import { AppError, FieldError } from './AppError';

/** 422 — the request body/params failed schema validation. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors: FieldError[] = []) {
    super(message, 422, 'VALIDATION', errors);
  }
}
