# @remote-repl/redis

The Redis transports for remote-repl: `IoRedisWebReplAdapter` (ioredis) and
`NodeRedisWebReplAdapter` (node-redis). A transport lets several instances of
one app share channels and ownership through one Redis pub/sub bus.

## Install

```bash
npm install @remote-repl/redis ioredis   # or: redis
```

`ioredis` and `redis` are optional peer dependencies. Install the one you use.

## Usage

```ts
import Redis from 'ioredis';
import { IoRedisWebReplAdapter } from '@remote-repl/redis';

const transport = new IoRedisWebReplAdapter(new Redis(process.env.REDIS_URL!), {
  prefix: 'billing-api:', // optional: isolates this app on a shared Redis
});
```

Pass the transport as the `adapter` extra of `WebReplModule.register` in
NestJS, or as `transport` to `createReplEngine` in Express. The transport
opens its own subscriber connection and closes only that one on shutdown.

Two apps on one Redis must use different prefixes. Replicas of one app must
use the same prefix. Full documentation is in the repository README:
https://github.com/p-dim-popov/remote-repl#readme

## License

MIT
