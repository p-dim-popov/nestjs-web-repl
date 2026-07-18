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
});
