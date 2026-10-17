import type { REMOTE_REPL_TOPICS } from './constants';

// The wire protocol. Every type here is serialized as JSON, either as a
// message on a transport topic or as the `data:` line of an SSE frame, and is
// the source the JSON Schema (schema/protocol.schema.json) is generated from.
// PROTOCOL.md is the prose contract; keep the two in step (`npm run
// schema:check` guards the schema, a human guards the prose).

/** The three fixed transport topic names (see `REMOTE_REPL_TOPICS`). */
export type RemoteReplTopic = (typeof REMOTE_REPL_TOPICS)[keyof typeof REMOTE_REPL_TOPICS];

export type RemoteReplSseEventType = 'command' | 'output' | 'system';

/** `data` of a `command` event: the echoed command and the instance that runs it. */
export interface RemoteReplCommandEventData {
  command: string;
  instanceId: string;
}

/** `data` of an `output` event: one raw chunk of REPL output, verbatim. */
export type RemoteReplOutputEventData = string;

/** `data` of the `system` event that ends every executed command. */
export interface RemoteReplDoneEventData {
  done: true;
}

/** `data` of the `system` event emitted when a command could not execute. */
export interface RemoteReplErrorEventData {
  error: string;
}

/** `data` of the SSE-only heartbeat `system` event. */
export interface RemoteReplPingEventData {
  ping: true;
}

/** Echo of a dispatched command, emitted by the owner right before it executes. */
export interface RemoteReplCommandEvent {
  id: number;
  type: 'command';
  commandId: string;
  data: RemoteReplCommandEventData;
}

/** A chunk of REPL output, tagged with the command executing when it was written. */
export interface RemoteReplOutputEvent {
  id: number;
  type: 'output';
  /** `null` only for a chunk written while no command was executing. */
  commandId: string | null;
  data: RemoteReplOutputEventData;
}

/** Completion signal, emitted once per executed command after its last output chunk. */
export interface RemoteReplDoneEvent {
  id: number;
  type: 'system';
  commandId: string;
  data: RemoteReplDoneEventData;
}

/** Failure signal: the command did not execute (e.g. the context factory threw). */
export interface RemoteReplErrorEvent {
  id: number;
  type: 'system';
  commandId: string;
  data: RemoteReplErrorEventData;
}

/**
 * SSE keep-alive. Local to one SSE connection: never published on a topic,
 * never buffered for replay, always `id: 0` (the server stamps the SSE frame
 * with the connection's last real id instead -- see PROTOCOL.md).
 */
export interface RemoteReplPingEvent {
  id: 0;
  type: 'system';
  commandId: null;
  data: RemoteReplPingEventData;
}

/** Every event that travels on the `remote-repl:out` topic (and is replayable). */
export type RemoteReplTransportEvent = RemoteReplCommandEvent | RemoteReplOutputEvent | RemoteReplDoneEvent | RemoteReplErrorEvent;

/** Every event that can appear as an SSE `data:` payload. */
export type RemoteReplSseEvent = RemoteReplTransportEvent | RemoteReplPingEvent;

/**
 * Structural superset of `RemoteReplSseEvent`: the engine's working type, where `data`
 * is still untyped. Everything that is a valid `RemoteReplSseEvent` is a valid
 * `RemoteReplEvent`; the reverse is what the schema rejects.
 */
export interface RemoteReplEvent {
  id: number;
  type: RemoteReplSseEventType;
  commandId: string | null;
  data: unknown;
}

/** Published on `remote-repl:cmd` by the instance that received the HTTP request. */
export interface RemoteReplCmdMessage {
  channel: string;
  commandId: string;
  command: string;
  originInstanceId: string;
}

/**
 * Published on `remote-repl:out` by the channel's owner; fanned out to every
 * instance. On the wire `event` is always a `RemoteReplTransportEvent`
 * (`RemoteReplOutMessage<RemoteReplTransportEvent>`, the schema's shape); the engine works with
 * the untyped default while it builds one.
 */
export interface RemoteReplOutMessage<E extends RemoteReplEvent = RemoteReplEvent> {
  channel: string;
  event: E;
}

/** The `remote-repl:out` message exactly as it travels. */
export type RemoteReplWireOutMessage = RemoteReplOutMessage<RemoteReplTransportEvent>;

/** Published on `remote-repl:sys`: ownership `claim` (also the lease heartbeat) and `release`. */
export interface RemoteReplSysMessage {
  channel: string;
  kind: 'claim' | 'release';
  instanceId: string;
}
