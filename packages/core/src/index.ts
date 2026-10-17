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

// ---------------------------------------------------------------------------
// Transitional aliases (ticket #36, expand phase). Removed once every package
// in the workspace imports the RemoteRepl* names above.
export {
  REMOTE_REPL_TOPICS as TOPICS,
  REMOTE_REPL_DEFAULTS as DEFAULTS,
} from './protocol/constants';
export type { RemoteReplTransport as WebReplAdapter } from './protocol/transport';
export type {
  RemoteReplTopic as Topic,
  RemoteReplSseEventType as SseEventType,
  RemoteReplCommandEventData as CommandEventData,
  RemoteReplOutputEventData as OutputEventData,
  RemoteReplDoneEventData as DoneEventData,
  RemoteReplErrorEventData as ErrorEventData,
  RemoteReplPingEventData as PingEventData,
  RemoteReplCommandEvent as CommandEvent,
  RemoteReplOutputEvent as OutputEvent,
  RemoteReplDoneEvent as DoneEvent,
  RemoteReplErrorEvent as ErrorEvent,
  RemoteReplPingEvent as PingEvent,
  RemoteReplTransportEvent as TransportEvent,
  RemoteReplSseEvent as SseEvent,
  RemoteReplEvent as WebReplEvent,
  RemoteReplCmdMessage as CmdMessage,
  RemoteReplOutMessage as OutMessage,
  RemoteReplWireOutMessage as WireOutMessage,
  RemoteReplSysMessage as SysMessage,
} from './protocol/messages';
export type { RemoteReplOptions as WebReplOptions } from './protocol/options';
export { EventRingBuffer } from './ring-buffer';
export { ReplSession } from './session/repl-session';
export type { RemoteReplSessionOptions as ReplSessionOptions } from './session/repl-session';
export { RemoteReplDisabledError as ReplDisabledError } from './engine/remote-repl-engine';
export type {
  RemoteReplContextFactory as ContextFactory,
  RemoteReplLogger as EngineLogger,
  RemoteReplStreamSink as StreamSink,
  RemoteReplStreamSubscription as StreamSubscription,
} from './engine/remote-repl-engine';
export { RemoteReplInMemoryTransport as InMemoryWebReplAdapter } from './transport/in-memory.transport';
export { renderReplUi } from './ui/repl-ui.html';
export { monacoVsDir, resolveMonacoFile } from './ui/monaco-assets';
export type { RemoteReplAsset as MonacoAsset } from './ui/monaco-assets';
export { toSseFrame, sseFrameToText } from './http/sse-frame';
export type { RemoteReplSseFrame as SseFrame } from './http/sse-frame';
export { randomChannelName, landingRedirectUrl } from './http/landing';
export {
  createRemoteReplHandlers as createReplHandlers,
  RemoteReplInvalidCommandError as InvalidCommandError,
  parseRemoteReplLastEventId as parseLastEventId,
  REMOTE_REPL_SSE_RESPONSE_HEADERS as SSE_RESPONSE_HEADERS,
  REMOTE_REPL_SSE_STREAM_PREAMBLE as SSE_STREAM_PREAMBLE,
} from './http/handlers';
export type {
  RemoteReplHandlers as ReplHandlers,
  RemoteReplHandlerEngine as ReplHandlerEngine,
  RemoteReplHandlerOptions as ReplHandlerOptions,
} from './http/handlers';
