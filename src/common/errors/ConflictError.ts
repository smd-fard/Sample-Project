import { AppError, FieldError } from './AppError';

/** 409 — the request conflicts with current resource state (e.g. duplicate). */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', errors: FieldError[] = []) {
    super(message, 409, 'CONFLICT', errors);
  }
}
