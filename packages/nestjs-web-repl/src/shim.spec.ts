import * as shim from 'nestjs-web-repl';
import * as shimRedis from 'nestjs-web-repl/redis';
import * as nestjsPkg from '@remote-repl/nestjs';
import * as redisPkg from '@remote-repl/redis';

// The shim has no API of its own: `nestjs-web-repl` IS `@remote-repl/nestjs`
// and `nestjs-web-repl/redis` IS `@remote-repl/redis`, same keys, same
// object identities (so `WebReplModule.register(...)`'s metadata, DI tokens
// and instanceof checks all agree across the two names).
describe('nestjs-web-repl shim', () => {
  it('re-exports every runtime export of @remote-repl/nestjs', () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(nestjsPkg).sort());
    for (const key of Object.keys(nestjsPkg) as (keyof typeof nestjsPkg)[]) {
      expect(shim[key]).toBe(nestjsPkg[key]);
    }
  });

  it('preserves class identity for WebReplModule, controller and service', () => {
    expect(shim.WebReplModule).toBe(nestjsPkg.WebReplModule);
    expect(shim.WebReplController).toBe(nestjsPkg.WebReplController);
    expect(shim.WebReplService).toBe(nestjsPkg.WebReplService);
    expect(shim.WEB_REPL_OPTIONS).toBe(nestjsPkg.WEB_REPL_OPTIONS);
  });

  it('re-exports every runtime export of @remote-repl/redis under /redis', () => {
    expect(Object.keys(shimRedis).sort()).toEqual(Object.keys(redisPkg).sort());
    expect(shimRedis.IoRedisWebReplAdapter).toBe(redisPkg.IoRedisWebReplAdapter);
    expect(shimRedis.NodeRedisWebReplAdapter).toBe(redisPkg.NodeRedisWebReplAdapter);
    expect(shimRedis.BaseRedisWebReplAdapter).toBe(redisPkg.BaseRedisWebReplAdapter);
  });
});
