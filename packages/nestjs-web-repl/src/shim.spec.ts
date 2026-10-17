import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shim from 'nestjs-web-repl';
import * as shimRedis from 'nestjs-web-repl/redis';
import * as nestjsPkg from '@remote-repl/nestjs';
import * as redisPkg from '@remote-repl/redis';

// `nestjs-web-repl` is the legacy name. It resolves every pre-split public
// name as a deprecated alias of its @remote-repl/* replacement (same object
// identity, so DI tokens and instanceof checks agree across the two names),
// and it also exposes the new names so an app can migrate one import at a
// time. `WebReplModule` is the one alias with logic: it translates the
// legacy `adapter` extra to `transport` and delegates to `RemoteReplModule`.
describe('nestjs-web-repl legacy aliases', () => {
  it('resolves every legacy runtime name to its replacement', () => {
    expect(shim.WebReplController).toBe(nestjsPkg.RemoteReplController);
    expect(shim.WebReplService).toBe(nestjsPkg.RemoteReplService);
    expect(shim.InMemoryWebReplAdapter).toBe(nestjsPkg.RemoteReplInMemoryTransport);
    expect(shim.WEB_REPL_OPTIONS).toBe(nestjsPkg.REMOTE_REPL_OPTIONS);
    expect(typeof shim.WebReplModule.register).toBe('function');
    expect(typeof shim.WebReplModule.registerAsync).toBe('function');
  });

  it('resolves every legacy /redis name to its replacement', () => {
    expect(shimRedis.IoRedisWebReplAdapter).toBe(redisPkg.RemoteReplIoRedisTransport);
    expect(shimRedis.NodeRedisWebReplAdapter).toBe(redisPkg.RemoteReplNodeRedisTransport);
    expect(shimRedis.BaseRedisWebReplAdapter).toBe(redisPkg.RemoteReplBaseRedisTransport);
  });

  it('also exposes the new names, so an app can migrate import by import', () => {
    const isNew = (key: string) => /^(RemoteRepl|REMOTE_REPL_)/.test(key);
    const newNestjs = Object.keys(nestjsPkg).filter(isNew) as (keyof typeof nestjsPkg)[];
    const newRedis = Object.keys(redisPkg).filter(isNew) as (keyof typeof redisPkg)[];
    expect(newNestjs).toContain('RemoteReplModule');
    expect(newRedis).toContain('RemoteReplIoRedisTransport');
    for (const key of newNestjs) expect(shim[key], key).toBe(nestjsPkg[key]);
    for (const key of newRedis) expect(shimRedis[key], key).toBe(redisPkg[key]);
  });

  it('WebReplModule.register returns the RemoteReplModule dynamic module', () => {
    const dynamic = shim.WebReplModule.register({ enabled: false });
    expect(dynamic.module).toBe(nestjsPkg.RemoteReplModule);
  });
});

// The deprecation must reach the consumer's editor: every legacy name carries
// a JSDoc `@deprecated` tag in the EMITTED declarations, not only in source.
describe('nestjs-web-repl emitted declarations', () => {
  const LEGACY_INDEX = [
    'WebReplModule',
    'WebReplController',
    'WebReplService',
    'InMemoryWebReplAdapter',
    'WEB_REPL_OPTIONS',
    'WebReplAdapter',
    'WebReplModuleOptions',
    'WebReplModuleExtras',
    'WebReplAdapterConfig',
    'WebReplEvent',
    'SseEventType',
  ];
  const LEGACY_REDIS = [
    'IoRedisWebReplAdapter',
    'NodeRedisWebReplAdapter',
    'BaseRedisWebReplAdapter',
    'RedisWebReplAdapterOptions',
    'RedisWebReplLogger',
    'IoRedisLike',
    'NodeRedisLike',
  ];

  // Emit declarations for the shim's sources alone (siblings resolve through
  // the typecheck `paths`, so no prior build is needed).
  const outDir = mkdtempSync(join(tmpdir(), 'nestjs-web-repl-dts-'));
  beforeAll(() => {
    execFileSync(
      join(process.cwd(), '..', '..', 'node_modules', '.bin', 'tsc'),
      ['-p', 'tsconfig.typecheck.json', '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', outDir],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
  }, 120_000);

  const declared = (file: string) => readFileSync(join(outDir, 'nestjs-web-repl', 'src', file), 'utf8');
  // The JSDoc block that precedes the `export` of `name`.
  const docOf = (dts: string, name: string): string | undefined => {
    const re = new RegExp(`\\/\\*\\*([\\s\\S]*?)\\*\\/\\s*export [^;{]*\\b${name}\\b`, 'g');
    const m = re.exec(dts);
    return m?.[1];
  };

  it.each(LEGACY_INDEX)('index.d.ts marks %s @deprecated with its replacement', (name) => {
    const doc = docOf(declared('index.d.ts'), name);
    expect(doc, `${name} has no JSDoc`).toBeDefined();
    expect(doc).toMatch(/@deprecated/);
    expect(doc).toMatch(/RemoteRepl|REMOTE_REPL/);
  });

  it.each(LEGACY_REDIS)('redis.d.ts marks %s @deprecated with its replacement', (name) => {
    const doc = docOf(declared('redis.d.ts'), name);
    expect(doc, `${name} has no JSDoc`).toBeDefined();
    expect(doc).toMatch(/@deprecated/);
    expect(doc).toMatch(/RemoteRepl/);
  });
});
