import * as subpath from './redis';
import * as redisPkg from '@remote-repl/redis';

// The `nestjs-web-repl/redis` subpath is a pure re-export of @remote-repl/redis.
// Consumers keep importing the transports from here; the implementation lives
// in packages/redis.
describe('nestjs-web-repl/redis subpath', () => {
  it('re-exports every runtime export of @remote-repl/redis', () => {
    expect(Object.keys(subpath).sort()).toEqual(Object.keys(redisPkg).sort());
    expect(subpath.IoRedisWebReplAdapter).toBe(redisPkg.IoRedisWebReplAdapter);
    expect(subpath.NodeRedisWebReplAdapter).toBe(redisPkg.NodeRedisWebReplAdapter);
    expect(subpath.BaseRedisWebReplAdapter).toBe(redisPkg.BaseRedisWebReplAdapter);
  });
});
