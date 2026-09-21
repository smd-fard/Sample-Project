/**
 * Runtime configuration for the realtime gateway and the Inworld cascade
 * (LLM → STT → TTS). A plain class so it doubles as the typedi token:
 * boot and tests call `Container.set(RealtimeConfig, config)` before resolving
 * anything that injects it.
 */
export class RealtimeConfig {
  inworldApiKey!: string;
  inworldBaseUrl!: string;
  llmModel!: string;
  sttModel!: string;
  sttSampleRate!: number;
  ttsModel!: string;
  ttsVoice!: string;
  sessionIdleTimeoutMs!: number;
  port!: number;
}

/**
 * Defaults applied for every field except `inworldApiKey`, which has no
 * sensible default and must always be supplied.
 */
export const DEFAULT_REALTIME_CONFIG: Readonly<Omit<RealtimeConfig, 'inworldApiKey'>> = Object.freeze({
  inworldBaseUrl: 'https://api.inworld.ai',
  llmModel: 'auto',
  sttModel: 'inworld/inworld-stt-1',
  sttSampleRate: 16000,
  ttsModel: 'inworld-tts-2-flash',
  ttsVoice: 'Ashley',
  sessionIdleTimeoutMs: 300000,
  port: 3000,
});

/**
 * Builds a `RealtimeConfig` from the defaults plus the given overrides.
 * `inworldApiKey` is required; everything else falls back to
 * `DEFAULT_REALTIME_CONFIG`. Intended for tests and for `loadRealtimeConfig`.
 */
export function createRealtimeConfig(
  overrides: Partial<RealtimeConfig> & { inworldApiKey: string },
): RealtimeConfig {
  if (!overrides.inworldApiKey || overrides.inworldApiKey.trim() === '') {
    throw new Error(
      'INWORLD_API_KEY is not set. Add it to .env or the environment before starting the server.',
    );
  }
  return Object.assign(new RealtimeConfig(), DEFAULT_REALTIME_CONFIG, overrides);
}

/**
 * Reads a string variable from `env`, returning `undefined` when it is
 * missing or blank so the default applies.
 */
function readString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Reads a positive numeric variable from `env`, returning `undefined` when it
 * is missing or blank. Throws a plain `Error` naming the variable when the
 * value is not a positive number.
 */
function readPositiveNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = readString(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  }
  return value;
}

/**
 * Loads a `RealtimeConfig` from process-style environment variables
 * (`INWORLD_API_KEY`, `INWORLD_BASE_URL`, `INWORLD_LLM_MODEL`,
 * `INWORLD_STT_MODEL`, `INWORLD_STT_SAMPLE_RATE`, `INWORLD_TTS_MODEL`,
 * `INWORLD_TTS_VOICE`, `SESSION_IDLE_TIMEOUT_MS`, `PORT`), applying defaults
 * and coercing numbers. Throws a plain `Error` whose message names
 * `INWORLD_API_KEY` when it is missing or blank; boot code prints the message
 * and exits 1.
 */
export function loadRealtimeConfig(env: NodeJS.ProcessEnv): RealtimeConfig {
  const inworldApiKey = readString(env, 'INWORLD_API_KEY');
  if (inworldApiKey === undefined) {
    throw new Error(
      'INWORLD_API_KEY is not set. Add it to .env or the environment before starting the server.',
    );
  }

  const overrides: Partial<RealtimeConfig> & { inworldApiKey: string } = { inworldApiKey };

  const inworldBaseUrl = readString(env, 'INWORLD_BASE_URL');
  if (inworldBaseUrl !== undefined) overrides.inworldBaseUrl = inworldBaseUrl;

  const llmModel = readString(env, 'INWORLD_LLM_MODEL');
  if (llmModel !== undefined) overrides.llmModel = llmModel;

  const sttModel = readString(env, 'INWORLD_STT_MODEL');
  if (sttModel !== undefined) overrides.sttModel = sttModel;

  const sttSampleRate = readPositiveNumber(env, 'INWORLD_STT_SAMPLE_RATE');
  if (sttSampleRate !== undefined) overrides.sttSampleRate = sttSampleRate;

  const ttsModel = readString(env, 'INWORLD_TTS_MODEL');
  if (ttsModel !== undefined) overrides.ttsModel = ttsModel;

  const ttsVoice = readString(env, 'INWORLD_TTS_VOICE');
  if (ttsVoice !== undefined) overrides.ttsVoice = ttsVoice;

  const sessionIdleTimeoutMs = readPositiveNumber(env, 'SESSION_IDLE_TIMEOUT_MS');
  if (sessionIdleTimeoutMs !== undefined) overrides.sessionIdleTimeoutMs = sessionIdleTimeoutMs;

  const port = readPositiveNumber(env, 'PORT');
  if (port !== undefined) overrides.port = port;

  return createRealtimeConfig(overrides);
}
