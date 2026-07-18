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

- Install: `npm install`
- Run tests: `npm test` (Vitest — unit specs under `src/`, e2e under `test/`)
- Build: `npm run build` (emits `dist/` via `tsc`; must produce `dist/index.js`
  and `dist/index.d.ts`)
- Typecheck only: `npx tsc -p tsconfig.build.json --noEmit`
- Run the example: `npm run example` (needs `REPL_ENABLED=true`; uses `ts-node`)

The full suite, `npm run build`, and the typecheck must all be green before you
consider a change complete.

## Project layout

- `src/session/repl-session.ts` — one `node:repl` server per channel; the
  subtlest file in the repo (see "Gotchas").
- `src/web-repl.service.ts` — the engine: adapter pub/sub, channel ownership
  (a heartbeat-renewed lease — see "Owner-liveness lease" below), per-channel
  serialized execution, output fan-out, SSE replay, TTL + channel GC,
  heartbeat, runtime `enabled` enforcement.
- `src/web-repl.controller.ts` — the three HTTP routes; SSE mapping; runtime
  `enabled` guards; reflected-XSS-safe UI rendering.
- `src/ui/repl-ui.html.ts` — the inlined browser UI (Monaco from CDN).
- `src/web-repl.module.ts` — `forRoot` / `forRootAsync`.
- `src/context/build-repl-context.ts` — builds the app-wide REPL context.
  Isolates two fragile `@nestjs/core` deep imports (see "Gotchas").
- `src/adapters/`, `src/ring-buffer.ts`, `src/interfaces/`, `src/constants.ts`
- `example/` — a runnable host app. `test/` — the two-instance e2e.

## Conventions

- TypeScript, strict mode. NestJS `@nestjs/common` / `@nestjs/core` are
  **peer** dependencies (`^10 || ^11`) — never add them as runtime deps.
- TDD: write a failing test first, then the minimal implementation. Do not
  weaken or delete an assertion to make a test pass — fix the code.
- The controller returns strings and RxJS `Observable`s only (no raw
  `req`/`res`) so it stays platform-agnostic across Express and Fastify.
- Keep files focused and small; match existing style.

## Security invariants (do not regress these)

1. **`enabled` is enforced at runtime**, not just at registration. A disabled
   module must not subscribe to the adapter and must 404 on every route — via
   both `forRoot` and `forRootAsync`. This is the product's only built-in
   safety rail; treating it as advisory-only is a critical bug.
2. **The UI escapes the channel name** for the `<script>` context (`<`
   escaping) and uses `encodeURIComponent` for URLs. SSE payloads render via
   `textContent`, never `innerHTML`.
3. The library ships **no authentication** — that is intentional and the user's
   responsibility. Do not add auth that pretends to be complete; do keep the
   security warnings in `README.md` accurate.

## Gotchas (hard-won; read before touching these areas)

- **`node:repl` on Node 20+**: `server.eval`'s callback never fires for a
  synchronous top-level `throw`. Completion is detected via a per-session
  random sentinel prompt, and genuine incomplete input is detected via the
  REPL's buffered-command state (not a transient continuation prompt). Preserve
  multi-line support and top-level `await` if you change this file.
- **Deep imports**: `@nestjs/core/repl/repl-context` and
  `@nestjs/core/nest-application-context` are not public API. They are isolated
  to `src/context/build-repl-context.ts` and covered by an execution-proof
  test. If a `@nestjs/core` major bump breaks them, fix them here.
- **Per-channel serialization**: output is tagged with the currently executing
  command; commands on a channel run serially. Don't reintroduce a shared
  cross-channel "current command" field.
- **Two unrelated heartbeats, don't conflate them**: `heartbeatInterval` /
  `DEFAULTS.heartbeatInterval` drives the client-visible SSE `{ping}` keep-alive
  in `stream()`. `ownerHeartbeatInterval` / `ownerLeaseTtl` drive the internal
  owner-liveness lease (an instance re-announcing `claim` for channels it
  owns, and the staleness check in `onCmd`). They are independent knobs for
  independent mechanisms; changing one must never implicitly affect the
  other.

### Owner-liveness lease

Ownership of a channel is a lease, not a permanent grant: the owning instance
must re-announce `claim` every `ownerHeartbeatInterval` (an injectable clock,
`WEB_REPL_CLOCK`, drives `ownerSeenAt` timestamps so tests can control
staleness deterministically — see `web-repl.service.spec.ts`'s
`makeServiceWithClock` helper). If no claim/heartbeat has been seen for a
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
logic, re-run `src/web-repl.service.spec.ts`'s `owner-liveness` describe block
a few times to confirm it isn't flaky — it's all driven by the injected clock,
not real waits, so it should never be.

## Provenance

This codebase was built with AI assistance (Claude Code, subagent-driven TDD)
under human direction and review. See "How this was built" in `README.md`.
Contributions — human or AI-assisted — are welcome; disclosure of AI assistance
is required (see `CONTRIBUTING.md`).
