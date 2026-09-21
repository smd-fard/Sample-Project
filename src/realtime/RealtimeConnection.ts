import { WebSocket } from 'ws';

import { parseClientEvent } from './protocol/clientEvents';
import { toErrorEvent } from './protocol/RealtimeError';
import { ServerEvent } from './protocol/serverEvents';
import { SessionRuntime } from './session/SessionRuntime';

/**
 * Wraps one `ws` socket: serialises outbound events, parses inbound frames and
 * routes them to the runtime. No client event can throw past this class — the
 * only outlet for a failure is an `error` event to the client.
 */
export class RealtimeConnection {
  private runtime: SessionRuntime | null = null;

  constructor(private readonly socket: WebSocket) {
    socket.on('close', () => this.runtime?.close());
    socket.on('error', () => this.runtime?.close());
  }

  /** Binds the runtime and starts consuming inbound frames. */
  public setRuntime(runtime: SessionRuntime): void {
    this.runtime = runtime;
    this.socket.on('message', (raw) => this.onMessage(raw as Buffer | string));
  }

  /** Sends one server event (dropped when the socket is not open). */
  public send(event: ServerEvent): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(event));
  }

  /** Closes the socket with a code and reason. */
  public close(code: number, reason: string): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // ignore
    }
  }

  private onMessage(raw: Buffer | string): void {
    let clientEventId: string | undefined;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const parsed: unknown = JSON.parse(text);
        const id = (parsed as { event_id?: unknown } | null)?.event_id;
        if (typeof id === 'string') clientEventId = id;
      } catch {
        // best-effort only
      }
      const event = parseClientEvent(text);
      this.runtime?.handle(event);
    } catch (err) {
      this.send(toErrorEvent(err, clientEventId));
    }
  }
}
