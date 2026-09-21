import { AppError, FieldError } from './AppError';

/** 400 — the request is malformed or semantically invalid. */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors: FieldError[] = []) {
    super(message, 400, 'BAD_REQUEST', errors);
  }
}
