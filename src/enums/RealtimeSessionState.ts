/** Lifecycle state of a realtime gateway session (one connected socket). */
export enum RealtimeSessionState {
  IDLE = 'IDLE', // connected, no active response
  RESPONDING = 'RESPONDING', // a response is in flight
  CLOSED = 'CLOSED', // socket gone; set just before the record is deleted, excluded from default queries
}
