import { RealtimeError } from '../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../protocol/RealtimeErrorCodes';

const INT16_MIN = -32768;
const INT16_MAX = 32767;

/**
 * Stateful linear-interpolation resampler for int16 LE mono PCM.
 * Carries the fractional read position and the last input sample across
 * chunks so chunk boundaries do not click. Identity when rates match.
 */
export class PcmResampler {
  private readonly step: number;
  private lastSample: number | null = null;
  private position = 0;

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {
    if (!(fromRate > 0) || !(toRate > 0)) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.INVALID_VALUE,
        'Sample rates must be positive',
        'sample_rate',
      );
    }
    this.step = fromRate / toRate;
  }

  /** Resamples one chunk; returns the input unchanged when rates match. */
  process(chunk: Buffer): Buffer {
    if (chunk.length % 2 !== 0) {
      throw RealtimeError.invalidRequest(
        RealtimeErrorCodes.INVALID_VALUE,
        'PCM chunk must have an even byte length',
        'audio',
      );
    }
    if (this.fromRate === this.toRate) {
      return chunk;
    }
    const sampleCount = chunk.length / 2;
    if (sampleCount === 0) {
      return Buffer.alloc(0);
    }

    // Virtual input: [lastSample?, ...chunkSamples]
    const hasCarry = this.lastSample !== null;
    const inLength = sampleCount + (hasCarry ? 1 : 0);
    const input = new Int16Array(inLength);
    let offset = 0;
    if (hasCarry) {
      input[0] = this.lastSample as number;
      offset = 1;
    }
    for (let n = 0; n < sampleCount; n++) {
      input[offset + n] = chunk.readInt16LE(n * 2);
    }

    const maxOut = Math.ceil((inLength - this.position) / this.step) + 1;
    const output = Buffer.alloc(maxOut * 2);
    let written = 0;
    let p = this.position;
    while (true) {
      const i = Math.floor(p);
      if (i + 1 >= inLength) {
        break;
      }
      const frac = p - i;
      const a = input[i];
      const b = input[i + 1];
      let s = Math.round(a + (b - a) * frac);
      if (s < INT16_MIN) s = INT16_MIN;
      else if (s > INT16_MAX) s = INT16_MAX;
      output.writeInt16LE(s, written * 2);
      written++;
      p += this.step;
    }

    this.position = p - (inLength - 1);
    this.lastSample = input[inLength - 1];
    return output.subarray(0, written * 2);
  }

  /** Clears carried state so the next chunk starts fresh. */
  reset(): void {
    this.lastSample = null;
    this.position = 0;
  }
}
