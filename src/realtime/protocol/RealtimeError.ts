import { AppError } from '../../common/errors/AppError';
import { ValidationError } from '../../common/errors/ValidationError';
import { RealtimeErrorCode, RealtimeErrorCodes } from './RealtimeErrorCodes';
import { newEventId } from './ids';

/** Wire-level error class: client mistakes vs. gateway/upstream failures. */
export type RealtimeErrorType = 'invalid_request_error' | 'server_error';

/** The `error` object carried by an `error` server event. */
export interface RealtimeErrorPayload {
  type: RealtimeErrorType;
  code: string;
  message: string;
  param: string | null;
  /** The `event_id` of the client event that caused the error, when known. */
  event_id: string | null;
}

/** The full `error` server event. */
export interface RealtimeErrorEvent {
  type: 'error';
  event_id: string;
  error: RealtimeErrorPayload;
}

/**
 * An error that maps 1:1 onto an `error` server event. `invalid_request_error`
 * carries HTTP status 400 and `server_error` 500 so the same instance also
 * renders correctly through `ErrorHandlerMiddleware` if it ever escapes over
 * HTTP.
 */
export class RealtimeError extends AppError {
  public readonly type: RealtimeErrorType;
  public readonly param?: string;

  constructor(type: RealtimeErrorType, code: RealtimeErrorCode, message: string, param?: string) {
    super(message, type === 'invalid_request_error' ? 400 : 500, code);
    this.type = type;
    this.param = param;
  }

  /** A client-caused error (`invalid_request_error`, status 400). */
  public static invalidRequest(code: RealtimeErrorCode, message: string, param?: string): RealtimeError {
    return new RealtimeError('invalid_request_error', code, message, param);
  }

  /** A gateway/upstream failure (`server_error`, status 500). */
  public static serverError(code: RealtimeErrorCode, message: string): RealtimeError {
    return new RealtimeError('server_error', code, message);
  }

  /** The `error` payload for this instance (without the client `event_id`). */
  public toPayload(clientEventId: string | null = null): RealtimeErrorPayload {
    return {
      type: this.type,
      code: this.code,
      message: this.message,
      param: this.param ?? null,
      event_id: clientEventId,
    };
  }
}

/**
 * Maps any thrown value to an `error` payload:
 * - `RealtimeError` → its own type/code/param;
 * - `ValidationError` → `invalid_request_error` / `invalid_value`, `param` = the first
 *   field path (already rooted at the event's top-level key, e.g. `session.audio.input.format`);
 * - any other `AppError` → `invalid_request_error` with the lower-cased `code`;
 * - anything else → `server_error` / `internal_error` (message only, never a stack).
 */
export function toErrorPayload(error: unknown, clientEventId: string | null = null): RealtimeErrorPayload {
  if (error instanceof RealtimeError) {
    return error.toPayload(clientEventId);
  }
  if (error instanceof ValidationError) {
    const first = error.errors[0];
    const param = first === undefined || first.field === '(root)' ? null : first.field;
    return {
      type: 'invalid_request_error',
      code: RealtimeErrorCodes.INVALID_VALUE,
      message: first?.message ?? error.message,
      param,
      event_id: clientEventId,
    };
  }
  if (error instanceof AppError) {
    return {
      type: 'invalid_request_error',
      code: error.code.toLowerCase(),
      message: error.message,
      param: null,
      event_id: clientEventId,
    };
  }
  return {
    type: 'server_error',
    code: RealtimeErrorCodes.INTERNAL_ERROR,
    message: error instanceof Error && error.message !== '' ? error.message : 'Internal server error',
    param: null,
    event_id: clientEventId,
  };
}

/**
 * Builds a complete `error` server event (fresh `event_id`) for any thrown value.
 * `clientEventId` is echoed as `error.event_id` (or `null` when unknown).
 */
export function toErrorEvent(error: unknown, clientEventId?: string): RealtimeErrorEvent {
  return {
    type: 'error',
    event_id: newEventId(),
    error: toErrorPayload(error, clientEventId ?? null),
  };
}
