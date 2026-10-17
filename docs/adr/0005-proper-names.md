---
status: accepted
---

# Every `@remote-repl` export carries the product name, and the legacy names live only in the shim

## Context

The split (ADR 0001) and the name (ADR 0004) left the code with the vocabulary
of the old package: `WebReplModule`, `WebReplAdapter`, `InMemoryWebReplAdapter`,
the `adapter` option, the `webrepl:*` wire topics. The new packages had not
been published. This was the one moment to rename without a migration cost for
anyone but the 2.3.x users of `nestjs-web-repl`, who could be served by the
shim. Four questions had to be answered together: what the exports are called,
whether the wire follows, how the five packages are versioned, and what the
shim owes to a 2.3.x app.

## Decision

1. **Naming rule and public surface.** Every export of every `@remote-repl/*`
   package is qualified: classes and types `RemoteRepl*`, constants and DI
   tokens `REMOTE_REPL_*`, factories `createRemoteRepl*`. The words "web repl"
   and "adapter" do not appear in those packages in any spelling. The
   transport vocabulary of `GLOSSARY.md` is used throughout: the option is
   `transport`, the teardown hook of a transport is `close()`. The core barrel
   exports exactly the engine, the transport interface, the in-memory
   transport, the protocol types and constants, the two errors, the handler
   factory with its SSE helpers, and the session interface as a type. The
   ring buffer, the Node session implementation, the UI renderer, the Monaco
   asset resolver and the SSE frame and landing helpers are internal: the
   handlers reach them. The engine, `createRemoteReplEngine` and
   `RemoteReplModule.register` all default to the in-memory transport.
2. **The wire follows.** The topics are `remote-repl:cmd|out|sys`. `PROTOCOL.md`
   stays at 1.0.0, because nothing had been published against it, and gains a
   note that `nestjs-web-repl` 2.3.x and earlier speak an undocumented
   pre-1.0 wire that is not interoperable.
3. **Versions decouple.** `@remote-repl/core`, `/nestjs`, `/express` and
   `/redis` start at 1.0.0, set by hand once before the first publish.
   `nestjs-web-repl` stays on its 2.x line and depends on `@remote-repl/nestjs
   ^1.0.0` and `@remote-repl/redis ^1.0.0`. There is no `fixed` group.
4. **The shim owns the legacy names.** `nestjs-web-repl` exports every 2.3.x
   public name as a JSDoc `@deprecated` alias of its replacement, and the new
   names beside them. `WebReplModule.register` / `registerAsync` translate the
   `adapter` extra to `transport` and delegate to `RemoteReplModule`. A
   transport that implements only `onModuleDestroy()` keeps working because
   the engine calls `close ?? onModuleDestroy`. There is no runtime warning.

## Considered options

- **Keep the `WebRepl*` names in the new packages.** No rename, no shim logic.
  Rejected: the names describe a NestJS web UI, not the product (ADR 0004),
  and "adapter" collides with the glossary, where it is the historical word
  for a transport. A rename after the first publish would cost every consumer
  a major.
- **Keep the `webrepl:*` topics.** Would let a 2.3.x and a 2.4.0 instance share
  one Redis during a rolling upgrade. Rejected: the message shapes changed
  anyway between 2.3.x and 1.0.0 (typed events, replay ids), so interoperation
  was never a safe promise, and a product-named wire is the one that other
  implementations will bind to for years. The upgrade window heals through
  lease expiry.
- **Lockstep versions for the shim and `@remote-repl/nestjs`.** Simple to
  explain. Rejected: it would force the shim to 1.0.0, a version lower than
  its published 2.3.2, or force `@remote-repl/nestjs` to start at 2.4.0 and
  carry the history of a package it is not.
- **Break 2.3.x apps and point them at `@remote-repl/nestjs`.** Rejected: the
  shim exists exactly so that an existing install upgrades without a code
  change.

## Consequences

- A vocabulary guard (`packages/nestjs/src/packaging.spec.ts`) fails the suite
  on any "web repl" or "adapter" spelling in the tracked files of the four
  packages. A spec pins the core barrel's runtime export keys.
- The shim is no longer a pure re-export. Its alias spec emits the
  declarations and checks the `@deprecated` tag on every legacy name.
- A rolling upgrade from 2.3.x to 2.4.0 has a short window in which the two
  versions form two clusters on one Redis (`PROTOCOL.md` §8.1).
- `changeset publish` publishes the four 1.0.0 packages without a changeset,
  because they are absent from the registry. Their changelogs start with
  their first changeset after 1.0.0.
