---
name: remote-repl-nestjs
description: Use when a NestJS app exposes a live REPL via @remote-repl/nestjs: wiring RemoteReplModule, gating it with an env flag, running replicas over Redis, or driving the POST/SSE routes to inspect the running app.
---

# remote-repl-nestjs

## Overview

`@remote-repl/nestjs` exposes a live NestJS REPL over HTTP: a POST command
endpoint, a Server-Sent Events output stream, and a Monaco browser UI, backed
by real `@nestjs/core` REPL sessions running inside the host app. Redis
transports for multi-instance deployments live in `@remote-repl/redis`. Full
reference (options, exports, securing it): the repository README,
https://github.com/p-dim-popov/remote-repl#readme.

An app that still imports `nestjs-web-repl` is covered by the
`nestjs-web-repl` skill instead; the two differ only in the setup names.

## Security first — read before wiring

The endpoints execute arbitrary code inside the running app **by design**. The
library ships **no authentication** (intentional). Before adding the module:

- Gate it behind an environment flag so it is OFF by default:
  `enabled: process.env.REPL_ENABLED === 'true'`.
- Enable it in production only behind your own authentication or network
  restriction in front of the routes.
- A disabled module 404s every route and does not subscribe to the transport.
  Keep it that way.

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

Done when `REPL_ENABLED=true` makes `GET /repl` answer 302 and, without the
flag, every `/repl/*` route answers 404.

## Use it

### Decide whether the REPL is the right tool

A session runs inside the live process: the real DI container, the real
config, the real database connections. Reach for it when a fresh test process
cannot answer the question:

- Inspect live state: what a provider holds right now, not what a unit test
  constructs.
- Call a service method with the real wiring: `get(CatService).findAll()`
  runs the actual provider against its actual dependencies.
- Reproduce a bug on the exact provider and inputs that failed, one call at a
  time, and watch the value at each step.
- Check what DI actually wired: `debug()` lists every module with its
  controllers and providers; `methods(CatService)` lists a provider's public
  methods (both print to the app's console; see "Vocabulary" below).
- Run a one-off data fix under supervision, with a human reading the stream.

Leave it alone when:

- the command is destructive and nobody is watching the stream: a provider
  mutated from the REPL is mutated in the running app, with no undo;
- the target is production without authentication in front (see "Security
  first");
- the work is a long-running loop or a job: a 30 s watchdog cuts each command
  off (`Error: eval timed out`, then `done`), and an idle channel is released
  after `sessionTtl` (default 30 min), dropping its variables. Start the job
  from the app and poll it from the REPL instead.

### Drive it from a shell

Two routes under the base path (default `repl`), both keyed by a channel
name (any path segment; pick one per task):

- `POST repl/{channel}` with `{"command":"<source>"}` answers
  `202 {"accepted":true,"commandId":"cmd_…"}` and nothing else: results
  arrive on the stream.
- `GET repl/{channel}` is a Server-Sent Events stream of the channel's
  events, replaying its recent history (200 events) on connect.

1. Open the stream to a file, then post the command:

   ```bash
   BASE=http://localhost:3000/repl/dev          # channel "dev"
   curl -sN "$BASE" > out.sse & SSE=$!
   ID=$(curl -s -X POST "$BASE" -H 'content-type: application/json' \
          -d '{"command":"get(CatService).findAll()"}' | sed -E 's/.*"commandId":"([^"]+)".*/\1/')
   ```

   Done when `$ID` holds a `cmd_…` id. A 400 means the command was not a
   non-empty string; a 404 means the REPL is disabled.

2. Wait for the command's `done` event, stop the stream, read the command's
   events:

   ```bash
   until grep -q "\"commandId\":\"$ID\".*\"done\":true" out.sse; do sleep 0.2; done
   kill $SSE; grep "\"commandId\":\"$ID\"" out.sse
   ```

   Done when the last line is a `system` event with `{"done":true}` and your
   command id. Observed for the command above:

   ```
   data: {"id":1,"type":"command","commandId":"cmd_1_78nz","data":{"command":"get(CatService).findAll()","instanceId":"inst_aanre0v8"}}
   data: {"id":2,"type":"output","commandId":"cmd_1_78nz","data":"[ 'Tom', 'Felix' ]\n"}
   data: {"id":3,"type":"system","commandId":"cmd_1_78nz","data":{"done":true}}
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

The browser UI at `repl/{channel}/ui` drives the same two routes from a
Monaco editor; use it when a human is pairing with you.

### Events

Each SSE frame's `data` line is one JSON event `{ id, type, commandId, data }`:

| `type`    | `data`                   | Meaning                                                                                      |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `command` | `{command, instanceId}`  | the owner instance started executing your command                                            |
| `output`  | string                   | one chunk of REPL output, verbatim: result rendering and `console.*` lines alike              |
| `system`  | `{"done":true}`          | your command finished; always the last event for a command id                                |
| `system`  | `{"error":"…"}`          | the command could not run at all (e.g. the session could not be created); the channel stays usable |
| `system`  | `{"ping":true}`          | keep-alive, `commandId: null`; ignore                                                        |

An exception thrown by your code is not an `error` event: it arrives as
`output` text (`Uncaught ReferenceError: nope is not defined\n`), then `done`.

### Vocabulary

Every session is a `@nestjs/core` REPL bound to the whole application:
`get`, `resolve` and `select` are app-wide and non-strict, so a provider from
any module resolves, whichever module hosts the REPL module. Pass the class,
not its name: `get("CatService")` throws `UnknownElementException`.

| Command                                                           | Observed output                           | Use for                                                            |
| ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `get(CatService).findAll()`                                       | `[ 'Tom', 'Felix' ]`                      | call a singleton provider (`$` is an alias of `get`)               |
| `get(CatService)`                                                 | `CatService { cats: [ 'Tom', 'Felix' ] }` | inspect a provider's fields                                        |
| `await resolve(CatService)`                                       | `CatService { cats: [ 'Tom', 'Felix' ] }` | request-scoped or transient providers, which `get` cannot return   |
| `select(AppModule).get(CatService).findAll()`                     | `[ 'Tom', 'Felix' ]`                      | a module-scoped lookup when two modules register the same token    |
| `Object.getOwnPropertyNames(Object.getPrototypeOf(get(CatService)))` | `[ 'constructor', 'findAll' ]`         | list a provider's methods on the stream                            |

`debug()`, `debug(SomeModule)`, `methods(CatService)` and `help()` exist, but
they write to the host process's stdout, not to the REPL output: the stream
shows `command` then `done` with nothing in between. Read them in the app's
console or log, or use the `getOwnPropertyNames` line above when you only
have the stream.

### State between commands

A channel is one session: variables, functions and provider mutations
persist between commands until the channel is released. Verified sequence on
one channel:

| Command                                                                            | Observed output                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `const cats = get(CatService).findAll()`                                           | none: a declaration has no value                                                      |
| `cats.length`                                                                      | `2`                                                                                   |
| `for (const c of cats) console.log(c)`                                             | `Tom`, then `Felix`: one `output` event per line                                      |
| `function shout(name) {\n  return name.toUpperCase() + '!';\n}\nshout(cats[0])`    | `'TOM!'`: a block is ONE command with embedded newlines                                |
| `await new Promise((r) => setTimeout(() => r(cats.map((c) => c.length)), 100))`   | `[ 3, 5 ]`: top-level `await` works                                                   |
| `get(CatService).findAll().push("Garfield"); get(CatService).findAll()`            | `[ 'Tom', 'Felix', 'Garfield' ]`: the provider is the live singleton; the app changed |
| `typeof cats` on another channel                                                   | `'undefined'`: each channel is its own session                                        |

A POST that ends inside an open brace is rejected with `SyntaxError:
incomplete input` and the session moves on: send the whole block in one
command.

### Reading output

The REPL prints an expression's value the way node's REPL does
(`util.inspect`: strings quoted, objects expanded) as one `output` chunk
ending in `\n`; `console.log` lines arrive as their own `output` events, in
order. A statement or declaration whose value is `undefined` prints nothing,
so `done` follows `command` directly. That is success, not a lost result.

## When you need more

- **Authentication:** subclass `RemoteReplController`, decorate it with
  `@UseGuards(...)`, and pass it as `controller:` to `register`/`registerAsync`.
  See "Securing it" in the README.
- **Multiple app instances** (load-balanced replicas): the default in-memory
  transport is per-process. Import a transport from `@remote-repl/redis`:
  `RemoteReplIoRedisTransport` (ioredis) or `RemoteReplNodeRedisTransport`
  (node-redis), and pass it as the `transport` extra:
  `register({ enabled, transport: new RemoteReplIoRedisTransport(client) })`.
  Hand it one connected client; it owns its own subscriber connection.
  `ioredis` / `redis` are optional peers: install the one you use.
- **Two apps on one Redis:** the topics have no origin check, so unrelated
  apps sharing a Redis would exchange REPL output and ownership. Give each
  app's transport its own topic `prefix` (second constructor argument):
  `new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:' })`.
  Replicas of one app share one prefix; apps with different prefixes never
  see each other.
- **Other brokers:** supply a custom transport (a ready instance,
  `{ useClass, imports }`, or `{ useFactory, inject, imports }`) implementing
  `RemoteReplTransport` (`publish`, `subscribe`, optional `close`). See
  "Transport / multi-instance" in the README.
- **Options** (base path, TTLs, heartbeats) and **exported symbols:** "Options"
  and "Exports" in the README.
- **Runnable example:** `REPL_ENABLED=true npm run example` in the repository
  (`packages/nestjs/example/`, which registers `CatService`). Run examples
  with `ts-node`: `tsx`/esbuild strips the decorator metadata NestJS DI
  needs.

## Habits that keep it safe

- Key `enabled` off an environment flag that defaults to off.
- Give each app on a shared Redis its own `prefix`; replicas of one app share
  one.
- Import from one package name per app: `@remote-repl/nestjs` here. The
  `nestjs-web-repl` shim aliases the same objects, but two installs can
  resolve to two copies.
- Run README examples with `ts-node`; missing-provider errors under `tsx`
  are the stripped decorator metadata.
