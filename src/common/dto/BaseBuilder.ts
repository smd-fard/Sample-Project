import { z } from 'zod';

/**
 * Minimal fluent builder base for DTOs. Subclasses add one `setX()` per field
 * (writing to `this.data`) and pass their Zod schema to `super()`. `build()`
 * validates the accumulated fields against the schema and returns the typed DTO,
 * so an incomplete or invalid build throws rather than producing a bad object.
 *
 * Mainly for constructing DTOs by hand (tests, fixtures). Incoming HTTP bodies
 * are validated in controllers via `validateDto` and don't go through a builder.
 */
export abstract class BaseBuilder<TSchema extends z.ZodType> {
  protected readonly data: Partial<z.infer<TSchema>> = {};

  constructor(private readonly schema: TSchema) {}

  /** Validate the accumulated fields and return the typed DTO. */
  public build(): z.infer<TSchema> {
    return this.schema.parse(this.data);
  }
}
