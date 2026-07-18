import RedisMock from 'ioredis-mock';
import { IoRedisWebReplAdapter, IoRedisLike } from './ioredis-web-repl.adapter';

// ioredis-mock instances share one in-memory pub/sub bus by default, so two
// separate clients model two app replicas talking through the same Redis.
const client = (): IoRedisLike => new RedisMock() as unknown as IoRedisLike;

describe('IoRedisWebReplAdapter', () => {
  it('delivers a message published on one instance to a subscriber on another', async () => {
    const a = new IoRedisWebReplAdapter(client());
    const b = new IoRedisWebReplAdapter(client());
    const received: string[] = [];
    await b.subscribe('webrepl:cmd', (m) => received.push(m));
    await a.publish('webrepl:cmd', 'hello');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(['hello']);
  });

  it('does not cross topics', async () => {
    const a = new IoRedisWebReplAdapter(client());
    const b = new IoRedisWebReplAdapter(client());
    const received: string[] = [];
    await b.subscribe('webrepl:out', (m) => received.push(m));
    await a.publish('webrepl:cmd', 'x');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
  });

  it('stops delivering after onModuleDestroy and leaves the publisher usable', async () => {
    const pubB = client();
    const a = new IoRedisWebReplAdapter(client());
    const b = new IoRedisWebReplAdapter(pubB);
    const received: string[] = [];
    await b.subscribe('webrepl:out', (m) => received.push(m));
    await b.onModuleDestroy();
    await a.publish('webrepl:out', 'after');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
    await expect(pubB.publish('webrepl:out', 'again')).resolves.toBeTypeOf('number');
  });
});
