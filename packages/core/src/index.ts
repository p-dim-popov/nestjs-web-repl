// Protocol
export { REMOTE_REPL_TOPICS, REMOTE_REPL_DEFAULTS } from './protocol/constants';
export type { RemoteReplTransport } from './protocol/transport';
export type {
  RemoteReplTopic,
  RemoteReplSseEventType,
  RemoteReplCommandEventData,
  RemoteReplOutputEventData,
  RemoteReplDoneEventData,
  RemoteReplErrorEventData,
  RemoteReplPingEventData,
  RemoteReplCommandEvent,
  RemoteReplOutputEvent,
  RemoteReplDoneEvent,
  RemoteReplErrorEvent,
  RemoteReplPingEvent,
  RemoteReplTransportEvent,
  RemoteReplSseEvent,
  RemoteReplEvent,
  RemoteReplCmdMessage,
  RemoteReplOutMessage,
  RemoteReplWireOutMessage,
  RemoteReplSysMessage,
} from './protocol/messages';
export type { RemoteReplOptions } from './protocol/options';

// Session: the interface is public (the seam for another runtime's
// implementation); the Node implementation is reached through the engine.
export type { RemoteReplSession, RemoteReplSessionOptions } from './session/repl-session';

// Engine (framework-free; framework packages wrap it)
export { RemoteReplEngine, RemoteReplDisabledError } from './engine/remote-repl-engine';
export type {
  RemoteReplContextFactory,
  RemoteReplLogger,
  RemoteReplStreamSink,
  RemoteReplStreamSubscription,
} from './engine/remote-repl-engine';

// Transports
export { RemoteReplInMemoryTransport } from './transport/in-memory.transport';

// Framework-free route handlers (all route logic; framework packages do HTTP wiring)
export {
  createRemoteReplHandlers,
  RemoteReplInvalidCommandError,
  parseRemoteReplLastEventId,
  REMOTE_REPL_SSE_RESPONSE_HEADERS,
  REMOTE_REPL_SSE_STREAM_PREAMBLE,
} from './http/handlers';
export type {
  RemoteReplHandlers,
  RemoteReplHandlerEngine,
  RemoteReplHandlerOptions,
} from './http/handlers';
export type { RemoteReplSseFrame } from './http/sse-frame';
export type { RemoteReplAsset } from './ui/monaco-assets';
