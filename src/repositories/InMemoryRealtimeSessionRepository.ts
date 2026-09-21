import { randomUUID } from 'crypto';
import { Service } from 'typedi';

import { RealtimeSessionState } from '../enums/RealtimeSessionState';
import { RealtimeSession } from '../models/RealtimeSession';
import { RealtimeSessionMetrics } from '../models/RealtimeSessionMetrics';
import { RealtimeSessionRepository } from './interfaces/RealtimeSessionRepository';

/**
 * Process-local hashmap store for realtime session records. A `@Service()` singleton.
 * Clones on read/write (including nested `metrics` and `outputModalities`) so callers
 * can't mutate stored records. Swap for a DB-backed class later without touching the
 * service (it uses the interface).
 */
@Service()
export class InMemoryRealtimeSessionRepository implements RealtimeSessionRepository {
  private readonly store = new Map<string, RealtimeSession>();

  public async create(session: RealtimeSession): Promise<RealtimeSession> {
    const created = this.clone(session);
    // Client-visible id in OpenAI's `sess_<32 hex>` shape rather than a bare UUID.
    created.sessionId = 'sess_' + randomUUID().replace(/-/g, '');
    created.createdAt = new Date().toISOString();
    this.store.set(created.sessionId, created);
    return this.clone(created);
  }

  public async findById(id: string): Promise<RealtimeSession | null> {
    const session = this.store.get(id);
    return session ? this.clone(session) : null;
  }

  public async findAll(): Promise<RealtimeSession[]> {
    return Array.from(this.store.values())
      .filter((session) => session.state !== RealtimeSessionState.CLOSED)
      .map((session) => this.clone(session));
  }

  public async update(session: RealtimeSession): Promise<RealtimeSession | null> {
    if (!this.store.has(session.sessionId)) {
      return null;
    }
    const updated = this.clone(session);
    this.store.set(updated.sessionId, updated);
    return this.clone(updated);
  }

  public async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  /** Test-support hook: drop all records so suites start from a clean store. */
  public clear(): void {
    this.store.clear();
  }

  private clone(session: RealtimeSession): RealtimeSession {
    const copy = Object.assign(new RealtimeSession(), session);
    copy.outputModalities = [...(session.outputModalities ?? [])];
    copy.metrics = Object.assign(new RealtimeSessionMetrics(), session.metrics);
    return copy;
  }
}
