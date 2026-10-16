// Contract suite: pins the observable multi-instance behavior of the product
// at the HTTP + SSE seam, with two real Nest apps sharing one REAL Redis
// (REDIS_URL, default redis://127.0.0.1:6379). Every scenario runs once per
// shipped Redis transport, proving the transport is an interchangeable detail.
// Tests assert only external behavior: HTTP status codes, SSE frames on the
// wire, and traffic observed by an independent raw Redis client.
import {
  bootInstance,
  isDoneFor,
  isOutputContaining,
  isPing,
  observeRedis,
  openSse,
  sleep,
  uniqueChannel,
  type Instance,
} from './harness';
import type { WebReplModuleOptions } from '../../src/interfaces/web-repl-options.interface';
import { TOPICS } from '../../src/constants';
import { transports, type Transport } from './transports';

interface Pair {
  a: Instance;
  b: Instance;
  closeAll(): Promise<void>;
}

/** Two instances ('A' and 'B') on fresh adapters of the given transport, sharing the real Redis. */
const bootPair = async (
  transport: Transport,
  options: Partial<WebReplModuleOptions> = {},
): Promise<Pair> => {
  const ta = await transport.make();
  const tb = await transport.make();
  const a = await bootInstance(ta.adapter, { instanceId: 'A', ...options });
  const b = await bootInstance(tb.adapter, { instanceId: 'B', ...options });
  return {
    a,
    b,
    closeAll: async () => {
      await Promise.allSettled([a.close(), b.close()]);
      await Promise.all([ta.close(), tb.close()]);
    },
  };
};

const executorOf = (f: { event: { data: unknown } }) =>
  (f.event.data as { instanceId: string }).instanceId;

describe.each(transports)('contract over $name', (transport: Transport) => {
  describe('ownership & single execution', () => {
    let pair: Pair;
    beforeAll(async () => {
      pair = await bootPair(transport);
    });
    afterAll(() => pair.closeAll());

    it('executes a command exactly once on the owner, relays from the other, fans output to both streams', async () => {
      const { a, b } = pair;
      const channel = uniqueChannel('own');
      const sseA = await openSse(a.port, channel);
      const sseB = await openSse(b.port, channel);

      const first = await a.post(channel, 'const total = 100');
      expect(first.status).toBe(202);
      await sseA.waitFor(isDoneFor(first.commandId));

      // Posted to B, but A owns the channel: A must execute it in the SAME
      // session (so `total` is still in scope) and the result must reach
      // both instances' SSE streams.
      const second = await b.post(channel, 'total + 1');
      expect(second.status).toBe(202);
      const outA = await sseA.waitFor(isOutputContaining('101'));
      const outB = await sseB.waitFor(isOutputContaining('101'));
      expect(outA.event.commandId).toBe(second.commandId);
      expect(outB.event).toEqual(outA.event);

      // Exactly one `command` (execution-start) event per command, both
      // announced by A -- B never executed anything.
      for (const sse of [sseA, sseB]) {
        for (const cmd of [first, second]) {
          const starts = sse.frames.filter(
            (f) => f.event.type === 'command' && f.event.commandId === cmd.commandId,
          );
          expect(starts).toHaveLength(1);
          expect(executorOf(starts[0])).toBe('A');
        }
        expect(sse.frames.some((f) => String(f.event.data).includes('ReferenceError'))).toBe(false);
      }
      sseA.close();
      sseB.close();
    }, 20_000);
  });

  describe('lease takeover', () => {
    // Short lease so the scenario runs in real time: heartbeat 200ms, lease
    // 400ms (the enforced minimum of 2x heartbeat).
    const lease = { ownerHeartbeatInterval: 200, ownerLeaseTtl: 400 };

    it('a live, heartbeating owner is never preempted, even long after the lease TTL', async () => {
      const pair = await bootPair(transport, lease);
      try {
        const { a, b } = pair;
        const channel = uniqueChannel('live');
        const sseB = await openSse(b.port, channel);
        const first = await a.post(channel, 'const kept = 7');
        await sseB.waitFor(isDoneFor(first.commandId));

        // Well past ownerLeaseTtl -- A's heartbeats must have kept the lease fresh on B.
        await sleep(lease.ownerLeaseTtl * 3);

        const second = await b.post(channel, 'kept * 6');
        const out = await sseB.waitFor(isOutputContaining('42'));
        expect(out.event.commandId).toBe(second.commandId);
        const start = sseB.frames.find(
          (f) => f.event.type === 'command' && f.event.commandId === second.commandId,
        )!;
        expect(executorOf(start)).toBe('A');
        sseB.close();
      } finally {
        await pair.closeAll();
      }
    }, 20_000);

    it('after the owner dies and the lease expires, the next command’s origin takes over with a fresh session', async () => {
      const pair = await bootPair(transport, lease);
      try {
        const { a, b } = pair;
        const channel = uniqueChannel('dead');
        const sseB = await openSse(b.port, channel);
        const first = await a.post(channel, 'const gone = 1');
        await sseB.waitFor(isDoneFor(first.commandId));

        // Kill the owner without a release (a crash, as far as B can tell).
        await a.close();
        await sleep(lease.ownerLeaseTtl + 200);

        const second = await b.post(channel, 'typeof gone');
        expect(second.status).toBe(202);
        const out = await sseB.waitFor(isOutputContaining('undefined'));
        expect(out.event.commandId).toBe(second.commandId);
        const start = sseB.frames.find(
          (f) => f.event.type === 'command' && f.event.commandId === second.commandId,
        )!;
        expect(executorOf(start)).toBe('B');
        await sseB.waitFor(isDoneFor(second.commandId));
        sseB.close();
      } finally {
        await pair.closeAll();
      }
    }, 20_000);
  });

  describe('SSE replay', () => {
    let pair: Pair;
    beforeAll(async () => {
      pair = await bootPair(transport, { heartbeatInterval: 150 });
    });
    afterAll(() => pair.closeAll());

    it('a client reconnecting with Last-Event-ID receives only the events it missed', async () => {
      const { a, b } = pair;
      const channel = uniqueChannel('replay');
      const live = await openSse(a.port, channel);
      const c1 = await a.post(channel, "'one'");
      await live.waitFor(isDoneFor(c1.commandId));
      const c2 = await a.post(channel, "'two'");
      await live.waitFor(isDoneFor(c2.commandId));
      const all = live.frames.filter((f) => !isPing(f));
      live.close();
      // Six real events: command/output/done for each of the two commands.
      expect(all.map((f) => f.event.type)).toEqual([
        'command', 'output', 'system', 'command', 'output', 'system',
      ]);
      // Wire ids are the event ids, strictly increasing.
      expect(all.map((f) => Number(f.wireId))).toEqual(all.map((f) => f.event.id));

      // Reconnect (on the OTHER instance, which only relayed) from the
      // cursor of the last event of the first command.
      const cursor = all[2].event.id;
      const resumed = await openSse(b.port, channel, cursor);
      const got = await resumed.settle(300);
      resumed.close();
      expect(got.filter((f) => !isPing(f)).map((f) => f.event)).toEqual(
        all.slice(3).map((f) => f.event),
      );
    }, 20_000);

    it('heartbeats carry the last real event id, so an idle reconnect replays nothing', async () => {
      const { a } = pair;
      const channel = uniqueChannel('idle');
      const live = await openSse(a.port, channel);
      const c1 = await a.post(channel, "'hello'");
      const done = await live.waitFor(isDoneFor(c1.commandId));

      // Idle: wait for a heartbeat that arrives AFTER the last real event.
      const ping = await live.waitFor((f) => isPing(f) && live.frames.indexOf(f) > live.frames.indexOf(done));
      live.close();
      expect(ping.wireId).toBe(String(done.event.id));

      // A browser EventSource would reconnect with that id; nothing is replayed.
      const resumed = await openSse(a.port, channel, ping.wireId!);
      const got = await resumed.settle(300);
      resumed.close();
      expect(got.filter((f) => !isPing(f))).toEqual([]);
      // Even before any real event, a heartbeat echoes the client's own cursor.
      expect(got.filter(isPing).every((f) => f.wireId === ping.wireId)).toBe(true);
    }, 20_000);
  });

  describe('per-channel serialization', () => {
    let pair: Pair;
    beforeAll(async () => {
      pair = await bootPair(transport);
    });
    afterAll(() => pair.closeAll());

    it('runs two commands on one channel serially and tags every output with the executing command', async () => {
      const { a, b } = pair;
      const channel = uniqueChannel('serial');
      const sse = await openSse(b.port, channel);
      // The first command sleeps before producing output; the second (posted
      // via the other instance) must still wait for it to finish.
      const slow = await a.post(channel, "await new Promise(r => setTimeout(r, 400)); 'slow-done'");
      const fast = await b.post(channel, "'fast-done'");
      await sse.waitFor(isDoneFor(fast.commandId));
      sse.close();

      const real = sse.frames.filter((f) => !isPing(f)).map((f) => f.event);
      expect(real.map((e) => [e.type, e.commandId])).toEqual([
        ['command', slow.commandId],
        ['output', slow.commandId],
        ['system', slow.commandId],
        ['command', fast.commandId],
        ['output', fast.commandId],
        ['system', fast.commandId],
      ]);
      expect(String(real[1].data)).toContain('slow-done');
      expect(String(real[4].data)).toContain('fast-done');
    }, 20_000);
  });

  describe('`enabled` enforcement', () => {
    it('a disabled instance 404s on every route and puts no traffic on Redis', async () => {
      const observer = await observeRedis();
      const topics = Object.values(TOPICS);
      const log = await observer.watch(topics);
      const before = await observer.numsub(topics); // includes the observer itself

      const t = await transport.make();
      const disabled = await bootInstance(t.adapter, { instanceId: 'OFF', enabled: false });
      try {
        const channel = uniqueChannel('off');
        expect((await disabled.get('/repl')).status).toBe(404);
        expect((await disabled.post(channel, '1 + 1')).status).toBe(404);
        expect((await disabled.get(`/repl/${channel}/ui`)).status).toBe(404);
        expect((await disabled.get(`/repl/${channel}/vs/loader.js`)).status).toBe(404);
        await expect(openSse(disabled.port, channel)).rejects.toThrow(/404/);

        // No subscription was added and nothing was published by it.
        await sleep(200);
        expect(await observer.numsub(topics)).toEqual(before);
        expect(log).toEqual([]);
      } finally {
        await disabled.close();
        await t.close();
        await observer.close();
      }
    }, 20_000);
  });
});
