import type { RealtimeError } from '../../protocol/RealtimeError';

/** Configuration for a single TTS synthesis context (voice, model, output format, rate). */
export interface TtsContextOptions {
  /** Upstream voice identifier. */
  voiceId: string;
  /** Upstream TTS model identifier. */
  modelId: string;
  /** Sample rate in Hz of the PCM audio produced. */
  sampleRate: number;
  /** Optional speaking-rate multiplier (1.0 = normal). */
  speakingRate?: number;
}

/** Callbacks invoked by a TTS context as audio and lifecycle events arrive. */
export interface TtsContextHandlers {
  /** A chunk of synthesized PCM audio. */
  onAudio(pcm: Buffer): void;
  /** All text sent before the last `flush()` has been fully synthesized and delivered. */
  onFlushCompleted(): void;
  /** The context is closed; no further audio follows. Always the last callback. */
  onClosed(): void;
  /** The context failed; followed by `onClosed`. */
  onError(error: RealtimeError): void;
}

/** A live TTS synthesis context: stream text in, receive audio out. */
export interface TtsContext {
  /** Caller-supplied id used to multiplex contexts on one connection. */
  readonly contextId: string;
  /** Append text to synthesize; text sent before the connection is open is queued in order. */
  sendText(text: string): void;
  /** Force synthesis of any buffered text; `onFlushCompleted` fires when delivered. */
  flush(): void;
  /** Close this context (and cancel pending audio); `onClosed` fires afterwards. */
  close(): void;
}

/** A multiplexed TTS connection hosting one or more synthesis contexts. */
export interface TtsConnection {
  /** Create a context on this connection; returns immediately and queues until the socket is open. */
  createContext(contextId: string, options: TtsContextOptions, handlers: TtsContextHandlers): TtsContext;
  /** Close the connection and every context on it. */
  close(): void;
}

/** Factory for TTS connections against an upstream provider. */
export interface TtsClient {
  /** Lazily connects and returns immediately; contexts and text are queued until the socket is open. */
  connect(): TtsConnection;
}
