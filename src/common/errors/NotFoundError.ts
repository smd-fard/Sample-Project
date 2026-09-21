import { AppError, FieldError } from './AppError';

/** 404 — a requested resource does not exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', errors: FieldError[] = []) {
    super(message, 404, 'NOT_FOUND', errors);
  }
}
