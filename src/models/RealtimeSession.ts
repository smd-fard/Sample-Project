import { RealtimeSessionState } from '../enums/RealtimeSessionState';
import { RealtimeSessionMetrics } from './RealtimeSessionMetrics';

/** Turn-detection mode negotiated for a realtime session (`null` = manual / no VAD). */
export type TurnDetectionType = 'server_vad' | 'semantic_vad' | null;

/**
 * In-memory RealtimeSession record. A plain class (no ORM) — the repository keeps these
 * in a hashmap. Required fields use `!`, server-optional fields use `?`.
 * Identity is `sessionId` (server-owned, `sess_` + 32 hex chars) because the spec fixes the REST field name.
 */
export class RealtimeSession {
  sessionId!: string;
  createdAt!: string;
  state!: RealtimeSessionState;
  itemCount!: number;
  turnDetectionType!: TurnDetectionType;
  outputModalities!: string[];
  voice!: string;
  model!: string;
  metrics!: RealtimeSessionMetrics;
}
