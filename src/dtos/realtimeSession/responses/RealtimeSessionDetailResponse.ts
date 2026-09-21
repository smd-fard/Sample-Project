import { z } from 'zod';

import { BaseBuilder } from '../../../common/dto/BaseBuilder';
import { RealtimeSessionState } from '../../../enums/RealtimeSessionState';
import { RealtimeSessionResponseSchema } from './RealtimeSessionResponse';

/** Schema for the per-session metrics block (mirrors `RealtimeSessionMetrics`). */
export const RealtimeSessionMetricsResponseSchema = z.object({
  turns: z.number().int().min(0),
  lastTimeToFirstTranscriptMs: z.number().nullable(),
  lastTimeToFirstAudioMs: z.number().nullable(),
  lastLlmTimeToFirstTokenMs: z.number().nullable(),
  transcribedAudioMs: z.number().min(0),
  synthesizedCharacters: z.number().int().min(0),
});

export type RealtimeSessionMetricsResponse = z.infer<typeof RealtimeSessionMetricsResponseSchema>;

/** Schema for a single realtimeSession's detail response: the list-row shape plus `metrics`. */
export const RealtimeSessionDetailResponseSchema = RealtimeSessionResponseSchema.extend({
  metrics: RealtimeSessionMetricsResponseSchema,
});

export type RealtimeSessionDetailResponse = z.infer<typeof RealtimeSessionDetailResponseSchema>;

/** Fluent builder for `RealtimeSessionDetailResponse` — handy for test fixtures. */
export class RealtimeSessionDetailResponseBuilder extends BaseBuilder<
  typeof RealtimeSessionDetailResponseSchema
> {
  constructor() {
    super(RealtimeSessionDetailResponseSchema);
  }

  public setSessionId(sessionId: string): this {
    this.data.sessionId = sessionId;
    return this;
  }

  public setCreatedAt(createdAt: string): this {
    this.data.createdAt = createdAt;
    return this;
  }

  public setState(state: RealtimeSessionState): this {
    this.data.state = state;
    return this;
  }

  public setItemCount(itemCount: number): this {
    this.data.itemCount = itemCount;
    return this;
  }

  public setTurnDetection(turnDetection: 'server_vad' | 'semantic_vad' | null): this {
    this.data.turnDetection = turnDetection;
    return this;
  }

  public setOutputModalities(outputModalities: string[]): this {
    this.data.outputModalities = outputModalities;
    return this;
  }

  public setVoice(voice: string): this {
    this.data.voice = voice;
    return this;
  }

  public setMetrics(metrics: RealtimeSessionMetricsResponse): this {
    this.data.metrics = metrics;
    return this;
  }
}
