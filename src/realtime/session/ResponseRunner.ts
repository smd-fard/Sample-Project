import { PCM_24K_BYTES_PER_MS } from '../audio/pcm';
import { SentenceSplitter } from '../audio/SentenceSplitter';
import { newCallId, newItemId } from '../protocol/ids';
import { ConversationItem, FunctionCallItem, MessageItem } from '../protocol/items';
import { RealtimeError } from '../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../protocol/RealtimeErrorCodes';
import { ResponseObject, ResponseStatus, ResponseStatusDetails, ServerEvent, ServerEvents } from '../protocol/serverEvents';
import { OutputModalities, ToolChoice, ToolDefinition } from '../protocol/sessionConfig';
import { LlmChatMessage, LlmClient, LlmToolChoice } from '../upstream/interfaces/LlmClient';
import { TtsContext, TtsContextHandlers } from '../upstream/interfaces/TtsClient';
import { Conversation } from './Conversation';

/** Where server events go (the connection's `send`). */
export type EventSink = (event: ServerEvent) => void;

/** Effective per-response settings (session config merged with `response.create` overrides). */
export interface ResponseSettings {
  instructions: string;
  outputModalities: OutputModalities;
  /** Resolved Inworld voice id. */
  voice: string;
  tools: ToolDefinition[];
  toolChoice: ToolChoice;
  temperature: number;
  maxOutputTokens: number | 'inf';
  speed: number;
  metadata?: Record<string, string> | null;
}

/** Metric callbacks fired once per response. */
export interface ResponseMetrics {
  onFirstToken(ms: number): void;
  onFirstAudio(ms: number): void;
  onSynthesized(chars: number): void;
}

/** Constructor options for `ResponseRunner`. */
export interface ResponseRunnerOptions {
  responseId: string;
  settings: ResponseSettings;
  messages: LlmChatMessage[];
  /** `null` for `conversation: 'none'` (no conversation writes). */
  conversation: Conversation | null;
  emit: EventSink;
  llm: LlmClient;
  llmModel: string;
  /** Lazy: only called for the audio modality on the first sentence. */
  ttsContextFactory: (contextId: string, handlers: TtsContextHandlers) => TtsContext;
  inputAudioMs: number;
  onMetrics: ResponseMetrics;
}

/**
 * One response's state machine: streams the LLM, fans text out to TTS (audio
 * modality) or straight to the client (text modality), relays tool calls, and
 * guarantees exactly one `response.done` through `settle()`.
 */
export class ResponseRunner {
  public readonly responseId: string;
  public onSettled: ((status: ResponseStatus) => void) | null = null;

  private readonly o: ResponseRunnerOptions;
  private messages: LlmChatMessage[];
  private readonly abort = new AbortController();
  private readonly splitter = new SentenceSplitter();
  private readonly output: ConversationItem[] = [];
  private readonly startedAt = Date.now();

  private message: MessageItem | null = null;
  private messageIndex = -1;
  private transcript = '';
  private audioMs = 0;
  private functionCall: FunctionCallItem | null = null;
  private functionCallIndex = -1;

  private tts: TtsContext | null = null;
  private pendingFlushes = 0;
  private llmDone = false;
  private settled = false;
  private usage: { inputTokens: number; outputTokens: number } | null = null;
  private outputCharacters = 0;
  private firstToken = false;
  private firstAudio = false;

  constructor(options: ResponseRunnerOptions) {
    this.o = options;
    this.messages = options.messages;
    this.responseId = options.responseId;
  }

  /** Replaces the LLM messages (used when the final transcript arrives after construction). */
  public setMessages(messages: LlmChatMessage[]): void {
    this.messages = messages;
  }

  /** Id of the assistant message item currently being written, or `null`. */
  public get writingItemId(): string | null {
    return this.message?.id ?? null;
  }

  /** `true` once `response.done` has been emitted. */
  public get isSettled(): boolean {
    return this.settled;
  }

  /** Emits `response.created` and drives the LLM stream. Never rejects. */
  public async start(): Promise<void> {
    this.o.emit(ServerEvents.responseCreated(this.responseObject('in_progress', null)));
    try {
      const stream = this.o.llm.streamChat(
        {
          model: this.o.llmModel,
          messages: this.messages,
          tools: this.o.settings.tools.length > 0
            ? this.o.settings.tools.map((t) => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.parameters },
              }))
            : undefined,
          tool_choice: ResponseRunner.toLlmToolChoice(this.o.settings.toolChoice),
          temperature: this.o.settings.temperature,
          max_tokens: this.o.settings.maxOutputTokens === 'inf' ? undefined : this.o.settings.maxOutputTokens,
        },
        this.abort.signal,
      );
      for await (const ev of stream) {
        if (this.settled) return;
        switch (ev.kind) {
          case 'text':
            this.onText(ev.delta);
            break;
          case 'tool_call':
            this.onToolCall(ev.index, ev.id, ev.name, ev.argumentsDelta);
            break;
          case 'usage':
            this.usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
            break;
          case 'done':
            break;
        }
      }
      if (this.settled) return;
      this.closeFunctionCall();
      const rest = this.splitter.flush();
      if (rest !== null && this.message !== null) this.emitSentence(rest);
      this.llmDone = true;
      this.maybeComplete();
    } catch (err) {
      if (!this.settled) this.fail(err);
    }
  }

  /** Aborts the LLM/TTS and emits `response.done` `cancelled`. */
  public cancel(reason: 'client_cancelled' | 'turn_detected'): void {
    if (this.settled) return;
    this.settle('cancelled', { type: 'cancelled', reason });
  }

  private onText(delta: string): void {
    if (delta === '') return;
    if (!this.firstToken) {
      this.firstToken = true;
      this.o.onMetrics.onFirstToken(Date.now() - this.startedAt);
    }
    this.closeFunctionCall();
    if (this.message === null) this.openMessage();
    const item = this.message as MessageItem;
    if (this.isAudio) {
      for (const sentence of this.splitter.push(delta)) this.emitSentence(sentence);
    } else {
      this.transcript += delta;
      this.o.emit(ServerEvents.outputTextDelta(this.responseId, item.id, this.messageIndex, 0, delta));
    }
  }

  private get isAudio(): boolean {
    return this.o.settings.outputModalities[0] === 'audio';
  }

  private openMessage(): void {
    const item: MessageItem = {
      id: newItemId(),
      object: 'realtime.item',
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    };
    this.message = item;
    this.messageIndex = this.output.length;
    this.output.push(item);
    this.o.conversation?.insert(item);
    this.o.emit(ServerEvents.outputItemAdded(this.responseId, this.messageIndex, item));
    const part = this.isAudio ? { type: 'output_audio' as const, transcript: '' } : { type: 'text' as const, text: '' };
    item.content.push(part);
    this.o.emit(ServerEvents.contentPartAdded(this.responseId, item.id, this.messageIndex, 0, part));
  }

  private emitSentence(sentence: string): void {
    const item = this.message as MessageItem;
    const delta = this.transcript === '' ? sentence : ` ${sentence}`;
    this.transcript += delta;
    this.o.emit(ServerEvents.outputAudioTranscriptDelta(this.responseId, item.id, this.messageIndex, 0, delta));
    this.outputCharacters += sentence.length;
    this.o.onMetrics.onSynthesized(sentence.length);
    if (this.tts === null) {
      this.tts = this.o.ttsContextFactory(this.responseId, {
        onAudio: (pcm) => this.onAudio(pcm),
        onFlushCompleted: () => {
          this.pendingFlushes = Math.max(0, this.pendingFlushes - 1);
          this.maybeComplete();
        },
        onClosed: () => {},
        onError: (err) => {
          if (!this.settled) this.fail(err);
        },
      });
    }
    this.tts.sendText(sentence);
    this.tts.flush();
    this.pendingFlushes++;
  }

  private onAudio(pcm: Buffer): void {
    if (this.settled || this.message === null || pcm.length === 0) return;
    if (!this.firstAudio) {
      this.firstAudio = true;
      this.o.onMetrics.onFirstAudio(Date.now() - this.startedAt);
    }
    const ms = pcm.length / PCM_24K_BYTES_PER_MS;
    this.audioMs += ms;
    this.o.conversation?.addAudioDuration(this.message.id, ms);
    this.o.emit(
      ServerEvents.outputAudioDelta(this.responseId, this.message.id, this.messageIndex, 0, pcm.toString('base64')),
    );
  }

  private onToolCall(index: number, id: string | undefined, name: string | undefined, argsDelta: string): void {
    if (this.functionCall === null || this.functionCallIndex !== index) {
      this.closeFunctionCall();
      this.closeMessage('completed');
      const item: FunctionCallItem = {
        id: newItemId(),
        object: 'realtime.item',
        type: 'function_call',
        status: 'in_progress',
        name: name ?? '',
        call_id: id ?? newCallId(),
        arguments: '',
      };
      this.functionCall = item;
      this.functionCallIndex = index;
      this.output.push(item);
      this.o.conversation?.insert(item);
      this.o.emit(ServerEvents.outputItemAdded(this.responseId, this.output.length - 1, item));
    }
    const fc = this.functionCall;
    if (name !== undefined && fc.name === '') fc.name = name;
    if (argsDelta !== '') {
      fc.arguments += argsDelta;
      this.o.emit(
        ServerEvents.functionCallArgumentsDelta(this.responseId, fc.id, this.output.indexOf(fc), fc.call_id, argsDelta),
      );
    }
  }

  private closeFunctionCall(status: 'completed' | 'incomplete' = 'completed'): void {
    const fc = this.functionCall;
    if (fc === null) return;
    this.functionCall = null;
    fc.status = status;
    const idx = this.output.indexOf(fc);
    this.o.emit(ServerEvents.functionCallArgumentsDone(this.responseId, fc.id, idx, fc.call_id, fc.arguments));
    this.o.emit(ServerEvents.outputItemDone(this.responseId, idx, fc));
    if (this.o.conversation !== null) {
      this.o.emit(ServerEvents.itemDone(fc, this.o.conversation.previousItemIdOf(fc.id)));
    }
  }

  private closeMessage(status: 'completed' | 'incomplete'): void {
    const item = this.message;
    if (item === null) return;
    this.message = null;
    item.status = status;
    const part = item.content[0];
    if (part.type === 'output_audio') {
      part.transcript = this.transcript;
      this.o.emit(
        ServerEvents.outputAudioTranscriptDone(this.responseId, item.id, this.messageIndex, 0, this.transcript),
      );
      this.o.emit(ServerEvents.outputAudioDone(this.responseId, item.id, this.messageIndex, 0));
    } else if (part.type === 'text') {
      part.text = this.transcript;
      this.o.emit(ServerEvents.outputTextDone(this.responseId, item.id, this.messageIndex, 0, this.transcript));
    }
    this.o.emit(ServerEvents.contentPartDone(this.responseId, item.id, this.messageIndex, 0, part));
    this.o.emit(ServerEvents.outputItemDone(this.responseId, this.messageIndex, item));
    if (this.o.conversation !== null) {
      this.o.emit(ServerEvents.itemDone(item, this.o.conversation.previousItemIdOf(item.id)));
    }
  }

  private maybeComplete(): void {
    if (this.settled || !this.llmDone || this.pendingFlushes > 0) return;
    this.settle('completed', null);
  }

  private fail(err: unknown): void {
    const e =
      err instanceof RealtimeError
        ? err
        : RealtimeError.serverError(
            RealtimeErrorCodes.LLM_REQUEST_FAILED,
            err instanceof Error ? err.message : 'Response failed',
          );
    this.settle('failed', { type: 'failed', error: { type: e.type, code: e.code, message: e.message } });
  }

  /** Emits exactly one `response.done` (then `rate_limits.updated`) regardless of how completion/cancel/failure race. */
  private settle(status: ResponseStatus, details: ResponseStatusDetails): void {
    if (this.settled) return;
    this.settled = true;
    this.abort.abort();
    try {
      this.tts?.close();
    } catch {
      // ignore
    }
    const itemStatus = status === 'completed' ? 'completed' : 'incomplete';
    this.closeFunctionCall(itemStatus);
    this.closeMessage(itemStatus);
    this.o.emit(ServerEvents.responseDone(this.responseObject(status, details)));
    this.o.emit(ServerEvents.rateLimitsUpdated());
    this.onSettled?.(status);
  }

  private responseObject(status: ResponseStatus, details: ResponseStatusDetails): ResponseObject {
    const input = this.usage?.inputTokens ?? 0;
    const output = this.usage?.outputTokens ?? 0;
    return {
      id: this.responseId,
      object: 'realtime.response',
      status,
      status_details: details,
      output: [...this.output],
      usage:
        status === 'in_progress'
          ? null
          : {
              total_tokens: input + output,
              input_tokens: input,
              output_tokens: output,
              input_token_details: { input_audio_ms: this.o.inputAudioMs },
              output_token_details: { output_characters: this.outputCharacters },
            },
      conversation_id: this.o.conversation === null ? null : undefined,
      metadata: this.o.settings.metadata ?? null,
    };
  }

  private static toLlmToolChoice(choice: ToolChoice): LlmToolChoice {
    return typeof choice === 'string' ? choice : { type: 'function', function: { name: choice.name } };
  }
}
