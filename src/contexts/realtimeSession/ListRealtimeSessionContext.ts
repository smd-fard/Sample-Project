/**
 * Validated, builder-constructed envelope for a list-realtimeSession call. Carries
 * request metadata into the service (no body or path id for this verb).
 */
export class ListRealtimeSessionContext {
  public traceId!: string;
}

/** Fluent builder for `ListRealtimeSessionContext`. */
export class ListRealtimeSessionContextBuilder {
  private readonly context = new ListRealtimeSessionContext();

  public setTraceId(traceId: string): this {
    this.context.traceId = traceId;
    return this;
  }

  public build(): ListRealtimeSessionContext {
    return this.context;
  }
}
