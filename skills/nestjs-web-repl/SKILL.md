---
name: nestjs-web-repl
description: Use when wiring a live, in-process REPL into a NestJS app over HTTP via @remote-repl/nestjs or its nestjs-web-repl shim — adding RemoteReplModule to AppModule, gating the REPL behind an environment flag, choosing the Redis transport for multiple instances, or calling/debugging its POST command, SSE stream, or browser-UI routes.
---

# nestjs-web-repl

## Overview

`@remote-repl/nestjs` exposes a live NestJS REPL over HTTP: a POST command
endpoint, a Server-Sent Events output stream, and a Monaco browser UI, backed
by real `@nestjs/core` REPL sessions running inside the host app.

Two package names:

| Install                  | Import from              | Notes                                                          |
| ------------------------ | ------------------------ | -------------------------------------------------------------- |
| `@remote-repl/nestjs`    | `@remote-repl/nestjs`    | The implementation. Redis transports are in `@remote-repl/redis`. Use it for new code and for migrations. |
| `nestjs-web-repl`        | `nestjs-web-repl`        | The no-change path for an app on 2.3.x: it keeps the legacy names (`WebReplModule`, `register({ adapter })`, `IoRedisWebReplAdapter` from `nestjs-web-repl/redis`) as `@deprecated` aliases of the names below. Do not write new code against the legacy names. |

The examples below use `@remote-repl/nestjs`. For an app that already imports
`nestjs-web-repl`, leave it as is, or rename the imports with the table in
`packages/nestjs-web-repl/README.md` (`WebReplModule` → `RemoteReplModule`,
`adapter` → `transport`, `*WebReplAdapter` → `RemoteRepl*Transport`).

## When to use this skill

- Adding `RemoteReplModule` to a NestJS `AppModule` for the first time.
- Reviewing or writing the code that enables/disables the REPL (the security
  gate below is non-negotiable).
- Running several replicas behind a load balancer (Redis transport, `prefix`).
- Calling or troubleshooting the `POST`/SSE/browser-UI routes at runtime.
- Running the package's own examples (there's a `ts-node`-vs-`tsx` gotcha).

## Security first — read before wiring

The endpoints execute arbitrary code inside the running app **by design**. The
library ships **no authentication** (intentional). Before adding the module:

- Gate it behind an environment flag so it is OFF by default:
  `enabled: process.env.REPL_ENABLED === 'true'`.
- Never enable it in production without your own authentication or network
  restriction in front of the routes.
- A disabled module 404s every route and does not subscribe to the transport —
  keep it that way.

## Wire it up

Add the module to your `AppModule`:

```ts
import { Module } from '@nestjs/common';
import { RemoteReplModule } from '@remote-repl/nestjs';

@Module({
  imports: [
    RemoteReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
    }),
  ],
})
export class AppModule {}
```

Config-driven `enabled` (async form):

```ts
RemoteReplModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('REPL_ENABLED') === 'true',
  }),
});
```

## Use it

These routes are registered (default base path `repl`); all but the first are keyed by a channel name:

| Route | Purpose |
| --- | --- |
| `GET repl` | Redirects (302) to a randomly named channel's UI. |
| `POST repl/{channel}` | Send a line of code to execute. |
| `GET repl/{channel}` | Server-Sent Events stream of output for the channel. |
| `GET repl/{channel}/ui` | Monaco editor + terminal browser UI. |
| `GET repl/{channel}/vs/*` | Self-hosted Monaco editor assets (used by the UI). |

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

- **Authentication:** subclass `RemoteReplController`, decorate it with
  `@UseGuards(...)`, and pass it as `controller:` to `register`/`registerAsync`.
  See "Securing it" in the repository README.
- **Multiple app instances** (load-balanced replicas): the default in-memory
  transport is per-process. For Redis, import a ready-made transport from
  `@remote-repl/redis` (the shim exposes it as `nestjs-web-repl/redis`) — `RemoteReplIoRedisTransport`
  (ioredis) or `RemoteReplNodeRedisTransport` (node-redis) — and pass it as the
  `transport` extra in the same `register` call:
  `register({ enabled, transport: new RemoteReplIoRedisTransport(client) })`. Hand it
  one connected client; it owns its own subscriber connection. `ioredis` /
  `redis` are optional peers: install the one you use.
- **Two apps on one Redis:** the topics have no origin check, so unrelated apps
  sharing a Redis would exchange REPL output and ownership. Give each app's
  transport its own topic `prefix` (second constructor argument):
  `new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:' })`. Replicas of
  one app must share the same prefix; apps with different prefixes never see
  each other. Default: no prefix.
- **Other brokers:** supply a custom transport (a ready instance,
  `{ useClass, imports }`, or `{ useFactory, inject, imports }`) implementing
  `RemoteReplTransport` (`publish`, `subscribe`, optional `close`). See
  "Transport / multi-instance" in the README.
- **Options** (base path, TTLs, heartbeats) and **exported symbols:** see
  "Options" and "Exports" in the README.
- **Runnable example gotcha:** run examples with `ts-node`, not `tsx` —
  `tsx`/esbuild strips the decorator metadata NestJS DI needs. See "Limitations"
  in the README.

## Common mistakes

- Enabling the REPL unconditionally (or defaulting `enabled` to `true`) —
  always key it off an environment flag that defaults to off.
- Running two different apps on one Redis without a `prefix` — they will share
  channels and ownership.
- Mixing `nestjs-web-repl` and `@remote-repl/nestjs` imports in one app — pick
  one name; the shim aliases the same objects, but two installs can resolve
  to two copies.
- Running a README example with `tsx` and hitting missing-provider/DI errors —
  use `ts-node` instead.
