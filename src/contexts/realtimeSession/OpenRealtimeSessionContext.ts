import type { TurnDetectionType } from '../../models/RealtimeSession';

/**
 * Validated, builder-constructed envelope for an open-realtimeSession call. There is
 * no HTTP request DTO for this verb — the WebSocket gateway builds the context
 * directly at connection time from the query params / config defaults, so it
 * carries flat session-option fields plus request metadata into the service.
 */
export class OpenRealtimeSessionContext {
  public traceId!: string;
  public model!: string;
  public turnDetectionType!: TurnDetectionType;
  public outputModalities!: string[];
  public voice!: string;
}

/** Fluent builder for `OpenRealtimeSessionContext`. */
export class OpenRealtimeSessionContextBuilder {
  private readonly context = new OpenRealtimeSessionContext();

  public setTraceId(traceId: string): this {
    this.context.traceId = traceId;
    return this;
  }

  public setModel(model: string): this {
    this.context.model = model;
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

  public build(): OpenRealtimeSessionContext {
    return this.context;
  }
}
