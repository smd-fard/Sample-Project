import { RealtimeSessionState } from '../../enums/RealtimeSessionState';
import { TurnDetectionType } from '../../models/RealtimeSession';
import { RealtimeSessionMetrics } from '../../models/RealtimeSessionMetrics';

/**
 * Builder-constructed envelope for an update-realtimeSession call. Carries the
 * session id plus an optional partial snapshot of session fields into the service.
 * Built directly by the gateway (no HTTP request DTO) after `session.updated`,
 * every commit, and every `response.done`.
 */
export class UpdateRealtimeSessionContext {
  public traceId!: string;
  public sessionId!: string;
  public state?: RealtimeSessionState;
  public itemCount?: number;
  public turnDetectionType?: TurnDetectionType;
  public outputModalities?: string[];
  public voice?: string;
  public metrics?: Partial<RealtimeSessionMetrics>;
}

/** Fluent builder for `UpdateRealtimeSessionContext`. */
export class UpdateRealtimeSessionContextBuilder {
  private readonly context = new UpdateRealtimeSessionContext();

  public setTraceId(traceId: string): this {
    this.context.traceId = traceId;
    return this;
  }

  public setSessionId(sessionId: string): this {
    this.context.sessionId = sessionId;
    return this;
  }

  public setState(state: RealtimeSessionState): this {
    this.context.state = state;
    return this;
  }

  public setItemCount(itemCount: number): this {
    this.context.itemCount = itemCount;
    return this;
  }

  public setTurnDetectionType(turnDetectionType: TurnDetectionType): this {
    this.context.turnDetectionType = turnDetectionType;
    return this;
  }

  public setOutputModalities(outputModalities: string[]): this {
    this.context.outputModalities = outputModalities;
    return this;
  }

  public setVoice(voice: string): this {
    this.context.voice = voice;
    return this;
  }

  public setMetrics(metrics: Partial<RealtimeSessionMetrics>): this {
    this.context.metrics = metrics;
    return this;
  }

  public build(): UpdateRealtimeSessionContext {
    return this.context;
  }
}
