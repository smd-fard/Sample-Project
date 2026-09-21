import { RealtimeErrorPayload } from './RealtimeError';
import { newEventId } from './ids';
import { ContentPart, ConversationItem } from './items';
import { SessionConfig } from './sessionConfig';

/**
 * Every server → client event name in one place. A future beta-dialect shim
 * only needs to remap this table.
 */
export const ServerEventType = {
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  ERROR: 'error',
  INPUT_AUDIO_BUFFER_SPEECH_STARTED: 'input_audio_buffer.speech_started',
  INPUT_AUDIO_BUFFER_SPEECH_STOPPED: 'input_audio_buffer.speech_stopped',
  INPUT_AUDIO_BUFFER_COMMITTED: 'input_audio_buffer.committed',
  INPUT_AUDIO_BUFFER_CLEARED: 'input_audio_buffer.cleared',
  CONVERSATION_ITEM_CREATED: 'conversation.item.created',
  CONVERSATION_ITEM_ADDED: 'conversation.item.added',
  CONVERSATION_ITEM_DONE: 'conversation.item.done',
  CONVERSATION_ITEM_RETRIEVED: 'conversation.item.retrieved',
  CONVERSATION_ITEM_DELETED: 'conversation.item.deleted',
  CONVERSATION_ITEM_TRUNCATED: 'conversation.item.truncated',
  CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_DELTA: 'conversation.item.input_audio_transcription.delta',
  CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED: 'conversation.item.input_audio_transcription.completed',
  RESPONSE_CREATED: 'response.created',
  RESPONSE_DONE: 'response.done',
  RESPONSE_OUTPUT_ITEM_ADDED: 'response.output_item.added',
  RESPONSE_OUTPUT_ITEM_DONE: 'response.output_item.done',
  RESPONSE_CONTENT_PART_ADDED: 'response.content_part.added',
  RESPONSE_CONTENT_PART_DONE: 'response.content_part.done',
  RESPONSE_OUTPUT_TEXT_DELTA: 'response.output_text.delta',
  RESPONSE_OUTPUT_TEXT_DONE: 'response.output_text.done',
  RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA: 'response.output_audio_transcript.delta',
  RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE: 'response.output_audio_transcript.done',
  RESPONSE_OUTPUT_AUDIO_DELTA: 'response.output_audio.delta',
  RESPONSE_OUTPUT_AUDIO_DONE: 'response.output_audio.done',
  RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA: 'response.function_call_arguments.delta',
  RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE: 'response.function_call_arguments.done',
  RATE_LIMITS_UPDATED: 'rate_limits.updated',
} as const;

/** Union of every server event name. */
export type ServerEventTypeName = (typeof ServerEventType)[keyof typeof ServerEventType];

/** Base shape every server event extends; use this as the event-sink type. */
export interface ServerEvent {
  type: string;
  event_id: string;
}

/** The `session` object emitted on `session.created` / `session.updated`. */
export type SessionObject = SessionConfig & { id: string; object: 'realtime.session' };

/** Terminal and in-flight response states. */
export type ResponseStatus = 'in_progress' | 'completed' | 'cancelled' | 'incomplete' | 'failed';

/** Why a response ended early, when it did. */
export type ResponseStatusDetails =
  | null
  | { type: 'cancelled'; reason: 'client_cancelled' | 'turn_detected' }
  | { type: 'failed'; error: { type: string; code: string; message: string } };

/** Token/usage accounting for one response (audio ms and TTS characters as extensions). */
export interface ResponseUsage {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  input_token_details: { input_audio_ms: number; text_tokens?: number; audio_tokens?: number };
  output_token_details: { output_characters: number; text_tokens?: number; audio_tokens?: number };
}

/** The `response` object emitted on `response.created` / `response.done`. */
export interface ResponseObject {
  id: string;
  object: 'realtime.response';
  status: ResponseStatus;
  status_details: ResponseStatusDetails;
  output: ConversationItem[];
  usage: ResponseUsage | null;
  conversation_id?: string | null;
  metadata?: Record<string, string> | null;
}

/** One `rate_limits.updated` entry. */
export interface RateLimit {
  name: 'requests' | 'tokens';
  limit: number;
  remaining: number;
  reset_seconds: number;
}

export interface SessionCreatedEvent extends ServerEvent {
  type: typeof ServerEventType.SESSION_CREATED;
  session: SessionObject;
}

export interface SessionUpdatedEvent extends ServerEvent {
  type: typeof ServerEventType.SESSION_UPDATED;
  session: SessionObject;
}

export interface ErrorEvent extends ServerEvent {
  type: typeof ServerEventType.ERROR;
  error: RealtimeErrorPayload;
}

export interface InputAudioBufferSpeechStartedEvent extends ServerEvent {
  type: typeof ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED;
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedEvent extends ServerEvent {
  type: typeof ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED;
  audio_end_ms: number;
  item_id: string;
}

export interface InputAudioBufferCommittedEvent extends ServerEvent {
  type: typeof ServerEventType.INPUT_AUDIO_BUFFER_COMMITTED;
  previous_item_id: string | null;
  item_id: string;
}

export interface InputAudioBufferClearedEvent extends ServerEvent {
  type: typeof ServerEventType.INPUT_AUDIO_BUFFER_CLEARED;
}

export interface ConversationItemCreatedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_CREATED;
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ConversationItemAddedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_ADDED;
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ConversationItemDoneEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_DONE;
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ConversationItemRetrievedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_RETRIEVED;
  item: ConversationItem;
}

export interface ConversationItemDeletedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_DELETED;
  item_id: string;
}

export interface ConversationItemTruncatedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_TRUNCATED;
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ConversationItemInputAudioTranscriptionDeltaEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_DELTA;
  item_id: string;
  content_index: number;
  delta: string;
}

export interface ConversationItemInputAudioTranscriptionCompletedEvent extends ServerEvent {
  type: typeof ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED;
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ResponseCreatedEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_CREATED;
  response: ResponseObject;
}

export interface ResponseDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_DONE;
  response: ResponseObject;
}

export interface ResponseOutputItemAddedEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_ITEM_ADDED;
  response_id: string;
  output_index: number;
  item: ConversationItem;
}

export interface ResponseOutputItemDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_ITEM_DONE;
  response_id: string;
  output_index: number;
  item: ConversationItem;
}

export interface ResponseContentPartAddedEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_CONTENT_PART_ADDED;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseContentPartDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_CONTENT_PART_DONE;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseOutputTextDeltaEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_TEXT_DELTA;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseOutputTextDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_TEXT_DONE;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseOutputAudioTranscriptDeltaEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseOutputAudioTranscriptDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

export interface ResponseOutputAudioDeltaEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_AUDIO_DELTA;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  /** Base64-encoded 24 kHz 16-bit mono PCM. */
  delta: string;
}

export interface ResponseOutputAudioDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_OUTPUT_AUDIO_DONE;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

export interface ResponseFunctionCallArgumentsDeltaEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA;
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent extends ServerEvent {
  type: typeof ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE;
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  arguments: string;
}

export interface RateLimitsUpdatedEvent extends ServerEvent {
  type: typeof ServerEventType.RATE_LIMITS_UPDATED;
  rate_limits: RateLimit[];
}

/** Discriminated union of every server event payload. */
export type AnyServerEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | ErrorEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | InputAudioBufferCommittedEvent
  | InputAudioBufferClearedEvent
  | ConversationItemCreatedEvent
  | ConversationItemAddedEvent
  | ConversationItemDoneEvent
  | ConversationItemRetrievedEvent
  | ConversationItemDeletedEvent
  | ConversationItemTruncatedEvent
  | ConversationItemInputAudioTranscriptionDeltaEvent
  | ConversationItemInputAudioTranscriptionCompletedEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseOutputAudioTranscriptDeltaEvent
  | ResponseOutputAudioTranscriptDoneEvent
  | ResponseOutputAudioDeltaEvent
  | ResponseOutputAudioDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | RateLimitsUpdatedEvent;

/** Placeholder limits reported on `rate_limits.updated` (the gateway enforces none). */
const PLACEHOLDER_RATE_LIMITS: readonly RateLimit[] = Object.freeze([
  { name: 'requests', limit: 1000, remaining: 1000, reset_seconds: 0 },
  { name: 'tokens', limit: 1000000, remaining: 1000000, reset_seconds: 0 },
]);

/**
 * Factory for every server event. Each method stamps a fresh `event_id` and
 * returns a plain payload ready for `JSON.stringify`.
 */
export class ServerEvents {
  static sessionCreated(session: SessionObject): SessionCreatedEvent {
    return { type: ServerEventType.SESSION_CREATED, event_id: newEventId(), session };
  }

  static sessionUpdated(session: SessionObject): SessionUpdatedEvent {
    return { type: ServerEventType.SESSION_UPDATED, event_id: newEventId(), session };
  }

  static error(payload: RealtimeErrorPayload): ErrorEvent {
    return { type: ServerEventType.ERROR, event_id: newEventId(), error: payload };
  }

  static speechStarted(audioStartMs: number, itemId: string): InputAudioBufferSpeechStartedEvent {
    return {
      type: ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
      event_id: newEventId(),
      audio_start_ms: audioStartMs,
      item_id: itemId,
    };
  }

  static speechStopped(audioEndMs: number, itemId: string): InputAudioBufferSpeechStoppedEvent {
    return {
      type: ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED,
      event_id: newEventId(),
      audio_end_ms: audioEndMs,
      item_id: itemId,
    };
  }

  static committed(previousItemId: string | null, itemId: string): InputAudioBufferCommittedEvent {
    return {
      type: ServerEventType.INPUT_AUDIO_BUFFER_COMMITTED,
      event_id: newEventId(),
      previous_item_id: previousItemId,
      item_id: itemId,
    };
  }

  static cleared(): InputAudioBufferClearedEvent {
    return { type: ServerEventType.INPUT_AUDIO_BUFFER_CLEARED, event_id: newEventId() };
  }

  static itemCreated(item: ConversationItem, previousItemId: string | null): ConversationItemCreatedEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_CREATED,
      event_id: newEventId(),
      previous_item_id: previousItemId,
      item,
    };
  }

  static itemAdded(item: ConversationItem, previousItemId: string | null): ConversationItemAddedEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_ADDED,
      event_id: newEventId(),
      previous_item_id: previousItemId,
      item,
    };
  }

  static itemDone(item: ConversationItem, previousItemId: string | null): ConversationItemDoneEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_DONE,
      event_id: newEventId(),
      previous_item_id: previousItemId,
      item,
    };
  }

  static itemRetrieved(item: ConversationItem): ConversationItemRetrievedEvent {
    return { type: ServerEventType.CONVERSATION_ITEM_RETRIEVED, event_id: newEventId(), item };
  }

  static itemDeleted(itemId: string): ConversationItemDeletedEvent {
    return { type: ServerEventType.CONVERSATION_ITEM_DELETED, event_id: newEventId(), item_id: itemId };
  }

  static itemTruncated(itemId: string, contentIndex: number, audioEndMs: number): ConversationItemTruncatedEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_TRUNCATED,
      event_id: newEventId(),
      item_id: itemId,
      content_index: contentIndex,
      audio_end_ms: audioEndMs,
    };
  }

  static inputAudioTranscriptionDelta(
    itemId: string,
    contentIndex: number,
    delta: string,
  ): ConversationItemInputAudioTranscriptionDeltaEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_DELTA,
      event_id: newEventId(),
      item_id: itemId,
      content_index: contentIndex,
      delta,
    };
  }

  static inputAudioTranscriptionCompleted(
    itemId: string,
    contentIndex: number,
    transcript: string,
  ): ConversationItemInputAudioTranscriptionCompletedEvent {
    return {
      type: ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
      event_id: newEventId(),
      item_id: itemId,
      content_index: contentIndex,
      transcript,
    };
  }

  static responseCreated(response: ResponseObject): ResponseCreatedEvent {
    return { type: ServerEventType.RESPONSE_CREATED, event_id: newEventId(), response };
  }

  static responseDone(response: ResponseObject): ResponseDoneEvent {
    return { type: ServerEventType.RESPONSE_DONE, event_id: newEventId(), response };
  }

  static outputItemAdded(responseId: string, outputIndex: number, item: ConversationItem): ResponseOutputItemAddedEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_ITEM_ADDED,
      event_id: newEventId(),
      response_id: responseId,
      output_index: outputIndex,
      item,
    };
  }

  static outputItemDone(responseId: string, outputIndex: number, item: ConversationItem): ResponseOutputItemDoneEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_ITEM_DONE,
      event_id: newEventId(),
      response_id: responseId,
      output_index: outputIndex,
      item,
    };
  }

  static contentPartAdded(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    part: ContentPart,
  ): ResponseContentPartAddedEvent {
    return {
      type: ServerEventType.RESPONSE_CONTENT_PART_ADDED,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    };
  }

  static contentPartDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    part: ContentPart,
  ): ResponseContentPartDoneEvent {
    return {
      type: ServerEventType.RESPONSE_CONTENT_PART_DONE,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    };
  }

  static outputTextDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    delta: string,
  ): ResponseOutputTextDeltaEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_TEXT_DELTA,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta,
    };
  }

  static outputTextDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    text: string,
  ): ResponseOutputTextDoneEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_TEXT_DONE,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      text,
    };
  }

  static outputAudioTranscriptDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    delta: string,
  ): ResponseOutputAudioTranscriptDeltaEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta,
    };
  }

  static outputAudioTranscriptDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    transcript: string,
  ): ResponseOutputAudioTranscriptDoneEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      transcript,
    };
  }

  static outputAudioDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    deltaBase64: string,
  ): ResponseOutputAudioDeltaEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_AUDIO_DELTA,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta: deltaBase64,
    };
  }

  static outputAudioDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
  ): ResponseOutputAudioDoneEvent {
    return {
      type: ServerEventType.RESPONSE_OUTPUT_AUDIO_DONE,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
    };
  }

  static functionCallArgumentsDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    callId: string,
    delta: string,
  ): ResponseFunctionCallArgumentsDeltaEvent {
    return {
      type: ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      call_id: callId,
      delta,
    };
  }

  static functionCallArgumentsDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    callId: string,
    args: string,
  ): ResponseFunctionCallArgumentsDoneEvent {
    return {
      type: ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE,
      event_id: newEventId(),
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      call_id: callId,
      arguments: args,
    };
  }

  static rateLimitsUpdated(): RateLimitsUpdatedEvent {
    return {
      type: ServerEventType.RATE_LIMITS_UPDATED,
      event_id: newEventId(),
      rate_limits: PLACEHOLDER_RATE_LIMITS.map((limit) => ({ ...limit })),
    };
  }
}
