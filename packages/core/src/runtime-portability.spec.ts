import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const sources = () =>
  walk(join(process.cwd(), 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

// @remote-repl/core runs on Node (supported) and on Bun and Deno (best-effort,
// CI matrix). Keep its sources free of Node-only TYPE namespaces: the
// `NodeJS.*` types (NodeJS.Timeout, NodeJS.Timer, ...) do not exist outside
// @types/node; `ReturnType<typeof setTimeout>` is the portable spelling.
describe('@remote-repl/core runtime portability', () => {
  it('has no source file using the NodeJS.* type namespace', () => {
    const offenders = sources().filter((f) => /\bNodeJS\./.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
