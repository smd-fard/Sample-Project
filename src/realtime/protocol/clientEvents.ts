import { z, ZodType } from 'zod';

import { validateDto } from '../../common/http/validateDto';
import { RealtimeError } from './RealtimeError';
import { RealtimeErrorCodes } from './RealtimeErrorCodes';
import { ConversationItemCreateSchema } from './items';
import { ResponseCreateSchema, SessionUpdateSchema } from './sessionConfig';

/** Maximum accepted `audio` length (base64 characters) for one append: 15 MiB. */
export const MAX_APPEND_BASE64_LENGTH = 15 * 1024 * 1024;

/** Minimal envelope every client event must satisfy before type dispatch. */
export const ClientEventEnvelopeSchema = z.object({
  type: z.string(),
  event_id: z.string().optional(),
});
export type ClientEventEnvelope = z.infer<typeof ClientEventEnvelopeSchema>;

const eventId = z.string().optional();

/** `session.update` — patch the session configuration. */
export const SessionUpdateEventSchema = z.strictObject({
  type: z.literal('session.update'),
  event_id: eventId,
  session: SessionUpdateSchema,
});
export type SessionUpdateEvent = z.infer<typeof SessionUpdateEventSchema>;

/** `input_audio_buffer.append` — base64 PCM chunk (size pre-checked in `parseClientEvent`). */
export const InputAudioBufferAppendEventSchema = z.strictObject({
  type: z.literal('input_audio_buffer.append'),
  event_id: eventId,
  audio: z.string(),
});
export type InputAudioBufferAppendEvent = z.infer<typeof InputAudioBufferAppendEventSchema>;

/** `input_audio_buffer.commit` — turn the buffer into a user message item. */
export const InputAudioBufferCommitEventSchema = z.strictObject({
  type: z.literal('input_audio_buffer.commit'),
  event_id: eventId,
});
export type InputAudioBufferCommitEvent = z.infer<typeof InputAudioBufferCommitEventSchema>;

/** `input_audio_buffer.clear` — discard buffered audio. */
export const InputAudioBufferClearEventSchema = z.strictObject({
  type: z.literal('input_audio_buffer.clear'),
  event_id: eventId,
});
export type InputAudioBufferClearEvent = z.infer<typeof InputAudioBufferClearEventSchema>;

/** `conversation.item.create` — insert an item (optionally after `previous_item_id`). */
export const ConversationItemCreateEventSchema = z.strictObject({
  type: z.literal('conversation.item.create'),
  event_id: eventId,
  item: ConversationItemCreateSchema,
  previous_item_id: z.string().nullable().optional(),
});
export type ConversationItemCreateEvent = z.infer<typeof ConversationItemCreateEventSchema>;

/** `conversation.item.retrieve` — fetch an item by id. */
export const ConversationItemRetrieveEventSchema = z.strictObject({
  type: z.literal('conversation.item.retrieve'),
  event_id: eventId,
  item_id: z.string(),
});
export type ConversationItemRetrieveEvent = z.infer<typeof ConversationItemRetrieveEventSchema>;

/** `conversation.item.truncate` — cut an assistant audio part at `audio_end_ms`. */
export const ConversationItemTruncateEventSchema = z.strictObject({
  type: z.literal('conversation.item.truncate'),
  event_id: eventId,
  item_id: z.string(),
  content_index: z.number().int().min(0),
  audio_end_ms: z.number().int().min(0),
});
export type ConversationItemTruncateEvent = z.infer<typeof ConversationItemTruncateEventSchema>;

/** `conversation.item.delete` — remove an item. */
export const ConversationItemDeleteEventSchema = z.strictObject({
  type: z.literal('conversation.item.delete'),
  event_id: eventId,
  item_id: z.string(),
});
export type ConversationItemDeleteEvent = z.infer<typeof ConversationItemDeleteEventSchema>;

/** `response.create` — start a model response with optional overrides. */
export const ResponseCreateEventSchema = z.strictObject({
  type: z.literal('response.create'),
  event_id: eventId,
  response: ResponseCreateSchema,
});
export type ResponseCreateEvent = z.infer<typeof ResponseCreateEventSchema>;

/** `response.cancel` — cancel the active (or the named) response. */
export const ResponseCancelEventSchema = z.strictObject({
  type: z.literal('response.cancel'),
  event_id: eventId,
  response_id: z.string().optional(),
});
export type ResponseCancelEvent = z.infer<typeof ResponseCancelEventSchema>;

/** Every supported client event schema keyed by its `type`. */
export const CLIENT_EVENT_SCHEMAS = {
  'session.update': SessionUpdateEventSchema,
  'input_audio_buffer.append': InputAudioBufferAppendEventSchema,
  'input_audio_buffer.commit': InputAudioBufferCommitEventSchema,
  'input_audio_buffer.clear': InputAudioBufferClearEventSchema,
  'conversation.item.create': ConversationItemCreateEventSchema,
  'conversation.item.retrieve': ConversationItemRetrieveEventSchema,
  'conversation.item.truncate': ConversationItemTruncateEventSchema,
  'conversation.item.delete': ConversationItemDeleteEventSchema,
  'response.create': ResponseCreateEventSchema,
  'response.cancel': ResponseCancelEventSchema,
} as const;

/** The `type` of every supported client event. */
export type ClientEventType = keyof typeof CLIENT_EVENT_SCHEMAS;

/** Discriminated union of every validated client event. */
export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | ConversationItemCreateEvent
  | ConversationItemRetrieveEvent
  | ConversationItemTruncateEvent
  | ConversationItemDeleteEvent
  | ResponseCreateEvent
  | ResponseCancelEvent;

/** True when `type` names a supported client event. */
export function isClientEventType(type: string): type is ClientEventType {
  return Object.prototype.hasOwnProperty.call(CLIENT_EVENT_SCHEMAS, type);
}

/**
 * Parses one raw WebSocket frame into a validated client event.
 * Throws `RealtimeError` for malformed JSON (`invalid_json`), a missing/invalid
 * envelope (`invalid_value`, `param: 'type'`), an unknown `type`
 * (`unknown_event_type`) or an oversized append (`payload_too_large`);
 * per-event schema failures propagate as `ValidationError` (mapped by `toErrorEvent`).
 */
export function parseClientEvent(raw: string | Buffer): ClientEvent {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw RealtimeError.invalidRequest(RealtimeErrorCodes.INVALID_JSON, 'Invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.INVALID_VALUE,
      'Client event must be a JSON object with a string "type"',
      'type',
    );
  }

  const envelope = ClientEventEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const issue = envelope.error.issues[0];
    const param = issue !== undefined && issue.path.length > 0 ? issue.path.map(String).join('.') : 'type';
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.INVALID_VALUE,
      param === 'type' ? 'Missing or invalid "type"' : issue.message,
      param,
    );
  }

  const { type } = envelope.data;
  if (!isClientEventType(type)) {
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.UNKNOWN_EVENT_TYPE,
      `Unknown event type: ${type}`,
      'type',
    );
  }

  if (type === 'input_audio_buffer.append') {
    const audio = (parsed as Record<string, unknown>).audio;
    if (typeof audio === 'string' && audio.length > MAX_APPEND_BASE64_LENGTH) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.PAYLOAD_TOO_LARGE,
        `audio exceeds the maximum of ${MAX_APPEND_BASE64_LENGTH} base64 characters`,
        'audio',
      );
    }
  }

  const schema = CLIENT_EVENT_SCHEMAS[type] as unknown as ZodType<ClientEvent>;
  return validateDto(parsed, schema);
}
