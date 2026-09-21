import { Inject, Service } from 'typedi';
import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import type { ClientRequest } from 'node:http';
import { RealtimeConfig } from '../../../config/RealtimeConfig';
import { RealtimeError } from '../../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../../protocol/RealtimeErrorCodes';
import type { RealtimeErrorCode } from '../../protocol/RealtimeErrorCodes';
import type {
  TtsClient,
  TtsConnection,
  TtsContext,
  TtsContextHandlers,
  TtsContextOptions,
} from '../interfaces/TtsClient';

/** Audio encoding requested from Inworld. Switch to `'PCM'` if the API expects that spelling. */
const TTS_AUDIO_ENCODING = 'LINEAR16';

/** Path of the bidirectional streaming TTS endpoint, appended to the configured base URL. */
const TTS_STREAM_PATH = '/tts/v1/voice:streamBidirectional';

/** Interval between keepalive frames while the socket is open. */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** Per-context bookkeeping held by a connection. */
interface ContextEntry {
  handlers: TtsContextHandlers;
  options: TtsContextOptions;
  closed: boolean;
}

/** Shape of an incoming Inworld result frame; every field is optional and checked at runtime. */
interface InworldTtsResult {
  contextId?: unknown;
  contextCreated?: unknown;
  audioChunk?: { audioContent?: unknown };
  flushCompleted?: unknown;
  contextClosed?: unknown;
  status?: { code?: unknown; message?: unknown };
}

/**
 * Converts the configured HTTP(S) base URL into the WebSocket URL of the
 * streaming TTS endpoint.
 */
function buildTtsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  return `${wsBase}${TTS_STREAM_PATH}`;
}

/**
 * Extracts a human-readable message from an Inworld `status` payload.
 */
function statusMessage(status: { code?: unknown; message?: unknown } | undefined): string {
  if (status && typeof status.message === 'string' && status.message.trim() !== '') {
    return status.message;
  }
  if (status && status.code !== undefined) {
    return `Inworld TTS status ${String(status.code)}`;
  }
  return 'Inworld TTS reported an error';
}

/**
 * One `ws` socket to Inworld's bidirectional TTS endpoint, multiplexing
 * caller-identified synthesis contexts. Outgoing frames are queued until the
 * socket is OPEN; incoming frames are routed by `contextId` and dropped when
 * they refer to an unknown or already-closed context.
 */
class InworldTtsConnection implements TtsConnection {
  private readonly socket: WebSocket;
  private readonly contexts = new Map<string, ContextEntry>();
  private readonly pending: string[] = [];
  private keepalive: NodeJS.Timeout | undefined;
  private closedByCaller = false;
  private failed = false;

  constructor(url: string, apiKey: string) {
    this.socket = new WebSocket(url, {
      headers: { Authorization: `Basic ${apiKey}` },
    });
    this.socket.on('open', () => this.handleOpen());
    this.socket.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
    this.socket.on('unexpected-response', (_req: ClientRequest, res: IncomingMessage) =>
      this.handleUnexpectedResponse(res),
    );
    this.socket.on('error', (err: Error) => this.handleFailure(err.message));
    this.socket.on('close', () => this.handleFailure('Inworld TTS connection closed'));
  }

  createContext(contextId: string, options: TtsContextOptions, handlers: TtsContextHandlers): TtsContext {
    const entry: ContextEntry = { handlers, options, closed: false };
    this.contexts.set(contextId, entry);

    const audioConfig: Record<string, unknown> = {
      audioEncoding: TTS_AUDIO_ENCODING,
      sampleRateHertz: options.sampleRate,
    };
    if (options.speakingRate !== undefined) {
      audioConfig.speakingRate = options.speakingRate;
    }
    this.send({
      create: { voiceId: options.voiceId, modelId: options.modelId, audioConfig },
      contextId,
    });

    return {
      contextId,
      sendText: (text: string) => {
        if (entry.closed) return;
        this.send({ send_text: { text }, contextId });
      },
      flush: () => {
        if (entry.closed) return;
        this.send({ flush_context: {}, contextId });
      },
      close: () => {
        if (entry.closed) return;
        entry.closed = true;
        this.send({ close_context: {}, contextId });
        this.contexts.delete(contextId);
        handlers.onClosed();
      },
    };
  }

  close(): void {
    if (this.closedByCaller) return;
    this.closedByCaller = true;
    this.clearKeepalive();
    for (const [contextId, entry] of this.contexts) {
      this.contexts.delete(contextId);
      if (!entry.closed) {
        entry.closed = true;
        entry.handlers.onClosed();
      }
    }
    this.pending.length = 0;
    this.socket.removeAllListeners('error');
    this.socket.on('error', () => undefined);
    this.socket.terminate();
  }

  /** Serializes and sends a frame, or queues it until the socket is open. */
  private send(frame: Record<string, unknown>): void {
    if (this.closedByCaller || this.failed) return;
    const json = JSON.stringify(frame);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(json);
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pending.push(json);
    }
  }

  private handleOpen(): void {
    if (this.closedByCaller) return;
    for (const json of this.pending) {
      this.socket.send(json);
    }
    this.pending.length = 0;
    this.keepalive = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ send_text: { text: '' }, contextId: '' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
    this.keepalive.unref();
  }

  private handleMessage(data: WebSocket.RawData): void {
    if (this.closedByCaller) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const envelope = parsed as { result?: unknown };
    const result = (
      envelope.result !== null && typeof envelope.result === 'object' ? envelope.result : parsed
    ) as InworldTtsResult;

    if (typeof result.contextId !== 'string') return;
    const entry = this.contexts.get(result.contextId);
    if (entry === undefined || entry.closed) return;

    if (result.status !== undefined && result.status !== null) {
      entry.handlers.onError(
        RealtimeError.serverError(RealtimeErrorCodes.TTS_UNAVAILABLE, statusMessage(result.status)),
      );
      return;
    }
    if (result.audioChunk !== undefined && result.audioChunk !== null) {
      const content = result.audioChunk.audioContent;
      if (typeof content === 'string' && content.length > 0) {
        entry.handlers.onAudio(Buffer.from(content, 'base64'));
      }
      return;
    }
    if (result.flushCompleted !== undefined) {
      entry.handlers.onFlushCompleted();
      return;
    }
    if (result.contextClosed !== undefined) {
      entry.closed = true;
      this.contexts.delete(result.contextId);
      entry.handlers.onClosed();
      return;
    }
    // `contextCreated` and any unrecognised event need no action.
  }

  private handleUnexpectedResponse(res: IncomingMessage): void {
    const status = res.statusCode ?? 0;
    const code =
      status === 401 || status === 403
        ? RealtimeErrorCodes.UPSTREAM_AUTH_FAILED
        : RealtimeErrorCodes.TTS_UNAVAILABLE;
    this.failAll(code, `Inworld TTS handshake failed with HTTP ${status}`);
    this.socket.removeAllListeners('error');
    this.socket.on('error', () => undefined);
    this.socket.terminate();
  }

  private handleFailure(message: string): void {
    if (this.closedByCaller) return;
    this.failAll(RealtimeErrorCodes.TTS_UNAVAILABLE, message);
  }

  /** Reports `onError` then `onClosed` to every open context and tears down timers. */
  private failAll(code: RealtimeErrorCode, message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.clearKeepalive();
    this.pending.length = 0;
    for (const [contextId, entry] of this.contexts) {
      this.contexts.delete(contextId);
      if (entry.closed) continue;
      entry.closed = true;
      entry.handlers.onError(RealtimeError.serverError(code, message));
      entry.handlers.onClosed();
    }
  }

  private clearKeepalive(): void {
    if (this.keepalive !== undefined) {
      clearInterval(this.keepalive);
      this.keepalive = undefined;
    }
  }
}

/**
 * Inworld implementation of {@link TtsClient}. Each `connect()` opens a fresh
 * WebSocket to `/tts/v1/voice:streamBidirectional` authenticated with the
 * configured API key.
 */
@Service()
export class InworldTtsClient implements TtsClient {
  constructor(@Inject() private readonly config: RealtimeConfig) {}

  connect(): TtsConnection {
    return new InworldTtsConnection(buildTtsUrl(this.config.inworldBaseUrl), this.config.inworldApiKey);
  }
}
