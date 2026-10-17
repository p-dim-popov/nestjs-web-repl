---
name: remote-repl-express
description: Use when an Express app exposes a live REPL via @remote-repl/express: creating the engine and router, choosing the context the sessions see, gating it with an env flag, running replicas over Redis, or driving the POST/SSE routes to inspect the running app.
---

# remote-repl-express

## Overview

`@remote-repl/express` exposes a live Node.js REPL running inside an Express
app over HTTP: a POST command endpoint, a Server-Sent Events output stream, and
a Monaco browser UI. It is the Express package over the framework-free engine
in `@remote-repl/core`; the NestJS package (`@remote-repl/nestjs`) speaks the
same protocol, so a NestJS replica and an Express replica can share one Redis.
Full reference (options, exports, securing it): the repository README,
https://github.com/p-dim-popov/remote-repl#readme.

Two exports:

| Export                                   | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `createRemoteReplEngine({ options, context \| buildContext, transport?, logger? })` | Builds the `RemoteReplEngine`. `transport` defaults to in-memory. The caller owns `start()` / `stop()`. |
| `createRemoteReplRouter({ engine })`           | An Express `Router` with the five routes; mount it wherever you want the base path. It reads `enabled` from the engine. |

## Security first — read before wiring

The endpoints execute arbitrary code inside the running process **by design**.
The library ships **no authentication** (intentional). Before mounting the
router:

- Gate it behind an environment flag so it is OFF by default:
  `const enabled = process.env.REPL_ENABLED === 'true'`, and pass it to
  `createRemoteReplEngine` in `options`. The router derives its own 404 gate from
  `engine.enabled`; there is no second flag to keep in step.
- Enable it in production only behind your own authentication or network
  restriction in front of the routes. Put your auth middleware **before** the
  router in the same `app.use(path, auth, router)` call.
- A disabled engine never subscribes to the transport (`start()` is a no-op)
  and a disabled router 404s every route. Keep it that way.

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
  the two. The keys are the whole REPL vocabulary of your app (see "Use it").
- **Lifecycle.** `await engine.start()` after construction, `await engine.stop()`
  on shutdown. Nothing starts implicitly.
- **`enabled` lives on the engine.** The engine enforces it (rejects dispatch,
  refuses streams); the router reads `engine.enabled` and enforces it again at
  the HTTP edge (404 on every route). One flag, two layers.
- Works on Express 4.16+ and Express 5 (peer range `^4.16 || ^5`).

Done when `REPL_ENABLED=true` makes `GET /repl` answer 302 behind your auth
and, without the flag, every `/repl/*` route answers 404.

## Use it

### Decide whether the REPL is the right tool

A session runs inside the live process: the real config, the real database
connections, the real service instances you put in `context`. Reach for it
when a fresh test process cannot answer the question:

- Inspect live state: what a service holds right now, not what a unit test
  constructs.
- Call a service method with the real wiring: `catService.findAll()` runs the
  actual instance against its actual dependencies.
- Reproduce a bug on the exact object and inputs that failed, one call at a
  time, and watch the value at each step.
- Run a one-off data fix under supervision, with a human reading the stream.

Leave it alone when:

- the command is destructive and nobody is watching the stream: an object
  mutated from the REPL is mutated in the running app, with no undo;
- the target is production without authentication in front (see "Security
  first");
- the work is a long-running loop or a job: a 30 s watchdog cuts each command
  off (`Error: eval timed out`, then `done`), and an idle channel is released
  after `sessionTtl` (default 30 min), dropping its variables. Start the job
  from the app and poll it from the REPL instead.

### Drive it from a shell

Two routes under the mount path, both keyed by a channel name (any path
segment; pick one per task). Both pass through your auth middleware, so send
its credential on every request (the examples use the package example's
bearer token).

- `POST /repl/{channel}` with `{"command":"<source>"}` answers
  `202 {"accepted":true,"commandId":"cmd_…"}` and nothing else: results
  arrive on the stream.
- `GET /repl/{channel}` is a Server-Sent Events stream of the channel's
  events, replaying its recent history (200 events) on connect.

1. Open the stream to a file, then post the command:

   ```bash
   BASE=http://localhost:3000/repl/dev          # channel "dev"
   AUTH='authorization: Bearer dev-token'
   curl -sN -H "$AUTH" "$BASE" > out.sse & SSE=$!
   ID=$(curl -s -X POST -H "$AUTH" "$BASE" -H 'content-type: application/json' \
          -d '{"command":"catService.findAll()"}' | sed -E 's/.*"commandId":"([^"]+)".*/\1/')
   ```

   Done when `$ID` holds a `cmd_…` id. A 401 is your auth middleware; a 400
   means the command was not a non-empty string; a 404 means the REPL is
   disabled.

2. Wait for the command's `done` event, stop the stream, read the command's
   events:

   ```bash
   until grep -q "\"commandId\":\"$ID\".*\"done\":true" out.sse; do sleep 0.2; done
   kill $SSE; grep "\"commandId\":\"$ID\"" out.sse
   ```

   Done when the last line is a `system` event with `{"done":true}` and your
   command id. Observed for the command above:

   ```
   data: {"id":1,"type":"command","commandId":"cmd_1_x6sb","data":{"command":"catService.findAll()","instanceId":"inst_5e4j146j"}}
   data: {"id":2,"type":"output","commandId":"cmd_1_x6sb","data":"[ 'Tom', 'Felix' ]\n"}
   data: {"id":3,"type":"system","commandId":"cmd_1_x6sb","data":{"done":true}}
   ```

3. Post the next command on the same channel to keep its variables, or on a
   new channel name for a clean slate. Commands on one channel run one after
   another, in post order.

4. If the stream dropped, reconnect with `-H 'Last-Event-ID: <the last id:
   line you saw>'`: the server replays only the events with a higher id.
   Done when the first replayed `id:` is your cursor + 1.

Filter by command id, never by position: the replay carries events of
earlier commands too. Kill the stream curl yourself, as above; a dangling
`curl -N | grep` exits only on the next keep-alive ping (15 s).

The browser UI at `/repl/{channel}/ui` drives the same two routes from a
Monaco editor; use it when a human is pairing with you. It sends no header of
its own, so your auth must also accept browser requests (a cookie/session, or
a query token as in the package example: `/repl/dev/ui?token=dev-token`).

### Events

Each SSE frame's `data` line is one JSON event `{ id, type, commandId, data }`:

| `type`    | `data`                   | Meaning                                                                                      |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `command` | `{command, instanceId}`  | the owner instance started executing your command                                            |
| `output`  | string                   | one chunk of REPL output, verbatim: result rendering and `console.*` lines alike              |
| `system`  | `{"done":true}`          | your command finished; always the last event for a command id                                |
| `system`  | `{"error":"…"}`          | the command could not run at all (e.g. `buildContext` threw); the channel stays usable        |
| `system`  | `{"ping":true}`          | keep-alive, `commandId: null`; ignore                                                        |

An exception thrown by your code is not an `error` event: it arrives as
`output` text (`Uncaught ReferenceError: nope is not defined\n`), then `done`.

### Vocabulary

A session is a plain `node:repl` whose globals are the keys of the `context`
the app passed (or the object `buildContext` returned), plus Node's own
globals. There is no DI container: `get`, `debug`, `methods` and `help` do not
exist unless the app put them in the context (`typeof get` → `'undefined'`).
Against the package example, whose context is `{ catService }`:

| Command                                                   | Observed output                                                      | Use for                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| `Object.keys(globalThis).filter((k) => !k.startsWith("_"))` | `[ 'global', 'clearImmediate', …, 'sessionStorage', 'catService' ]` | discover what the app exposed: the context keys come last |
| `catService.findAll()`                                    | `[ 'Tom', 'Felix' ]`                                                 | call a service method                     |
| `catService`                                              | `CatService { cats: [ 'Tom', 'Felix' ] }`                            | inspect a service's fields                |
| `Object.getOwnPropertyNames(Object.getPrototypeOf(catService))` | `[ 'constructor', 'findAll' ]`                               | list a service's methods                  |

To expose more, add keys to `context` (`{ catService, db, config }`) or
return them from `buildContext`; a session sees exactly those names.

### State between commands

A channel is one session: variables, functions and object mutations persist
between commands until the channel is released. Verified sequence on one
channel:

| Command                                                                            | Observed output                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `const cats = catService.findAll()`                                                | none: a declaration has no value                                                      |
| `cats.length`                                                                      | `2`                                                                                   |
| `for (const c of cats) console.log(c)`                                             | `Tom`, then `Felix`: one `output` event per line                                      |
| `function shout(name) {\n  return name.toUpperCase() + '!';\n}\nshout(cats[0])`    | `'TOM!'`: a block is ONE command with embedded newlines                                |
| `await new Promise((r) => setTimeout(() => r(cats.map((c) => c.length)), 100))`   | `[ 3, 5 ]`: top-level `await` works                                                   |
| `typeof cats` on another channel                                                   | `'undefined'`: each channel is its own session                                        |

`context` values are shared by reference across sessions (each session gets a
shallow copy of the object, not of its values), so a mutation through
`catService` is visible to the app and to every other channel. A POST that
ends inside an open brace is rejected with `SyntaxError: incomplete input`
and the session moves on: send the whole block in one command.

### Reading output

The REPL prints an expression's value the way node's REPL does
(`util.inspect`: strings quoted, objects expanded) as one `output` chunk
ending in `\n`; `console.log` lines arrive as their own `output` events, in
order. A statement or declaration whose value is `undefined` prints nothing,
so `done` follows `command` directly. That is success, not a lost result.

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
  one app share one prefix; apps with different prefixes never see each
  other.
- **Options** (`instanceId`, `sessionTtl`, `replayBufferSize`,
  `heartbeatInterval`, `ownerHeartbeatInterval`, `ownerLeaseTtl`) are the
  engine's `RemoteReplOptions` from `@remote-repl/core`; pass them in `options`.
  See "Options" in the README.
- **Logging:** `logger` (an object with `warn` and `error`) on
  `createRemoteReplEngine`; defaults to `console`.
- **Runnable example:** `packages/express/example/main.ts` in the repository
  (`npm run build`, then `REPL_ENABLED=true npm run example:express`; demo
  bearer token `REPL_TOKEN`, default `dev-token`; context `{ catService }`).

## Habits that keep it safe

- Key `enabled` off an environment flag that defaults to off.
- Mount auth middleware in front of the router in the same `app.use` call;
  the library has none.
- `await engine.start()` after construction, so commands have a session to
  run in; `await engine.stop()` on shutdown, so the transport subscription
  closes and the process exits.
- Give each app on a shared Redis its own `prefix`; replicas of one app share
  one.
