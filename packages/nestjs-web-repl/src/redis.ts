import {
  RemoteReplBaseRedisTransport,
  RemoteReplIoRedisTransport,
  RemoteReplNodeRedisTransport,
  type RemoteReplIoRedisLike,
  type RemoteReplNodeRedisLike,
  type RemoteReplRedisLogger,
  type RemoteReplRedisTransportOptions,
} from '@remote-repl/redis';

// The new names, so an app on this package can migrate one import at a time.
export * from '@remote-repl/redis';

// Legacy names (nestjs-web-repl/redis <= 2.3.x): deprecated aliases.

/** @deprecated Use `RemoteReplBaseRedisTransport` from `@remote-repl/redis`. */
export const BaseRedisWebReplAdapter = RemoteReplBaseRedisTransport;
/** @deprecated Use `RemoteReplBaseRedisTransport` from `@remote-repl/redis`. */
export type BaseRedisWebReplAdapter = RemoteReplBaseRedisTransport;

/** @deprecated Use `RemoteReplIoRedisTransport` from `@remote-repl/redis`. */
export const IoRedisWebReplAdapter = RemoteReplIoRedisTransport;
/** @deprecated Use `RemoteReplIoRedisTransport` from `@remote-repl/redis`. */
export type IoRedisWebReplAdapter = RemoteReplIoRedisTransport;

/** @deprecated Use `RemoteReplNodeRedisTransport` from `@remote-repl/redis`. */
export const NodeRedisWebReplAdapter = RemoteReplNodeRedisTransport;
/** @deprecated Use `RemoteReplNodeRedisTransport` from `@remote-repl/redis`. */
export type NodeRedisWebReplAdapter = RemoteReplNodeRedisTransport;

/** @deprecated Use `RemoteReplRedisTransportOptions` from `@remote-repl/redis`. */
export type RedisWebReplAdapterOptions = RemoteReplRedisTransportOptions;

/** @deprecated Use `RemoteReplRedisLogger` from `@remote-repl/redis`. */
export type RedisWebReplLogger = RemoteReplRedisLogger;

/** @deprecated Use `RemoteReplIoRedisLike` from `@remote-repl/redis`. */
export type IoRedisLike = RemoteReplIoRedisLike;

/** @deprecated Use `RemoteReplNodeRedisLike` from `@remote-repl/redis`. */
export type NodeRedisLike = RemoteReplNodeRedisLike;
