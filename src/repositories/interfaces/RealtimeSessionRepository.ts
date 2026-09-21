import { RealtimeSession } from '../../models/RealtimeSession';

/** Data-access contract for realtime session records. Methods return entities or `null`
 * — they never throw business errors. */
export interface RealtimeSessionRepository {
  create(session: RealtimeSession): Promise<RealtimeSession>;
  findById(id: string): Promise<RealtimeSession | null>;
  /** Live (non-CLOSED) sessions only. */
  findAll(): Promise<RealtimeSession[]>;
  /** Replace the stored record with the same `sessionId`; `null` if absent. */
  update(session: RealtimeSession): Promise<RealtimeSession | null>;
  /** Remove the record; `true` if a record was removed. */
  delete(id: string): Promise<boolean>;
}
