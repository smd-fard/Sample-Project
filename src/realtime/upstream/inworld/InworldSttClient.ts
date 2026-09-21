import { Inject, Service } from 'typedi';
import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { RealtimeConfig } from '../../../config/RealtimeConfig';
import { RealtimeError } from '../../protocol/RealtimeError';
import { RealtimeErrorCodes } from '../../protocol/RealtimeErrorCodes';
import type {
  SttClient,
  SttStream,
  SttStreamHandlers,
  SttStreamOptions,
} from '../interfaces/SttClient';

/** Path of Inworld's bidirectional streaming STT endpoint, relative to the API base URL. */
const STT_STREAM_PATH = '/stt/v1/transcribe:streamBidirectional';

/** Maximum bytes of the current turn's audio retained for replay after a reconnect. */
const TURN_BUFFER_MAX_BYTES = 5 * 1024 * 1024;

/** Backoff delays (ms) for each reconnect attempt after an unexpected close. */
const RECONNECT_DELAYS_MS: readonly number[] = [250, 500, 1000];

/**
 * Converts an `http(s)` base URL plus a path into the equivalent `ws(s)` URL.
 * A base that is already `ws(s)` is left as is; a trailing slash on the base is tolerated.
 */
export function toWsUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const scheme = trimmedBase.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${scheme}${normalizedPath}`;
}

/** Shape of the `transcribeConfig` frame sent as the first message on every socket. */
interface TranscribeConfigFrame {
  transcribeConfig: {
    modelId: string;
    audioEncoding: 'LINEAR16';
    sampleRateHertz: number;
    numberOfChannels: 1;
    language?: string;
    endOfTurnConfidenceThreshold: number;
    inworldSttV1Config: {
      vadThreshold: number;
      maxTurnSilence: number;
      minEndOfTurnSilenceWhenConfident: number;
    };
  };
}

/** Loosely-typed server frame; every field is optional and validated at runtime. */
interface InworldSttServerFrame {
  result?: {
    transcription?: { transcript?: unknown; isFinal?: unknown };
    speechStarted?: { startTimeMs?: unknown };
    speechStopped?: unknown;
    usage?: { transcribedAudioMs?: unknown };
    status?: { code?: unknown; message?: unknown; status?: unknown };
  };
}

/** Builds the `transcribeConfig` frame from stream options. */
function buildTranscribeConfig(options: SttStreamOptions): TranscribeConfigFrame {
  const frame: TranscribeConfigFrame = {
    transcribeConfig: {
      modelId: options.model,
      audioEncoding: 'LINEAR16',
      sampleRateHertz: options.sampleRate,
      numberOfChannels: 1,
      endOfTurnConfidenceThreshold: options.endOfTurnConfidenceThreshold,
      inworldSttV1Config: {
        vadThreshold: options.vadThreshold,
        maxTurnSilence: options.maxTurnSilenceMs,
        minEndOfTurnSilenceWhenConfident: options.minEndOfTurnSilenceWhenConfidentMs,
      },
    },
  };
  if (options.language !== undefined) {
    frame.transcribeConfig.language = options.language;
  }
  return frame;
}

/**
 * Factory for Inworld streaming STT sessions. Each `open()` call produces an independent
 * `InworldSttStream` backed by its own WebSocket against `<inworldBaseUrl>/stt/v1/transcribe:streamBidirectional`.
 */
@Service()
export class InworldSttClient implements SttClient {
  constructor(@Inject() private readonly config: RealtimeConfig) {}

  /** Opens a stream and returns immediately; audio sent before the socket is ready is queued in order. */
  public open(options: SttStreamOptions, handlers: SttStreamHandlers): SttStream {
    return new InworldSttStream(this.config, options, handlers);
  }
}

/**
 * A single Inworld STT WebSocket session with pre-open queueing, bounded turn replay
 * on reconnect, and one-shot error/closed signalling.
 */
class InworldSttStream implements SttStream {
  private ws: WebSocket | null = null;
  private options: SttStreamOptions;

  /** Audio received before the socket was OPEN, flushed in order once the config frame is sent. */
  private pending: Buffer[] = [];

  /** Audio of the current turn, replayed after a reconnect; bounded by `TURN_BUFFER_MAX_BYTES`. */
  private turnBuffer: Buffer[] = [];
  private turnBufferBytes = 0;

  private closedByUs = false;
  private closedEmitted = false;
  private errorEmitted = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnecting = false;
  /** Set when a socket is being torn down for `reconfigure()` so its close is not treated as unexpected. */
  private replacingSocket = false;

  constructor(
    private readonly config: RealtimeConfig,
    options: SttStreamOptions,
    private readonly handlers: SttStreamHandlers,
  ) {
    this.options = { ...options };
    this.connect();
  }

  /** Send raw PCM audio; audio sent before the socket is ready is queued in order. */
  public sendAudio(pcm: Buffer): void {
    if (this.closedByUs) return;
    this.recordTurnAudio(pcm);
    if (this.isOpen()) {
      this.sendJson({ audioChunk: { content: pcm.toString('base64') } });
    } else {
      this.pending.push(pcm);
    }
  }

  /** Force the current turn to end and flush a final transcript. */
  public endTurn(): void {
    if (this.closedByUs) return;
    this.clearTurnBuffer();
    if (this.isOpen()) {
      this.sendJson({ endTurn: {} });
    }
  }

  /**
   * Apply new options: the current socket is closed and a fresh one opened with the new
   * `transcribeConfig`. Queued audio is preserved and sent once the new socket is ready.
   */
  public reconfigure(options: SttStreamOptions): void {
    if (this.closedByUs) return;
    this.options = { ...options };
    this.cancelReconnect();
    this.reconnectAttempt = 0;
    this.reconnecting = false;

    const current = this.ws;
    this.ws = null;
    if (current) {
      this.replacingSocket = true;
      this.detach(current);
      if (current.readyState === WebSocket.OPEN) {
        try {
          current.send(JSON.stringify({ closeStream: {} }));
        } catch {
          /* socket already going away */
        }
      }
      current.terminate();
      this.replacingSocket = false;
    }
    this.connect();
  }

  /** Close the stream; `onClosed` fires once the socket is down. */
  public close(): void {
    if (this.closedByUs) return;
    this.closedByUs = true;
    this.cancelReconnect();
    this.pending = [];
    this.clearTurnBuffer();

    const current = this.ws;
    this.ws = null;
    if (current) {
      this.detach(current);
      if (current.readyState === WebSocket.OPEN) {
        try {
          current.send(JSON.stringify({ closeStream: {} }));
        } catch {
          /* socket already going away */
        }
      }
      current.terminate();
    }
    this.emitClosed();
  }

  /** Opens a new WebSocket and wires its lifecycle handlers. */
  private connect(): void {
    const url = toWsUrl(this.config.inworldBaseUrl, STT_STREAM_PATH);
    const ws = new WebSocket(url, {
      headers: { Authorization: `Basic ${this.config.inworldApiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => this.onSocketOpen(ws));
    ws.on('message', (data: WebSocket.RawData) => this.onSocketMessage(ws, data));
    ws.on('unexpected-response', (_req: unknown, res: IncomingMessage) =>
      this.onUnexpectedResponse(ws, res),
    );
    ws.on('error', () => {
      /* The subsequent 'close' event drives reconnect/error reporting. */
    });
    ws.on('close', () => this.onSocketClose(ws));
  }

  /** Sends the config frame, replays the current turn (on reconnect) and drains queued audio. */
  private onSocketOpen(ws: WebSocket): void {
    if (ws !== this.ws) return;
    const wasReconnecting = this.reconnecting;
    this.reconnecting = false;
    this.reconnectAttempt = 0;

    this.sendJson(buildTranscribeConfig(this.options));

    if (wasReconnecting) {
      for (const chunk of this.turnBuffer) {
        this.sendJson({ audioChunk: { content: chunk.toString('base64') } });
      }
    }

    const queued = this.pending;
    this.pending = [];
    for (const chunk of queued) {
      this.sendJson({ audioChunk: { content: chunk.toString('base64') } });
    }
  }

  /** Parses a JSON server frame defensively and dispatches known results to the handlers. */
  private onSocketMessage(ws: WebSocket, data: WebSocket.RawData): void {
    if (ws !== this.ws || this.closedByUs) return;

    let frame: InworldSttServerFrame;
    try {
      const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString();
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return;
      frame = parsed as InworldSttServerFrame;
    } catch {
      return;
    }

    const result = frame.result;
    if (!result || typeof result !== 'object') return;

    if (result.status && typeof result.status === 'object') {
      const { code, status, message } = result.status;
      const ok =
        (code === undefined || code === 0 || code === 'OK') &&
        (status === undefined || status === 'OK' || status === 0);
      if (!ok) {
        const text = typeof message === 'string' && message !== '' ? message : 'Inworld STT reported an error';
        this.emitError(RealtimeError.serverError(RealtimeErrorCodes.STT_UNAVAILABLE, text));
        return;
      }
    }

    if (result.speechStarted && typeof result.speechStarted === 'object') {
      const raw = result.speechStarted.startTimeMs;
      const startTimeMs = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0;
      this.handlers.onSpeechStarted(Number.isFinite(startTimeMs) ? startTimeMs : 0);
    }

    if (result.speechStopped !== undefined) {
      this.handlers.onSpeechStopped();
    }

    if (result.transcription && typeof result.transcription === 'object') {
      const { transcript, isFinal } = result.transcription;
      if (typeof transcript === 'string') {
        const final = isFinal === true;
        if (final) this.clearTurnBuffer();
        this.handlers.onTranscript(transcript, final);
      }
    }

    if (result.usage && typeof result.usage === 'object') {
      const raw = result.usage.transcribedAudioMs;
      const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(ms)) this.handlers.onUsage(ms);
    }
  }

  /** Handles a non-101 upgrade response; 401/403 are reported as an auth failure. */
  private onUnexpectedResponse(ws: WebSocket, res: IncomingMessage): void {
    if (ws !== this.ws) return;
    const statusCode = res.statusCode ?? 0;
    if (statusCode === 401 || statusCode === 403) {
      this.cancelReconnect();
      this.emitError(
        RealtimeError.serverError(
          RealtimeErrorCodes.UPSTREAM_AUTH_FAILED,
          `Inworld STT rejected credentials (HTTP ${statusCode})`,
        ),
      );
      this.ws = null;
      this.detach(ws);
      ws.terminate();
      this.emitClosed();
    }
    // Other statuses fall through to 'close', which drives the reconnect path.
  }

  /** Reconnects on an unexpected close, or reports `stt_unavailable` once attempts are exhausted. */
  private onSocketClose(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = null;
    if (this.closedByUs || this.replacingSocket) return;

    if (this.reconnectAttempt < RECONNECT_DELAYS_MS.length) {
      const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1] ?? 1000;
      this.reconnectAttempt += 1;
      this.reconnecting = true;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.closedByUs) return;
        this.connect();
      }, delay);
      return;
    }

    this.reconnecting = false;
    this.emitError(
      RealtimeError.serverError(
        RealtimeErrorCodes.STT_UNAVAILABLE,
        'Inworld STT connection lost and could not be re-established',
      ),
    );
    this.emitClosed();
  }

  /** Appends audio to the replay buffer, evicting the oldest chunks past the byte cap. */
  private recordTurnAudio(pcm: Buffer): void {
    this.turnBuffer.push(pcm);
    this.turnBufferBytes += pcm.length;
    while (this.turnBufferBytes > TURN_BUFFER_MAX_BYTES && this.turnBuffer.length > 0) {
      const dropped = this.turnBuffer.shift();
      if (dropped) this.turnBufferBytes -= dropped.length;
    }
  }

  private clearTurnBuffer(): void {
    this.turnBuffer = [];
    this.turnBufferBytes = 0;
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Serialises and sends a frame on the current socket; send failures surface via 'close'. */
  private sendJson(frame: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* socket is going away; 'close' will follow */
    }
  }

  /** Removes all listeners from a socket we no longer own so stale events cannot reach us. */
  private detach(ws: WebSocket): void {
    ws.removeAllListeners('open');
    ws.removeAllListeners('message');
    ws.removeAllListeners('unexpected-response');
    ws.removeAllListeners('close');
    ws.removeAllListeners('error');
    ws.on('error', () => {
      /* swallow errors from a discarded socket */
    });
  }

  private emitError(error: RealtimeError): void {
    if (this.errorEmitted || this.closedByUs) return;
    this.errorEmitted = true;
    this.handlers.onError(error);
  }

  private emitClosed(): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.handlers.onClosed();
  }
}
