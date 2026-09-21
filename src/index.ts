import "reflect-metadata";

import { Application } from "express";
import * as http from "http";
import { createExpressServer, useContainer } from "routing-controllers";
import { Container } from "typedi";

import { ErrorHandlerMiddleware } from "./common/middlewares/ErrorHandlerMiddleware";
import { loadRealtimeConfig, RealtimeConfig } from "./config/RealtimeConfig";
import { RealtimeSessionController } from "./controllers/RealtimeSessionController";
import { RealtimeGateway, RealtimeGatewayHandle } from "./realtime/RealtimeGateway";

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

/**
 * Wraps the Express app in an `http.Server` and attaches the realtime WebSocket
 * gateway at `/v1/realtime`. Registers `config` in the container first so the
 * gateway and the Inworld adapters can inject it.
 */
export function createHttpServer(
  app: Application,
  config: RealtimeConfig,
): { server: http.Server; gateway: RealtimeGatewayHandle } {
  Container.set(RealtimeConfig, config);
  const server = http.createServer(app);
  const gateway = Container.get(RealtimeGateway).attach(server);
  return { server, gateway };
}

// Only start listening when run directly (not when imported by tests).
if (require.main === module) {
  try {
    process.loadEnvFile();
  } catch {
    // A missing .env is fine; the environment may already be populated.
  }
  let config: RealtimeConfig;
  try {
    config = loadRealtimeConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const { server, gateway } = createHttpServer(createApp(), config);
  server.listen(config.port, () => {
    console.log(`Server is running on http://localhost:${config.port}`);
  });
  const shutdown = (): void => {
    gateway.close().finally(() => server.close(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
