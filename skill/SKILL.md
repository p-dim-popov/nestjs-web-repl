---
name: nestjs-web-repl
description: Use when adding or using a live network/web/remote REPL in a NestJS app via the nestjs-web-repl package — wiring WebReplModule into AppModule, the enabled security gate, and the POST command / SSE / browser-UI endpoints.
---

# nestjs-web-repl

`nestjs-web-repl` exposes a live NestJS REPL over HTTP: a POST command endpoint,
a Server-Sent Events output stream, and a Monaco browser UI, backed by real
`@nestjs/core` REPL sessions running inside the host app.

## Security first — read before wiring

The endpoints execute arbitrary code inside the running app **by design**. The
library ships **no authentication** (intentional). Before adding the module:

- Gate it behind an environment flag so it is OFF by default:
  `enabled: process.env.REPL_ENABLED === 'true'`.
- Never enable it in production without your own authentication or network
  restriction in front of the routes.
- A disabled module 404s every route and does not subscribe to the adapter —
  keep it that way.

## Wire it up

Add the module to your `AppModule`:

```ts
import { Module } from '@nestjs/common';
import { WebReplModule } from 'nestjs-web-repl';

@Module({
  imports: [
    WebReplModule.forRoot({
      enabled: process.env.REPL_ENABLED === 'true',
    }),
  ],
})
export class AppModule {}
```

Config-driven `enabled` (async form):

```ts
WebReplModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('REPL_ENABLED') === 'true',
  }),
});
```

## Use it

Three routes are registered (default base path `repl`), keyed by a channel name:

- `POST repl/{channel}` — send a line of code to execute.
- `GET repl/{channel}` — Server-Sent Events stream of output for the channel.
- `GET repl/{channel}/ui` — Monaco editor + terminal browser UI.

```bash
# stream output (leave running in one terminal)
curl -N http://localhost:3000/repl/main

# in another terminal, run a command on the same channel
curl -X POST http://localhost:3000/repl/main \
  -H 'content-type: application/json' \
  -d '{"command":"1 + 1"}'
```

Open `http://localhost:3000/repl/main/ui` in a browser for the interactive UI.

## When you need more

- **Multiple app instances** (load-balanced replicas): the default in-memory
  adapter is per-process; supply a shared adapter so a command and its output
  reach the owning instance. See "Adapter / multi-instance" in the package
  README.
- **Custom adapter:** implement the adapter interface (publish/subscribe over
  the message topics). See "Adapter / multi-instance" in the README.
- **Options** (base path, TTLs, heartbeats) and **exported symbols:** see
  "Options" and "Exports" in the README.
- **Runnable example gotcha:** run examples with `ts-node`, not `tsx` —
  `tsx`/esbuild strips the decorator metadata NestJS DI needs. See "Limitations"
  in the README.
