import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from './index';
import { SKILL_TARGET_SUBPATH } from './install-skill';

describe('cli run', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'webrepl-cli-'));
  });

  it('prints usage and exits 0 for --help', () => {
    const res = run(['--help'], cwd);
    expect(res.code).toBe(0);
    expect(res.out).toContain('install-skill');
  });

  it('prints usage and exits 0 for no args', () => {
    const res = run([], cwd);
    expect(res.code).toBe(0);
    expect(res.out).toContain('Usage');
  });

  it('installs the skill and exits 0 for install-skill', () => {
    const res = run(['install-skill'], cwd);
    expect(res.code).toBe(0);
    expect(res.out).toContain('created');
    expect(existsSync(join(cwd, SKILL_TARGET_SUBPATH))).toBe(true);
  });

  it('reports up to date on a second run', () => {
    run(['install-skill'], cwd);
    const res = run(['install-skill'], cwd);
    expect(res.code).toBe(0);
    expect(res.out).toContain('up to date');
  });

  it('exits non-zero and writes to err for an unknown command', () => {
    const res = run(['frobnicate'], cwd);
    expect(res.code).toBeGreaterThan(0);
    expect(res.err).toContain('unknown command');
  });
});
