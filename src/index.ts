import "reflect-metadata";

import { Application } from "express";
import { createExpressServer, useContainer } from "routing-controllers";
import { Container } from "typedi";

import { ErrorHandlerMiddleware } from "./common/middlewares/ErrorHandlerMiddleware";
import { RealtimeSessionController } from "./controllers/RealtimeSessionController";

// Route all dependency resolution through the typedi container so controllers,
// services, and repositories are constructor-injected.
useContainer(Container);

/**
 * Builds the configured Express application. Exported as a factory so functional
 * tests can boot an identical app without binding to a port.
 *
 * Register each new controller in the `controllers` array below — the
 * define-controller skill does this when it creates the first endpoint of a
 * resource.
 */
export function createApp(): Application {
  return createExpressServer({
    routePrefix: "/api",
    controllers: [RealtimeSessionController],
    middlewares: [ErrorHandlerMiddleware],
    // We own error formatting via ErrorHandlerMiddleware; disable the built-in one.
    defaultErrorHandler: false,
  });
}

const PORT = process.env.PORT ?? 3000;

// Only start listening when run directly (not when imported by tests).
if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}
