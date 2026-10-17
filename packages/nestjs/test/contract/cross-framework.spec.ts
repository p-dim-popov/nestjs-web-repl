// Cross-framework contract: one NestJS instance and one Express instance
// sharing a REAL Redis (REDIS_URL). Proves the protocol is framework-agnostic
// at the HTTP + SSE seam: whichever framework owns a channel, the other
// relays to it, sees its output, honours its lease and shares its replay
// buffer. Each scenario runs once per shipped Redis transport and once per
// owner framework (NestJS owning / Express owning). Only external behavior is
// asserted: HTTP status codes, SSE frames, and raw Redis traffic. Each pair
// gets its own topic prefix, so this file runs alongside contract.spec.ts (and
// any other process on the same Redis) without hearing it.
import {
  bootPair,
  executorOf,
  frameworkNamed,
  isDoneFor,
  isOutputContaining,
  isPing,
  observeRedis,
  openSse,
  sleep,
  uniqueChannel,
  type Framework,
  type Instance,
} from './harness';
import { transports, type Transport } from './transports';
import { REMOTE_REPL_TOPICS, type RemoteReplSysMessage, type RemoteReplOptions } from '@remote-repl/core';

interface Pair {
  /** Receives the first command, so it claims the channel. */
  owner: Instance;
  /** The other framework; it only relays. */
  peer: Instance;
  /** The pair's own topic prefix (raw-Redis observers watch `prefix + REMOTE_REPL_TOPICS.x`). */
  prefix: string;
  closeAll(): Promise<void>;
}

interface Ordering {
  label: string;
  owner: Framework;
  peer: Framework;
}

const orderings: Ordering[] = [
  { label: 'NestJS owns, Express relays', owner: frameworkNamed('nestjs'), peer: frameworkNamed('express') },
  { label: 'Express owns, NestJS relays', owner: frameworkNamed('express'), peer: frameworkNamed('nestjs') },
];

/** `bootPair` with the owner as A and the peer as B, under a fresh topic prefix. */
const bootOrderedPair = async (
  transport: Transport,
  ordering: Ordering,
  options: Partial<RemoteReplOptions> = {},
): Promise<Pair> => {
  const pair = await bootPair(transport, {
    options,
    hosts: [ordering.owner, ordering.peer],
    instanceIds: ['OWNER', 'PEER'],
  });
  return { owner: pair.a, peer: pair.b, prefix: pair.prefix, closeAll: pair.closeAll };
};

describe.each(transports)('NestJS <-> Express over $name', (transport: Transport) => {
  describe.each(orderings)('$label', (ordering) => {
    describe('single execution & cross-framework relay', () => {
      let pair: Pair;
      beforeAll(async () => {
        pair = await bootOrderedPair(transport, ordering);
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

    describe('ownership on the wire', () => {
      // Fast owner heartbeat so a renewal is observable within the test.
      const lease = { ownerHeartbeatInterval: 200, ownerLeaseTtl: 400 };

      it('the owner claims the channel and keeps heartbeating it on the sys topic; the relaying framework never claims', async () => {
        const observer = await observeRedis();
        const pair = await bootOrderedPair(transport, ordering, lease);
        const sysTopic = pair.prefix + REMOTE_REPL_TOPICS.sys;
        const wire = await observer.watch([sysTopic]);
        try {
          const { owner, peer } = pair;
          const channel = uniqueChannel('sys');
          const ssePeer = await openSse(peer.port, channel);
          const first = await owner.post(channel, "'claimed'");
          await ssePeer.waitFor(isDoneFor(first.commandId));
          const second = await peer.post(channel, "'relayed'");
          await ssePeer.waitFor(isDoneFor(second.commandId));
          // Long enough for at least one lease renewal from the owner.
          await sleep(lease.ownerHeartbeatInterval * 3);
          ssePeer.close();

          const sys = wire
            .filter((m) => m.startsWith(`${sysTopic} `))
            .map((m) => JSON.parse(m.slice(sysTopic.length + 1)) as RemoteReplSysMessage)
            .filter((m) => m.channel === channel);
          const claims = sys.filter((m) => m.kind === 'claim');
          expect(claims.length).toBeGreaterThanOrEqual(2); // initial claim + >= 1 heartbeat
          expect(claims.every((m) => m.instanceId === 'OWNER')).toBe(true);
          expect(sys.some((m) => m.instanceId === 'PEER')).toBe(false);
          expect(sys.some((m) => m.kind === 'release')).toBe(false);
        } finally {
          await pair.closeAll();
          await observer.close();
        }
      }, 20_000);
    });

    describe('lease takeover across frameworks', () => {
      const lease = { ownerHeartbeatInterval: 200, ownerLeaseTtl: 400 };

      it('after the owning framework dies and its lease expires, the other framework takes over with a fresh session', async () => {
        const pair = await bootOrderedPair(transport, ordering, lease);
        try {
          const { owner, peer } = pair;
          const channel = uniqueChannel('xdead');
          const ssePeer = await openSse(peer.port, channel);
          const first = await owner.post(channel, 'const gone = 1');
          await ssePeer.waitFor(isDoneFor(first.commandId));

          // A crash as far as the peer can tell: no release is published.
          await owner.close();
          await sleep(lease.ownerLeaseTtl + 200);

          const second = await peer.post(channel, 'typeof gone');
          expect(second.status).toBe(202);
          const out = await ssePeer.waitFor(isOutputContaining('undefined'));
          expect(out.event.commandId).toBe(second.commandId);
          const start = ssePeer.frames.find(
            (f) => f.event.type === 'command' && f.event.commandId === second.commandId,
          )!;
          expect(executorOf(start)).toBe('PEER');
          await ssePeer.waitFor(isDoneFor(second.commandId));
          ssePeer.close();
        } finally {
          await pair.closeAll();
        }
      }, 20_000);
    });

    describe('SSE replay across frameworks', () => {
      let pair: Pair;
      beforeAll(async () => {
        pair = await bootOrderedPair(transport, ordering, { heartbeatInterval: 150 });
      });
      afterAll(() => pair.closeAll());

      it('a client that watched the owner can reconnect to the other framework with Last-Event-ID and get only what it missed', async () => {
        const { owner, peer } = pair;
        const channel = uniqueChannel('xreplay');
        const live = await openSse(owner.port, channel);
        const c1 = await owner.post(channel, "'one'");
        await live.waitFor(isDoneFor(c1.commandId));
        const c2 = await peer.post(channel, "'two'");
        await live.waitFor(isDoneFor(c2.commandId));
        const all = live.frames.filter((f) => !isPing(f));
        live.close();
        expect(all.map((f) => f.event.type)).toEqual([
          'command', 'output', 'system', 'command', 'output', 'system',
        ]);
        expect(all.map((f) => Number(f.wireId))).toEqual(all.map((f) => f.event.id));

        // Reconnect on the OTHER framework from the cursor of the first command's `done`.
        const cursor = all[2].event.id;
        const resumed = await openSse(peer.port, channel, cursor);
        const got = await resumed.settle(300);
        resumed.close();
        expect(got.filter((f) => !isPing(f)).map((f) => f.event)).toEqual(
          all.slice(3).map((f) => f.event),
        );
      }, 20_000);

      it('a client that watched the relaying framework can reconnect to the owner and get only what it missed', async () => {
        const { owner, peer } = pair;
        const channel = uniqueChannel('xreplay-rev');
        const live = await openSse(peer.port, channel);
        const c1 = await owner.post(channel, "'one'");
        await live.waitFor(isDoneFor(c1.commandId));
        const c2 = await owner.post(channel, "'two'");
        await live.waitFor(isDoneFor(c2.commandId));
        const all = live.frames.filter((f) => !isPing(f));
        live.close();
        expect(all).toHaveLength(6);

        const cursor = all[2].event.id;
        const resumed = await openSse(owner.port, channel, cursor);
        const got = await resumed.settle(300);
        resumed.close();
        expect(got.filter((f) => !isPing(f)).map((f) => f.event)).toEqual(
          all.slice(3).map((f) => f.event),
        );
      }, 20_000);
    });
  });
});
