// The contract suite's one external requirement, declared in one place
// (ADR 0006). `redisVerdict()` is awaited at the top of each contract spec:
// 'run' when REDIS_URL answers PING, 'skip' (one warning per spec file, since
// vitest isolates files) when it does not,
// and a thrown error naming the fix when REDIS_REQUIRED=1 (CI) and it does
// not. Nothing else in the suite knows how Redis is found.
import net from 'node:net';

export type RedisVerdict = 'run' | 'skip';

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** True when a Redis (or anything that answers `PING` with `+PONG`) listens at `url`. */
export const probeRedis = (url: string, timeoutMs = 2000): Promise<boolean> =>
  new Promise((resolve) => {
    const { hostname, port } = new URL(url);
    const socket = net.connect({ host: hostname, port: Number(port) || 6379 });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => socket.write('PING\r\n'));
    socket.once('data', (chunk) => done(chunk.toString('utf8').startsWith('+PONG')));
    socket.once('error', () => done(false));
    socket.once('close', () => done(false));
  });

export const decideRedis = (input: {
  available: boolean;
  required: boolean;
  url: string;
  warn?: (message: string) => void;
}): RedisVerdict => {
  if (input.available) return 'run';
  const start = 'docker run -d -p 6379:6379 redis:7-alpine';
  if (input.required) {
    throw new Error(
      `REDIS_REQUIRED is set but no Redis answers at ${input.url}. ` +
        `Start one (${start}) or point REDIS_URL at an existing instance.`,
    );
  }
  (input.warn ?? console.warn)(
    `contract suite skipped: no Redis at ${input.url}. Start one (${start}) ` +
      `or point REDIS_URL at an existing instance; set REDIS_REQUIRED=1 to fail instead.`,
  );
  return 'skip';
};

let verdict: Promise<RedisVerdict> | undefined;

/** Probes once per spec file (vitest isolates files); memoised within it. */
export const redisVerdict = (): Promise<RedisVerdict> =>
  (verdict ??= probeRedis(REDIS_URL).then((available) =>
    decideRedis({ available, required: process.env.REDIS_REQUIRED === '1', url: REDIS_URL }),
  ));
