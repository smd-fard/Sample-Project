import { z } from 'zod';

/** Who authored a `message` item. */
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** Lifecycle state of a conversation item. */
export const ItemStatusSchema = z.enum(['in_progress', 'completed', 'incomplete']);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/**
 * Content parts as stored and emitted by the server. Audio bytes are never
 * carried on items — `input_audio` / `output_audio` expose only the transcript.
 */
export const ContentPartSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('input_text'), text: z.string() }),
  z.strictObject({ type: z.literal('input_audio'), transcript: z.string().nullable() }),
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('output_audio'), transcript: z.string() }),
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

/** Server-side conversation item (stored and emitted on the wire). */
export const ConversationItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: z.string(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('message'),
    role: MessageRoleSchema,
    status: ItemStatusSchema,
    content: z.array(ContentPartSchema),
  }),
  z.strictObject({
    id: z.string(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('function_call'),
    status: ItemStatusSchema,
    name: z.string(),
    call_id: z.string(),
    arguments: z.string(),
  }),
  z.strictObject({
    id: z.string(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('function_call_output'),
    status: ItemStatusSchema,
    call_id: z.string(),
    output: z.string(),
  }),
]);
export type ConversationItem = z.infer<typeof ConversationItemSchema>;
export type MessageItem = Extract<ConversationItem, { type: 'message' }>;
export type FunctionCallItem = Extract<ConversationItem, { type: 'function_call' }>;
export type FunctionCallOutputItem = Extract<ConversationItem, { type: 'function_call_output' }>;

/**
 * Content parts a client may supply on `conversation.item.create`. For
 * `input_audio`, `audio` (base64) is accepted for wire compatibility but
 * ignored — only the transcript is retained.
 */
export const ContentPartCreateSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('input_text'), text: z.string() }),
  z.strictObject({
    type: z.literal('input_audio'),
    audio: z.string().optional(),
    transcript: z.string().nullable().optional(),
  }),
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('output_audio'), transcript: z.string() }),
]);
export type ContentPartCreate = z.infer<typeof ContentPartCreateSchema>;

/**
 * Client-supplied subset of a conversation item: no `status` (server-owned),
 * optional `id` (generated when absent).
 */
export const ConversationItemCreateSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: z.string().optional(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('message'),
    role: MessageRoleSchema,
    content: z.array(ContentPartCreateSchema),
  }),
  z.strictObject({
    id: z.string().optional(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('function_call'),
    name: z.string(),
    call_id: z.string(),
    arguments: z.string(),
  }),
  z.strictObject({
    id: z.string().optional(),
    object: z.literal('realtime.item').optional(),
    type: z.literal('function_call_output'),
    call_id: z.string(),
    output: z.string(),
  }),
]);
export type ConversationItemCreate = z.infer<typeof ConversationItemCreateSchema>;
