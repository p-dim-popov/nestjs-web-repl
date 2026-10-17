# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. This
follows the [AGENTS.md](https://agents.md) convention. If you are an automated
agent, read this before making changes.

## What this project is

The `@remote-repl` package family exposes a live, in-process REPL over HTTP: a
`POST` command endpoint, an SSE output stream, and a Monaco-based browser UI,
backed by real `node:repl` sessions running inside the host app. One
framework-free engine (`@remote-repl/core`) speaks one wire protocol
(`packages/core/PROTOCOL.md`); framework packages (`@remote-repl/nestjs`,
`@remote-repl/express`) do the HTTP wiring; transports (`@remote-repl/redis`)
carry the protocol between instances; the legacy `nestjs-web-repl` name is a
shim that keeps the 2.3.x names as deprecated aliases. The shared vocabulary
(engine, channel, transport, framework package, lease, claim/release, topic
prefix, shim, …) is defined in `GLOSSARY.md`; the hard-to-reverse decisions
behind the split are in `docs/adr/`. Use the glossary's terms in code, tests
and issues. Every export of an `@remote-repl/*` package is qualified
(`RemoteRepl*`, `REMOTE_REPL_*`, `createRemoteRepl*`) and the words "web
repl" and "adapter" do not appear in those four packages in any spelling
(ADR 0005; guarded by the vocabulary spec in
`packages/nestjs/src/packaging.spec.ts`).
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
  `packages/redis`, `packages/express` and `packages/nestjs` must each
  produce `dist/index.js` and `dist/index.d.ts`; `packages/nestjs-web-repl`
  (the shim) those plus `dist/redis.js` + `dist/redis.d.ts`, its `./redis`
  subpath)
- Typecheck only: `npm run typecheck`
- Protocol schema drift check: `npm run schema:check` (regenerates
  `packages/core/schema/protocol.schema.json` from the TS types and diffs)
- Run the examples: `npm run example` (NestJS) and `npm run example:express`
  (Express; demo bearer token `REPL_TOKEN`, default `dev-token`, as
  `Authorization: Bearer …` or `?token=`). Both need `REPL_ENABLED=true` and
  use `ts-node`, which resolves `@remote-repl/core` from its built `dist/` —
  build first.
- One package only: `npm run <script> --workspace <package-name>`
  (e.g. `npx vitest run test/contract` from inside `packages/nestjs`).

How one package finds another (`packages/nestjs` → `@remote-repl/core`;
`packages/redis` and `packages/express` → `@remote-repl/core`;
`packages/nestjs-web-repl` → `@remote-repl/nestjs` + `@remote-repl/redis`):
each is a
workspace dependency (npm links `node_modules/@remote-repl/<name>` →
`packages/<name>`). Tests and typecheck resolve it from SOURCE
(`vitest.config.ts` alias and `tsconfig.typecheck.json` `paths` →
`../<name>/src/index.ts`), so `npm test` and `npm run typecheck` need no
prior build. The build resolves the symlink to `packages/<name>/dist`
(`tsconfig.build.json` declares a project reference and runs `tsc -b`, so
dependencies are compiled first; a package another one references must set
`composite: true` in its `tsconfig.build.json` and `composite: false` back in
its `tsconfig.typecheck.json`). Each package's `tsbuildinfo` lives inside
its `dist/` so `rm -rf dist` is a true clean, and every package's `build`
script does exactly that first (a `node -e` `fs.rmSync`, cross-platform):
`tsc -b` is incremental and never removes the output of a deleted source, so
without the wipe a removed file's `dist/*.js` would ship. `tsc -b --clean`
is no substitute (it only knows outputs of sources that still exist).
`packages/nestjs/src/packaging.spec.ts` checks, when a `dist/` exists (CI
builds before testing), that no built output lacks a source. Copy this pattern for any new
package. `unplugin-swc` reads the package's `tsconfig.json` for
`experimentalDecorators`: a package whose specs use Nest decorators needs
them there, not only in the typecheck config.

The full suite, `npm run build`, the typecheck and `npm run schema:check` (the
protocol schema drift check) must all be green before you consider a change
complete.

## Runtime support (standing rule)

- **Node (>= 20) is the supported, release-blocking runtime.** CI runs the
  full suite on Node 22.x and 24.x (`build-test` in `.github/workflows/ci.yml`);
  those legs must be green.
- **Bun and Deno are best-effort.** The `runtime-matrix` job runs the same
  suite (unit + contract + e2e, Redis service on every leg) under each
  runtime itself -- `bun --bun x vitest run` (the `--bun` flag is required or
  bunx honours vitest's node shebang and runs it on Node) and
  `deno run -A npm:vitest run --pool=threads` (the default forks pool exits 1
  with a BrokenPipe on Deno after a green run) -- per package, because the
  root `npm test` would run vitest under Node. The job has
  `continue-on-error: true`: its status is reported, never blocking. Promote a
  runtime to supported by removing that line once it has stayed green -- no
  code change. Never gate a release on a best-effort leg, and never patch the
  engine to chase one.
- **Failure attribution on Bun/Deno.** The session spec
  (`packages/core/src/session/repl-session.spec.ts`) runs first as its own
  step: it is the `node:repl` parity canary (sentinel prompt, continuation
  prompt, buffered-command state are verified on Node only). A red session
  step means "session layer": do not weaken the spec; the drop-in point is
  the session seam in `packages/core/src/session/` (a runtime-specific
  session implementation replaces `ReplSession` there, the engine is
  untouched). A red full suite with a green session step is attributed
  elsewhere. The job writes this attribution to the step summary.
- **Portability fences.** `packages/core/src/runtime-portability.spec.ts`
  forbids the `NodeJS.*` type namespace in core sources (use
  `ReturnType<typeof setTimeout>`); `src/ui/monaco-assets.ts` guards
  `__dirname` / `require.resolve` and returns null (asset 404) when neither
  a bundled `vs` copy nor the package resolver is available. Keep new core
  code free of Node-only globals, or guard them the same way.

## Project layout

Root: `package.json` (private workspace root; also owns the `@changesets/cli`
devDependency and the `changeset:*` scripts), `.changeset/` (config + pending
changesets), `.github/workflows/`, `README.md`
(the full consumer documentation for every package; each package also has a
short `README.md` that links back to it), `CHANGELOG.md` (pre-split history
only; per-package `CHANGELOG.md` files are generated from here on),
`CONTRIBUTING.md`, `GLOSSARY.md` (the ubiquitous language), `docs/adr/`
(architecture decision records: `0001` separate packages over subpath exports,
`0002` no rxjs in core, `0003` no wire protocol version, `0004` the
`remote-repl` name and why the web UI is one client surface, not the product), `docs/agents/` (agent
workflow notes), `skills/` (consumer-facing agent skills, see below) and
`examples/stackblitz/` (a standalone demo against the published package, not
a workspace). `packages/nestjs/src/docs.spec.ts` checks that every path
`README.md`, `AGENTS.md` and `CONTRIBUTING.md` reference exists, that
`GLOSSARY.md` defines the core terms and that the ADRs have Context /
Decision / Consequences — when you move a file, fix the docs in the same
change or that spec goes red. Packages live under `packages/`:

- `packages/core/` — `@remote-repl/core`: everything with NO framework dependency. Its
  `package.json` has zero `@nestjs/*`, express, redis/ioredis or rxjs
  dependencies (pinned by `src/package-boundary.spec.ts`). No decorators, so
  its `vitest.config.ts` needs neither swc nor `reflect-metadata`. Consumers
  import only from the barrel `src/index.ts`. Paths relative to it:
  - `src/engine/remote-repl-engine.ts` — `RemoteReplEngine`, the engine:
    transport pub/sub, channel ownership (a heartbeat-renewed lease — see
    "Owner-liveness lease" below), per-channel serialized execution, output
    fan-out, replay, TTL + channel GC, the client-visible `{ping}` heartbeat,
    runtime `enabled` enforcement (`RemoteReplDisabledError`). A plain class (no
    decorators, no rxjs): constructor `(options, transport, buildContext,
    clock, logger)`, `start()`/`stop()`, `dispatch()`, `openStream()` (the
    synchronous subscribe/close primitive) and `events()` (an async iterator
    built on it). Its spec drives it with the in-memory transport and an
    injected clock.
  - `src/session/repl-session.ts` — one `node:repl` server per channel; the
    subtlest file in the repo (see "Gotchas").
  - `src/protocol/` — the wire protocol: `messages.ts` (`RemoteReplCmdMessage`,
    `RemoteReplOutMessage`, `RemoteReplSysMessage`, the `RemoteReplSseEvent`/`RemoteReplTransportEvent` discriminated
    unions and the loose `RemoteReplEvent` the engine still works with),
    `transport.ts` (the `RemoteReplTransport` transport interface; its optional
    `onModuleDestroy?` hook keeps that name for compatibility), `constants.ts`
    (`REMOTE_REPL_TOPICS`, `REMOTE_REPL_DEFAULTS`), `options.ts` (`RemoteReplOptions`, the framework-free
    options shape).
  - `PROTOCOL.md` — the versioned, language-neutral protocol spec (topics,
    message shapes, ownership/lease semantics, SSE contract, versioning
    rule). `schema/protocol.schema.json` is GENERATED from
    `src/protocol/messages.ts` by `scripts/generate-schema.mjs`
    (`npm run schema:generate`); `npm run schema:check` (root and CI) fails
    on drift. When you change a wire type: regenerate, commit the schema,
    update PROTOCOL.md's prose and bump its version (additive = minor,
    breaking = major).
  - `src/ring-buffer.ts` — `EventRingBuffer`, the per-channel SSE replay buffer.
  - `src/transport/in-memory.transport.ts` — `RemoteReplInMemoryTransport`.
  - `src/ui/repl-ui.html.ts` — the inlined browser UI (self-hosted Monaco).
    `src/ui/monaco-assets.ts` serves `dist/ui/vs` (built) or falls back to the
    `monaco-editor` devDependency through Node's resolver (hoisted to the root
    `node_modules`), and yields null when neither is reachable (`__dirname` /
    `require.resolve` are guarded, see "Runtime support"); it is also the
    sole path-traversal guard for the asset route.
  - `src/http/` — the framework-free HTTP layer. `handlers.ts` is the
    shared route-handler layer every framework package wires to:
    `createRemoteReplHandlers(engine, { enabled })` returns plain-data handlers —
    `landing(requestUrl) → redirectUrl`, `post(channel, body) →
    Promise<{commandId}>`, `streamFrames(channel, lastEventId) →
    AsyncIterableIterator<RemoteReplSseFrame>` (owns the heartbeat id-stamping; for
    SSE layers that take `{id,type,data}` objects, e.g. Nest's
    `MessageEvent`), `stream(channel, lastEventId) →
    AsyncIterableIterator<string>` (`sseFrameToText` over `streamFrames`:
    ready-to-send SSE text frames), `ui(channel) → html`,
    `asset(relativePath) → RemoteReplAsset | null`. Both stream variants open
    the engine stream eagerly and the transport MUST call `return()` on
    disconnect — that is what closes the engine subscription. The `engine`
    argument is structural: `{ dispatch, events }`. Error contract: every
    handler throws `RemoteReplDisabledError` when disabled (synchronously, except
    `post`, which is always async and rejects — also with
    `RemoteReplInvalidCommandError` for a bad body → 400). Framework packages map errors to
    status codes and use `REMOTE_REPL_SSE_RESPONSE_HEADERS` + `REMOTE_REPL_SSE_STREAM_PREAMBLE` and
    `parseRemoteReplLastEventId(header)` so the wire format matches the reference
    exactly. Route logic belongs here, never in a framework package. Pure helpers:
    `sse-frame.ts` (`toSseFrame` → a plain `RemoteReplSseFrame {id,type,data}`,
    heartbeat id stamping; `sseFrameToText` → wire text) and `landing.ts`
    (`randomChannelName`, `landingRedirectUrl`). `src/package-boundary.spec.ts`
    also greps core's sources for `@nestjs/*`, express or rxjs imports.
  - `scripts/copy-monaco.mjs` — build step. Finds `monaco-editor` through
    Node's resolver (`createRequire`), never a hardcoded `node_modules` path.
- `packages/redis/` — `@remote-repl/redis`: the Redis transports. Depends on `@remote-repl/core`
  (the `RemoteReplTransport` interface) and nothing else; `ioredis` and `redis` are
  OPTIONAL peers (pinned by `src/package-boundary.spec.ts`, which also
  forbids `@nestjs/*`, express, rxjs). No decorators, no swc, no
  `reflect-metadata`. Paths relative to it:
  - `src/base-redis.transport.ts` — `RemoteReplBaseRedisTransport`: handler
    fan-out, subscribe once per topic, handler-fault isolation (a throwing
    handler never escapes into the client's emitter nor skips other
    handlers), and the topic `prefix`. `RemoteReplRedisTransportOptions` =
    `{ prefix?, logger? }`; `logger` is any `{ warn, error }` (a Nest
    `Logger`, pino, …), default `console` — this package has no framework
    logger. The prefix is prepended verbatim to WIRE topic names and stripped
    before dispatch; with no prefix the names are byte-identical to the
    engine's `REMOTE_REPL_TOPICS`. The prefix belongs to the shared medium, NOT the
    engine: the in-memory transport takes none.
  - `src/ioredis.transport.ts`, `src/node-redis.transport.ts` —
    the two clients, each behind a structural `*Like` interface (no client
    import at runtime). `test/fakes/fake-node-redis.ts` — the node-redis fake
    used by the unit spec; the ioredis spec uses `ioredis-mock`.
- `packages/express/` — `@remote-repl/express`: the Express package, thin wiring of core's
  `createRemoteReplHandlers` onto an Express `Router`. Depends on `@remote-repl/core`
  and nothing else; `express` (`^4.16 || ^5`) is a PEER (pinned by
  `src/package-boundary.spec.ts`, which also forbids `@nestjs/*`, rxjs, redis
  clients). No decorators, no swc, no `reflect-metadata`. Paths relative to it:
  - `src/repl-router.ts` — `createRemoteReplRouter({ engine })`; the router reads
    `enabled` from `engine.enabled` (a read-only getter on `RemoteReplEngine`),
    so there is no second flag to drift. The user
    mounts it (`app.use('/repl', router)`) and the MOUNT PATH IS THE BASE PATH
    (landing redirects via `req.originalUrl`; there is no base-path option).
    Routes: `GET /` landing 302, `POST /:channel` 202 (JSON parsing scoped to
    this route; `RemoteReplInvalidCommandError` → 400 with the handler's message),
    `GET /:channel` SSE (`REMOTE_REPL_SSE_RESPONSE_HEADERS`, `REMOTE_REPL_SSE_STREAM_PREAMBLE`, then
    the handler's frames verbatim; `return()` on `res` `close`), `GET
    /:channel/ui`, and the Monaco assets as a RegExp route
    (`/^\/([^/]+)\/vs\/(.+)$/`, `req.params[1]`) so the same code works on
    Express 4 (`*` → `params[0]`) and 5 (`*path` → `string[]`).
    `RemoteReplDisabledError` → 404 on every route; errors are caught explicitly
    (no reliance on Express 5 promise forwarding). The user's auth middleware
    goes in front of the router; none is shipped.
  - `src/repl-engine.ts` — `createRemoteReplEngine({ options, transport, context |
    buildContext, logger? })`: builds a `RemoteReplEngine` for an app with no
    DI. The caller owns `start()` / `stop()`; `start()` is a no-op when
    disabled (subscribes to nothing).
  - `test/repl-router.suite.ts` — the router's HTTP contract (supertest, fake
    engine: mirrors the NestJS controller spec incl. the heartbeat `id: 5` ×3
    case, UI escaping, asset traversal, mount-path-as-base, disconnect →
    `return()`, disabled engine → 404 on all five routes), run once per
    supported Express major: `src/repl-router.spec.ts` (Express 5, the
    devDependency) and `src/repl-router.express4.spec.ts` (Express 4 via the
    `express4` = `npm:express@4` alias devDependency, `vi.mock`ed over
    `express` so the router module itself resolves v4; each leg asserts its
    major). Keep both legs green: they are what backs the `^4.16 || ^5` peer
    range. `test/` is outside the build (`tsconfig.build.json` excludes it).
    `src/integration.spec.ts` (real engine + in-memory transport round trip,
    disabled engine subscribes to nothing, auth middleware in front → 401).
  - `example/main.ts` — runnable host app: `REPL_ENABLED` (default off),
    bearer-token middleware in front, `CatService` exposed via `context`.
- `packages/nestjs/` — `@remote-repl/nestjs`, with its own `package.json`, `tsconfig*.json` and
  `vitest.config.ts`. The root `example` script addresses it by this name.
  The legacy unscoped `nestjs-web-repl` name is owned by the shim package
  below; nothing in this package imports it (the example and tests import
  `../src`; `examples/stackblitz/` targets the published package). Depends
  on `@remote-repl/core` and re-exports what its public API needs
  (`RemoteReplInMemoryTransport`, `RemoteReplTransport`, `RemoteReplEvent`,
  `RemoteReplSseEventType`), so the shim can alias them without depending on
  core. Exports the DI tokens `REMOTE_REPL_OPTIONS`, `REMOTE_REPL_TRANSPORT`,
  `REMOTE_REPL_CLOCK`. It exports ONLY its own API: no `./redis`
  subpath, no `typesVersions`, no redis-client peers (`src/packaging.spec.ts`
  pins that, together with `files: ["dist"]`, the absence of a `bin` in every
  workspace package, the workspace layout and the `skills/` frontmatter); `@remote-repl/redis` is a devDependency for `test/contract/`
  only. rxjs is a peer of THIS package (the Observable adaptation lives
  here), never of
  core. Paths below are relative to it.
  - `src/remote-repl.service.ts` — `RemoteReplService extends RemoteReplEngine`:
    the thin Nest face of core's engine. DI construction (passes
    `new Logger('RemoteReplService')`), `onModuleInit`/`onModuleDestroy` →
    `start()`/`stop()`, `RemoteReplDisabledError` → `NotFoundException` (a
    rejection from `dispatch()`, a synchronous throw from `stream()`), and
    `stream()` as an RxJS `Observable` over the engine's `openStream()`
    (kept for consumers and its spec; the controller consumes `events()`
    through the shared handlers instead). No engine logic lives here. `src/remote-repl.service.spec.ts` is the
    behaviour-preservation gate for the engine extraction: it reaches
    engine internals by name (`channels`, `ownership`, `onCmd`, …), so the
    engine's members stay plain TS `private`, never `#private`.
  - `src/remote-repl.controller.ts` — thin HTTP wiring over core's
    `createRemoteReplHandlers(service, options)`: Nest params in, core errors out
    (`RemoteReplDisabledError` → `NotFoundException`, `RemoteReplInvalidCommandError` →
    `BadRequestException(message)`). No route logic lives here. The SSE
    route adapts `handlers.streamFrames()`'s async iterator to the
    `Observable<MessageEvent>` that `@Sse()` expects (unsubscribe →
    `iterator.return()`); the controller still returns only strings and
    Observables (no raw req/res). Runtime `enabled` enforcement comes from
    the handlers reading the shared options object on every call — keep
    passing `options` itself, not a copy. Its spec mocks the service as
    `{ dispatch, events }` (the handler engine surface), not `stream()`.
  - `src/remote-repl.module.ts` + `src/remote-repl.module-definition.ts` — `register` /
    `registerAsync` (ConfigurableModuleBuilder).
  - `src/context/build-repl-context.ts` — builds the app-wide REPL context.
    Isolates two fragile `@nestjs/core` deep imports (see "Gotchas").
  - `src/interfaces/remote-repl-options.interface.ts` — `RemoteReplModuleOptions`
    (extends core's `RemoteReplOptions`), `RemoteReplTransportConfig`,
    `RemoteReplModuleExtras`. `src/constants.ts` — the Nest DI tokens only.
  - `example/` — a runnable host app. `test/` — the two-instance e2e (in-memory
    transport) and `test/contract/` — the contract suite: two real Nest
    instances on a REAL Redis (`REDIS_URL`, default `redis://127.0.0.1:6379`),
    every scenario run once per transport from `@remote-repl/redis`. It pins
    the observable multi-instance behavior (ownership, lease takeover, SSE
    replay, serialization, `enabled`, and cross-app isolation: no prefix
    leaks, same prefix shares, different prefixes isolate) and must stay
    green through any refactor. `test/contract/cross-framework.spec.ts` reuses
    the same harness (`frameworks`: `bootInstance` for Nest,
    `bootExpressInstance` for a plain Express app via `@remote-repl/express`,
    aliased to its source in `vitest.config.ts` like core) to run one NestJS
    and one Express instance on the shared Redis, per transport and per owner
    framework: single execution + cross-framework relay, claim/heartbeat on
    the raw `sys` topic, lease takeover when the owning framework dies, and
    `Last-Event-ID` replay against the other framework.
- `packages/nestjs-web-repl/` — the `nestjs-web-repl` package: the legacy
  name kept alive as a shim so 2.3.x installs resolve with zero code changes.
  Deliberately NOT under the `@remote-repl` scope. `src/index.ts` re-exports
  `@remote-repl/nestjs` AND every 2.3.x name as a JSDoc `@deprecated` alias
  (`WebReplController = RemoteReplController`, …); `WebReplModule` is the one
  alias with logic: `register`/`registerAsync` rename the `adapter` extra to
  `transport` (the DI form is the value, so the key rename is the whole
  translation) and delegate to `RemoteReplModule`. `src/redis.ts` (the
  `./redis` subpath, with a `typesVersions` fallback) does the same over
  `@remote-repl/redis`. No runtime deprecation warning. Depends on
  `@remote-repl/nestjs` and `@remote-repl/redis` with `^1.0.0` ranges; its
  `version` is its OWN 2.x line, not lockstep (pinned by
  `src/packaging.spec.ts`, together with the exports map, the NestJS/rxjs
  peers, the optional `ioredis`/`redis` peers, `files: ["dist"]`, the absence
  of a `bin` and the tarball contents). Ships its own `README.md` (with the
  old → new migration table) and `LICENSE` because root files are not packed.
  `src/shim.spec.ts` pins alias identity and emits the shim's declarations to
  check that every legacy name carries `@deprecated` in the `.d.ts`;
  `test/shim-app.e2e.spec.ts` boots a legacy consumer app with the `adapter`
  extra in every DI form plus `registerAsync`. No `bin` (see `CHANGELOG.md`;
  skills install via skills.sh, see `skills/` below).
- `skills/` — the consumer-facing Claude Code skills (distinct from this
  AGENTS.md, which is for contributors), one directory per package, each a
  single `SKILL.md` with `name` + `description` frontmatter:
  `skills/remote-repl-nestjs/` (`@remote-repl/nestjs`),
  `skills/nestjs-web-repl/` (the shim, with the legacy setup names; frontmatter
  `name: nestjs-web-repl` is the identity skills.sh keys on, keep it) and
  `skills/remote-repl-express/` (`@remote-repl/express`). Consumers install
  them with `npx skills add p-dim-popov/remote-repl/skills/<dir>`
  (skills.sh indexes `SKILL.md` files straight from the GitHub repo; nothing
  is packed into npm tarballs, and there is no install CLI). Every skill
  leads with "Security first" before "Wire it up" and has a "Use it" section
  that teaches the POST + SSE pair read until `done`, the REPL vocabulary and
  per-channel state, with outputs observed against the package examples
  (re-run the examples when you change those tables). The two NestJS skills
  share their "Security first" and "Use it" sections byte for byte: edit the
  text in one, copy it to the other. When a package's public API or package
  name changes, update the matching skill in the same change.
  `packages/nestjs/src/packaging.spec.ts` pins the three directories, their
  frontmatter, key content and the shared sections.

## Conventions

- TypeScript, strict mode. NestJS `@nestjs/common` / `@nestjs/core` are
  **peer** dependencies (`^10 || ^11`) of `packages/nestjs` — never add them
  as runtime deps. `packages/core` must stay free of every framework,
  transport client and rxjs; `packages/redis` of every framework and rxjs
  (its clients are optional peers); `packages/express` of NestJS and rxjs
  (`express` is its peer). Put framework-specific code in the package that
  owns the framework.
- TDD: write a failing test first, then the minimal implementation. Do not
  weaken or delete an assertion to make a test pass — fix the code.
- The controller returns strings and RxJS `Observable`s only (no raw
  `req`/`res`) so it stays platform-agnostic across Express and Fastify.
- Keep files focused and small; match existing style.
- **Releases are automated with changesets** (`.changeset/config.json`;
  `release.yml` runs `changesets/action` on every push to `main`). Never
  hand-edit a `package.json` `version`, a package `CHANGELOG.md`, or create
  release tags manually. Commit messages no longer drive version bumps: every
  user-visible change ships with a changeset file (`npx changeset`, or write
  `.changeset/<name>.md` by hand) naming the affected packages and the bump
  (`patch` / `minor` / `major`) with a short release note. Conventional
  Commit subjects are still the house style, for readable history. On merge
  to `main`, pending changesets become a "Version Packages" PR; merging that
  PR publishes to npm. Versions are decoupled (ADR 0005): no `fixed` or
  `linked` group. The four `@remote-repl` packages started at 1.0.0 (set by
  hand once, before the first publish — the one allowed hand edit) and
  `nestjs-web-repl` stays on its own 2.x line with `^1.0.0` ranges on them
  (asserted by `packages/nestjs-web-repl/src/packaging.spec.ts`).
  `updateInternalDependencies: patch` rewrites the internal ranges when a
  dependency bumps. A never-published package needs no changeset:
  `changeset publish` ships every workspace package whose version is absent
  from the registry. See "Contributing" in `README.md`.

## Security invariants (do not regress these)

1. **`enabled` is enforced at runtime**, not just at registration, and at
   EVERY layer: the engine (`start()` subscribes to nothing and `dispatch()`
   / `events()` / `openStream()` throw `RemoteReplDisabledError` when disabled), the
   shared handler layer (every handler reads the live options object on each
   call and throws `RemoteReplDisabledError`), and every framework package (maps
   `RemoteReplDisabledError` to its own 404 — via both `register` and
   `registerAsync` in NestJS, via `createRemoteReplRouter` in Express). A new
   framework package MUST replicate the 404 mapping on all five routes and
   MUST pass the engine the same `enabled` value; the e2e/HTTP suites of each
   transport cover it. This is the product's only built-in safety rail;
   treating it as advisory-only is a critical bug.
2. **The UI escapes the channel name** for the `<script>` context (`<`
   escaping) and uses `encodeURIComponent` for URLs. SSE payloads render via
   `textContent`, never `innerHTML`. The escaping and the Monaco asset
   path-traversal guard live once, in core (`src/ui/`), and every transport
   serves the UI and the assets through the shared handlers — never
   re-implement either in a framework package.
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
  to `packages/nestjs/src/context/build-repl-context.ts` (never in core) and
  covered by an execution-proof test. If a `@nestjs/core` major bump breaks
  them, fix them here.
- **Per-channel serialization** (`packages/core/src/engine/remote-repl-engine.ts`):
  output is tagged with the currently executing
  command; commands on a channel run serially. Don't reintroduce a shared
  cross-channel "current command" field.
- **Two unrelated heartbeats, don't conflate them**: `heartbeatInterval` /
  `REMOTE_REPL_DEFAULTS.heartbeatInterval` drives the client-visible SSE `{ping}` keep-alive
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
injectable `clock` constructor argument — `REMOTE_REPL_CLOCK` in the Nest
package — drives `ownerSeenAt` timestamps so tests can control
staleness deterministically — see `remote-repl-engine.spec.ts`'s
`makeSharedClock` and `remote-repl.service.spec.ts`'s `makeServiceWithClock`
helpers). If no claim/heartbeat has been seen for a
channel's recorded owner within `ownerLeaseTtl`, `onCmd` treats it as
effectively ownerless and lets the ORIGIN instance of the next command for it
take over (fresh session; the dead owner's variables are gone). A live,
heartbeating owner must NEVER be preempted this way — `ownerLeaseTtl` is
clamped in the constructor to at least `ownerHeartbeatInterval * 2` (not just
"greater than") specifically to guarantee that: a bare majority margin (e.g.
lease = heartbeat + 1ms) leaves zero slack for publish/transport delivery
jitter measured on a PEER's clock, so a single heartbeat delivered late could
make a live owner look stale to someone else and get preempted. The 2x
margin guarantees a live owner always has at least one full heartbeat
interval of slack. If you touch this
logic, re-run the `owner-liveness` describe blocks of
`packages/core/src/engine/remote-repl-engine.spec.ts` and
`packages/nestjs/src/remote-repl.service.spec.ts` a few times to confirm they
aren't flaky — staleness is all driven by the injected clock, not real
waits, so they should never be.

## Provenance

This codebase was built with AI assistance (Claude Code, subagent-driven TDD)
under human direction and review. See "How this was built" in `README.md`.
Contributions — human or AI-assisted — are welcome; disclosure of AI assistance
is required (see `CONTRIBUTING.md`).

## Agent skills

### Issue tracker

GitHub Issues on `p-dim-popov/remote-repl`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (labels named after the roles). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
