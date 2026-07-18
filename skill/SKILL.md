---
name: nestjs-web-repl
description: Use when wiring a live, in-process REPL into a NestJS app over HTTP via the nestjs-web-repl package — adding WebReplModule to AppModule, gating the REPL behind an environment flag, or calling/debugging its POST command, SSE stream, or browser-UI routes.
---

# nestjs-web-repl

## Overview

`nestjs-web-repl` exposes a live NestJS REPL over HTTP: a POST command endpoint,
a Server-Sent Events output stream, and a Monaco browser UI, backed by real
`@nestjs/core` REPL sessions running inside the host app.

## When to use this skill

- Adding `WebReplModule` to a NestJS `AppModule` for the first time.
- Reviewing or writing the code that enables/disables the REPL (the security
  gate below is non-negotiable).
- Calling or troubleshooting the `POST`/SSE/browser-UI routes at runtime.
- Running the package's own examples (there's a `ts-node`-vs-`tsx` gotcha).

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
    WebReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
    }),
  ],
})
export class AppModule {}
```

Config-driven `enabled` (async form):

```ts
WebReplModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('REPL_ENABLED') === 'true',
  }),
});
```

## Use it

Three routes are registered (default base path `repl`), keyed by a channel name:

| Route | Purpose |
|---|---|
| `POST repl/{channel}` | Send a line of code to execute. |
| `GET repl/{channel}` | Server-Sent Events stream of output for the channel. |
| `GET repl/{channel}/ui` | Monaco editor + terminal browser UI. |

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

- **Authentication:** subclass `WebReplController`, decorate it with
  `@UseGuards(...)`, and pass it as `controller:` to `register`/`registerAsync`.
  See "Securing it" in the package README.
- **Multiple app instances** (load-balanced replicas): the default in-memory
  adapter is per-process. For Redis, import a ready-made adapter from the
  `nestjs-web-repl/redis` subpath — `IoRedisWebReplAdapter` (ioredis) or
  `NodeRedisWebReplAdapter` (node-redis) — and pass it via the `adapter` extra:
  `{ adapter: { useFactory: () => new IoRedisWebReplAdapter(client) } }`. Hand it
  one connected client; it owns its own subscriber connection. For any other
  broker, supply a custom adapter (a ready instance, `{ useClass, imports }`, or
  `{ useFactory, inject, imports }`). See "Adapter / multi-instance" in the README.
- **Options** (base path, TTLs, heartbeats) and **exported symbols:** see
  "Options" and "Exports" in the README.
- **Runnable example gotcha:** run examples with `ts-node`, not `tsx` —
  `tsx`/esbuild strips the decorator metadata NestJS DI needs. See "Limitations"
  in the README.

## Common mistakes

- Enabling the REPL unconditionally (or defaulting `enabled` to `true`) —
  always key it off an environment flag that defaults to off.
- Running a README example with `tsx` and hitting missing-provider/DI errors —
  use `ts-node` instead.
