// The contract suite's one external requirement, declared once (ADR 0006):
// without a reachable Redis the suite skips with a single warning; with
// REDIS_REQUIRED=1 (CI) it fails with one message naming the fix.
import net from 'node:net';
import { decideRedis, probeRedis } from './redis-preflight';

const listen = (onConnection: (socket: net.Socket) => void): Promise<{ url: string; close(): void }> =>
  new Promise((resolve) => {
    const server = net.createServer(onConnection);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ url: `redis://127.0.0.1:${port}`, close: () => server.close() });
    });
  });

describe('probeRedis', () => {
  it('is true when the endpoint answers PING with +PONG', async () => {
    const fake = await listen((socket) => {
      socket.on('data', () => socket.end('+PONG\r\n'));
    });
    try {
      expect(await probeRedis(fake.url)).toBe(true);
    } finally {
      fake.close();
    }
  });

  it('is false when the endpoint answers anything else', async () => {
    const fake = await listen((socket) => {
      socket.on('data', () => socket.end('HTTP/1.1 400 Bad Request\r\n'));
    });
    try {
      expect(await probeRedis(fake.url)).toBe(false);
    } finally {
      fake.close();
    }
  });

  it('is false when nothing listens', async () => {
    const free = await listen(() => {});
    free.close();
    expect(await probeRedis(free.url)).toBe(false);
  });
});

describe('decideRedis', () => {
  const url = 'redis://127.0.0.1:6379';

  it('runs when Redis is available, without warning', () => {
    const warn = vi.fn();
    expect(decideRedis({ available: true, required: false, url, warn })).toBe('run');
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips with one warning naming the URL when Redis is absent and not required', () => {
    const warn = vi.fn();
    expect(decideRedis({ available: false, required: false, url, warn })).toBe('skip');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(url);
    expect(warn.mock.calls[0][0]).toContain('skipped');
  });

  it('fails with one message naming the docker command when Redis is absent but required', () => {
    const warn = vi.fn();
    expect(() => decideRedis({ available: false, required: true, url, warn })).toThrow(
      /docker run -d -p 6379:6379 redis:7-alpine/,
    );
    expect(() => decideRedis({ available: false, required: true, url, warn })).toThrow(/REDIS_REQUIRED/);
    expect(warn).not.toHaveBeenCalled();
  });
});
