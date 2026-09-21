import { ZodType } from 'zod';

import { ValidationError } from '../errors/ValidationError';

/**
 * Parses `input` against a Zod schema and returns the typed, validated value.
 * On failure throws a `ValidationError` whose `errors` carry one entry per
 * invalid field (dotted path + message), which the error middleware renders as
 * a 422 envelope.
 */
export function validateDto<T>(input: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new ValidationError();
    for (const issue of result.error.issues) {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      error.addError(field, issue.message);
    }
    throw error;
  }
  return result.data;
}
