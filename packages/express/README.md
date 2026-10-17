# @remote-repl/express

The Express adapter for remote-repl: an Express `Router` that exposes a live,
in-process Node.js REPL over HTTP. It gives you a command endpoint, an SSE
output stream and a Monaco browser UI, backed by the framework-free engine in
`@remote-repl/core`.

> **Security.** The routes execute arbitrary code inside your process by
> design. The package ships no authentication. Gate `enabled` behind an
> environment variable and put your own middleware in front of the router.

## Install

```bash
npm install @remote-repl/express @remote-repl/core
```

`express` (`^4.16 || ^5`) is a peer dependency. Node 20+ is required.

## Usage

```ts
import express from 'express';
import { InMemoryWebReplAdapter } from '@remote-repl/core';
import { createReplEngine, createReplRouter } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const engine = createReplEngine({
  options: { enabled },
  transport: new InMemoryWebReplAdapter(),
  context: { db }, // what every REPL session sees as globals
});
await engine.start(); // no-op when disabled

const app = express();
app.use('/repl', requireAdmin, createReplRouter({ engine }));
app.listen(3000);
```

The mount path is the base path. `enabled` is set once, on the engine: the
engine refuses commands and streams, and the router reads `engine.enabled` and
returns 404 on every route. For several replicas, pass a transport from
`@remote-repl/redis` instead of the in-memory one.

Full documentation, the options table and the security notes are in the
repository README: https://github.com/p-dim-popov/node-remote-repl#readme

## License

MIT
