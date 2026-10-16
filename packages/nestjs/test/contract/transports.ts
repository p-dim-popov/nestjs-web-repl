import Redis from 'ioredis';
import { createClient } from 'redis';
import type { WebReplAdapter } from '@remote-repl/core';
import { IoRedisWebReplAdapter, NodeRedisWebReplAdapter } from '../../src/redis';
import { REDIS_URL } from './harness';

/**
 * A transport under contract: builds a fresh adapter (one publisher client it
 * owns) against the real Redis. `close` quits that publisher; the adapter
 * itself quits its own subscriber when the host app shuts down.
 */
export interface TransportOptions {
  /** Prepended verbatim to every topic name (tenancy on a shared Redis). */
  prefix?: string;
}

export interface Transport {
  name: string;
  make(options?: TransportOptions): Promise<{ adapter: WebReplAdapter; close(): Promise<void> }>;
}

export const transports: Transport[] = [
  {
    name: 'ioredis',
    async make(options) {
      const client = new Redis(REDIS_URL, { lazyConnect: true });
      await client.connect();
      return {
        adapter: new IoRedisWebReplAdapter(client, options),
        close: async () => {
          await client.quit();
        },
      };
    },
  },
  {
    name: 'node-redis',
    async make(options) {
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      return {
        adapter: new NodeRedisWebReplAdapter(client, options),
        close: async () => {
          await client.quit();
        },
      };
    },
  },
];
