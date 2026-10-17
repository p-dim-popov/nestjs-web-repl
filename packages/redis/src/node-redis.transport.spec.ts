import { FakeNodeRedis, FakeRedisBus } from '../test/fakes/fake-node-redis';
import { RemoteReplNodeRedisTransport } from './node-redis.transport';

describe('RemoteReplNodeRedisTransport', () => {
  it('delivers a message published on one instance to a subscriber on another', async () => {
    const bus = new FakeRedisBus();
    const a = new RemoteReplNodeRedisTransport(new FakeNodeRedis(bus));
    const b = new RemoteReplNodeRedisTransport(new FakeNodeRedis(bus));
    const received: string[] = [];
    await b.subscribe('remote-repl:cmd', (m) => received.push(m));
    await a.publish('remote-repl:cmd', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('connects the subscriber before subscribing', async () => {
    const bus = new FakeRedisBus();
    const b = new RemoteReplNodeRedisTransport(new FakeNodeRedis(bus));
    // The fake throws if subscribe runs before connect; resolving proves order.
    await expect(b.subscribe('remote-repl:sys', () => {})).resolves.toBeUndefined();
  });

  it('quits only the duplicated subscriber on destroy, leaving the publisher usable', async () => {
    const bus = new FakeRedisBus();
    const pubB = new FakeNodeRedis(bus);
    const a = new RemoteReplNodeRedisTransport(new FakeNodeRedis(bus));
    const b = new RemoteReplNodeRedisTransport(pubB);
    const received: string[] = [];
    await b.subscribe('remote-repl:out', (m) => received.push(m));
    await b.close();
    expect(pubB.quitCalled).toBe(false);
    await a.publish('remote-repl:out', 'after');
    expect(received).toEqual([]);
    await expect(pubB.publish('remote-repl:out', 'x')).resolves.toBe(0);
  });

  it('creates and connects the subscriber exactly once across multiple topic subscriptions', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeNodeRedis(bus);
    const b = new RemoteReplNodeRedisTransport(pub);
    await Promise.all([
      b.subscribe('remote-repl:cmd', () => {}),
      b.subscribe('remote-repl:out', () => {}),
      b.subscribe('remote-repl:sys', () => {}),
    ]);
    // One duplicated subscriber connection, connected exactly once — the
    // memoized `connecting` promise must dedupe concurrent subscribes.
    expect(pub.duplicates).toHaveLength(1);
    expect(pub.duplicates[0].connectCount).toBe(1);
  });

  it('quits the subscriber exactly once when destroyed twice concurrently (Nest hook + service both call it)', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeNodeRedis(bus);
    const b = new RemoteReplNodeRedisTransport(pub);
    await b.subscribe('remote-repl:out', () => {});
    // A real client throws on a second quit(); both calls must settle cleanly.
    await expect(Promise.all([b.close(), b.close()])).resolves.toBeDefined();
    expect(pub.duplicates[0].quitCount).toBe(1);
  });
});
