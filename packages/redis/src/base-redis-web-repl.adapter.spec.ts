import { BaseRedisWebReplAdapter } from './base-redis-web-repl.adapter';

class FakeBase extends BaseRedisWebReplAdapter {
  publishes: Array<[string, string]> = [];
  subscribeCalls: string[] = [];
  teardowns = 0;
  protected async doPublish(topic: string, message: string): Promise<void> {
    this.publishes.push([topic, message]);
  }
  protected async ensureSubscribed(topic: string): Promise<void> {
    this.subscribeCalls.push(topic);
  }
  protected async teardown(): Promise<void> {
    this.teardowns++;
  }
  emit(topic: string, message: string): void {
    this.dispatch(topic, message);
  }
}

describe('BaseRedisWebReplAdapter', () => {
  it('delivers a dispatched message to a registered handler', async () => {
    const a = new FakeBase();
    const got: string[] = [];
    await a.subscribe('webrepl:cmd', (m) => got.push(m));
    a.emit('webrepl:cmd', 'hello');
    expect(got).toEqual(['hello']);
  });

  it('calls ensureSubscribed exactly once per topic across multiple subscribe calls', async () => {
    const a = new FakeBase();
    await a.subscribe('webrepl:cmd', () => {});
    await a.subscribe('webrepl:cmd', () => {});
    await a.subscribe('webrepl:out', () => {});
    expect(a.subscribeCalls).toEqual(['webrepl:cmd', 'webrepl:out']);
  });

  it('fans out to every handler on a topic and none of another topic', async () => {
    const a = new FakeBase();
    const one: string[] = [];
    const two: string[] = [];
    const other: string[] = [];
    await a.subscribe('webrepl:sys', (m) => one.push(m));
    await a.subscribe('webrepl:sys', (m) => two.push(m));
    await a.subscribe('webrepl:out', (m) => other.push(m));
    a.emit('webrepl:sys', 'claim');
    expect(one).toEqual(['claim']);
    expect(two).toEqual(['claim']);
    expect(other).toEqual([]);
  });

  it('delegates publish to doPublish', async () => {
    const a = new FakeBase();
    await a.publish('webrepl:cmd', 'x');
    expect(a.publishes).toEqual([['webrepl:cmd', 'x']]);
  });

  it('tears down and clears state on onModuleDestroy', async () => {
    const a = new FakeBase();
    const got: string[] = [];
    await a.subscribe('webrepl:cmd', (m) => got.push(m));
    await a.onModuleDestroy();
    expect(a.teardowns).toBe(1);
    a.emit('webrepl:cmd', 'after');
    expect(got).toEqual([]);
  });

  it('isolates a throwing handler: dispatch does not throw and later handlers still run', async () => {
    const a = new FakeBase();
    const got: string[] = [];
    await a.subscribe('webrepl:cmd', () => {
      throw new Error('boom');
    });
    await a.subscribe('webrepl:cmd', (m) => got.push(m));
    expect(() => a.emit('webrepl:cmd', 'x')).not.toThrow();
    expect(got).toEqual(['x']);
  });

  describe('logger', () => {
    it('reports a handler fault through the injected logger, naming the bare topic', async () => {
      const errors: string[] = [];
      const a = new FakeBase({
        prefix: 'tenant-a:',
        logger: { warn: () => {}, error: (m) => errors.push(m) },
      });
      await a.subscribe('webrepl:cmd', () => {
        throw new Error('boom');
      });
      a.emit('tenant-a:webrepl:cmd', 'x');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('"webrepl:cmd"');
      expect(errors[0]).toContain('boom');
    });

    it('defaults to console.error so a fault is never silently swallowed', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const a = new FakeBase();
        await a.subscribe('webrepl:cmd', () => {
          throw new Error('boom');
        });
        a.emit('webrepl:cmd', 'x');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(String(spy.mock.calls[0][0])).toContain('boom');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('topic prefix', () => {
    it('prepends the prefix verbatim on the wire and strips it before dispatching to handlers', async () => {
      const a = new FakeBase({ prefix: 'tenant-a:' });
      const got: string[] = [];
      await a.subscribe('webrepl:cmd', (m) => got.push(m));
      await a.publish('webrepl:cmd', 'x');
      expect(a.subscribeCalls).toEqual(['tenant-a:webrepl:cmd']);
      expect(a.publishes).toEqual([['tenant-a:webrepl:cmd', 'x']]);
      a.emit('tenant-a:webrepl:cmd', 'hello');
      expect(got).toEqual(['hello']);
    });

    it('without a prefix, topic names are byte-identical on the wire', async () => {
      const a = new FakeBase();
      await a.subscribe('webrepl:out', () => {});
      await a.publish('webrepl:out', 'x');
      expect(a.subscribeCalls).toEqual(['webrepl:out']);
      expect(a.publishes).toEqual([['webrepl:out', 'x']]);
    });
  });
});
