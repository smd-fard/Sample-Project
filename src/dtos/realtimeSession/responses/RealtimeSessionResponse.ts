import { z } from 'zod';

import { BaseBuilder } from '../../../common/dto/BaseBuilder';
import { RealtimeSessionState } from '../../../enums/RealtimeSessionState';

/** Schema for a single realtimeSession's response payload (the shared list-row shape). */
export const RealtimeSessionResponseSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  state: z.enum(RealtimeSessionState),
  itemCount: z.number().int().min(0),
  turnDetection: z.enum(['server_vad', 'semantic_vad']).nullable(),
  outputModalities: z.array(z.string()),
  voice: z.string(),
});

export type RealtimeSessionResponse = z.infer<typeof RealtimeSessionResponseSchema>;

/** Fluent builder for `RealtimeSessionResponse` — handy for test fixtures. */
export class RealtimeSessionResponseBuilder extends BaseBuilder<typeof RealtimeSessionResponseSchema> {
  constructor() {
    super(RealtimeSessionResponseSchema);
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
}
