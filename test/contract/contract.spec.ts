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
  uniqueChannel,
  type Instance,
} from './harness';
import { transports, type Transport } from './transports';

describe.each(transports)('contract over $name', (transport: Transport) => {
  describe('ownership & single execution', () => {
    let a: Instance;
    let b: Instance;
    const closers: Array<() => Promise<void>> = [];

    beforeAll(async () => {
      const ta = await transport.make();
      const tb = await transport.make();
      closers.push(ta.close, tb.close);
      a = await bootInstance(ta.adapter, { instanceId: 'A' });
      b = await bootInstance(tb.adapter, { instanceId: 'B' });
    });

    afterAll(async () => {
      await a.close();
      await b.close();
      await Promise.all(closers.map((c) => c()));
    });

    it('executes a command exactly once on the owner, relays from the other, fans output to both streams', async () => {
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
          expect((starts[0].event.data as { instanceId: string }).instanceId).toBe('A');
        }
        expect(sse.frames.some((f) => String(f.event.data).includes('ReferenceError'))).toBe(false);
      }
      sseA.close();
      sseB.close();
    }, 20_000);
  });
});
