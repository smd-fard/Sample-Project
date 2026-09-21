/**
 * Validated, builder-constructed envelope for a find-realtimeSession call. Carries
 * the path id plus request metadata into the service.
 */
export class FindRealtimeSessionContext {
  public traceId!: string;
  public sessionId!: string;
}

/** Fluent builder for `FindRealtimeSessionContext`. */
export class FindRealtimeSessionContextBuilder {
  private readonly context = new FindRealtimeSessionContext();

  public setTraceId(traceId: string): this {
    this.context.traceId = traceId;
    return this;
  }

  public setSessionId(sessionId: string): this {
    this.context.sessionId = sessionId;
    return this;
  }

  public build(): FindRealtimeSessionContext {
    return this.context;
  }
}
