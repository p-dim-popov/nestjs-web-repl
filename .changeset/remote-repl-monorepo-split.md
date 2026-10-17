---
'@remote-repl/core': minor
'@remote-repl/express': minor
'@remote-repl/redis': minor
'@remote-repl/nestjs': minor
'nestjs-web-repl': minor
---

Split `nestjs-web-repl` into the `@remote-repl` monorepo (#19).

New packages, first publish at 0.x:

- `@remote-repl/core` — the framework-free engine, protocol types (`PROTOCOL.md` + JSON schema), in-memory transport, browser UI and the shared HTTP handlers.
- `@remote-repl/redis` — the ioredis and node-redis transports, with an optional topic `prefix` for tenancy on a shared Redis.
- `@remote-repl/express` — `createReplEngine` + `createReplRouter` for Express 4 and 5.

`@remote-repl/nestjs` is the NestJS adapter (`WebReplModule.register` / `registerAsync`, controller, DI-container context builder) under its new name. `nestjs-web-repl` stays published as a compatibility shim: it re-exports `@remote-repl/nestjs`, and `nestjs-web-repl/redis` re-exports `@remote-repl/redis`. Imports, options, peer dependencies and behaviour are unchanged, and the two versions move in lockstep.

Why `minor` and not `major` for the NestJS pair: the public API has full parity with 2.3.x, so existing installs upgrade without code changes. The one removal is the `npx nestjs-web-repl install-skill` bin, a one-time bootstrap convenience rather than a runtime feature; install the agent skill with `npx skills add p-dim-popov/node-remote-repl/skills/nestjs-web-repl` instead.
