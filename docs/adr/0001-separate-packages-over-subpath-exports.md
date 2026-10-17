---
status: accepted
---

# Separate packages per framework and transport, not subpath exports

## Context

The product started as one npm package, `nestjs-web-repl`, that welded a
framework-agnostic engine to NestJS through DI decorators, a controller and a
DI-container context builder. Express users could not use it, and a planned
Python implementation had no language-neutral contract to target. The split had
two candidate shapes: one package with subpath exports
(`remote-repl/nestjs`, `remote-repl/express`, `remote-repl/redis`), or separate
packages under one npm scope. The unscoped name `remote-repl` is taken on npm,
and the `@remote-repl` scope was claimed.

## Decision

The code lives in an npm-workspaces monorepo with one package per distribution
axis: `@remote-repl/core` (engine, protocol, UI bundle, in-memory transport,
shared handler layer), `@remote-repl/nestjs` and `@remote-repl/express`
(framework adapters), and `@remote-repl/redis` (transports). The runtime
(Node, Bun, Deno) is a CI matrix target, not a package. The legacy
`nestjs-web-repl` name stays published as a pure re-export shim of the NestJS
adapter and the Redis transports, versioned in lockstep with
`@remote-repl/nestjs`.

## Considered options

- **Subpath exports in one package.** Rejected: one package must declare every
  framework and client as an optional peer, so an Express-only install still
  sees NestJS peer warnings and a NestJS-only install sees Express. The package
  boundary also cannot be enforced by a test when all code shares one
  `package.json`.
- **Separate repositories per package.** Rejected: the protocol types, the
  shared handler layer and the e2e suites change together. One workspace keeps
  one lockfile, one CI run and cross-package tests against source.

## Consequences

- Each package declares only its own peers. `packages/*/src/package-boundary.spec.ts`
  pins the boundary: core has no framework, transport-client or rxjs dependency.
- A new framework adapter is a new small package over the shared handler layer,
  not a change to an existing one.
- Releases must coordinate several packages: a core protocol change bumps every
  dependent package, and the shim must track the NestJS adapter version. The
  release tooling has to support a fixed version group.
- Consumers of the legacy name need zero code changes, but the shim is a second
  install path that the docs and the skills must keep in step with the scoped
  packages.
