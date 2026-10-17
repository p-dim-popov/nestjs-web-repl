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
  const rootPkg = () =>
    JSON.parse(
      readFileSync(join(process.cwd(), '..', '..', 'package.json'), 'utf8'),
    );

  it('sits under a private workspace root that lists packages/*', () => {
    expect(rootPkg().private).toBe(true);
    expect(rootPkg().workspaces).toContain('packages/*');
  });

  it('is reached from the workspace root by its package name', () => {
    expect(pkgName()).toBe('@remote-repl/nestjs');
    expect(process.cwd().endsWith(join('packages', 'nestjs'))).toBe(true);
  });

  function pkgName(): string {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
      .name;
  }
});
