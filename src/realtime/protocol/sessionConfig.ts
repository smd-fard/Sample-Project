import { z } from 'zod';

import { RealtimeConfig } from '../../config/RealtimeConfig';
import { RealtimeError } from './RealtimeError';
import { RealtimeErrorCodes } from './RealtimeErrorCodes';
import { ConversationItemCreateSchema } from './items';

/** The only input-transcription model the gateway advertises. */
export const SESSION_INPUT_TRANSCRIPTION_MODEL = 'inworld-stt';

/** The only audio format supported in either direction: 24 kHz 16-bit mono PCM. */
export const PCM_24K_FORMAT = { type: 'audio/pcm', rate: 24000 } as const;

/** Wire shape of `audio.input.format` / `audio.output.format`. */
export type AudioFormat = { type: 'audio/pcm'; rate: 24000 };

/**
 * Validates the format as a whole (not per field) so a wrong rate reports the
 * object path `audio.input.format`, which becomes the error `param`.
 */
export const AudioFormatSchema = z.custom<AudioFormat>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === PCM_24K_FORMAT.type &&
    (value as Record<string, unknown>).rate === PCM_24K_FORMAT.rate,
  { message: 'Only audio/pcm at 24000 Hz is supported' },
);

/** `['audio']` or `['text']` — a single output modality. */
export const OutputModalitiesSchema = z.union([
  z.tuple([z.literal('audio')]),
  z.tuple([z.literal('text')]),
]);
export type OutputModalities = z.infer<typeof OutputModalitiesSchema>;

/** Input transcription settings; `model` is echoed back as supplied. */
export const TranscriptionSchema = z.strictObject({
  model: z.string().default(SESSION_INPUT_TRANSCRIPTION_MODEL),
  language: z.string().optional(),
  prompt: z.string().optional(),
});
export type Transcription = z.infer<typeof TranscriptionSchema>;

const ServerVadSchema = z.strictObject({
  type: z.literal('server_vad'),
  threshold: z.number().min(0).max(1).default(0.5),
  prefix_padding_ms: z.number().int().min(0).default(300),
  silence_duration_ms: z.number().int().min(0).default(500),
  create_response: z.boolean().default(true),
  interrupt_response: z.boolean().default(true),
});

const SemanticVadSchema = z.strictObject({
  type: z.literal('semantic_vad'),
  eagerness: z.enum(['low', 'medium', 'high', 'auto']).default('auto'),
  create_response: z.boolean().default(true),
  interrupt_response: z.boolean().default(true),
});

/** Turn detection: `server_vad` or `semantic_vad` (use `null` to disable). */
export const TurnDetectionSchema = z.discriminatedUnion('type', [ServerVadSchema, SemanticVadSchema]);
export type TurnDetection = z.infer<typeof TurnDetectionSchema>;

/** OpenAI Realtime GA flat function-tool shape. */
export const ToolDefinitionSchema = z.strictObject({
  type: z.literal('function'),
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** `auto` | `none` | `required` | a named function. */
export const ToolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  z.strictObject({ type: z.literal('function'), name: z.string().min(1) }),
]);
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

const TemperatureSchema = z.number().min(0.6).max(1.2);
const MaxOutputTokensSchema = z.union([z.number().int().positive(), z.literal('inf')]);
const SpeedSchema = z.number().min(0.25).max(1.5);

const DEFAULT_TURN_DETECTION: TurnDetection = {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 500,
  create_response: true,
  interrupt_response: true,
};

/** Full effective session configuration (strict at every depth). */
export const SessionConfigSchema = z.strictObject({
  type: z.literal('realtime').default('realtime'),
  model: z.string().min(1),
  instructions: z.string().default(''),
  output_modalities: OutputModalitiesSchema.default(['audio']),
  audio: z.strictObject({
    input: z.strictObject({
      format: AudioFormatSchema.default(PCM_24K_FORMAT),
      transcription: TranscriptionSchema.nullable().default({ model: SESSION_INPUT_TRANSCRIPTION_MODEL }),
      turn_detection: TurnDetectionSchema.nullable().default(DEFAULT_TURN_DETECTION),
    }),
    output: z.strictObject({
      format: AudioFormatSchema.default(PCM_24K_FORMAT),
      voice: z.string().min(1),
      speed: SpeedSchema.default(1),
    }),
  }),
  tools: z.array(ToolDefinitionSchema).default([]),
  tool_choice: ToolChoiceSchema.default('auto'),
  temperature: TemperatureSchema.default(0.8),
  max_output_tokens: MaxOutputTokensSchema.default('inf'),
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

/**
 * Client `session.update` patch: the same shape with every field optional at
 * every depth (zod v4 has no `deepPartial`, so this is written by hand).
 * `turn_detection: null` disables VAD.
 */
export const SessionUpdateSchema = z.strictObject({
  type: z.literal('realtime').optional(),
  model: z.string().min(1).optional(),
  instructions: z.string().optional(),
  output_modalities: OutputModalitiesSchema.optional(),
  audio: z
    .strictObject({
      input: z
        .strictObject({
          format: AudioFormatSchema.optional(),
          transcription: z
            .strictObject({
              model: z.string().optional(),
              language: z.string().optional(),
              prompt: z.string().optional(),
            })
            .nullable()
            .optional(),
          turn_detection: TurnDetectionSchema.nullable().optional(),
        })
        .optional(),
      output: z
        .strictObject({
          format: AudioFormatSchema.optional(),
          voice: z.string().min(1).optional(),
          speed: SpeedSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  temperature: TemperatureSchema.optional(),
  max_output_tokens: MaxOutputTokensSchema.optional(),
});
export type SessionUpdate = z.infer<typeof SessionUpdateSchema>;

/** Per-response overrides carried by `response.create` → `response`. */
export const ResponseCreateOptionsSchema = z.strictObject({
  instructions: z.string().optional(),
  output_modalities: OutputModalitiesSchema.optional(),
  voice: z.string().min(1).optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  temperature: TemperatureSchema.optional(),
  max_output_tokens: MaxOutputTokensSchema.optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  conversation: z.enum(['auto', 'none']).optional(),
  input: z.array(ConversationItemCreateSchema).optional(),
});
export type ResponseCreateOptions = z.infer<typeof ResponseCreateOptionsSchema>;

/** The optional `response` field of a `response.create` client event. */
export const ResponseCreateSchema = ResponseCreateOptionsSchema.optional();
export type ResponseCreate = z.infer<typeof ResponseCreateSchema>;

/**
 * Effective defaults for a new session: voice from `config.ttsVoice`, `model`
 * from the `model` query param or `config.llmModel`, 24 kHz PCM both ways and
 * server VAD on. Parsed through `SessionConfigSchema` so the shape is guaranteed.
 */
export function defaultSessionConfig(config: RealtimeConfig, model?: string): SessionConfig {
  return SessionConfigSchema.parse({
    type: 'realtime',
    model: model !== undefined && model.trim() !== '' ? model : config.llmModel,
    instructions: '',
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { ...PCM_24K_FORMAT },
        transcription: { model: SESSION_INPUT_TRANSCRIPTION_MODEL },
        turn_detection: { ...DEFAULT_TURN_DETECTION },
      },
      output: {
        format: { ...PCM_24K_FORMAT },
        voice: config.ttsVoice,
        speed: 1,
      },
    },
    tools: [],
    tool_choice: 'auto',
    temperature: 0.8,
    max_output_tokens: 'inf',
  });
}

/** Keys whose values are always replaced wholesale rather than merged. */
const REPLACE_WHOLESALE = new Set<string>(['turn_detection', 'tool_choice']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively applies `patch` onto `target` (mutating `target`). */
function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = target[key];
    if (!REPLACE_WHOLESALE.has(key) && isPlainObject(value) && isPlainObject(existing)) {
      target[key] = deepMerge({ ...existing }, value);
    } else if (isPlainObject(value)) {
      target[key] = structuredClone(value);
    } else if (Array.isArray(value)) {
      target[key] = structuredClone(value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Deep-merges `patch` into a clone of `current` (objects merged recursively;
 * arrays, `turn_detection` and `tool_choice` replaced wholesale), then
 * re-validates the result. Throws `RealtimeError` (`invalid_value`,
 * `param = session.<path>`) before anything is assigned — the update is atomic.
 */
export function mergeSessionConfig(current: SessionConfig, patch: SessionUpdate): SessionConfig {
  const merged = deepMerge(
    structuredClone(current) as unknown as Record<string, unknown>,
    patch as unknown as Record<string, unknown>,
  );
  const result = SessionConfigSchema.safeParse(merged);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.map(String).join('.');
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.INVALID_VALUE,
      issue.message,
      path === '' ? 'session' : `session.${path}`,
    );
  }
  return result.data;
}
