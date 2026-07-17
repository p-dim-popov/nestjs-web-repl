# nestjs-web-repl

Expose a live NestJS REPL over HTTP — command intake, an SSE output stream, and a
Monaco-based browser UI. Under the hood it drives a real `node:repl` session wired
into your app's Nest DI container, the same way `nest start --entrypoint repl` does,
so `get(SomeService)`, `resolve(...)`, `select(...)`, and friends all work exactly as
they do in the local REPL — except reachable over HTTP, from anywhere, against a
running server.

> ## ⚠️ Security warning — read this before enabling anything
>
> **These endpoints execute arbitrary code inside your running application.**
> A command like `require('child_process').execSync('...')` runs with the full
> privileges of your Node process. This library ships with **no authentication,
> no authorization, and no rate limiting**. The `enabled` option is the *only*
> built-in safety rail, and it is a blunt boolean — it does not check who is
> asking.
>
> Do not expose these routes on a public-facing port. Do not enable this in
> production unless you have put your own auth in front of it (see
> [Securing it](#securing-it) below). Treat this exactly like you would treat
> giving someone a shell on your server — because that is what it is.

## Install

```bash
npm install nestjs-web-repl
```

## Quick start

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

Boot the app with `REPL_ENABLED=true` and open `http://localhost:3000/repl/dev/ui`
(`dev` here is just a channel name — see [Endpoints](#endpoints)). Type a command
and press `Ctrl+Enter`. The REPL context is app-wide: `get(SomeProviderFromAnyModule)`
resolves from the whole DI container, not just the module that imports
`WebReplModule`.

A runnable example lives in [`example/`](./example): `example/cat.service.ts`
registers a trivial `CatService`, `example/app.module.ts` wires up
`WebReplModule.forRoot(...)`, and `example/main.ts` boots it. Run it with:

```bash
REPL_ENABLED=true PORT=3000 npx ts-node -T example/main.ts
# or, from a checkout of this repo: REPL_ENABLED=true PORT=3000 npm run example
```

> Use `ts-node` (not `tsx`/esbuild-based runners) to run TypeScript sources
> directly: Nest's DI resolves constructor parameter types from
> `emitDecoratorMetadata` output, and esbuild-based transpilers do not emit
> it the way `tsc`/`ts-node` do, which breaks provider injection at runtime.

then, in the UI (or via `curl`, see below), run:

```ts
get(CatService).findAll()
// -> [ 'Tom', 'Felix' ]
```

## Endpoints

Every endpoint is namespaced under a `:channel` path segment. A channel is an
arbitrary string you choose (`dev`, `prod-debug`, your username — whatever); each
channel gets its own isolated REPL session (its own variables, its own history),
and is how multiple people/tabs can share or separate REPL state.

- **`POST /repl/:channel`** — body `{ "command": "get(CatService).findAll()" }`.
  Dispatches the command for execution and returns immediately:
  `202 { "accepted": true, "commandId": "cmd_..." }`. The actual result arrives
  asynchronously over the SSE stream below.
- **`GET /repl/:channel`** — a Server-Sent-Events stream of what happens on that
  channel. Supports `Last-Event-ID` for replay (a bounded ring buffer, default
  200 events, backs each channel) so a reconnecting client doesn't miss output.
  Each SSE message is JSON with `{ id, type, commandId, data }`, where `type` is
  one of:
  - **`command`** — echoes a dispatched command back out. `data` is
    `{ command, instanceId }` (the instance that is about to run it).
  - **`output`** — a chunk of REPL output. **`data` is the raw output string**
    (not `{ chunk: ... }` — just the string itself), exactly as `node:repl`
    wrote it (including `console.log` output and the inspected return value).
  - **`system`** — control/status notices. `data` varies by shape:
    - `{ ping: true }` — a heartbeat, `id: 0`, sent on `heartbeatInterval` (default
      15s) purely to keep the connection alive. Not buffered for replay.
    - `{ done: true }` — sent once after a command's output finishes, since
      silent statements (`const v = 10`) produce no `output` events at all and
      clients otherwise have no way to know a command has finished.
    - `{ error: string }` — a command failed to execute (e.g. the REPL context
      factory threw); the channel stays usable afterward.
- **`GET /repl/:channel/ui`** — an HTML page: an output pane fed by the SSE
  stream above, plus a Monaco editor for composing/sending commands
  (`Ctrl+Enter` or the Run button posts to the endpoint above).

### Try it with curl

```bash
# stream (leave running in one terminal)
curl -N http://localhost:3000/repl/dev

# in another terminal, dispatch a command
curl -X POST http://localhost:3000/repl/dev \
  -H 'content-type: application/json' \
  -d '{"command":"get(CatService).findAll()"}'
```

## Securing it

Because the module ships no auth, the supported way to lock this down is to
disable the built-in controller and register your own subclass with guards:

```ts
import { Controller, UseGuards } from '@nestjs/common';
import { WebReplController } from 'nestjs-web-repl';
import { AdminGuard } from './admin.guard';

@Controller('internal/repl')
@UseGuards(AdminGuard)
export class SecureReplController extends WebReplController {}
```

```ts
@Module({
  imports: [
    WebReplModule.forRoot({
      enabled: process.env.REPL_ENABLED === 'true',
      registerController: false, // don't register the unguarded default controller
    }),
  ],
  controllers: [SecureReplController], // register yours instead
})
export class AppModule {}
```

> **Note:** `registerController: false` only takes effect via the synchronous
> `forRoot(...)`. `forRootAsync(...)` always registers the default,
> **unguarded** `WebReplController`, because whether to declare a controller is
> a static, module-definition-time decision in Nest, and `forRootAsync`'s
> options aren't resolved until DI runs (after controllers are already fixed).
> If you need async configuration (e.g. options from a `ConfigService`) *and*
> a guarded controller, resolve your options synchronously up front (read env
> vars / config directly) and call `forRoot(...)`, or put a guard in front of
> the route at the HTTP-adapter/middleware level instead.

## Adapter / multi-instance

If you run more than one instance of your app (multiple processes, pods,
etc.), each instance would otherwise get its own isolated in-memory REPL —
confusing if you dispatch a command from one browser tab and it lands on a
different instance than the one holding your session's variables. Web-repl
solves this with an **ownership + fan-out** protocol:

- The **first instance** to see a command for a given channel claims
  ownership of that channel (broadcasting an internal `claim` message on the
  `webrepl:sys` adapter topic — not a client-visible SSE event; see
  [Endpoints](#endpoints)) and is the only instance that actually runs
  commands on it from then on.
- Every instance still receives and displays that channel's `output` events
  (via fan-out), so any tab watching that channel's SSE stream sees the same
  output regardless of which instance it's connected to.
- A channel's ownership is released after `sessionTtl` (default 30 minutes)
  of inactivity, freeing it to be re-claimed by whichever instance next
  receives a command for it.
- Because ownership is decided by whichever instance's `onCmd` handler runs
  first, two instances racing to claim the same brand-new channel at the
  same instant resolve **last-claim-wins** (see [Limitations](#limitations-v1)).

By default this coordination happens via `InMemoryWebReplAdapter`, which only
works within a single process (fine for local dev / single-instance
deployments). For real multi-instance deployments, provide your own adapter
that implements:

```ts
export interface WebReplAdapter {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string, handler: (message: string) => void): Promise<void>;
  onModuleDestroy?(): void | Promise<void>;
}
```

`message` is always a JSON string (already serialized by the library — your
adapter just needs to move opaque strings around, not parse them). Three
fixed topics are used: `webrepl:cmd`, `webrepl:out`, `webrepl:sys`. The
`webrepl:sys` topic carries internal `claim`/`release` ownership-coordination
messages between instances — these are never forwarded to SSE clients (they
are distinct from, and not to be confused with, the client-visible `system`
*SSE event type* documented under [Endpoints](#endpoints), which only ever
carries `{ping}`/`{done}`/`{error}`).

### Redis adapter sketch

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { WebReplAdapter } from 'nestjs-web-repl';

@Injectable()
export class RedisWebReplAdapter implements WebReplAdapter, OnModuleDestroy {
  private readonly pub = new Redis(process.env.REDIS_URL);
  private readonly sub = new Redis(process.env.REDIS_URL);

  async publish(topic: string, message: string): Promise<void> {
    await this.pub.publish(topic, message);
  }

  async subscribe(topic: string, handler: (message: string) => void): Promise<void> {
    await this.sub.subscribe(topic);
    this.sub.on('message', (channel, message) => {
      if (channel === topic) handler(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
```

```ts
WebReplModule.forRoot({
  enabled: process.env.REPL_ENABLED === 'true',
  adapter: new RedisWebReplAdapter(),
  instanceId: process.env.HOSTNAME, // shows up in `command` SSE events and
                                     // internal webrepl:sys claim messages
});
```

## Options (`WebReplModuleOptions`)

| Option              | Type             | Default                    | Notes                                              |
| ------------------- | ---------------- | --------------------------- | --------------------------------------------------- |
| `enabled`           | `boolean`        | *(required)*                | When `false`, the module registers nothing at all.  |
| `adapter`           | `WebReplAdapter` | `InMemoryWebReplAdapter`    | Provide for multi-instance coordination.            |
| `instanceId`        | `string`         | random `inst_xxxxxxxx`      | Shown in `command` SSE events and internal `webrepl:sys` claim/release messages. |
| `sessionTtl`        | `number` (ms)    | `1_800_000` (30 min)        | Idle time before a channel's ownership is released. |
| `replayBufferSize`  | `number`         | `200`                       | Events kept per channel for SSE `Last-Event-ID` replay. |
| `heartbeatInterval` | `number` (ms)    | `15_000`                    | SSE `system` `{ ping: true }` interval.             |
| `registerController`| `boolean`        | `true`                      | Set `false` to omit the default controller (see [Securing it](#securing-it)). `forRoot` only. |

`WebReplModule.forRootAsync({ useFactory, inject, imports })` is also available
for options that need DI (e.g. reading a `ConfigService`); see the
`registerController` caveat above.

## Exports

`WebReplModule`, `WebReplController`, `WebReplService`, `InMemoryWebReplAdapter`,
and the types `WebReplAdapter`, `WebReplModuleOptions`, `WebReplModuleAsyncOptions`,
`WebReplEvent`, `SseEventType`.

## Limitations (v1)

- **Monaco loads from a CDN** (`cdn.jsdelivr.net`) inside the `/ui` page — the
  *browser* needs internet access to load the editor; the server side has no
  such dependency.
- **No autocomplete / IntelliSense** against your actual providers — Monaco
  is configured for plain TypeScript syntax highlighting only, not a live
  language service.
- **No session persistence.** REPL sessions (and their variables) live only
  in process memory; a restart of the owning instance loses all channel
  state, including the replay buffer.
- **Ownership races are last-claim-wins.** If two instances receive the very
  first command for a brand-new channel at nearly the same time, both may
  briefly believe they own it; whichever internal `claim` message (on the
  `webrepl:sys` adapter topic) is processed last by the group determines the
  actual owner going forward. This is a narrow window (first command on a
  channel only) but is not fully resolved by the protocol as implemented.
- **Relies on a deep import of `@nestjs/core` internals**
  (`@nestjs/core/nest-application-context`, `@nestjs/core/repl/repl-context`)
  to build an app-wide REPL context, since only the `repl()` bootstrap
  function itself is part of `@nestjs/core`'s public entrypoint. This is
  pinned by the package's `@nestjs/core` peer range; a future `@nestjs/core`
  major that relocates these modules could break it.
