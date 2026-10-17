export { RemoteReplBaseRedisTransport } from './base-redis.transport';
export type {
  RemoteReplRedisTransportOptions,
  RemoteReplRedisLogger,
} from './base-redis.transport';
export { RemoteReplIoRedisTransport } from './ioredis.transport';
export type { RemoteReplIoRedisLike } from './ioredis.transport';
export { RemoteReplNodeRedisTransport } from './node-redis.transport';
export type { RemoteReplNodeRedisLike } from './node-redis.transport';

// Transitional aliases (ticket #36, migrate phase); removed in the contract step.
export { RemoteReplBaseRedisTransport as BaseRedisWebReplAdapter } from './base-redis.transport';
export { RemoteReplIoRedisTransport as IoRedisWebReplAdapter } from './ioredis.transport';
export { RemoteReplNodeRedisTransport as NodeRedisWebReplAdapter } from './node-redis.transport';
