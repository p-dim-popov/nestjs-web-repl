# nestjs-web-repl

Expose a live NestJS REPL over HTTP — command intake, an SSE output stream, and a
Monaco-based browser UI. Under the hood it drives a real `node:repl` session wired
into your app's Nest DI container, the same way `nest start --entrypoint repl` does,
so `get(SomeService)`, `resolve(...)`, `select(...)`, and friends all work exactly as
they do in the local REPL — except reachable over HTTP, from anywhere, against a
running server.

> ## ⚠️ Security
>
> These endpoints run arbitrary code inside your app, with the full privileges of
> your Node process. That's the whole point — it's a debugging tool — and it's
> also the risk: anyone who can reach an enabled endpoint can run anything your
> app can.
>
> The module ships no authentication of its own; `enabled` is an on/off switch,
> not a lock. Control access yourself: gate `enabled` behind an environment
> variable and put your own guard in front of the routes ([Securing it](#securing-it)).
>
> Guarded and on a trusted network, it's a safe way to inspect a running app.

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
    WebReplModule.register({
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
`WebReplModule.register(...)`, and `example/main.ts` boots it. Run it with:

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
subclass the built-in controller, add your own guard, and pass it in via the
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

`controller` is available to both `register` and `registerAsync` — it is a
static, module-definition-time choice, so it's passed alongside `useFactory`/
`inject` rather than resolved by it:

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
- Ownership is also a **lease**: the owning instance re-announces `claim`
  for every channel it owns every `ownerHeartbeatInterval` (default 10s). If
  no claim/heartbeat has been seen for a channel's owner in `ownerLeaseTtl`
  (default 30s) — because that instance crashed or was killed without a
  clean shutdown — the channel is treated as effectively ownerless, and the
  origin instance of the next command for it takes over. `ownerLeaseTtl` is
  enforced to be at least `ownerHeartbeatInterval * 2` (clamped up with a
  warning otherwise), so a live owner always has a full heartbeat interval
  of slack against publish/delivery jitter — a live, heartbeating owner is
  never preempted this way. Takeover loses that channel's in-memory
  variables (the dead owner's session is gone) but restores availability
  instead of leaving the channel wedged fleet-wide (see
  [Limitations](#limitations-v1)).
- Because ownership is decided by whichever instance's `onCmd` handler runs
  first, two instances racing to claim the same brand-new channel at the
  same instant resolve **last-claim-wins** (see [Limitations](#limitations-v1)).

By default this coordination happens via `InMemoryWebReplAdapter`, which only
works within a single process (fine for local dev / single-instance
deployments). For real multi-instance deployments, provide your own adapter
via the `adapter` extra — a ready instance, `{ useClass, imports }`, or
`{ useFactory, inject, imports }` (all DI-capable, so the adapter can itself
depend on other providers) — that implements:

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

### Redis (multi-instance)

Behind a load balancer the default in-memory adapter is per-process: a command
posted to one replica never reaches a session owned by another. Supply a Redis
adapter so every replica shares one pub/sub bus. Import it from the
`nestjs-web-repl/redis` subpath and hand it one connected client — the adapter
creates its own dedicated subscriber connection (Redis requires one for subscribe
mode) and closes only that connection on shutdown; your client stays yours.

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

`ioredis` and `redis` are optional peer dependencies — install whichever you use.
Both adapters wrap a small shared base; to target another broker, subclass
`BaseRedisWebReplAdapter` or implement `WebReplAdapter` directly.

The `adapter` extra also accepts a DI-configured provider — `{ useClass, imports? }`
or `{ useFactory, inject?, imports? }` — so a custom adapter can pull its own
dependencies (a shared client, a config service) from a Nest module. See the
[extras table](#options-webreplmoduleoptions) below.

## Options (`WebReplModuleOptions`)

| Option              | Type             | Default                    | Notes                                              |
| ------------------- | ---------------- | --------------------------- | --------------------------------------------------- |
| `enabled`           | `boolean`        | *(required)*                | When `false`, routes 404 and the module does not subscribe to the adapter. |
| `instanceId`        | `string`         | random `inst_xxxxxxxx`      | Shown in `command` SSE events and internal `webrepl:sys` claim/release messages. |
| `sessionTtl`        | `number` (ms)    | `1_800_000` (30 min)        | Idle time before a channel's ownership is released. |
| `replayBufferSize`  | `number`         | `200`                       | Events kept per channel for SSE `Last-Event-ID` replay. |
| `heartbeatInterval` | `number` (ms)    | `15_000`                    | SSE `system` `{ ping: true }` interval.             |
| `ownerHeartbeatInterval` | `number` (ms) | `10_000`                | How often an instance re-announces `claim` for each channel it owns, keeping its ownership lease alive. |
| `ownerLeaseTtl`     | `number` (ms)    | `30_000`                    | How long an ownership record is trusted since the last claim/heartbeat, before a stale owner's channel may be taken over. Enforced minimum `ownerHeartbeatInterval * 2` (a live owner always keeps a full heartbeat interval of slack against delivery jitter); if the configured value is below that, it's clamped up to `ownerHeartbeatInterval * 2` and a warning is logged (never throws). |

`register`/`registerAsync` also accept two "extras", passed alongside the
options above (or alongside `useFactory`/`inject`/`imports` for the async
form) rather than through them, since both are static, module-definition-time
choices:

| Extra        | Type                  | Default              | Notes                                              |
| ------------ | --------------------- | --------------------- | --------------------------------------------------- |
| `controller` | `Type<WebReplController>` | built-in `WebReplController` | Bring your own controller (subclass + guards). See [Securing it](#securing-it). |
| `adapter`    | `WebReplAdapter \| Type<WebReplAdapter> \| { useClass, imports? } \| { useFactory, inject?, imports? }` | `InMemoryWebReplAdapter` | Multi-instance coordination. See [Adapter / multi-instance](#adapter--multi-instance). |

`WebReplModule.registerAsync({ useFactory, inject, imports, controller?, adapter? })`
is also available for options that need DI (e.g. reading a `ConfigService`).

## Exports

`WebReplModule`, `WebReplController`, `WebReplService`, `InMemoryWebReplAdapter`,
and `WEB_REPL_OPTIONS` (the DI token for the resolved options, useful when
injecting them into a sibling-registered controller subclass), plus the types
`WebReplAdapter`, `WebReplModuleOptions`, `WebReplModuleExtras`,
`WebReplAdapterConfig`, `WebReplEvent`, `SseEventType`.

## Migrating from 1.x → 2.0

- `WebReplModule.forRoot(...)` → `WebReplModule.register(...)`.
- `WebReplModule.forRootAsync(...)` → `WebReplModule.registerAsync(...)`.
- `adapter` is no longer an option resolved by `useFactory`; it's a static
  "extra" passed alongside the options (or alongside `useFactory`/`inject` for
  the async form), and now also accepts `{ useClass, imports? }` or
  `{ useFactory, inject?, imports? }` in addition to a ready instance — see
  [Adapter / multi-instance](#adapter--multi-instance).
- `registerController: false` is gone. To run your own guarded controller
  instead of the default, subclass `WebReplController`, add `@UseGuards(...)`,
  and pass it as the `controller` extra to `register`/`registerAsync` — see
  [Securing it](#securing-it). Unlike the old `registerController` flag, this
  works identically for both the sync and async form.
- A disabled module (`enabled: false`) now still registers the
  controller/service, but every route 404s and the module never subscribes to
  the adapter — it no longer silently registers nothing. If you were relying
  on a disabled module contributing zero routes/providers to the Nest module
  graph, that is no longer the case.

## AI skill

This package ships a [Claude Code](https://claude.com/claude-code) skill that
teaches coding agents how to wire in and use the REPL safely. After installing
the package, run:

```bash
npx nestjs-web-repl install-skill
```

This writes `.claude/skills/nestjs-web-repl/SKILL.md` into your project; your
agent picks it up on its next session. The command never clobbers a modified
skill file silently — if you have edited it, re-run with `--force` to refresh it
after upgrading the package.

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
- **A crashed/restarted owner's channel is taken over, not wedged forever,
  but loses its in-memory variables.** Ownership is a lease (see
  "Multi-instance ownership" above): a live owner keeps it alive with
  `claim` heartbeats every `ownerHeartbeatInterval`. If the instance that
  owns a channel crashes or is restarted instead of shutting down cleanly,
  it stops heartbeating, and after `ownerLeaseTtl` the origin instance of
  the next command for that channel takes over — starting a fresh session.
  Any variables declared in the dead owner's session are gone; the channel
  itself becomes usable again rather than being wedged fleet-wide. This is
  strictly better than a permanent wedge, but it is still a data loss on
  unclean owner death, and (like last-claim-wins above) a narrow multi-
  instance edge case worth knowing about.
- **Relies on a deep import of `@nestjs/core` internals**
  (`@nestjs/core/nest-application-context`, `@nestjs/core/repl/repl-context`)
  to build an app-wide REPL context, since only the `repl()` bootstrap
  function itself is part of `@nestjs/core`'s public entrypoint. This is
  pinned by the package's `@nestjs/core` peer range; a future `@nestjs/core`
  major that relocates these modules could break it.

## How this was built (transparency)

This library was built with AI assistance — specifically, an agent (Claude
Code) driving a plan-first, test-driven workflow under human direction: a
written spec and implementation plan, then task-by-task implementation where
each task was implemented, independently reviewed by a separate agent, and
fixed before the next, followed by a whole-repository review.

We tell you this because the honest thing to do is let you judge the code on
its merits rather than guess at its origins. If you are skeptical of AI-written
code, here is what to actually look at:

- **The tests.** 99 automated tests, including a two-instance end-to-end test
  that proves cross-instance command routing and output fan-out, and an
  execution-proof test that resolves a real provider through the live REPL
  context. `npm test`, `npm run build`, and `npx tsc --noEmit` are all green.
- **The commit history.** The real TDD trail is preserved — failing test,
  implementation, fixes — including several rounds where review caught genuine
  defects (the trickiest: `node:repl` completion detection on modern Node, and
  a runtime-vs-registration security bug where an earlier async-registration
  API could have shipped the arbitrary-code endpoint live with
  `enabled: false`; `registerAsync` now enforces `enabled` at runtime instead).
- **The security invariants** are documented in [`AGENTS.md`](./AGENTS.md) and
  enforced by tests, not left as prose.

AI assistance does not exempt the code from scrutiny — it raises the bar for
it. Issues and fixes are welcome from anyone who finds something we missed.

## AI usage & training

The source here is published so people and their tools can **use** it — read
it, run it, debug against it, integrate it. It is not offered as training data.
[`robots.txt`](./robots.txt) and [`ai.txt`](./ai.txt) record a request that AI
model *training* crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, and
others) not ingest this repository. Those files are advisory — they express
intent and do not, and cannot, technically enforce anything, nor do they bind
GitHub's own hosting. Using an AI coding assistant to help you *work with* this
library is entirely fine and expected.

## Releasing

Releases are **fully automated**. Merging a PR to `main` with releasable
[Conventional Commits](https://www.conventionalcommits.org/) triggers
`.github/workflows/release.yml`, which runs the full test suite and then
[semantic-release](https://semantic-release.gitbook.io/):

| Commit type            | Version bump      |
| ---------------------- | ----------------- |
| `fix:`                 | patch (x.y.**z**) |
| `feat:`                | minor (x.**y**.0) |
| `feat!:` / `BREAKING CHANGE:` in body | major (**x**.0.0) |
| `docs:` `chore:` `test:` `ci:` `refactor:` | no release |

It computes the next version, updates `CHANGELOG.md`, publishes to npm
(**tokenless via OIDC trusted publishing, with provenance attached
automatically**), tags the commit, cuts a GitHub Release, and commits the
version/changelog bump back to `main` as `chore(release): x.y.z [skip ci]`.
Do not bump `version` in `package.json` by hand.

### One-time bootstrap (maintainer, once)

npm's OIDC trusted publishing cannot perform a package's *first* publish, so a
maintainer does this once:

1. **Create the package on npm with a placeholder:**
   ```bash
   npm login
   npm version 0.0.0 --no-git-tag-version   # temp, do not commit
   npm publish --access public
   git checkout -- package.json               # restore working version
   ```
   Do **not** create a git tag for `0.0.0`; with no tags semantic-release's
   first automated release is `1.0.0`.
2. **Register the Trusted Publisher** at
   `https://www.npmjs.com/package/nestjs-web-repl/access` → *Trusted Publishers*
   → GitHub Actions: owner `p-dim-popov`, repository `nestjs-web-repl`, workflow
   `release.yml` (leave environment blank). After this, no token is needed.
3. (Optional, after `1.0.0` ships) `npm deprecate nestjs-web-repl@0.0.0 "placeholder"`.

### Verifying the first real release

After the bootstrap, the next merge to `main` containing a `feat:`/`fix:` commit
should produce `1.0.0`. Confirm:

- `npm view nestjs-web-repl version` → `1.0.0`
- the npm package page shows a provenance / "Published via GitHub Actions" badge
- a `v1.0.0` git tag and a matching GitHub Release with generated notes exist
- `CHANGELOG.md` and a `chore(release): 1.0.0` commit are on `main`
- the `release.yml` run is green

If the publish step fails with an auth error, the Trusted Publisher registration
(step 2) is missing or its repo/workflow fields don't match exactly.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). AI-
assisted PRs are fine; we just ask you to disclose the assistance and to
understand what you submit. Agents working in this repo should start with
[`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE) © Petar Popov
