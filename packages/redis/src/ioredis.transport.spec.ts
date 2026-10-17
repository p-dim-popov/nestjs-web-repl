import RedisMock from 'ioredis-mock';
import { RemoteReplIoRedisTransport, RemoteReplIoRedisLike } from './ioredis.transport';

// ioredis-mock instances share one in-memory pub/sub bus by default, so two
// separate clients model two app replicas talking through the same Redis.
const client = (): RemoteReplIoRedisLike => new RedisMock() as unknown as RemoteReplIoRedisLike;

describe('RemoteReplIoRedisTransport', () => {
  it('delivers a message published on one instance to a subscriber on another', async () => {
    const a = new RemoteReplIoRedisTransport(client());
    const b = new RemoteReplIoRedisTransport(client());
    const received: string[] = [];
    await b.subscribe('remote-repl:cmd', (m) => received.push(m));
    await a.publish('remote-repl:cmd', 'hello');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(['hello']);
  });

  it('does not cross topics', async () => {
    const a = new RemoteReplIoRedisTransport(client());
    const b = new RemoteReplIoRedisTransport(client());
    const received: string[] = [];
    await b.subscribe('remote-repl:out', (m) => received.push(m));
    await a.publish('remote-repl:cmd', 'x');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
  });

  it('stops delivering after close and leaves the publisher usable', async () => {
    const pubB = client();
    const a = new RemoteReplIoRedisTransport(client());
    const b = new RemoteReplIoRedisTransport(pubB);
    const received: string[] = [];
    await b.subscribe('remote-repl:out', (m) => received.push(m));
    await b.close();
    await a.publish('remote-repl:out', 'after');
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
    await expect(pubB.publish('remote-repl:out', 'again')).resolves.toBeTypeOf('number');
  });

  it('quits the subscriber exactly once when destroyed twice concurrently', async () => {
    const pub = client();
    let quits = 0;
    const duplicate = pub.duplicate.bind(pub);
    pub.duplicate = () => {
      const sub = duplicate();
      const quit = sub.quit.bind(sub);
      sub.quit = async () => {
        if (quits++ > 0) throw new Error('Connection is closed.');
        return quit();
      };
      return sub;
    };
    const b = new RemoteReplIoRedisTransport(pub);
    await b.subscribe('remote-repl:out', () => {});
    await expect(Promise.all([b.close(), b.close()])).resolves.toBeDefined();
    expect(quits).toBe(1);
  });
});
