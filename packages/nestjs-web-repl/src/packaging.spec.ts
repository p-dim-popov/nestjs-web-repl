import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// `npm pack --json` prints an array of pack results up to npm 11 and, from
// npm 12, an object keyed by package name. Accept both.
const packedPaths = (packJson: string): string[] => {
  const parsed = JSON.parse(packJson);
  const result = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return (result as { files: { path: string }[] }).files.map((f) => f.path);
};

// `nestjs-web-repl` is the legacy package name, kept alive as a re-export
// shim over @remote-repl/nestjs (+ @remote-repl/redis under ./redis) so an
// existing install resolves identically. These pins moved here from
// packages/nestjs when that package became @remote-repl/nestjs.
describe('nestjs-web-repl packaging', () => {
  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
  const pkg = read(join(process.cwd(), 'package.json'));
  const nestjsPkg = read(join(process.cwd(), '..', 'nestjs', 'package.json'));
  const redisPkg = read(join(process.cwd(), '..', 'redis', 'package.json'));

  it('keeps the exact legacy unscoped name and lives at packages/nestjs-web-repl', () => {
    expect(pkg.name).toBe('nestjs-web-repl');
    expect(process.cwd().endsWith(join('packages', 'nestjs-web-repl'))).toBe(true);
  });

  // Versions are decoupled (ADR 0005): the shim stays on its own 2.x line and
  // the @remote-repl packages start at 1.0.0. The shim follows them through
  // caret ranges, never through a shared version number.
  it('stays on its own 2.x line while the @remote-repl packages are on 1.x', () => {
    expect(pkg.version).toMatch(/^2\./);
    expect(nestjsPkg.version).toMatch(/^1\./);
    expect(redisPkg.version).toMatch(/^1\./);
  });

  it('depends on @remote-repl/nestjs and @remote-repl/redis with ^1.0.0 ranges, nothing else', () => {
    expect(pkg.dependencies).toEqual({
      '@remote-repl/nestjs': '^1.0.0',
      '@remote-repl/redis': '^1.0.0',
    });
  });

  it('exposes the default entry, the redis subpath and package.json in exports', () => {
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './redis': { types: './dist/redis.d.ts', default: './dist/redis.js' },
      './package.json': './package.json',
    });
  });

  it('provides a typesVersions fallback for the redis subpath', () => {
    expect(pkg.typesVersions['*'].redis).toEqual(['dist/redis.d.ts']);
  });

  it('carries the NestJS and rxjs peers exactly as the legacy package did', () => {
    expect(pkg.peerDependencies['@nestjs/common']).toBe('^10 || ^11');
    expect(pkg.peerDependencies['@nestjs/core']).toBe('^10 || ^11');
    expect(pkg.peerDependencies.rxjs).toBe('^7');
  });

  it('declares ioredis and redis as optional peer dependencies', () => {
    expect(pkg.peerDependencies.ioredis).toBe('^5');
    expect(pkg.peerDependencies.redis).toBe('^4 || ^5');
    expect(pkg.peerDependenciesMeta).toEqual({
      ioredis: { optional: true },
      redis: { optional: true },
    });
  });

  it('ships no bin (skills install via skills.sh)', () => {
    expect(pkg.bin).toBeUndefined();
  });

  it('packs dist, README and LICENSE and nothing from src or skill', () => {
    expect(pkg.files).toEqual(['dist']);
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const paths: string[] = packedPaths(out);
    expect(paths).toContain('README.md');
    expect(paths).toContain('LICENSE');
    expect(paths).toContain('package.json');
    expect(paths.some((p) => p.startsWith('src/') || p.startsWith('skill/'))).toBe(false);
  });
});

// Releases are driven by changesets (`.changeset/config.json` at the workspace
// root), not semantic-release. No `fixed` or `linked` group: every package is
// versioned by its own changesets, and every package is public so
// `changeset publish` can ship it.
describe('release wiring (changesets)', () => {
  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
  const repoRoot = join(process.cwd(), '..', '..');
  const packagesDir = join(repoRoot, 'packages');
  const manifests = readdirSync(packagesDir)
    .map((d) => join(packagesDir, d, 'package.json'))
    .filter((p) => existsSync(p))
    .map(read);
  const names = manifests.map((m) => m.name).sort();
  const config = () => read(join(repoRoot, '.changeset', 'config.json'));

  it('has all five workspace packages', () => {
    expect(names).toEqual([
      '@remote-repl/core',
      '@remote-repl/express',
      '@remote-repl/nestjs',
      '@remote-repl/redis',
      'nestjs-web-repl',
    ]);
  });

  it('has no fixed or linked group', () => {
    expect(config().fixed ?? []).toEqual([]);
    expect(config().linked ?? []).toEqual([]);
  });

  it('the four @remote-repl packages are at 1.x and depend on each other with ^1.0.0', () => {
    const scoped = manifests.filter((m) => m.name.startsWith('@remote-repl/'));
    expect(scoped).toHaveLength(4);
    for (const m of scoped) {
      expect(m.version, m.name).toMatch(/^1\./);
      for (const [dep, range] of Object.entries({ ...m.dependencies, ...m.devDependencies })) {
        if (dep.startsWith('@remote-repl/')) expect(range, `${m.name} -> ${dep}`).toBe('^1.0.0');
      }
    }
  });

  it('publishes every package publicly from the main branch', () => {
    expect(config().access).toBe('public');
    expect(config().baseBranch).toBe('main');
    expect(config().updateInternalDependencies).toBe('patch');
    expect(config().ignore ?? []).toEqual([]);
    for (const m of manifests) {
      expect(m.private, m.name).toBeUndefined();
      expect(m.publishConfig?.access, m.name).toBe('public');
    }
  });

  it('has no semantic-release config or dependencies left at the root', () => {
    const rootPkg = read(join(repoRoot, 'package.json'));
    const devDeps = Object.keys(rootPkg.devDependencies ?? {});
    expect(devDeps.some((d) => d.includes('semantic-release'))).toBe(false);
    expect(devDeps).toContain('@changesets/cli');
    expect(existsSync(join(repoRoot, '.releaserc.json'))).toBe(false);
    expect(rootPkg.scripts['changeset:version']).toBeDefined();
    expect(rootPkg.scripts['changeset:publish']).toBeDefined();
  });
});
