import { RemoteReplInMemoryTransport } from '../transport/in-memory.transport';
import type { RemoteReplEvent } from '../protocol/messages';
import type { RemoteReplOptions } from '../protocol/options';
import { RemoteReplEngine, RemoteReplDisabledError } from './remote-repl-engine';

const silentLogger = { warn: () => {}, error: () => {} };
const defaultContext = () => ({ marker: () => 'ctx-ok' });

const makeEngine = async (
  instanceId: string,
  transport: RemoteReplInMemoryTransport,
  overrides: Partial<RemoteReplOptions> = {},
  contextFactory: () => Record<string, unknown> = defaultContext,
  clock: () => number = () => Date.now(),
) => {
  const engine = new RemoteReplEngine(
    { enabled: true, instanceId, ...overrides },
    transport,
    contextFactory,
    clock,
    silentLogger,
  );
  await engine.start();
  return engine;
};

// Pull `n` events off an async iterator, then release it (return()).
const takeN = async (iter: AsyncIterator<RemoteReplEvent>, n: number): Promise<RemoteReplEvent[]> => {
  const got: RemoteReplEvent[] = [];
  while (got.length < n) {
    const { value, done } = await iter.next();
    if (done) break;
    got.push(value);
  }
  await iter.return?.(undefined);
  return got;
};

// Collect every event into `sink` until `stop()` is called.
const collect = (iter: AsyncIterator<RemoteReplEvent>, sink: RemoteReplEvent[]) => {
  const pump = (async () => {
    for (;;) {
      const { value, done } = await iter.next();
      if (done) return;
      sink.push(value);
    }
  })();
  return async () => {
    await iter.return?.(undefined);
    await pump;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const makeSharedClock = (start = 0) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('RemoteReplEngine', () => {
  it('executes a dispatched command and yields the command echo followed by its output', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const engine = await makeEngine('A', transport);

    const iter = engine.events('c1', null);
    const pending = takeN(iter, 2);
    const { commandId } = await engine.dispatch('c1', '2 + 3');
    const got = await pending;

    expect(got[0].type).toBe('command');
    expect(got[0].commandId).toBe(commandId);
    expect(got[1].type).toBe('output');
    expect(String(got[1].data)).toContain('5');
    await engine.stop();
  });

  it('replays buffered events to a late subscriber', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const engine = await makeEngine('A', transport);
    await engine.dispatch('c3', '7 * 6');
    await sleep(20);

    const replay = await takeN(engine.events('c3', null), 2);
    expect(replay[0].type).toBe('command');
    expect(replay.some((e) => String(e.data).includes('42'))).toBe(true);
    await engine.stop();
  });

  it('replays only events after lastEventId', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const engine = await makeEngine('A', transport);
    await engine.dispatch('c3b', '1 + 1');
    await sleep(20);
    const all = await takeN(engine.events('c3b', null), 3);
    expect(all.map((e) => e.id)).toEqual([1, 2, 3]);

    const tail = await takeN(engine.events('c3b', 1), 2);
    expect(tail.map((e) => e.id)).toEqual([2, 3]);
    await engine.stop();
  });

  it('merges a client-visible {ping} heartbeat (id 0) into the stream, never buffering it', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const engine = await makeEngine('A', transport, { heartbeatInterval: 10 });

    const got = await takeN(engine.events('hb', null), 1);
    expect(got[0]).toEqual({ id: 0, type: 'system', commandId: null, data: { ping: true } });
    // A second subscriber replays nothing: pings are per-subscriber only,
    // never written to the channel's replay buffer.
    const replayed: RemoteReplEvent[] = [];
    engine.openStream('hb', null, { next: (e) => replayed.push(e), complete: () => {} }).close();
    expect(replayed).toEqual([]);
    await engine.stop();
  });

  it('routes execution to the owning instance only', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const a = await makeEngine('A', transport);
    const b = await makeEngine('B', transport);

    // A owns c2 because A receives the dispatch (origin = A).
    await a.dispatch('c2', 'const v = 10');
    await sleep(20);
    // A command posted at B for the same channel must still execute on A
    // (the owner), so the variable persists.
    const events: RemoteReplEvent[] = [];
    const stop = collect(b.events('c2', null), events);
    await sleep(0);
    await b.dispatch('c2', 'v + 5');
    await sleep(20);
    await stop();
    expect(events.some((e) => e.type === 'output' && String(e.data).includes('15'))).toBe(true);

    await a.stop();
    await b.stop();
  });

  it("tags each command's output with its own commandId under same-channel overlap", async () => {
    const transport = new RemoteReplInMemoryTransport();
    const engine = await makeEngine('A', transport, {}, () => ({
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    }));

    const events: RemoteReplEvent[] = [];
    const stop = collect(engine.events('c4', null), events);
    await sleep(0);

    const { commandId: id1 } = await engine.dispatch('c4', "await sleep(80); console.log('one')");
    await sleep(10);
    const { commandId: id2 } = await engine.dispatch('c4', "console.log('two')");
    await sleep(250);
    await stop();

    const outputs = events.filter((e) => e.type === 'output');
    expect(outputs.find((e) => String(e.data).includes('one'))?.commandId).toBe(id1);
    expect(outputs.find((e) => String(e.data).includes('two'))?.commandId).toBe(id2);
    await engine.stop();
  });

  it('keeps the channel alive after a command whose execution throws', async () => {
    const transport = new RemoteReplInMemoryTransport();
    let calls = 0;
    const factory = () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return { marker: () => 'ok' };
    };
    const engine = await makeEngine('A', transport, {}, factory);

    const events: RemoteReplEvent[] = [];
    const stop = collect(engine.events('c5', null), events);
    await sleep(0);

    const { commandId: id1 } = await engine.dispatch('c5', '1 + 1');
    await sleep(20);
    const { commandId: id2 } = await engine.dispatch('c5', '3 + 4');
    await sleep(50);
    await stop();

    const errorEvent = events.find(
      (e) => e.type === 'system' && e.commandId === id1 && typeof (e.data as { error?: unknown })?.error === 'string',
    );
    expect(errorEvent).toBeDefined();
    const outputEvent = events.find((e) => e.type === 'output' && e.commandId === id2);
    expect(String(outputEvent?.data)).toContain('7');
    await engine.stop();
  });

  describe('channel GC (eviction)', () => {
    it('evicts a subscriber-less, session-less, empty-buffer channel synchronously when its last subscriber closes', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = engine as any;

      const sub = engine.openStream('ghost-chan', null, { next: () => {}, complete: () => {} });
      expect(internals.channels.has('ghost-chan')).toBe(true);
      sub.close();
      expect(internals.channels.has('ghost-chan')).toBe(false);
      await engine.stop();
    });

    it('releases the subscription when the async iterator is returned early', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = engine as any;

      const stop = collect(engine.events('iter-chan', null), []);
      await sleep(0);
      expect(internals.channels.has('iter-chan')).toBe(true);
      await stop();
      expect(internals.channels.has('iter-chan')).toBe(false);
      await engine.stop();
    });

    it('does not evict a channel that still has buffered replay history', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = engine as any;

      await engine.dispatch('busy-chan', '1 + 1');
      await sleep(20);
      engine.openStream('busy-chan', null, { next: () => {}, complete: () => {} }).close();
      expect(internals.channels.has('busy-chan')).toBe(true);
      await engine.stop();
    });

    it('keeps an in-flight command session-consistent even if the last subscriber closes mid-dispatch', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = engine as any;

      const channel = 'race-chan';
      const sub = engine.openStream(channel, null, { next: () => {}, complete: () => {} });
      const stateBefore = internals.channels.get(channel);

      // onCmd increments `pending` synchronously before its first await;
      // closing right after lands in the exact vulnerable window.
      const onCmdDone: Promise<void> = internals.onCmd({
        channel,
        commandId: 'race-cmd-1',
        command: '1 + 1',
        originInstanceId: 'A',
      });
      expect(stateBefore.pending).toBeGreaterThan(0);
      sub.close();
      expect(internals.channels.get(channel)).toBe(stateBefore);

      await onCmdDone;
      await sleep(30);
      expect(internals.channels.get(channel)).toBe(stateBefore);
      expect(stateBefore.session).toBeDefined();
      const output = (stateBefore.buffer.since(null) as RemoteReplEvent[]).find((e) => e.type === 'output');
      expect(output?.commandId).toBe('race-cmd-1');
      expect(String(output?.data)).toContain('2');
      await engine.stop();
    });
  });

  describe('owner-liveness (lease-based ownership)', () => {
    const opts = { ownerHeartbeatInterval: 60_000, ownerLeaseTtl: 150_000 };

    it('takes over a channel after its owner goes stale', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const clock = makeSharedClock();
      const a = await makeEngine('A', transport, opts, defaultContext, clock.now);
      const b = await makeEngine('B', transport, opts, defaultContext, clock.now);

      await a.dispatch('lease-c1', 'const oldVar = 1');
      await sleep(20);
      // A "dies": never heartbeats again.
      clock.advance(150_001);

      const events: RemoteReplEvent[] = [];
      const stop = collect(b.events('lease-c1', null), events);
      await sleep(0);
      const { commandId: takeoverId } = await b.dispatch('lease-c1', 'const w = 99; w');
      await sleep(20);
      const takeover = events.find((e) => e.type === 'output' && e.commandId === takeoverId);
      expect(String(takeover?.data)).toContain('99');

      const { commandId: followupId } = await b.dispatch('lease-c1', 'w + 1');
      await sleep(20);
      await stop();
      const followup = events.find((e) => e.type === 'output' && e.commandId === followupId);
      expect(String(followup?.data)).toContain('100');
      await a.stop();
      await b.stop();
    });

    it('does not preempt a live owner within the lease window', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const clock = makeSharedClock();
      const a = await makeEngine('A', transport, opts, defaultContext, clock.now);
      const b = await makeEngine('B', transport, opts, defaultContext, clock.now);

      await a.dispatch('lease-c2', 'const v = 10');
      await sleep(20);
      clock.advance(50_000);

      const events: RemoteReplEvent[] = [];
      const stop = collect(b.events('lease-c2', null), events);
      await sleep(0);
      const { commandId } = await b.dispatch('lease-c2', 'v + 5');
      await sleep(20);
      await stop();
      const output = events.find((e) => e.type === 'output' && e.commandId === commandId);
      // `v` only resolves if A (with `v` in scope) executed it.
      expect(String(output?.data)).toContain('15');
      await a.stop();
      await b.stop();
    });

    it('a real owner heartbeat tick refreshes the lease, preventing a later takeover', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const clock = makeSharedClock();
      // Short real heartbeat so the engine's own setInterval fires during the test.
      const tight = { ownerHeartbeatInterval: 20, ownerLeaseTtl: 150_000 };
      const a = await makeEngine('A', transport, tight, defaultContext, clock.now);
      const b = await makeEngine('B', transport, tight, defaultContext, clock.now);

      await a.dispatch('lease-c3', 'const v = 1');
      await sleep(20);
      clock.advance(90_000);
      await sleep(60); // let A's heartbeat tick land a claim on B
      // 180_000 since the original claim (> lease), but only 90_000 since
      // the heartbeat refreshed B's ownerSeenAt.
      clock.advance(90_000);

      const events: RemoteReplEvent[] = [];
      const stop = collect(b.events('lease-c3', null), events);
      await sleep(0);
      const { commandId } = await b.dispatch('lease-c3', 'v + 1');
      await sleep(20);
      await stop();
      const output = events.find((e) => e.type === 'output' && e.commandId === commandId);
      expect(String(output?.data)).toContain('2');
      await a.stop();
      await b.stop();
    });

    it('clamps a requested ownerLeaseTtl below the 2x margin instead of throwing, and warns', () => {
      const warnings: string[] = [];
      const engine = new RemoteReplEngine(
        { enabled: true, instanceId: 'A', ownerHeartbeatInterval: 10_000, ownerLeaseTtl: 10_001 },
        new RemoteReplInMemoryTransport(),
        () => ({}),
        () => 0,
        { warn: (m) => warnings.push(m), error: () => {} },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((engine as any).ownerLeaseTtl).toBe(20_000);
      expect(warnings).toHaveLength(1);
    });
  });

  describe('enabled', () => {
    it('exposes the configured `enabled` flag read-only, so adapters derive it from the engine', async () => {
      const on = await makeEngine('ON', new RemoteReplInMemoryTransport());
      expect(on.enabled).toBe(true);
      await on.stop();
      const off = new RemoteReplEngine(
        { enabled: false, instanceId: 'OFF' },
        new RemoteReplInMemoryTransport(),
        defaultContext,
        undefined,
        silentLogger,
      );
      expect(off.enabled).toBe(false);
      // A getter only: nothing can flip the safety rail after construction.
      expect(() => {
        (off as { enabled: boolean }).enabled = true;
      }).toThrow(TypeError);
      expect(off.enabled).toBe(false);
    });
  });

  describe('when disabled at runtime', () => {
    const disabled = (transport: RemoteReplInMemoryTransport) =>
      new RemoteReplEngine({ enabled: false, instanceId: 'D' }, transport, defaultContext, undefined, silentLogger);

    it('subscribes to nothing and starts no timers on start()', async () => {
      vi.useFakeTimers();
      try {
        const transport = new RemoteReplInMemoryTransport();
        const subscribeSpy = vi.spyOn(transport, 'subscribe');
        const engine = disabled(transport);
        await engine.start();
        expect(subscribeSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        await engine.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('dispatch() rejects with RemoteReplDisabledError and never publishes', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const publishSpy = vi.spyOn(transport, 'publish');
      const engine = disabled(transport);
      await engine.start();
      await expect(engine.dispatch('d', '1 + 1')).rejects.toThrow(RemoteReplDisabledError);
      expect(publishSpy).not.toHaveBeenCalled();
      await engine.stop();
    });

    it('events() and openStream() throw RemoteReplDisabledError synchronously', async () => {
      const engine = disabled(new RemoteReplInMemoryTransport());
      await engine.start();
      expect(() => engine.events('d', null)).toThrow(RemoteReplDisabledError);
      expect(() => engine.openStream('d', null, { next: () => {}, complete: () => {} })).toThrow(
        RemoteReplDisabledError,
      );
      await engine.stop();
    });
  });

  describe('events() iterator contract', () => {
    it('subscribes eagerly: an event published before the first next() is delivered', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      const iter = engine.events('eager', null);
      const { commandId } = await engine.dispatch('eager', '1 + 1');
      await sleep(20);
      const { value } = await iter.next();
      expect(value).toMatchObject({ type: 'command', commandId });
      await iter.return?.(undefined);
      await engine.stop();
    });

    it('return() while a next() is pending settles that next() with done and releases the channel', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const engine = await makeEngine('A', transport);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = engine as any;
      const iter = engine.events('pending', null);
      const pending = iter.next();
      await iter.return?.(undefined);
      expect(await pending).toEqual({ value: undefined, done: true });
      expect(internals.channels.has('pending')).toBe(false);
      await engine.stop();
    });
  });

  describe('stop()', () => {
    it('completes open iterators and tears down the transport', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const destroySpy = vi.spyOn(transport, 'close');
      const engine = await makeEngine('A', transport);

      const iter = engine.events('s1', null);
      const first = iter.next();
      await sleep(0);
      await engine.stop();

      expect(await first).toEqual({ value: undefined, done: true });
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('transport (ticket #36)', () => {
    it('defaults to an in-memory transport when none is given, so one instance needs no wiring', async () => {
      const engine = new RemoteReplEngine({ enabled: true, instanceId: 'solo' }, undefined, defaultContext, undefined, silentLogger);
      await engine.start();
      const iter = engine.events('ch', null);
      await engine.dispatch('ch', 'marker()');
      const events = await takeN(iter, 2);
      expect(events[1].data).toContain('ctx-ok');
      await engine.stop();
    });

    it('stop() calls close() on the transport', async () => {
      const calls: string[] = [];
      const transport = {
        publish: async () => {},
        subscribe: async () => {},
        close: () => void calls.push('close'),
      };
      const engine = new RemoteReplEngine({ enabled: true }, transport, defaultContext, undefined, silentLogger);
      await engine.start();
      await engine.stop();
      expect(calls).toEqual(['close']);
    });

    it('stop() falls back to onModuleDestroy() for a legacy transport without close()', async () => {
      const calls: string[] = [];
      const legacy = {
        publish: async () => {},
        subscribe: async () => {},
        onModuleDestroy: () => void calls.push('onModuleDestroy'),
      };
      const engine = new RemoteReplEngine({ enabled: true }, legacy, defaultContext, undefined, silentLogger);
      await engine.start();
      await engine.stop();
      expect(calls).toEqual(['onModuleDestroy']);
    });
  });
});
