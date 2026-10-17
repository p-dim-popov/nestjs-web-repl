// Cross-framework contract: one NestJS instance and one Express instance
// sharing a REAL Redis (REDIS_URL). Proves the protocol is framework-agnostic
// at the HTTP + SSE seam: whichever framework owns a channel, the other
// relays to it, sees its output, honours its lease and shares its replay
// buffer. Each scenario runs once per shipped Redis transport and once per
// owner framework (NestJS owning / Express owning). Only external behavior is
// asserted: HTTP status codes, SSE frames, and raw Redis traffic.
import {
  frameworks,
  isDoneFor,
  isOutputContaining,
  type Framework,
  type Instance,
  openSse,
  uniqueChannel,
} from './harness';
import { transports, type Transport } from './transports';
import type { WebReplOptions } from '@remote-repl/core';

interface Pair {
  /** Receives the first command, so it claims the channel. */
  owner: Instance;
  /** The other framework; it only relays. */
  peer: Instance;
  closeAll(): Promise<void>;
}

const byName = (name: Framework['name']) => frameworks.find((f) => f.name === name)!;
const orderings = [
  { label: 'NestJS owns, Express relays', owner: byName('nestjs'), peer: byName('express') },
  { label: 'Express owns, NestJS relays', owner: byName('express'), peer: byName('nestjs') },
];

const bootPair = async (
  transport: Transport,
  ordering: (typeof orderings)[number],
  options: Partial<WebReplOptions> = {},
): Promise<Pair> => {
  const to = await transport.make();
  const tp = await transport.make();
  const owner = await ordering.owner.boot(to.adapter, { instanceId: 'OWNER', ...options });
  const peer = await ordering.peer.boot(tp.adapter, { instanceId: 'PEER', ...options });
  return {
    owner,
    peer,
    closeAll: async () => {
      await Promise.allSettled([owner.close(), peer.close()]);
      await Promise.all([to.close(), tp.close()]);
    },
  };
};

const executorOf = (f: { event: { data: unknown } }) =>
  (f.event.data as { instanceId: string }).instanceId;

describe.each(transports)('NestJS <-> Express over $name', (transport: Transport) => {
  describe.each(orderings)('$label', (ordering) => {
    describe('single execution & cross-framework relay', () => {
      let pair: Pair;
      beforeAll(async () => {
        pair = await bootPair(transport, ordering);
      });
      afterAll(() => pair.closeAll());

      it('a command posted to the other framework runs once on the owner and streams to both', async () => {
        const { owner, peer } = pair;
        const channel = uniqueChannel('xfw');
        const sseOwner = await openSse(owner.port, channel);
        const ssePeer = await openSse(peer.port, channel);

        const first = await owner.post(channel, 'const total = 100');
        expect(first.status).toBe(202);
        await ssePeer.waitFor(isDoneFor(first.commandId));

        const second = await peer.post(channel, 'total + 1');
        expect(second.status).toBe(202);
        const outOwner = await sseOwner.waitFor(isOutputContaining('101'));
        const outPeer = await ssePeer.waitFor(isOutputContaining('101'));
        expect(outOwner.event.commandId).toBe(second.commandId);
        expect(outPeer.event).toEqual(outOwner.event);

        for (const sse of [sseOwner, ssePeer]) {
          for (const cmd of [first, second]) {
            const starts = sse.frames.filter(
              (f) => f.event.type === 'command' && f.event.commandId === cmd.commandId,
            );
            expect(starts).toHaveLength(1);
            expect(executorOf(starts[0])).toBe('OWNER');
          }
          expect(sse.frames.some((f) => String(f.event.data).includes('ReferenceError'))).toBe(false);
        }
        sseOwner.close();
        ssePeer.close();
      }, 20_000);
    });
  });
});
