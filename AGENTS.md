# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. This
follows the [AGENTS.md](https://agents.md) convention. If you are an automated
agent, read this before making changes.

## What this project is

`nestjs-web-repl` is a library that exposes a live NestJS REPL over HTTP: a
`POST` command endpoint, an SSE output stream, and a Monaco-based browser UI,
backed by real `@nestjs/core` REPL sessions running inside the host app.
**The endpoints execute arbitrary code by design.** Treat every change through
that lens — see "Security invariants" below.

## Setup, build, test

The repo is an npm-workspaces monorepo: the root `package.json` is private
with `workspaces: ["packages/*"]`, and every root script delegates to every
workspace. Run everything from the workspace root.

- Install: `npm install` (at the root; `node_modules` is hoisted there)
- Run tests: `npm test` (Vitest — unit specs under `packages/*/src/`, e2e under
  `packages/nestjs/test/`). `packages/nestjs/test/contract/` needs a reachable
  Redis (`docker run -d -p 6379:6379 redis:7-alpine`; override the address
  with `REDIS_URL`).
- Build: `npm run build` (each package emits its own `dist/` via `tsc`;
  `packages/core` must produce `dist/index.js`, `dist/index.d.ts` and
  `dist/ui/vs/`, the Monaco copy made by its `scripts/copy-monaco.mjs`;
  `packages/nestjs` must produce `dist/index.js` and `dist/index.d.ts`)
- Typecheck only: `npm run typecheck`
- Run the example: `npm run example` (needs `REPL_ENABLED=true`; uses `ts-node`,
  which resolves `@remote-repl/core` from its built `dist/` — build first)
- One package only: `npm run <script> --workspace <package-name>`
  (e.g. `npx vitest run test/contract` from inside `packages/nestjs`).

How `packages/nestjs` finds `@remote-repl/core`: it is a workspace
dependency (npm links `node_modules/@remote-repl/core` → `packages/core`).
Tests and typecheck resolve it from SOURCE (`vitest.config.ts` alias and
`tsconfig.typecheck.json` `paths` → `../core/src/index.ts`), so `npm test`
and `npm run typecheck` need no prior build. The build resolves the symlink
to `packages/core/dist` (`tsconfig.build.json` declares a project reference
and runs `tsc -b`, so core is compiled first). Each package's
`tsbuildinfo` lives inside its `dist/` so `rm -rf dist` is a true clean.

The full suite, `npm run build`, and the typecheck must all be green before you
consider a change complete.

## Project layout

Root: `package.json` (private workspace root; also owns the semantic-release
devDependencies and `.releaserc.json`), `.github/workflows/`, `README.md`,
`CHANGELOG.md`, `CONTRIBUTING.md`, `docs/`, and `examples/stackblitz/` (a
standalone demo against the published package, not a workspace). Packages
live under `packages/`:

- `packages/core/` — `@remote-repl/core` (private until the per-package
  release design lands): everything with NO framework dependency. Its
  `package.json` has zero `@nestjs/*`, express, redis/ioredis or rxjs
  dependencies (pinned by `src/package-boundary.spec.ts`). No decorators, so
  its `vitest.config.ts` needs neither swc nor `reflect-metadata`. Consumers
  import only from the barrel `src/index.ts`. Paths relative to it:
  - `src/engine/remote-repl-engine.ts` — `RemoteReplEngine`, the engine:
    transport pub/sub, channel ownership (a heartbeat-renewed lease — see
    "Owner-liveness lease" below), per-channel serialized execution, output
    fan-out, replay, TTL + channel GC, the client-visible `{ping}` heartbeat,
    runtime `enabled` enforcement (`ReplDisabledError`). A plain class (no
    decorators, no rxjs): constructor `(options, transport, buildContext,
    clock, logger)`, `start()`/`stop()`, `dispatch()`, `openStream()` (the
    synchronous subscribe/close primitive) and `events()` (an async iterator
    built on it). Its spec drives it with the in-memory transport and an
    injected clock.
  - `src/session/repl-session.ts` — one `node:repl` server per channel; the
    subtlest file in the repo (see "Gotchas").
  - `src/protocol/` — the wire protocol: `messages.ts` (`WebReplEvent`,
    `CmdMessage`, `OutMessage`, `SysMessage`), `adapter.ts` (the
    `WebReplAdapter` transport interface; its optional `onModuleDestroy?`
    hook keeps that name for compatibility), `constants.ts` (`TOPICS`,
    `DEFAULTS`), `options.ts` (`WebReplOptions`, the framework-free options
    shape).
  - `src/ring-buffer.ts` — `EventRingBuffer`, the per-channel SSE replay buffer.
  - `src/transport/in-memory.adapter.ts` — `InMemoryWebReplAdapter`.
  - `src/ui/repl-ui.html.ts` — the inlined browser UI (self-hosted Monaco).
    `src/ui/monaco-assets.ts` serves `dist/ui/vs` (built) or falls back to the
    `monaco-editor` devDependency through Node's resolver (hoisted to the root
    `node_modules`); it is also the sole path-traversal guard for the asset
    route.
  - `src/http/` — pure HTTP helpers: `sse-frame.ts` (`toSseFrame` → a plain
    `SseFrame {id,type,data}`, heartbeat id stamping) and `landing.ts`
    (`randomChannelName`, `landingRedirectUrl`).
  - `scripts/copy-monaco.mjs` — build step. Finds `monaco-editor` through
    Node's resolver (`createRequire`), never a hardcoded `node_modules` path.
- `packages/nestjs/` — the `nestjs-web-repl` package (future
  `@remote-repl/nestjs`), with its own `package.json`, `tsconfig*.json` and
  `vitest.config.ts`. Depends on `@remote-repl/core` and re-exports what its
  public API needs (`InMemoryWebReplAdapter`, `WebReplAdapter`,
  `WebReplEvent`, `SseEventType`), so `import { WebReplModule } from
  'nestjs-web-repl'` and the `nestjs-web-repl/redis` subpath are unchanged.
  Paths below are relative to it.
  - `src/web-repl.service.ts` — `WebReplService extends RemoteReplEngine`:
    the thin Nest face of core's engine. DI construction (passes
    `new Logger('WebReplService')`), `onModuleInit`/`onModuleDestroy` →
    `start()`/`stop()`, `ReplDisabledError` → `NotFoundException` (a
    rejection from `dispatch()`, a synchronous throw from `stream()`), and
    `stream()` as an RxJS `Observable` over the engine's `openStream()`.
    No engine logic lives here. `src/web-repl.service.spec.ts` is the
    behaviour-preservation gate for the engine extraction: it reaches
    engine internals by name (`channels`, `ownership`, `onCmd`, …), so the
    engine's members stay plain TS `private`, never `#private`.
  - `src/web-repl.controller.ts` — the HTTP routes; SSE mapping; runtime
    `enabled` guards; reflected-XSS-safe UI rendering. Uses core's UI, Monaco
    and SSE helpers.
  - `src/web-repl.module.ts` + `src/web-repl.module-definition.ts` — `register` /
    `registerAsync` (ConfigurableModuleBuilder).
  - `src/context/build-repl-context.ts` — builds the app-wide REPL context.
    Isolates two fragile `@nestjs/core` deep imports (see "Gotchas").
  - `src/adapters/redis/` — the Redis transports (ioredis, node-redis).
    `src/interfaces/web-repl-options.interface.ts` — `WebReplModuleOptions`
    (extends core's `WebReplOptions`), `WebReplAdapterConfig`,
    `WebReplModuleExtras`. `src/constants.ts` — the Nest DI tokens only.
  - `src/cli/` — the `install-skill` CLI (`index.ts` dispatcher +
    `install-skill.ts` copy logic) exposed as the `nestjs-web-repl` bin.
    `src/cli/packaging.spec.ts` also pins the workspace layout (private root,
    package at `packages/nestjs`).
  - `skill/SKILL.md` — the consumer-facing Claude Code skill shipped to package
    users (distinct from this AGENTS.md, which is for contributors). Installed
    via `npx nestjs-web-repl install-skill`.
  - `example/` — a runnable host app. `test/` — the two-instance e2e (in-memory
    adapter), `test/fakes/`, and `test/contract/` — the contract suite: two
    real Nest instances on a REAL Redis (`REDIS_URL`, default
    `redis://127.0.0.1:6379`), every scenario run once per Redis transport. It
    pins the observable multi-instance behavior (ownership, lease takeover,
    SSE replay, serialization, `enabled`, prefix isolation) and must stay
    green through any refactor.

## Conventions

- TypeScript, strict mode. NestJS `@nestjs/common` / `@nestjs/core` are
  **peer** dependencies (`^10 || ^11`) of `packages/nestjs` — never add them
  as runtime deps. `packages/core` must stay free of every framework,
  transport client and rxjs; put framework-specific code in the package that
  owns the framework.
- TDD: write a failing test first, then the minimal implementation. Do not
  weaken or delete an assertion to make a test pass — fix the code.
- The controller returns strings and RxJS `Observable`s only (no raw
  `req`/`res`) so it stays platform-agnostic across Express and Fastify.
- Keep files focused and small; match existing style.
- **Releases are automated** (semantic-release on merge to `main`). Never hand-
  edit `package.json` `version` or create release tags manually. Write
  Conventional Commit subjects (`feat:`, `fix:`, `feat!:` …) — they drive the
  version bump. See "Releasing" in `README.md`. **Release automation is
  currently off** for the `@remote-repl` monorepo split (#19): `release.yml`
  and the `release-config` CI job are gated with `if: false`; #33 re-enables
  releases per package.

## Security invariants (do not regress these)

1. **`enabled` is enforced at runtime**, not just at registration. A disabled
   module must not subscribe to the adapter and must 404 on every route — via
   both `register` and `registerAsync`. This is the product's only built-in
   safety rail; treating it as advisory-only is a critical bug.
2. **The UI escapes the channel name** for the `<script>` context (`<`
   escaping) and uses `encodeURIComponent` for URLs. SSE payloads render via
   `textContent`, never `innerHTML`.
3. The library ships **no authentication** — that is intentional and the user's
   responsibility. Do not add auth that pretends to be complete; do keep the
   security warnings in `README.md` accurate.

## Gotchas (hard-won; read before touching these areas)

- **`node:repl` on Node 20+** (`packages/core/src/session/repl-session.ts`):
  `server.eval`'s callback never fires for a
  synchronous top-level `throw`. Completion is detected via a per-session
  random sentinel prompt, and genuine incomplete input is detected via the
  REPL's buffered-command state (not a transient continuation prompt). Preserve
  multi-line support and top-level `await` if you change this file.
- **Deep imports**: `@nestjs/core/repl/repl-context` and
  `@nestjs/core/nest-application-context` are not public API. They are isolated
  to `src/context/build-repl-context.ts` and covered by an execution-proof
  test. If a `@nestjs/core` major bump breaks them, fix them here.
- **Per-channel serialization** (`packages/core/src/engine/remote-repl-engine.ts`):
  output is tagged with the currently executing
  command; commands on a channel run serially. Don't reintroduce a shared
  cross-channel "current command" field.
- **Two unrelated heartbeats, don't conflate them**: `heartbeatInterval` /
  `DEFAULTS.heartbeatInterval` drives the client-visible SSE `{ping}` keep-alive
  started per subscriber in the engine's `openStream()`.
  `ownerHeartbeatInterval` / `ownerLeaseTtl` drive the internal
  owner-liveness lease (an instance re-announcing `claim` for channels it
  owns, and the staleness check in `onCmd`). They are independent knobs for
  independent mechanisms; changing one must never implicitly affect the
  other.

### Owner-liveness lease

Implemented in `packages/core/src/engine/remote-repl-engine.ts` (`onCmd`,
`heartbeatOwnedChannels`, the constructor clamp). Ownership of a channel is a
lease, not a permanent grant: the owning instance
must re-announce `claim` every `ownerHeartbeatInterval` (the engine's
injectable `clock` constructor argument — `WEB_REPL_CLOCK` in the Nest
package — drives `ownerSeenAt` timestamps so tests can control
staleness deterministically — see `remote-repl-engine.spec.ts`'s
`makeSharedClock` and `web-repl.service.spec.ts`'s `makeServiceWithClock`
helpers). If no claim/heartbeat has been seen for a
channel's recorded owner within `ownerLeaseTtl`, `onCmd` treats it as
effectively ownerless and lets the ORIGIN instance of the next command for it
take over (fresh session; the dead owner's variables are gone). A live,
heartbeating owner must NEVER be preempted this way — `ownerLeaseTtl` is
clamped in the constructor to at least `ownerHeartbeatInterval * 2` (not just
"greater than") specifically to guarantee that: a bare majority margin (e.g.
lease = heartbeat + 1ms) leaves zero slack for publish/adapter delivery
jitter measured on a PEER's clock, so a single heartbeat delivered late could
make a live owner look stale to someone else and get preempted. The 2x
margin guarantees a live owner always has at least one full heartbeat
interval of slack. If you touch this
logic, re-run the `owner-liveness` describe blocks of
`packages/core/src/engine/remote-repl-engine.spec.ts` and
`packages/nestjs/src/web-repl.service.spec.ts` a few times to confirm they
aren't flaky — staleness is all driven by the injected clock, not real
waits, so they should never be.

## Provenance

This codebase was built with AI assistance (Claude Code, subagent-driven TDD)
under human direction and review. See "How this was built" in `README.md`.
Contributions — human or AI-assisted — are welcome; disclosure of AI assistance
is required (see `CONTRIBUTING.md`).

## Agent skills

### Issue tracker

GitHub Issues on `p-dim-popov/nestjs-web-repl`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (labels named after the roles). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
