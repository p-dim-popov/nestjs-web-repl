---
name: remote-repl-express
description: Use when wiring a live, in-process REPL into an Express app over HTTP via @remote-repl/express — creating the engine with createRemoteReplEngine, mounting createRemoteReplRouter under a base path, supplying the REPL context, gating the REPL behind an environment flag, putting auth middleware in front, choosing the Redis transport for multiple instances, or calling/debugging its POST command, SSE stream, or browser-UI routes.
---

# remote-repl-express

## Overview

`@remote-repl/express` exposes a live Node.js REPL running inside an Express
app over HTTP: a POST command endpoint, a Server-Sent Events output stream, and
a Monaco browser UI. It is the Express package over the framework-free engine
in `@remote-repl/core`; the NestJS package (`@remote-repl/nestjs`) speaks the
same protocol, so a NestJS replica and an Express replica can share one Redis.

Two exports:

| Export                                   | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `createRemoteReplEngine({ options, context \| buildContext, transport?, logger? })` | Builds the `RemoteReplEngine`. `transport` defaults to in-memory. The caller owns `start()` / `stop()`. |
| `createRemoteReplRouter({ engine })`           | An Express `Router` with the five routes; mount it wherever you want the base path. It reads `enabled` from the engine. |

## When to use this skill

- Adding the REPL to an Express app for the first time.
- Reviewing or writing the code that enables/disables the REPL (the security
  gate below is non-negotiable).
- Deciding what the REPL sessions see as globals (the context).
- Running several replicas behind a load balancer (Redis transport, `prefix`).
- Calling or troubleshooting the `POST`/SSE/browser-UI routes at runtime.

## Security first — read before wiring

The endpoints execute arbitrary code inside the running process **by design**.
The library ships **no authentication** (intentional). Before mounting the
router:

- Gate it behind an environment flag so it is OFF by default:
  `const enabled = process.env.REPL_ENABLED === 'true'`, and pass it to
  `createRemoteReplEngine` in `options`. The router derives its own 404 gate from
  `engine.enabled`; there is no second flag to keep in step.
- Never enable it in production without your own authentication or network
  restriction in front of the routes. Put your auth middleware **before** the
  router in the same `app.use(path, auth, router)` call.
- A disabled engine never subscribes to the transport (`start()` is a no-op)
  and a disabled router 404s every route — keep it that way.

## Wire it up

```ts
import express from 'express';
import { createRemoteReplEngine, createRemoteReplRouter } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const engine = createRemoteReplEngine({
  options: { enabled },
  // no `transport`: the in-memory default, correct for one process; see Redis below
  context: { db, userService }, // the globals every session sees
});
await engine.start(); // no-op when disabled

const app = express();
app.use('/repl', requireAdmin, createRemoteReplRouter({ engine }));
//          ^ mount path = base path      ^ your auth middleware, in front

const server = app.listen(3000);
process.once('SIGTERM', () => {
  server.close();
  void engine.stop();
});
```

Key points:

- **Mount path is the base path.** `app.use('/repl', router)` gives
  `/repl`, `/repl/:channel`, `/repl/:channel/ui`, `/repl/:channel/vs/*`. The
  landing redirect uses `req.originalUrl`, so nested mounts and prefixes work.
- **Context.** Pass either `context: { ... }` (a plain object; each session
  gets a shallow copy) or `buildContext: () => ({ ... })` (a synchronous
  function called once per session, returning a plain object; for lazily
  built or per-session values; it cannot return a Promise). Exactly one of
  the two.
- **Lifecycle.** `await engine.start()` after construction, `await engine.stop()`
  on shutdown. Nothing starts implicitly.
- **`enabled` lives on the engine.** The engine enforces it (rejects dispatch,
  refuses streams); the router reads `engine.enabled` and enforces it again at
  the HTTP edge (404 on every route). One flag, two layers.
- Works on Express 4.16+ and Express 5 (peer range `^4.16 || ^5`).

## Use it

| Route | Purpose |
| --- | --- |
| `GET /repl` | Redirects (302) to a randomly named channel's UI. |
| `POST /repl/{channel}` | Send a line of code: body `{"command":"1 + 1"}`; 202 with `{ accepted, commandId }`, 400 on a non-string command. |
| `GET /repl/{channel}` | Server-Sent Events stream of output for the channel (supports `Last-Event-ID` replay). |
| `GET /repl/{channel}/ui` | Monaco editor + terminal browser UI. |
| `GET /repl/{channel}/vs/*` | Self-hosted Monaco editor assets (used by the UI). |

```bash
# stream output (leave running in one terminal)
curl -N -H 'authorization: Bearer …' http://localhost:3000/repl/main

# in another terminal, run a command on the same channel
curl -X POST http://localhost:3000/repl/main \
  -H 'authorization: Bearer …' -H 'content-type: application/json' \
  -d '{"command":"1 + 1"}'
```

Open `http://localhost:3000/repl/main/ui` in a browser for the interactive UI
(the UI calls the same routes, so your auth must also accept browser
requests — a cookie/session, or a query token as in the package example).

## When you need more

- **Multiple app instances** (load-balanced replicas): the in-memory transport
  is per-process. Install `@remote-repl/redis` and pass
  `transport: new RemoteReplIoRedisTransport(client)` (ioredis) or
  `new RemoteReplNodeRedisTransport(client)` (node-redis) to `createRemoteReplEngine`.
  Hand it one connected client; it owns its own subscriber connection.
  `ioredis` / `redis` are optional peers: install the one you use.
- **Two apps on one Redis:** the topics have no origin check, so unrelated apps
  sharing a Redis would exchange REPL output and ownership. Give each app's
  transport its own topic `prefix` (second constructor argument):
  `new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:' })`. Replicas of
  one app must share the same prefix; apps with different prefixes never see
  each other. Default: no prefix.
- **Options** (`instanceId`, `sessionTtl`, `replayBufferSize`,
  `heartbeatInterval`, `ownerHeartbeatInterval`, `ownerLeaseTtl`) are the
  engine's `RemoteReplOptions` from `@remote-repl/core`; pass them in `options`.
  See the repository README.
- **Logging:** `logger` (an object with `warn` and `error`) on
  `createRemoteReplEngine`; defaults to `console`.
- **Runnable example:** `packages/express/example/main.ts` in the repository
  (`REPL_ENABLED=true npm run example:express`; demo bearer token `REPL_TOKEN`).

## Common mistakes

- Enabling the REPL unconditionally (or defaulting `enabled` to `true`) —
  always key it off an environment flag that defaults to off.
- Mounting the router without auth in front — the library has none.
- Forgetting `await engine.start()` — commands are accepted but no session
  runs them; or forgetting `engine.stop()` — the process hangs on shutdown
  while the transport subscription stays open.
- Running two different apps on one Redis without a `prefix` — they will share
  channels and ownership.
