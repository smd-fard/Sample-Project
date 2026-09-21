/** A single field-level error entry in the response envelope. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Base application error. Every error thrown from a service or validator should
 * be an `AppError` subclass so `ErrorHandlerMiddleware` can map it to the right
 * HTTP status and a uniform `{ message, data, errors }` envelope.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errors: FieldError[];

  constructor(message: string, statusCode: number, code: string, errors: FieldError[] = []) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }

  /** Append a field-level error; returns `this` for fluent accumulation. */
  public addError(field: string, message: string): this {
    this.errors.push({ field, message });
    return this;
  }

  /** True once at least one field-level error has been accumulated. */
  public hasErrors(): boolean {
    return this.errors.length > 0;
  }
}
