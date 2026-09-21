/** Role of a chat message in the OpenAI chat-completions wire format. */
export type LlmChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** A completed tool call emitted by the assistant (OpenAI wire shape). */
export interface LlmToolCall {
  /** Provider-assigned call id, echoed back in the matching `tool` message. */
  id: string;
  /** Always `'function'`. */
  type: 'function';
  /** The function name and its JSON-encoded arguments string. */
  function: { name: string; arguments: string };
}

/** A single message in OpenAI chat-completions format, discriminated by `role`. */
export type LlmChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** A function tool the model may call, with an optional JSON-schema `parameters` object. */
export interface LlmToolDefinition {
  /** Always `'function'`. */
  type: 'function';
  /** Function name, description and JSON-schema parameters. */
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

/** Tool-selection policy: let the model decide, forbid, require, or force a named function. */
export type LlmToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/** A streaming chat-completions request in OpenAI wire shape. */
export interface LlmChatRequest {
  /** Upstream model identifier. */
  model: string;
  /** Conversation history in OpenAI chat format. */
  messages: LlmChatMessage[];
  /** Tools the model may call. */
  tools?: LlmToolDefinition[];
  /** Tool-selection policy. */
  tool_choice?: LlmToolChoice;
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum output tokens. */
  max_tokens?: number;
}

/** Normalized streaming events yielded by `LlmClient.streamChat`, discriminated by `kind`. */
export type LlmStreamEvent =
  /** Incremental assistant text. */
  | { kind: 'text'; delta: string }
  /** Incremental tool-call data; `id`/`name` arrive on the first chunk for a given `index`. */
  | { kind: 'tool_call'; index: number; id?: string; name?: string; argumentsDelta: string }
  /** Token usage for the completed request. */
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  /** Terminal event; `finishReason` is the provider's stop reason or `null` if unknown. */
  | { kind: 'done'; finishReason: string | null };

/** Streaming chat client against an upstream LLM provider. */
export interface LlmClient {
  /** Streams a chat completion; aborting `signal` cancels the upstream request and ends the iterable. */
  streamChat(request: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmStreamEvent>;
}
