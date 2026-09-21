import { randomUUID } from 'crypto';
import type * as http from 'http';
import { Inject, Service } from 'typedi';
import { WebSocket, WebSocketServer } from 'ws';

import { RealtimeConfig } from '../config/RealtimeConfig';
import { OpenRealtimeSessionContextBuilder } from '../contexts/realtimeSession/OpenRealtimeSessionContext';
import { RealtimeSessionService } from '../services/RealtimeSessionService';
import { RealtimeConnection } from './RealtimeConnection';
import { defaultSessionConfig } from './protocol/sessionConfig';
import { SessionRuntime } from './session/SessionRuntime';
import { InworldLlmClient } from './upstream/inworld/InworldLlmClient';
import { InworldSttClient } from './upstream/inworld/InworldSttClient';
import { InworldTtsClient } from './upstream/inworld/InworldTtsClient';

/** Handle for one attached WebSocket server. */
export interface RealtimeGatewayHandle {
  /** Closes every live session and the WebSocket server. */
  close(): Promise<void>;
  /** Number of live sessions. */
  readonly sessionCount: number;
}

/**
 * The WebSocket edge of the realtime gateway: accepts `/v1/realtime`
 * upgrades, opens a session record and wires a `SessionRuntime` +
 * `RealtimeConnection` per socket.
 */
@Service()
export class RealtimeGateway {
  constructor(
    @Inject() private readonly config: RealtimeConfig,
    @Inject() private readonly sessionService: RealtimeSessionService,
    @Inject() private readonly stt: InworldSttClient,
    @Inject() private readonly llm: InworldLlmClient,
    @Inject() private readonly tts: InworldTtsClient,
  ) {}

  /** Attaches a WebSocket server at `/v1/realtime` on `server`; each call returns its own handle. */
  public attach(server: http.Server): RealtimeGatewayHandle {
    const wss = new WebSocketServer({ server, path: '/v1/realtime' });
    const runtimes = new Set<SessionRuntime>();

    wss.on('connection', (socket: WebSocket, request: http.IncomingMessage) => {
      const model = new URL(request.url ?? '/', 'http://localhost').searchParams.get('model') ?? undefined;
      const defaults = defaultSessionConfig(this.config, model);
      const connection = new RealtimeConnection(socket);
      this.sessionService
        .open(
          new OpenRealtimeSessionContextBuilder()
            .setTraceId(randomUUID())
            .setModel(defaults.model)
            .setTurnDetectionType(defaults.audio.input.turn_detection?.type ?? null)
            .setOutputModalities([...defaults.output_modalities])
            .setVoice(defaults.audio.output.voice)
            .build(),
        )
        .then((session) => {
          const runtime = new SessionRuntime({
            session,
            config: this.config,
            sessionService: this.sessionService,
            stt: this.stt,
            llm: this.llm,
            tts: this.tts,
            emit: (event) => connection.send(event),
            closeSocket: (code, reason) => connection.close(code, reason),
            model: defaults.model,
          });
          runtimes.add(runtime);
          socket.once('close', () => {
            runtime.close();
            runtimes.delete(runtime);
          });
          if (socket.readyState !== WebSocket.OPEN) {
            runtime.close();
            runtimes.delete(runtime);
            return;
          }
          connection.setRuntime(runtime);
          connection.send(runtime.sessionCreatedEvent());
        })
        .catch(() => connection.close(1011, 'session_open_failed'));
    });

    return {
      get sessionCount(): number {
        return runtimes.size;
      },
      close: () =>
        new Promise<void>((resolve) => {
          for (const runtime of runtimes) runtime.close();
          runtimes.clear();
          for (const client of wss.clients) client.close(1001, 'server_shutdown');
          wss.close(() => resolve());
        }),
    };
  }
}
