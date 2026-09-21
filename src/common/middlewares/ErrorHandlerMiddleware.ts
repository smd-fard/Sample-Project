import { NextFunction, Request, Response } from 'express';
import { ExpressErrorMiddlewareInterface, Middleware } from 'routing-controllers';
import { Service } from 'typedi';

import { AppError } from '../errors/AppError';
import { ApiResult } from '../http/ApiResult';

/**
 * Terminal error handler. Maps `AppError` subclasses to their status + envelope
 * and anything else to a 500. Registered via `middlewares` in `createApp()`.
 */
@Middleware({ type: 'after' })
@Service()
export class ErrorHandlerMiddleware implements ExpressErrorMiddlewareInterface {
  public error(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
    if (error instanceof AppError) {
      response.status(error.statusCode).json(ApiResult.error(error.message, error.errors));
      return;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    response.status(500).json(ApiResult.error('Internal server error', [{ field: '(root)', message }]));
  }
}
