import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebReplModule } from '../../src/web-repl.module';
import type { WebReplAdapter } from '../../src/interfaces/web-repl-adapter.interface';
import type { WebReplModuleOptions } from '../../src/interfaces/web-repl-options.interface';
import type { WebReplEvent } from '../../src/interfaces/web-repl-messages.interface';

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** A booted, listening instance plus the HTTP handle tests drive it through. */
export interface Instance {
  app: INestApplication;
  port: number;
  post(channel: string, command: string): Promise<{ status: number; commandId?: string }>;
  get(path: string): Promise<{ status: number }>;
  close(): Promise<void>;
}

export const bootInstance = async (
  adapter: WebReplAdapter,
  options: Partial<WebReplModuleOptions> & { instanceId: string },
): Promise<Instance> => {
  const mod = await Test.createTestingModule({
    imports: [WebReplModule.register({ enabled: true, ...options, adapter })],
  }).compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    port,
    async post(channel, command) {
      const res = await request(app.getHttpServer())
        .post(`/repl/${encodeURIComponent(channel)}`)
        .send({ command });
      return { status: res.status, commandId: res.body?.commandId };
    },
    async get(path) {
      const res = await request(app.getHttpServer()).get(path);
      return { status: res.status };
    },
    close: () => app.close(),
  };
};

/** One SSE frame as it arrived on the wire: the `id:` line plus the parsed `data:` JSON. */
export interface Frame {
  wireId: string | null;
  event: WebReplEvent;
}

export interface SseClient {
  frames: Frame[];
  /** Resolves with the first frame matching `pred` (already received or future). */
  waitFor(pred: (f: Frame) => boolean, timeoutMs?: number): Promise<Frame>;
  /** Resolves after `ms` with every frame received so far (for "nothing arrives" checks). */
  settle(ms: number): Promise<Frame[]>;
  close(): void;
}

const parseFrame = (raw: string): Frame | null => {
  let wireId: string | null = null;
  let data: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) wireId = line.slice(3).trim();
    else if (line.startsWith('data:')) data = (data ?? '') + line.slice(5).trim();
  }
  if (data === null) return null;
  return { wireId, event: JSON.parse(data) as WebReplEvent };
};

export const openSse = (
  port: number,
  channel: string,
  lastEventId?: string | number,
): Promise<SseClient> =>
  new Promise((resolveOpen, rejectOpen) => {
    const frames: Frame[] = [];
    const waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
    let buffer = '';
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId);
    const req = http.get(
      `http://127.0.0.1:${port}/repl/${encodeURIComponent(channel)}`,
      { headers },
      (res) => {
        if (res.statusCode !== 200) {
          rejectOpen(new Error(`SSE connect failed: ${res.statusCode}`));
          req.destroy();
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = parseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (!frame) continue;
            frames.push(frame);
            for (const w of [...waiters]) {
              if (w.pred(frame)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(frame);
              }
            }
          }
        });
        const client: SseClient = {
          frames,
          waitFor: (pred, timeoutMs = 10_000) =>
            new Promise((resolve, reject) => {
              const hit = frames.find(pred);
              if (hit) return resolve(hit);
              const timer = setTimeout(
                () => reject(new Error(`timed out after ${timeoutMs}ms waiting for SSE frame`)),
                timeoutMs,
              );
              waiters.push({
                pred,
                resolve: (f) => {
                  clearTimeout(timer);
                  resolve(f);
                },
              });
            }),
          settle: (ms) => new Promise((resolve) => setTimeout(() => resolve([...frames]), ms)),
          close: () => {
            res.destroy();
            req.destroy();
          },
        };
        resolveOpen(client);
      },
    );
    req.on('error', rejectOpen);
  });

export const isOutputContaining = (text: string) => (f: Frame) =>
  f.event.type === 'output' && String(f.event.data).includes(text);

export const isDoneFor = (commandId: string | undefined) => (f: Frame) =>
  f.event.type === 'system' &&
  f.event.commandId === commandId &&
  (f.event.data as { done?: boolean })?.done === true;

export const isPing = (f: Frame) =>
  f.event.type === 'system' && (f.event.data as { ping?: boolean })?.ping === true;

export const uniqueChannel = (label: string): string =>
  `${label}-${Math.random().toString(36).slice(2, 8)}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * An independent observer of the shared Redis (ioredis, regardless of the
 * transport under test): counts subscribers per topic and records every
 * message published on the topics it watches.
 */
export interface RedisObserver {
  numsub(topics: string[]): Promise<Record<string, number>>;
  watch(topics: string[]): Promise<string[]>; // returns the live message log
  close(): Promise<void>;
}

export const observeRedis = async (): Promise<RedisObserver> => {
  const { default: Redis } = await import('ioredis');
  const cmd = new Redis(REDIS_URL);
  const sub = new Redis(REDIS_URL);
  const log: string[] = [];
  sub.on('message', (topic: string, message: string) => log.push(`${topic} ${message}`));
  return {
    async numsub(topics) {
      const raw = (await cmd.call('PUBSUB', 'NUMSUB', ...topics)) as Array<string | number>;
      const out: Record<string, number> = {};
      for (let i = 0; i < raw.length; i += 2) out[String(raw[i])] = Number(raw[i + 1]);
      return out;
    },
    async watch(topics) {
      await sub.subscribe(...topics);
      return log;
    },
    async close() {
      await Promise.all([cmd.quit(), sub.quit()]);
    },
  };
};
