import type { RealtimeError } from '../../protocol/RealtimeError';

/** Configuration for a streaming speech-to-text session (model, audio format, VAD and end-of-turn tuning). */
export interface SttStreamOptions {
  /** Upstream STT model identifier. */
  model: string;
  /** Sample rate in Hz of the PCM audio that will be sent on the stream. */
  sampleRate: number;
  /** Optional BCP-47 language hint; omit for auto-detection. */
  language?: string;
  /** Voice-activity-detection sensitivity threshold (0..1). */
  vadThreshold: number;
  /** Confidence at or above which the upstream may end a turn early. */
  endOfTurnConfidenceThreshold: number;
  /** Maximum silence in milliseconds before a turn is force-ended. */
  maxTurnSilenceMs: number;
  /** Minimum silence in milliseconds before ending a turn when confidence is high. */
  minEndOfTurnSilenceWhenConfidentMs: number;
}

/** Callbacks invoked by an STT stream as speech, transcripts, usage and lifecycle events arrive. */
export interface SttStreamHandlers {
  /** Speech detected; `startTimeMs` is the offset into the audio stream where it began. */
  onSpeechStarted(startTimeMs: number): void;
  /** Speech ended (silence detected). */
  onSpeechStopped(): void;
  /** Partial (`isFinal === false`) or final transcript text for the current turn. */
  onTranscript(text: string, isFinal: boolean): void;
  /** Billing signal: milliseconds of audio transcribed since the last usage event. */
  onUsage(transcribedAudioMs: number): void;
  /** The stream failed; no further events follow except `onClosed`. */
  onError(error: RealtimeError): void;
  /** The underlying socket closed (cleanly or after an error). Always the last callback. */
  onClosed(): void;
}

/** A live STT stream handle: push audio, force turn boundaries, retune, or close. */
export interface SttStream {
  /** Send raw PCM audio; audio sent before the socket is ready is queued in order. */
  sendAudio(pcm: Buffer): void;
  /** Force the current turn to end and flush a final transcript. */
  endTurn(): void;
  /** Apply new options to the live stream without reconnecting. */
  reconfigure(options: SttStreamOptions): void;
  /** Close the stream; `onClosed` fires once the socket is down. */
  close(): void;
}

/** Factory for STT streams against an upstream provider. */
export interface SttClient {
  /** Opens a stream and returns immediately; audio sent before the socket is ready is queued in order. */
  open(options: SttStreamOptions, handlers: SttStreamHandlers): SttStream;
}
