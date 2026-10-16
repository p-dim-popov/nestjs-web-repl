import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @remote-repl/core is the framework-free heart of the monorepo. Every
// framework adapter (nestjs today, express/bun/deno later) depends on it, so
// it must never pull a framework, a transport client, or rxjs into consumers.
describe('@remote-repl/core package boundary', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const allDeps = () =>
    Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    });

  it('is named @remote-repl/core and lives at packages/core', () => {
    expect(pkg.name).toBe('@remote-repl/core');
    expect(process.cwd().endsWith(join('packages', 'core'))).toBe(true);
  });

  it('has zero @nestjs/*, express, redis, ioredis or rxjs dependencies', () => {
    const forbidden = allDeps().filter(
      (d) => d.startsWith('@nestjs/') || ['express', 'redis', 'ioredis', 'rxjs'].includes(d),
    );
    expect(forbidden).toEqual([]);
  });

  it('owns the monaco-editor devDependency (the UI asset source)', () => {
    expect(pkg.devDependencies['monaco-editor']).toBeTypeOf('string');
  });

  it('points main/types at the compiled dist entry', () => {
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
  });
});
