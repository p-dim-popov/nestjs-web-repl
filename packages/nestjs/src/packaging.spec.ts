import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const repoRoot = join(process.cwd(), '..', '..');

describe('packaging', () => {
  const pkg = read(join(process.cwd(), 'package.json'));

  it('ships only dist (no skill dir, no bin: skills install via skills.sh)', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.bin).toBeUndefined();
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const paths: string[] = JSON.parse(out)[0].files.map(
      (f: { path: string }) => f.path,
    );
    expect(paths.some((p) => p.startsWith('skill/') || p.includes('/cli/'))).toBe(false);
  });

  // The `./redis` subpath, its typesVersions fallback and the optional
  // ioredis/redis peers belong to the `nestjs-web-repl` shim
  // (packages/nestjs-web-repl): this package exports only its own API.
  it('exposes only the default entry and package.json in exports', () => {
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    });
    expect(pkg.typesVersions).toBeUndefined();
  });

  it('has no runtime dependency on @remote-repl/redis and no redis client peers', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['@remote-repl/core']);
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual([
      '@nestjs/common',
      '@nestjs/core',
      'rxjs',
    ]);
    expect(pkg.peerDependenciesMeta).toBeUndefined();
  });
});

describe('workspace layout', () => {
  // This package lives at packages/nestjs inside an npm-workspaces monorepo.
  // The root manifest is private (never published) and owns the workspace.
  const rootPkg = () => read(join(repoRoot, 'package.json'));

  it('sits under a private workspace root that lists packages/*', () => {
    expect(rootPkg().private).toBe(true);
    expect(rootPkg().workspaces).toContain('packages/*');
  });

  it('is reached from the workspace root by its package name', () => {
    expect(read(join(process.cwd(), 'package.json')).name).toBe('@remote-repl/nestjs');
    expect(process.cwd().endsWith(join('packages', 'nestjs'))).toBe(true);
  });

  it('has no package with a bin field anywhere in the workspace', () => {
    const packagesDir = join(repoRoot, 'packages');
    const manifests = readdirSync(packagesDir)
      .map((d) => join(packagesDir, d, 'package.json'))
      .filter((p) => existsSync(p));
    expect(manifests.length).toBeGreaterThan(0);
    for (const p of [join(repoRoot, 'package.json'), ...manifests]) {
      expect(read(p).bin, p).toBeUndefined();
    }
  });
});

// Agent skills are plain files under skills/<dir>/SKILL.md at the repo root,
// installed by consumers with `npx skills add p-dim-popov/remote-repl/skills/<dir>`.
describe('agent skills (skills.sh layout)', () => {
  const skill = (dir: string) =>
    readFileSync(join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf8');
  const frontmatter = (body: string) => {
    const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    const fm = m![1];
    return {
      name: fm.match(/^name:\s*(.+)$/m)?.[1].trim(),
      description: fm.match(/^description:\s*(.+)$/m)?.[1].trim(),
    };
  };

  it.each([
    ['nestjs-web-repl', 'nestjs-web-repl'],
    ['remote-repl-express', 'remote-repl-express'],
  ])('skills/%s/SKILL.md has frontmatter name %s and a description', (dir, name) => {
    const fm = frontmatter(skill(dir));
    expect(fm.name).toBe(name);
    expect(fm.description && fm.description.length).toBeGreaterThan(0);
  });

  it.each(['nestjs-web-repl', 'remote-repl-express'])(
    'skills/%s leads with the security warning before the wiring instructions',
    (dir) => {
      const body = skill(dir);
      const securityIdx = body.indexOf('Security first');
      const wireIdx = body.indexOf('## Wire it up');
      expect(securityIdx).toBeGreaterThan(-1);
      expect(wireIdx).toBeGreaterThan(-1);
      expect(securityIdx).toBeLessThan(wireIdx);
    },
  );

  it('the NestJS skill documents register(), the shim and the redis prefix', () => {
    const body = skill('nestjs-web-repl');
    expect(body).toContain('WebReplModule.register(');
    expect(body).not.toContain('forRoot');
    expect(body).toContain('@remote-repl/nestjs');
    expect(body).toContain('nestjs-web-repl/redis');
    expect(body).toContain('prefix');
    expect(body).not.toMatch(/npx nestjs-web-repl install/);
  });

  it('the Express skill documents the engine + router API and the lifecycle', () => {
    const body = skill('remote-repl-express');
    expect(body).toContain('@remote-repl/express');
    expect(body).toContain('createReplEngine(');
    expect(body).toContain('createReplRouter(');
    expect(body).toContain('engine.start()');
    expect(body).toContain('engine.stop()');
    expect(body).toContain('prefix');
  });
});

// The repo is being renamed to p-dim-popov/remote-repl (ADR 0004; the
// skills.sh install paths already use it). Every URL in the tree that names
// the repo must use that slug so they cannot drift. The root CHANGELOG.md
// keeps the original slug in its released history; everything else is
// scanned for both superseded slugs.
describe('repository slug', () => {
  const OLD_SLUGS = ['nestjs-web-repl', 'node-remote-repl'].map((r) => ['p-dim-popov', r].join('/'));
  // Tracked files only: untracked or ignored local files (scratch dirs,
  // build output) are not part of what ships, so they must not fail the gate.
  const trackedFiles = (): string[] =>
    execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((rel) => join(repoRoot, rel))
      .filter((f) => existsSync(f));

  it('no tracked file outside the root CHANGELOG history references a superseded slug', () => {
    const offenders = trackedFiles()
      .filter((f) => f !== join(repoRoot, 'CHANGELOG.md'))
      .filter((f) => {
        const body = readFileSync(f, 'utf8');
        return OLD_SLUGS.some((slug) => body.includes(slug));
      })
      .map((f) => f.slice(repoRoot.length + 1));
    expect(offenders).toEqual([]);
  });
});

// `tsc -b` is incremental and never deletes the output of a source file that
// was removed (seen with a stale dist/cli after the CLI was deleted), so every
// package's `build` empties its dist first. Guarded on dist existing: `npm
// test` needs no prior build, but CI builds first, so there it is live.
describe('built output (when a dist exists)', () => {
  const packagesDir = join(repoRoot, 'packages');
  const listFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) listFiles(full, out);
      else out.push(full);
    }
    return out;
  };
  const built = readdirSync(packagesDir).filter((d) => existsSync(join(packagesDir, d, 'dist')));

  it.each(built)('packages/%s/dist has no output whose source is gone', (name) => {
    const dist = join(packagesDir, name, 'dist');
    const src = join(packagesDir, name, 'src');
    const stale = listFiles(dist)
      .map((f) => f.slice(dist.length + 1))
      .filter((rel) => /\.(js|d\.ts)$/.test(rel))
      // core copies the Monaco tree into dist/ui/vs; it has no .ts sources.
      .filter((rel) => !rel.startsWith(join('ui', 'vs')))
      .filter((rel) => !existsSync(join(src, rel.replace(/\.d\.ts$|\.js$/, '.ts'))));
    expect(stale).toEqual([]);
  });
});
