import { randomUUID } from 'crypto';

/** 32 lower-case hex characters (a UUID v4 with the dashes stripped). */
function hex32(): string {
  return randomUUID().replace(/-/g, '');
}

/** New conversation item id: `item_` + 32 hex. */
export function newItemId(): string {
  return `item_${hex32()}`;
}

/** New response id: `resp_` + 32 hex. */
export function newResponseId(): string {
  return `resp_${hex32()}`;
}

/** New server event id: `event_` + 32 hex. */
export function newEventId(): string {
  return `event_${hex32()}`;
}

/** New function-call id: `call_` + 32 hex. */
export function newCallId(): string {
  return `call_${hex32()}`;
}

/** New session id: `sess_` + 32 hex. */
export function newSessionId(): string {
  return `sess_${hex32()}`;
}
