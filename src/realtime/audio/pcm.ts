import { RealtimeError } from '../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../protocol/RealtimeErrorCodes';

/** Native sample rate of the realtime audio pipeline (Hz). */
export const PCM_SAMPLE_RATE = 24000;

/** Bytes per int16 PCM sample. */
export const BYTES_PER_SAMPLE = 2;

/** Bytes of 24 kHz int16 mono PCM per millisecond (24000 * 2 / 1000). */
export const PCM_24K_BYTES_PER_MS = 48;

const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes a strictly validated base64 string into a PCM buffer.
 * Throws `RealtimeError invalid_base64` on malformed input or an odd byte length.
 */
export function decodeBase64Pcm(audio: string): Buffer {
  if (typeof audio !== 'string' || audio.length % 4 !== 0 || !STRICT_BASE64.test(audio)) {
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.INVALID_BASE64,
      'Audio payload must be valid base64',
      'audio',
    );
  }
  const bytes = Buffer.from(audio, 'base64');
  if (bytes.length % BYTES_PER_SAMPLE !== 0) {
    throw RealtimeError.invalidRequest(
      RealtimeErrorCodes.INVALID_BASE64,
      'Audio payload must contain whole 16-bit samples',
      'audio',
    );
  }
  return bytes;
}

/** Duration in milliseconds of `bytes` of int16 mono PCM at `sampleRate` Hz. */
export function pcmDurationMs(bytes: number, sampleRate: number): number {
  return (bytes / BYTES_PER_SAMPLE / sampleRate) * 1000;
}

/** Byte count of `ms` milliseconds of int16 mono PCM at `sampleRate` Hz. */
export function bytesForMs(ms: number, sampleRate: number = PCM_SAMPLE_RATE): number {
  return Math.round((ms / 1000) * sampleRate) * BYTES_PER_SAMPLE;
}
