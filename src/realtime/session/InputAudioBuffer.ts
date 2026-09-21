import { PCM_SAMPLE_RATE, pcmDurationMs } from '../audio/pcm';

/** What `InputAudioBuffer.take()` hands back: the concatenated PCM and its duration. */
export interface TakenAudio {
  /** All appended-but-uncommitted 24 kHz int16 mono PCM, concatenated. */
  bytes: Buffer;
  /** Duration of `bytes` in milliseconds. */
  durationMs: number;
}

/**
 * Holds the un-committed 24 kHz int16 mono PCM chunks appended by the client.
 *
 * `totalAppendedMs` is monotonic across `take()` / `clear()` and is the clock used
 * for `audio_start_ms` / `audio_end_ms`, measured from the start of the buffer's
 * life (i.e. the session).
 */
export class InputAudioBuffer {
  private chunks: Buffer[] = [];
  private byteLength = 0;
  private appendedBytes = 0;

  /** Appends a chunk of 24 kHz int16 mono PCM. */
  public append(bytes: Buffer): void {
    if (bytes.length === 0) {
      return;
    }
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    this.appendedBytes += bytes.length;
  }

  /** Duration in milliseconds of the audio currently held (un-committed). */
  public get durationMs(): number {
    return pcmDurationMs(this.byteLength, PCM_SAMPLE_RATE);
  }

  /** `true` when no audio is currently held. */
  public get isEmpty(): boolean {
    return this.byteLength === 0;
  }

  /** Monotonic total of every millisecond ever appended, unaffected by `take()` / `clear()`. */
  public get totalAppendedMs(): number {
    return pcmDurationMs(this.appendedBytes, PCM_SAMPLE_RATE);
  }

  /** Returns the held audio (concatenated) and resets the buffer. `totalAppendedMs` is unchanged. */
  public take(): TakenAudio {
    const bytes = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.byteLength);
    const durationMs = this.durationMs;
    this.reset();
    return { bytes, durationMs };
  }

  /** Discards the held audio. `totalAppendedMs` is unchanged. */
  public clear(): void {
    this.reset();
  }

  private reset(): void {
    this.chunks = [];
    this.byteLength = 0;
  }
}
