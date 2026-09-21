import { FieldError } from '../errors/AppError';

/** Uniform response envelope returned by every controller. */
export interface ApiEnvelope<T> {
  message: string;
  data: T | null;
  errors: FieldError[];
}

/**
 * Builds the uniform `{ message, data, errors }` envelope. Controllers wrap
 * their success payloads with `ApiResult.data(...)`; the error middleware uses
 * `ApiResult.error(...)`.
 */
export class ApiResult {
  /** Success envelope carrying a data payload. */
  public static data<T>(message: string, data: T): ApiEnvelope<T> {
    return { message, data, errors: [] };
  }

  /** Error envelope carrying field-level errors and no data. */
  public static error(message: string, errors: FieldError[] = []): ApiEnvelope<null> {
    return { message, data: null, errors };
  }
}
