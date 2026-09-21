import { Inject, Service } from 'typedi';
import { RealtimeConfig } from '../../../config/RealtimeConfig';
import { RealtimeError } from '../../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../../protocol/RealtimeErrorCodes';
import type { LlmChatRequest, LlmClient, LlmStreamEvent } from '../interfaces/LlmClient';

/** Maximum number of characters of an upstream error body echoed into the thrown error message. */
const MAX_ERROR_BODY_CHARS = 500;

/** One streamed tool-call fragment in the OpenAI chat-completions SSE dialect. */
interface InworldToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** One parsed `data:` chunk in the OpenAI chat-completions SSE dialect. */
interface InworldChatChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: InworldToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Streaming chat-completions client for Inworld's OpenAI-compatible LLM endpoint.
 * Posts `<base>/v1/chat/completions` with `stream: true`, reads the SSE body and
 * normalizes each chunk into `LlmStreamEvent`s. Aborting the signal ends the
 * iterator silently; HTTP and network failures surface as `RealtimeError`s.
 */
@Service()
export class InworldLlmClient implements LlmClient {
  /** Fetch implementation used for the upstream call; overridable in tests. */
  public fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

  constructor(@Inject() private readonly config: RealtimeConfig) {}

  /** Streams a chat completion; aborting `signal` cancels the upstream request and ends the iterable. */
  public async *streamChat(request: LlmChatRequest, signal: AbortSignal): AsyncGenerator<LlmStreamEvent> {
    const response = await this.openStream(request, signal);
    if (response === null) return;

    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    if (response.body === null) {
      throw RealtimeError.serverError(
        RealtimeErrorCodes.LLM_REQUEST_FAILED,
        'LLM request failed: empty response body',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let doneEmitted = false;

    try {
      while (true) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          if (this.isAbort(error, signal)) return;
          throw RealtimeError.serverError(
            RealtimeErrorCodes.LLM_REQUEST_FAILED,
            `LLM stream failed: ${this.describe(error)}`,
          );
        }
        if (result.done) break;

        carry += decoder.decode(result.value, { stream: true });
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';

        for (const line of lines) {
          const outcome = this.parseLine(line);
          if (outcome === 'done') return;
          if (outcome === null) continue;
          for (const event of this.toEvents(outcome, doneEmitted)) {
            if (event.kind === 'done') doneEmitted = true;
            yield event;
          }
        }
      }

      const tail = carry.trim();
      if (tail !== '') {
        const outcome = this.parseLine(tail);
        if (outcome !== null && outcome !== 'done') {
          for (const event of this.toEvents(outcome, doneEmitted)) {
            if (event.kind === 'done') doneEmitted = true;
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Issues the upstream request; returns `null` when the signal aborted before or during connect. */
  private async openStream(request: LlmChatRequest, signal: AbortSignal): Promise<Response | null> {
    if (signal.aborted) return null;
    const url = `${this.config.inworldBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const body = {
      ...request,
      model: request.model,
      stream: true,
      stream_options: { include_usage: true },
    };

    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.inworldApiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (this.isAbort(error, signal)) return null;
      throw RealtimeError.serverError(
        RealtimeErrorCodes.LLM_REQUEST_FAILED,
        `LLM request failed: ${this.describe(error)}`,
      );
    }
  }

  /** Builds the error for a non-2xx response, reading and truncating the body for the message. */
  private async toHttpError(response: Response): Promise<RealtimeError> {
    let text = '';
    try {
      text = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } catch {
      text = '';
    }
    const code =
      response.status === 401 || response.status === 403
        ? RealtimeErrorCodes.UPSTREAM_AUTH_FAILED
        : RealtimeErrorCodes.LLM_REQUEST_FAILED;
    return RealtimeError.serverError(code, `LLM request failed (${response.status}): ${text}`);
  }

  /** Parses one SSE line: returns the chunk, `'done'` for the sentinel, or `null` to skip. */
  private parseLine(line: string): InworldChatChunk | 'done' | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice('data:'.length).trim();
    if (payload === '') return null;
    if (payload === '[DONE]') return 'done';
    try {
      return JSON.parse(payload) as InworldChatChunk;
    } catch {
      return null;
    }
  }

  /** Normalizes one parsed chunk into zero or more stream events. */
  private toEvents(chunk: InworldChatChunk, doneEmitted: boolean): LlmStreamEvent[] {
    const events: LlmStreamEvent[] = [];
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;

    if (typeof delta?.content === 'string' && delta.content !== '') {
      events.push({ kind: 'text', delta: delta.content });
    }

    if (Array.isArray(delta?.tool_calls)) {
      delta.tool_calls.forEach((tc, position) => {
        const event: LlmStreamEvent = {
          kind: 'tool_call',
          index: typeof tc.index === 'number' ? tc.index : position,
          argumentsDelta: tc.function?.arguments ?? '',
        };
        if (tc.id !== undefined) event.id = tc.id;
        if (tc.function?.name !== undefined) event.name = tc.function.name;
        events.push(event);
      });
    }

    if (chunk.usage) {
      events.push({
        kind: 'usage',
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      });
    }

    if (!doneEmitted && choice?.finish_reason !== undefined && choice.finish_reason !== null) {
      events.push({ kind: 'done', finishReason: choice.finish_reason });
    }

    return events;
  }

  /** True when the error is an abort (by name) or the signal has been aborted. */
  private isAbort(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return true;
    return error instanceof Error && error.name === 'AbortError';
  }

  /** Renders an unknown thrown value as a message string. */
  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
