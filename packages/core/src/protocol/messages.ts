import type { TOPICS } from './constants';

// The wire protocol. Every type here is serialized as JSON, either as a
// message on a transport topic or as the `data:` line of an SSE frame, and is
// the source the JSON Schema (schema/protocol.schema.json) is generated from.
// PROTOCOL.md is the prose contract; keep the two in step (`npm run
// schema:check` guards the schema, a human guards the prose).

/** The three fixed transport topic names (see `TOPICS`). */
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export type SseEventType = 'command' | 'output' | 'system';

/** `data` of a `command` event: the echoed command and the instance that runs it. */
export interface CommandEventData {
  command: string;
  instanceId: string;
}

/** `data` of an `output` event: one raw chunk of REPL output, verbatim. */
export type OutputEventData = string;

/** `data` of the `system` event that ends every executed command. */
export interface DoneEventData {
  done: true;
}

/** `data` of the `system` event emitted when a command could not execute. */
export interface ErrorEventData {
  error: string;
}

/** `data` of the SSE-only heartbeat `system` event. */
export interface PingEventData {
  ping: true;
}

/** Echo of a dispatched command, emitted by the owner right before it executes. */
export interface CommandEvent {
  id: number;
  type: 'command';
  commandId: string;
  data: CommandEventData;
}

/** A chunk of REPL output, tagged with the command executing when it was written. */
export interface OutputEvent {
  id: number;
  type: 'output';
  /** `null` only for a chunk written while no command was executing. */
  commandId: string | null;
  data: OutputEventData;
}

/** Completion signal, emitted once per executed command after its last output chunk. */
export interface DoneEvent {
  id: number;
  type: 'system';
  commandId: string;
  data: DoneEventData;
}

/** Failure signal: the command did not execute (e.g. the context factory threw). */
export interface ErrorEvent {
  id: number;
  type: 'system';
  commandId: string;
  data: ErrorEventData;
}

/**
 * SSE keep-alive. Local to one SSE connection: never published on a topic,
 * never buffered for replay, always `id: 0` (the server stamps the SSE frame
 * with the connection's last real id instead -- see PROTOCOL.md).
 */
export interface PingEvent {
  id: 0;
  type: 'system';
  commandId: null;
  data: PingEventData;
}

/** Every event that travels on the `webrepl:out` topic (and is replayable). */
export type TransportEvent = CommandEvent | OutputEvent | DoneEvent | ErrorEvent;

/** Every event that can appear as an SSE `data:` payload. */
export type SseEvent = TransportEvent | PingEvent;

/**
 * Structural superset of `SseEvent`: the engine's working type, where `data`
 * is still untyped. Everything that is a valid `SseEvent` is a valid
 * `WebReplEvent`; the reverse is what the schema rejects.
 */
export interface WebReplEvent {
  id: number;
  type: SseEventType;
  commandId: string | null;
  data: unknown;
}

/** Published on `webrepl:cmd` by the instance that received the HTTP request. */
export interface CmdMessage {
  channel: string;
  commandId: string;
  command: string;
  originInstanceId: string;
}

/**
 * Published on `webrepl:out` by the channel's owner; fanned out to every
 * instance. On the wire `event` is always a `TransportEvent`
 * (`OutMessage<TransportEvent>`, the schema's shape); the engine works with
 * the untyped default while it builds one.
 */
export interface OutMessage<E extends WebReplEvent = WebReplEvent> {
  channel: string;
  event: E;
}

/** The `webrepl:out` message exactly as it travels. */
export type WireOutMessage = OutMessage<TransportEvent>;

/** Published on `webrepl:sys`: ownership `claim` (also the lease heartbeat) and `release`. */
export interface SysMessage {
  channel: string;
  kind: 'claim' | 'release';
  instanceId: string;
}
