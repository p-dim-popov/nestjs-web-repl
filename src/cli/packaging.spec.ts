import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('packaging', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  );

  it('wires the bin to the compiled CLI', () => {
    expect(pkg.bin).toEqual({ 'nestjs-web-repl': 'dist/cli/index.js' });
  });

  it('lists both dist and skill in files', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('skill');
  });

  it('ships skill/SKILL.md in the published tarball', () => {
    expect(existsSync(join(process.cwd(), 'skill', 'SKILL.md'))).toBe(true);
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const paths: string[] = JSON.parse(out)[0].files.map(
      (f: { path: string }) => f.path,
    );
    expect(paths).toContain('skill/SKILL.md');
  });

  it('exposes the default entry and the redis subpath in exports', () => {
    expect(pkg.exports['.']).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
    expect(pkg.exports['./redis']).toEqual({
      types: './dist/redis.d.ts',
      default: './dist/redis.js',
    });
  });

  it('declares ioredis and redis as optional peer dependencies', () => {
    expect(pkg.peerDependencies.ioredis).toBeTypeOf('string');
    expect(pkg.peerDependencies.redis).toBeTypeOf('string');
    expect(pkg.peerDependenciesMeta.ioredis).toEqual({ optional: true });
    expect(pkg.peerDependenciesMeta.redis).toEqual({ optional: true });
  });

  it('provides a typesVersions fallback for the redis subpath', () => {
    expect(pkg.typesVersions['*'].redis).toEqual(['dist/redis.d.ts']);
  });
});
