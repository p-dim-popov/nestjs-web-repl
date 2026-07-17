import { ReplSession } from './repl-session';

const collect = () => {
  const chunks: string[] = [];
  return { chunks, onOutput: (c: string) => chunks.push(c) };
};

describe('ReplSession', () => {
  it('evaluates an expression and reports the result', async () => {
    const { chunks, onOutput } = collect();
    const s = new ReplSession({ context: {}, onOutput });
    await s.eval('1 + 1');
    s.close();
    expect(chunks.join('')).toContain('2');
  });

  it('persists variables across evals', async () => {
    const { chunks, onOutput } = collect();
    const s = new ReplSession({ context: {}, onOutput });
    await s.eval('const x = 41');
    await s.eval('x + 1');
    s.close();
    expect(chunks.join('')).toContain('42');
  });

  it('exposes seeded context values', async () => {
    const { chunks, onOutput } = collect();
    const s = new ReplSession({ context: { greet: () => 'hi-there' }, onOutput });
    await s.eval('greet()');
    s.close();
    expect(chunks.join('')).toContain('hi-there');
  });

  it('captures console.log output', async () => {
    const { chunks, onOutput } = collect();
    const s = new ReplSession({ context: {}, onOutput });
    await s.eval('console.log("logged-line")');
    s.close();
    expect(chunks.join('')).toContain('logged-line');
  });

  it('reports errors without throwing', async () => {
    const { chunks, onOutput } = collect();
    const s = new ReplSession({ context: {}, onOutput });
    await expect(s.eval('throw new Error("boom")')).resolves.toBeUndefined();
    s.close();
    expect(chunks.join('')).toContain('boom');
  });
});
