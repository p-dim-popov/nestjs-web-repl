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
  openSse,
  sleep,
  uniqueChannel,
  type Instance,
} from './harness';
import type { WebReplModuleOptions } from '../../src/interfaces/web-repl-options.interface';
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
});
