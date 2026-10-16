import Redis from 'ioredis';
import { createClient } from 'redis';
import type { WebReplAdapter } from '../../src/interfaces/web-repl-adapter.interface';
import { IoRedisWebReplAdapter, NodeRedisWebReplAdapter } from '../../src/redis';
import { REDIS_URL } from './harness';

/**
 * A transport under contract: builds a fresh adapter (one publisher client it
 * owns) against the real Redis. `close` quits that publisher; the adapter
 * itself quits its own subscriber when the host app shuts down.
 */
export interface Transport {
  name: string;
  make(): Promise<{ adapter: WebReplAdapter; close(): Promise<void> }>;
}

export const transports: Transport[] = [
  {
    name: 'ioredis',
    async make() {
      const client = new Redis(REDIS_URL, { lazyConnect: true });
      await client.connect();
      return {
        adapter: new IoRedisWebReplAdapter(client),
        close: async () => {
          await client.quit();
        },
      };
    },
  },
  {
    name: 'node-redis',
    async make() {
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      return {
        adapter: new NodeRedisWebReplAdapter(client),
        close: async () => {
          await client.quit();
        },
      };
    },
  },
];
