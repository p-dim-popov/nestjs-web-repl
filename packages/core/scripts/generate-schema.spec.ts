import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The CI drift check: the committed schema must equal a fresh generation
// from src/protocol/messages.ts, byte for byte.
describe('scripts/generate-schema.mjs --check', () => {
  const script = join(__dirname, 'generate-schema.mjs');
  const committed = join(__dirname, '..', 'schema', 'protocol.schema.json');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000 });

  it('exits 0 when the committed schema matches the TypeScript types', () => {
    const res = run('--check');
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('exits 1 and names the file when the committed schema has drifted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-repl-schema-'));
    const tampered = join(dir, 'protocol.schema.json');
    const schema = JSON.parse(readFileSync(committed, 'utf8'));
    delete schema.definitions.RemoteReplSysMessage.properties.instanceId;
    writeFileSync(tampered, JSON.stringify(schema, null, 2) + '\n');

    const res = run('--check', '--out', tampered);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(tampered);
    expect(res.stderr).toContain('schema:generate');
  });

  it('exits 1 when the committed schema is missing', () => {
    const res = run('--check', '--out', join(mkdtempSync(join(tmpdir(), 'remote-repl-schema-')), 'nope.json'));
    expect(res.status).toBe(1);
  });
});
