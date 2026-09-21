/**
 * Validated, builder-constructed envelope for a close-realtimeSession call. Carries
 * the path id plus request metadata into the service.
 */
export class CloseRealtimeSessionContext {
  public traceId!: string;
  public sessionId!: string;
}

/** Fluent builder for `CloseRealtimeSessionContext`. */
export class CloseRealtimeSessionContextBuilder {
  private readonly context = new CloseRealtimeSessionContext();

  public setTraceId(traceId: string): this {
    this.context.traceId = traceId;
    return this;
  }

  public setSessionId(sessionId: string): this {
    this.context.sessionId = sessionId;
    return this;
  }

  public build(): CloseRealtimeSessionContext {
    return this.context;
  }
}
