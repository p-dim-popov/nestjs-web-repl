---
status: accepted
---

# The product is named `remote-repl`, not `web-repl`

## Context

The original package was `nestjs-web-repl`: a NestJS module that serves a
browser REPL UI over HTTP and SSE. The split into a package family (ADR 0001)
needed an npm scope and a repository name, and the obvious candidates were
`@web-repl` and `@remote-repl`. The unscoped `remote-repl` name on npm belongs to
an unrelated package; both scopes were available.

The two words make different promises. "Web" names the client surface that
ships today: a page in a browser, reached over HTTP. "Remote" names the
capability: you are somewhere other than the process you inspect, and some
medium carries your commands to it and its output back. The question was whether
the product is the UI or the capability.

## Decision

The scope is `@remote-repl` and the repository is `p-dim-popov/remote-repl`.
The product is the capability. The web UI is one client surface over a
medium-agnostic protocol, and it is the only client surface shipped for now.

What makes "remote" the accurate word is the layering that the split produced:

```text
client surface     browser UI over HTTP + SSE (today)   terminal client, IDE, ... (possible)
                   ───────────────────────────────────────────────────────────────────────
protocol           three topics, three message shapes, ownership lease, event ids
                   (`packages/core/PROTOCOL.md`, language-neutral, JSON Schema)
                   ───────────────────────────────────────────────────────────────────────
medium             transport interface: publish + subscribe
                   in-memory (one process), Redis pub/sub (a fleet), IPC or NATS (possible)
```

HTTP exists only in the top layer. A process with no web server at all, such as
a queue worker, a cron job or an Electron main process, can run the engine with
a transport and execute commands for a channel. A client can speak the transport
directly instead of HTTP: publish a command message with the target's instance
id as `originInstanceId`, subscribe to the output topic, and no adapter package
is involved on either side. The protocol document is the contract that makes
this possible without reading the TypeScript source, which is also why the
repository that holds that document carries the language-neutral name rather
than a `js-` or `node-` prefix: a Python implementation binds to the same
document, whether it lives in this repository or in its own.

## Considered options

- **`@web-repl`.** Honest about what ships today and available on npm.
  Rejected: it names the UI, and the UI is replaceable. A terminal client over
  Redis, or an IPC transport for attaching to a child process, would be outside
  the name while being inside the design.
- **`js-remote-repl` or `node-remote-repl` as the repository name.** Rejected:
  the repository holds the protocol spec, which is not bound to JavaScript, and
  the suite already passes on Bun and Deno, so even `node-` overstates the
  binding. The package names (`@remote-repl/nestjs`, `@remote-repl/express`)
  say which runtime an entry point is for.
- **Keeping `nestjs-web-repl` as the only name.** Rejected: it excludes the
  Express adapter and every future one. It survives as the shim package so
  that existing consumers need no change.

## Consequences

- The web UI is not the product's definition. Changes to the protocol or the
  transport interface are the ones that need an ADR; the UI can change freely
  within the escaping rules in `PROTOCOL.md`.
- A client that speaks the transport directly (a terminal client over Redis is
  the natural first one) is in scope and is the proof that the protocol
  document is complete. None has been built yet.
- Every URL in the tree that names the repository uses
  `p-dim-popov/remote-repl` (skills.sh install paths, package manifests, the
  changesets config, the schema `$id`); a spec in `packages/nestjs/src/packaging.spec.ts`
  guards against the old slugs. The GitHub rename is a manual step; GitHub
  redirects the old slug afterwards.
- The legacy name `nestjs-web-repl` stays on npm as a shim. It keeps the
  2.3.x names as deprecated aliases and has its own version line (2.x) with
  `^1.0.0` ranges on the `@remote-repl` packages. An earlier version of this
  ADR said "in lockstep with `@remote-repl/nestjs`"; ADR 0005 decided
  otherwise, before the first publish.
