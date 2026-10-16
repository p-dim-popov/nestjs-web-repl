// Protocol
export { TOPICS, DEFAULTS } from './protocol/constants';
export type { WebReplAdapter } from './protocol/adapter';
export type {
  Topic,
  SseEventType,
  CommandEventData,
  OutputEventData,
  DoneEventData,
  ErrorEventData,
  PingEventData,
  CommandEvent,
  OutputEvent,
  DoneEvent,
  ErrorEvent,
  PingEvent,
  TransportEvent,
  SseEvent,
  WebReplEvent,
  CmdMessage,
  OutMessage,
  WireOutMessage,
  SysMessage,
} from './protocol/messages';
export type { WebReplOptions } from './protocol/options';

// Replay buffer
export { EventRingBuffer } from './ring-buffer';

// REPL session (one node:repl per channel)
export { ReplSession } from './session/repl-session';
export type { ReplSessionOptions } from './session/repl-session';

// Transports
export { InMemoryWebReplAdapter } from './transport/in-memory.adapter';

// Browser UI (self-hosted Monaco)
export { renderReplUi } from './ui/repl-ui.html';
export { monacoVsDir, resolveMonacoFile } from './ui/monaco-assets';
export type { MonacoAsset } from './ui/monaco-assets';

// Framework-free HTTP helpers (SSE frame mapping, landing redirect)
export { toSseFrame } from './http/sse-frame';
export type { SseFrame } from './http/sse-frame';
export { randomChannelName, landingRedirectUrl } from './http/landing';