import { InMemoryWebReplAdapter } from './in-memory-web-repl.adapter';

describe('InMemoryWebReplAdapter', () => {
  it('delivers a published message to a subscriber on the same topic', async () => {
    const a = new InMemoryWebReplAdapter();
    const received: string[] = [];
    await a.subscribe('webrepl:cmd', (m) => received.push(m));
    await a.publish('webrepl:cmd', 'hello');
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual(['hello']);
  });

  it('does not cross topics', async () => {
    const a = new InMemoryWebReplAdapter();
    const received: string[] = [];
    await a.subscribe('webrepl:out', (m) => received.push(m));
    await a.publish('webrepl:cmd', 'x');
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual([]);
  });

  it('fans out to multiple subscribers', async () => {
    const a = new InMemoryWebReplAdapter();
    const one: string[] = [];
    const two: string[] = [];
    await a.subscribe('webrepl:sys', (m) => one.push(m));
    await a.subscribe('webrepl:sys', (m) => two.push(m));
    await a.publish('webrepl:sys', 'claim');
    await new Promise((r) => setTimeout(r, 0));
    expect(one).toEqual(['claim']);
    expect(two).toEqual(['claim']);
  });
});
