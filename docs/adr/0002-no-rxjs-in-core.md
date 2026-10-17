---
status: accepted
---

# Core exposes async iterators, not RxJS Observables

## Context

The original engine returned the SSE stream as an RxJS `Observable` because the
NestJS `@Sse()` decorator consumes one. The spec first planned to keep RxJS as
the only required peer of the core package. Bun and Deno portability, the
Express adapter, and the planned Python implementation all argued against a
core that depends on a stream library only one framework needs.

## Decision

`@remote-repl/core` has no rxjs dependency. The engine exposes a synchronous
primitive, `openStream(channel, lastEventId, sink) -> { close() }`, and an
async iterator built on it, `events(channel, lastEventId)`. The shared handler
layer yields SSE frames as async iterators. The Observable adaptation lives
only in `@remote-repl/nestjs`: `WebReplService.stream()` wraps `openStream()`
in an `Observable`, and the controller adapts the handler iterator to the
`Observable<MessageEvent>` that `@Sse()` expects. rxjs is a peer of the NestJS
package, never of core.

## Considered options

- **RxJS as a core peer.** Rejected: every adapter and every runtime would
  carry a dependency that only NestJS uses, and the core boundary test could
  not forbid it.
- **A custom minimal observable type in core.** Rejected: a bespoke contract
  that every adapter must learn, when async iterators are a language feature.

## Consequences

- Adapters MUST call `return()` on the iterator when the client disconnects.
  That call is what closes the engine subscription. Both shipped adapters do
  this and their specs pin it.
- The core package boundary spec forbids rxjs imports in core sources, so a
  future contributor cannot reintroduce the dependency by accident.
- The existing NestJS consumers keep the `Observable` returned by
  `WebReplService.stream()`, so the public NestJS API is unchanged.
