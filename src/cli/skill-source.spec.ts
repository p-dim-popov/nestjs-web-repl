import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('shipped skill source', () => {
  const raw = () =>
    readFileSync(join(process.cwd(), 'skill', 'SKILL.md'), 'utf8');

  it('has YAML frontmatter with name nestjs-web-repl and a non-empty description', () => {
    const m = raw().match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    const fm = m![1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
    const description = fm.match(/^description:\s*(.+)$/m)?.[1].trim();
    expect(name).toBe('nestjs-web-repl');
    expect(description && description.length).toBeGreaterThan(0);
  });

  it('leads with the security warning before the wiring instructions', () => {
    const body = raw();
    const securityIdx = body.indexOf('Security first');
    const wireIdx = body.indexOf('## Wire it up');
    expect(securityIdx).toBeGreaterThan(-1);
    expect(wireIdx).toBeGreaterThan(-1);
    expect(securityIdx).toBeLessThan(wireIdx);
  });
});
