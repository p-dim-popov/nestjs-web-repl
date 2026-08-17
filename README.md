# nestjs-web-repl

Expose a live NestJS REPL over HTTP. The module gives you a command endpoint, an
SSE output stream, and a Monaco-based browser UI. It drives a real `node:repl`
session that is connected to the Nest DI container of your app, in the same way as
`nest start --entrypoint repl`. The helpers `get(SomeService)`, `resolve(...)`,
`select(...)`, and the others work as they do in the local REPL. The difference is
that you reach the REPL over HTTP, against a running server.

> ## ⚠️ Security
>
> This module runs code inside your app with the full privileges of the Node
> process. It ships no authentication. `enabled` is an on/off switch, not a lock.
> Gate `enabled` behind an environment variable and put your own guard in front of
> the routes. See [Securing it](#securing-it).

## Install

```bash
npm install nestjs-web-repl
```

The module requires Node 20+ and NestJS 10 or 11.

> **Upgrading from 1.x?** The `forRoot`/`forRootAsync` API is deprecated. v2 uses
> `register`/`registerAsync`. See [Quick start](#quick-start) and
> [Securing it](#securing-it).

## Live demo

You can try the REPL without an install. The link below opens a full NestJS app
that runs the REPL in a StackBlitz sandbox. The editor and the app run in your
browser. Nothing touches a shared server.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/p-dim-popov/nestjs-web-repl/tree/main/examples/stackblitz)

The first boot takes about 30–60 seconds for the dependency install and startup.
After that, the REPL is live. The [demo project](./examples/stackblitz) and its
[command cheatsheet](./examples/stackblitz/TRY-THESE.md) are in
`examples/stackblitz/`.

## Quick start

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

Start the app with `REPL_ENABLED=true` and open `http://localhost:3000/repl/dev/ui`.
Here `dev` is a channel name. See [Endpoints](#endpoints). Type a command and press
`Ctrl+Enter`. The REPL context is app-wide. `get(SomeProviderFromAnyModule)`
resolves from the whole DI container, not only from the module that imports
`WebReplModule`.

A runnable example is in [`example/`](./example). `example/cat.service.ts`
registers a small `CatService`. `example/app.module.ts` calls
`WebReplModule.register(...)`. `example/main.ts` starts the app. Run it with:

```bash
REPL_ENABLED=true PORT=3000 npx ts-node -T example/main.ts
# or, from a checkout of this repo: REPL_ENABLED=true PORT=3000 npm run example
```

> Use `ts-node` to run the TypeScript sources directly. Do not use `tsx` or other
> esbuild-based runners. Nest DI reads constructor parameter types from
> `emitDecoratorMetadata` output. Esbuild-based transpilers do not emit that output
> in the same way as `tsc` and `ts-node`, so provider injection fails at runtime.

Then, in the UI or with `curl` (see below), run:

```ts
get(CatService).findAll()
// -> [ 'Tom', 'Felix' ]
```

## Endpoints

Every endpoint except the bare `/repl` redirect has a `:channel` path segment. A
channel is a string that you choose, for example `dev`, `prod-debug`, or your
username. Each channel gets its own REPL session with its own variables and its own
history. Channels are how multiple people or tabs share or separate REPL state.

- **`GET /repl`** — no channel. The server generates a random 8-character channel
  name and redirects (`302`) to the UI of that channel. The name is not a secret.
  It only keeps two visitors from a collision by default. Your guard is the only
  access control.
- **`POST /repl/:channel`** — body `{ "command": "get(CatService).findAll()" }`.
  The server dispatches the command and returns at once:
  `202 { "accepted": true, "commandId": "cmd_..." }`. The result arrives later over
  the SSE stream below.
- **`GET /repl/:channel`** — a Server-Sent-Events stream of the activity on that
  channel. It supports `Last-Event-ID` for replay. A bounded ring buffer (default
  200 events) backs each channel, so a client that reconnects does not miss output.
  Each SSE message is JSON with `{ id, type, commandId, data }`. `type` is one of:
  - **`command`** — echoes a dispatched command. `data` is
    `{ command, instanceId }`, where `instanceId` is the instance that will run it.
  - **`output`** — a chunk of REPL output. **`data` is the raw output string**, not
    `{ chunk: ... }`. It is the exact text that `node:repl` wrote, which includes
    `console.log` output and the inspected return value.
  - **`system`** — control and status notices. `data` has one of these shapes:
    - `{ ping: true }` — a heartbeat with `id: 0`, sent every `heartbeatInterval`
      (default 15 s) to keep the connection alive. The buffer does not keep it for
      replay.
    - `{ done: true }` — sent once after the output of a command ends. Silent
      statements such as `const v = 10` produce no `output` events. This event is
      then the only signal that the command has finished.
    - `{ error: string }` — a command did not execute, for example because the
      REPL context factory threw. The channel stays usable after this.
- **`GET /repl/:channel/ui`** — an HTML page with an output pane fed by the SSE
  stream above, plus a Monaco editor to write and send commands. `Ctrl+Enter` or
  the Run button posts to the endpoint above.
- **`GET /repl/:channel/vs/*`** — the files of the Monaco editor. The package
  bundles them and your app serves them, so the browser needs no internet access.
  The UI page loads the editor from this path. A proxy or path allowlist in front
  of the app must let this path through, or the editor does not load.

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

The module ships no auth. The supported way to lock it down is to subclass the
built-in controller, add your own guard, and pass the subclass through the
`controller` extra:

```ts
import { Controller, UseGuards } from '@nestjs/common';
import { WebReplController } from 'nestjs-web-repl';
import { AdminGuard } from './admin.guard';

@Controller('internal/repl')
@UseGuards(AdminGuard)
class SecureReplController extends WebReplController {}
```

```ts
@Module({
  imports: [
    WebReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
      controller: SecureReplController, // replaces the unguarded default controller
    }),
  ],
})
export class AppModule {}
```

`controller` is available in both `register` and `registerAsync`. It is a static
choice made at module definition time, so you pass it next to
`useFactory`/`inject`, not inside the factory result:

```ts
WebReplModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('REPL_ENABLED') === 'true',
  }),
  controller: SecureReplController,
});
```

### How the browser UI authenticates

Your guard runs in front of every route: the UI page, the SSE stream, the command
POST, the Monaco assets, and the redirect. The bundled UI sends only what a browser
attaches on its own to a **same-origin** request. That is **cookies**, and
**HTTP auth credentials** from a `WWW-Authenticate` challenge. It sets no
`Authorization` header of its own. The SSE stream uses `EventSource`, which cannot
send custom headers. This leaves three protections that work:

- **Cookie/session auth.** The UI is served from the same origin that it calls.
  A session cookie therefore rides along on the page load, the SSE connection,
  and every command. One caveat: the UI sends no CSRF token. Authenticate from the session
  itself and do not require a CSRF token on these routes.
- **HTTP Basic auth.** Make the guard respond `401` with a
  `WWW-Authenticate: Basic realm="repl"` header. The browser asks for credentials
  once, then attaches `Authorization: Basic ...` to every later request, which
  includes the `EventSource` connection. In Nest, set that header on the response
  explicitly. `UnauthorizedException` alone does not send it, and without it the
  browser never asks.
- **A network-level control.** An IP allowlist, mTLS, or a VPN.

A bearer-token guard rejects the UI, because the browser cannot produce the token.
It still works for direct `curl` clients, where you set the header yourself.

## Adapter / multi-instance

If you run more than one instance of your app (multiple processes, pods, and so
on), each instance would get its own in-memory REPL. A command from one browser
tab can then land on one instance, while another instance holds the variables of
your session. Web-repl solves this with an **ownership + fan-out** protocol:

- The **first instance** to see a command for a channel claims ownership of that
  channel. It broadcasts an internal `claim` message on the `webrepl:sys` adapter
  topic. This is not a client-visible SSE event (see [Endpoints](#endpoints)).
  From then on, only the owner runs commands on that channel.
- Every instance still receives and shows the `output` events of that channel
  through fan-out. Any tab that watches the SSE stream of that channel sees the
  same output, no matter which instance it is connected to.
- The ownership of a channel is released after `sessionTtl` (default 30 minutes)
  without activity. The next instance that receives a command for it can then
  claim it.
- Ownership is also a **lease**. The owner re-announces `claim` for every channel
  it owns every `ownerHeartbeatInterval` (default 10 s). If the owner of a channel sends no
  claim or heartbeat within `ownerLeaseTtl` (default 30 s), the channel counts as
  ownerless. A crash of that instance is one cause. The
  origin instance of the next command for it takes over. The module enforces
  `ownerLeaseTtl >= ownerHeartbeatInterval * 2` and clamps the value up with a
  warning if it is lower. A live owner therefore always has a full heartbeat
  interval of slack against publish or delivery jitter, and is never preempted
  this way. A takeover loses the in-memory variables of that channel, because the
  session of the dead owner is gone. It restores availability instead of a
  channel that is stuck fleet-wide (see [Limitations](#limitations)).
- Ownership goes to the instance whose `onCmd` handler runs first. If two
  instances race to claim the same new channel at the same instant, the result is
  **last-claim-wins** (see [Limitations](#limitations)).

By default, this coordination uses `InMemoryWebReplAdapter`, which only works
inside one process. That is fine for local development and single-instance
deployments. For real multi-instance deployments, provide your own adapter through
the `adapter` extra. Pass a ready instance, `{ useClass, imports }`, or
`{ useFactory, inject, imports }`. All three forms are DI-capable, so the adapter
can depend on other providers. The adapter implements:

```ts
export interface WebReplAdapter {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string, handler: (message: string) => void): Promise<void>;
  onModuleDestroy?(): void | Promise<void>;
}
```

`message` is always a JSON string that the library has already serialized. Your
adapter only moves opaque strings. It does not parse them. The library uses three
fixed topics: `webrepl:cmd`, `webrepl:out`, `webrepl:sys`. The `webrepl:sys` topic
carries internal `claim`/`release` ownership messages between instances. The
library never forwards them to SSE clients. Do not confuse them with the
client-visible `system` *SSE event type* under [Endpoints](#endpoints), which only
carries `{ping}`, `{done}`, or `{error}`.

### Redis (multi-instance)

Behind a load balancer, the default in-memory adapter is per-process. A command
posted to one replica never reaches a session that another replica owns. Supply a
Redis adapter so that every replica shares one pub/sub bus. Import it from the
`nestjs-web-repl/redis` subpath and give it one connected client. The adapter
creates its own subscriber connection, because Redis requires a dedicated
connection for subscribe mode. On shutdown, it closes only that connection. Your
client stays yours.

**ioredis:**

```ts
import Redis from 'ioredis';
import { WebReplModule } from 'nestjs-web-repl';
import { IoRedisWebReplAdapter } from 'nestjs-web-repl/redis';

WebReplModule.register({
  enabled: process.env.REPL_ENABLED === 'true',
  adapter: new IoRedisWebReplAdapter(new Redis(process.env.REDIS_URL!)),
});
```

**node-redis:**

```ts
import { createClient } from 'redis';
import { WebReplModule } from 'nestjs-web-repl';
import { NodeRedisWebReplAdapter } from 'nestjs-web-repl/redis';

WebReplModule.register({
  enabled: process.env.REPL_ENABLED === 'true',
  adapter: {
    useFactory: async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      await client.connect();
      return new NodeRedisWebReplAdapter(client);
    },
  },
});
```

`ioredis` and `redis` are optional peer dependencies. Install the one that you use.
Both adapters extend a small shared base. To target another broker, subclass
`BaseRedisWebReplAdapter` or implement `WebReplAdapter` directly.

The `adapter` extra also accepts a DI-configured provider, `{ useClass, imports? }`
or `{ useFactory, inject?, imports? }`. A custom adapter can then get its own
dependencies, such as a shared client or a config service, from a Nest module. See
the [extras table](#options-webreplmoduleoptions) below.

## Options (`WebReplModuleOptions`)

| Option              | Type             | Default                    | Notes                                              |
| ------------------- | ---------------- | --------------------------- | --------------------------------------------------- |
| `enabled`           | `boolean`        | *(required)*                | When `false`, the routes return 404 and the module does not subscribe to the adapter. |
| `instanceId`        | `string`         | random `inst_xxxxxxxx`      | Shown in `command` SSE events and in internal `webrepl:sys` claim/release messages. |
| `sessionTtl`        | `number` (ms)    | `1_800_000` (30 min)        | Idle time before the module releases the ownership of a channel. |
| `replayBufferSize`  | `number`         | `200`                       | Events kept per channel for SSE `Last-Event-ID` replay. |
| `heartbeatInterval` | `number` (ms)    | `15_000`                    | Interval of the SSE `system` `{ ping: true }` event. |
| `ownerHeartbeatInterval` | `number` (ms) | `10_000`                | How often an instance re-announces `claim` for each channel it owns. This keeps its ownership lease alive. |
| `ownerLeaseTtl`     | `number` (ms)    | `30_000`                    | How long an ownership record stays valid after the last claim or heartbeat. After that, another instance can take over the channel. The minimum is `ownerHeartbeatInterval * 2`. If the value is lower, the module clamps it up to that minimum and logs a warning. It never throws. |

`register`/`registerAsync` also accept two "extras". You pass them next to the
options above, or next to `useFactory`/`inject`/`imports` for the async form, not
inside them. Both are static choices made at module definition time:

| Extra        | Type                  | Default              | Notes                                              |
| ------------ | --------------------- | --------------------- | --------------------------------------------------- |
| `controller` | `Type<WebReplController>` | built-in `WebReplController` | Bring your own controller (subclass + guards). See [Securing it](#securing-it). |
| `adapter`    | `WebReplAdapter \| Type<WebReplAdapter> \| { useClass, imports? } \| { useFactory, inject?, imports? }` | `InMemoryWebReplAdapter` | Multi-instance coordination. See [Adapter / multi-instance](#adapter--multi-instance). |

`WebReplModule.registerAsync({ useFactory, inject, imports, controller?, adapter? })`
is available for options that need DI, for example to read a `ConfigService`.

## Exports

`WebReplModule`, `WebReplController`, `WebReplService`, `InMemoryWebReplAdapter`,
and `WEB_REPL_OPTIONS`. `WEB_REPL_OPTIONS` is the DI token for the resolved
options. Use it to inject the options into a controller subclass that you register
next to the module. The package also exports the types `WebReplAdapter`,
`WebReplModuleOptions`, `WebReplModuleExtras`, `WebReplAdapterConfig`,
`WebReplEvent`, and `SseEventType`.

## AI skill

This package ships a [Claude Code](https://claude.com/claude-code) skill that
teaches coding agents how to install and use the REPL safely. After you install the
package, run:

```bash
npx nestjs-web-repl install-skill
```

This writes `.claude/skills/nestjs-web-repl/SKILL.md` into your project. Your agent
picks it up in its next session. The command never overwrites a modified skill file
without a flag. If you have edited the file, run the command again with `--force`
to refresh it after a package upgrade.

## Limitations

- **No autocomplete or IntelliSense** against your providers. Monaco is configured
  for plain TypeScript syntax highlighting only, not for a live language service.
- **No session persistence.** REPL sessions and their variables live only in
  process memory. A restart of the owner instance loses all channel state, which
  includes the replay buffer.
- **Ownership races are last-claim-wins.** If two instances receive the first
  command for a new channel at almost the same time, both can briefly believe that
  they own it. The internal `claim` message (on the `webrepl:sys` adapter topic)
  that the group processes last decides the owner from then on. This window is
  narrow. It only exists for the first command on a channel. The protocol as
  implemented does not fully resolve it.
- **The channel of a crashed or restarted owner is taken over, but loses its
  in-memory variables.** Ownership is a lease (see
  [Adapter / multi-instance](#adapter--multi-instance)). A live owner keeps it
  alive with `claim` heartbeats every `ownerHeartbeatInterval`. If the owner of a
  channel crashes or restarts without a clean shutdown, its heartbeats stop. After
  `ownerLeaseTtl`, the origin instance of the next command for that channel takes
  over and starts a fresh session. The variables of the dead session are gone. The
  channel becomes usable again instead of stuck fleet-wide. This is better than a
  permanent stuck channel, but it is still a data loss on unclean owner death. Like
  last-claim-wins above, it is a narrow multi-instance edge case.
- **The module relies on a deep import of `@nestjs/core` internals**
  (`@nestjs/core/nest-application-context`, `@nestjs/core/repl/repl-context`) to
  build an app-wide REPL context. Only the `repl()` bootstrap function itself is
  part of the public entrypoint of `@nestjs/core`. The peer range of the package
  pins `@nestjs/core`. A future `@nestjs/core` major that moves these modules can
  break it.

## How this was built (transparency)

An AI agent (Claude Code) built this library under human direction. The workflow was
plan-first and test-driven: a written spec and implementation plan, then
task-by-task implementation. A separate agent reviewed each task before the next
one started, and the fixes went in first. A whole-repository review followed.

We tell you this so that you can judge the code on its merits and not guess at its
origins. If you are skeptical of AI-written code, look at these things:

- **The tests.** A thorough automated suite. It includes a two-instance end-to-end
  test that proves cross-instance command routing and output fan-out. It also
  includes an execution-proof test that resolves a real provider through the live
  REPL context. `npm test`, `npm run build`, and the typecheck all run green in CI.
- **The commit history.** The TDD trail is preserved: failing test,
  implementation, fixes. It includes several rounds where review caught real
  defects. The hardest two were `node:repl` completion detection on modern Node,
  and a runtime-vs-registration security bug. An earlier async-registration API
  could have shipped the arbitrary-code endpoint live with `enabled: false`.
  `registerAsync` now enforces `enabled` at runtime instead.
- **The security invariants.** They are documented in [`AGENTS.md`](./AGENTS.md)
  and enforced by tests, not left as prose.

AI assistance does not exempt the code from scrutiny. It raises the bar for it.
Issues and fixes are welcome from anyone who finds something we missed.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). AI-assisted
PRs are fine. We only ask that you disclose the assistance and that you understand
what you submit. Agents that work in this repo should start with
[`AGENTS.md`](./AGENTS.md).

PRs merge as a single squash commit. Its message is the **PR title and
description**, and that commit drives an automated release. Write the PR title as a
[Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`docs:`, and so on) so that the version bump is correct. Put any `BREAKING CHANGE:`
note in the description.

## License

[MIT](./LICENSE) © Petar Popov
