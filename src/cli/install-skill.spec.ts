import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSkill, SKILL_TARGET_SUBPATH } from './install-skill';

describe('installSkill', () => {
  let cwd: string;
  let sourcePath: string;
  const SOURCE = '---\nname: nestjs-web-repl\ndescription: x\n---\nbody\n';

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'webrepl-cwd-'));
    const srcDir = mkdtempSync(join(tmpdir(), 'webrepl-src-'));
    sourcePath = join(srcDir, 'SKILL.md');
    writeFileSync(sourcePath, SOURCE);
  });

  const target = () => join(cwd, SKILL_TARGET_SUBPATH);

  it('creates the file and parent dirs when absent', () => {
    const res = installSkill({ cwd, sourcePath });
    expect(res.status).toBe('created');
    expect(res.path).toBe(target());
    expect(readFileSync(target(), 'utf8')).toBe(SOURCE);
  });

  it('reports up-to-date and does not rewrite when identical', () => {
    installSkill({ cwd, sourcePath });
    const res = installSkill({ cwd, sourcePath });
    expect(res.status).toBe('up-to-date');
    expect(readFileSync(target(), 'utf8')).toBe(SOURCE);
  });

  it('refuses to overwrite a differing file without force', () => {
    mkdirSync(dirname(target()), { recursive: true });
    writeFileSync(target(), 'hand edited\n');
    const res = installSkill({ cwd, sourcePath });
    expect(res.status).toBe('differs');
    expect(readFileSync(target(), 'utf8')).toBe('hand edited\n'); // untouched
  });

  it('overwrites a differing file when force is set', () => {
    mkdirSync(dirname(target()), { recursive: true });
    writeFileSync(target(), 'hand edited\n');
    const res = installSkill({ cwd, sourcePath, force: true });
    expect(res.status).toBe('updated');
    expect(readFileSync(target(), 'utf8')).toBe(SOURCE);
  });

  it('defaults the source to the bundled skill/SKILL.md', () => {
    // No sourcePath: resolves to repo skill/SKILL.md (exists from Task 1).
    const res = installSkill({ cwd });
    expect(res.status).toBe('created');
    expect(existsSync(target())).toBe(true);
  });
});
