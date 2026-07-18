import { FakeNodeRedis, FakeRedisBus } from '../../../test/fakes/fake-node-redis';
import { NodeRedisWebReplAdapter } from './node-redis-web-repl.adapter';

describe('NodeRedisWebReplAdapter', () => {
  it('delivers a message published on one instance to a subscriber on another', async () => {
    const bus = new FakeRedisBus();
    const a = new NodeRedisWebReplAdapter(new FakeNodeRedis(bus));
    const b = new NodeRedisWebReplAdapter(new FakeNodeRedis(bus));
    const received: string[] = [];
    await b.subscribe('webrepl:cmd', (m) => received.push(m));
    await a.publish('webrepl:cmd', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('connects the subscriber before subscribing', async () => {
    const bus = new FakeRedisBus();
    const b = new NodeRedisWebReplAdapter(new FakeNodeRedis(bus));
    // The fake throws if subscribe runs before connect; resolving proves order.
    await expect(b.subscribe('webrepl:sys', () => {})).resolves.toBeUndefined();
  });

  it('quits only the duplicated subscriber on destroy, leaving the publisher usable', async () => {
    const bus = new FakeRedisBus();
    const pubB = new FakeNodeRedis(bus);
    const a = new NodeRedisWebReplAdapter(new FakeNodeRedis(bus));
    const b = new NodeRedisWebReplAdapter(pubB);
    const received: string[] = [];
    await b.subscribe('webrepl:out', (m) => received.push(m));
    await b.onModuleDestroy();
    expect(pubB.quitCalled).toBe(false);
    await a.publish('webrepl:out', 'after');
    expect(received).toEqual([]);
    await expect(pubB.publish('webrepl:out', 'x')).resolves.toBe(0);
  });

  it('creates and connects the subscriber exactly once across multiple topic subscriptions', async () => {
    const bus = new FakeRedisBus();
    const pub = new FakeNodeRedis(bus);
    const b = new NodeRedisWebReplAdapter(pub);
    await Promise.all([
      b.subscribe('webrepl:cmd', () => {}),
      b.subscribe('webrepl:out', () => {}),
      b.subscribe('webrepl:sys', () => {}),
    ]);
    // One duplicated subscriber connection, connected exactly once — the
    // memoized `connecting` promise must dedupe concurrent subscribes.
    expect(pub.duplicates).toHaveLength(1);
    expect(pub.duplicates[0].connectCount).toBe(1);
  });
});
