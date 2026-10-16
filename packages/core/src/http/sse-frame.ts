import type { WebReplEvent } from '../protocol/messages';

/**
 * One SSE message, framework-free. Structurally compatible with Nest's
 * `MessageEvent` (`{ data, id?, type? }`), and trivially serialisable by any
 * other HTTP layer as `event: <type>\nid: <id>\ndata: <data>\n\n`.
 */
export interface SseFrame {
  id: string;
  type: string;
  data: string;
}

// The heartbeat is emitted as a real WebReplEvent with the sentinel `id: 0`.
// Per the SSE spec, any non-null `id` field (including "0") overwrites the
// browser EventSource's last-event-id -- so if every heartbeat carried
// `id: "0"`, almost any reconnect after an idle period would send
// `Last-Event-ID: 0`, and EventRingBuffer.since(0) returns the entire
// buffer, defeating replay dedup.
//
// This can't be fixed by simply *omitting* `id`: SSE server helpers
// (e.g. @nestjs/core's SseStream.writeMessage()) auto-assign their own
// monotonically increasing id to any message whose `id` is undefined/null,
// so an "omitted" id still lands on the wire as a small, framework-generated
// counter value that is just as disconnected from real event ids as the "0"
// sentinel was. Instead, stamp every heartbeat with the id of the *last real
// event this connection has actually sent* (or the client's original
// Last-Event-ID cursor if none has been sent yet on this connection). Per
// the SSE spec, receiving an id equal to the one the client already has is
// a no-op for its reconnection cursor, so heartbeats stop perturbing
// Last-Event-ID once at least one real event has flowed.
export function toSseFrame(event: WebReplEvent, lastRealId: number): SseFrame {
  const id = event.id === 0 ? lastRealId : event.id;
  return { id: String(id), type: 'message', data: JSON.stringify(event) };
}

/**
 * Serialises one frame to the exact wire text the reference (Nest)
 * implementation emits: `event: <type>\nid: <id>\ndata: <data>\n\n`.
 * Field values must not contain line breaks (JSON data never does); any
 * CR/LF in them is stripped rather than allowed to forge extra fields.
 */
export function sseFrameToText(frame: SseFrame): string {
  const line = (v: string) => v.replace(/[\r\n]/g, '');
  return `event: ${line(frame.type)}\nid: ${line(frame.id)}\ndata: ${line(frame.data)}\n\n`;
}
