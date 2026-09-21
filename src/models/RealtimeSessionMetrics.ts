/**
 * Per-session realtime metrics. A plain value object embedded inside a
 * `RealtimeSession` record (not stored on its own, so no id / createdAt).
 * Nullable `*Ms` fields hold `null` until the first measurement is taken.
 */
export class RealtimeSessionMetrics {
  turns!: number;
  lastTimeToFirstTranscriptMs!: number | null;
  lastTimeToFirstAudioMs!: number | null;
  lastLlmTimeToFirstTokenMs!: number | null;
  transcribedAudioMs!: number;
  synthesizedCharacters!: number;
}
