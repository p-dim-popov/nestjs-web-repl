---
status: accepted
---

# The protocol spec is versioned, the wire is not

## Context

`packages/core/PROTOCOL.md` is the language-neutral contract for every
implementation, with a JSON Schema generated from the TypeScript types and a CI
drift check. The spec needed a versioning rule, and the question was whether a
version number should also travel on the wire, with a handshake that lets
instances detect an incompatible peer.

## Decision

No wire version and no handshake. The spec version in `PROTOCOL.md` is
documentation only: additive changes bump the minor version, breaking changes
bump the major version. Messages carry no version field. Mixed-version clusters
and cross-language clusters are not supported scenarios. An operator who
upgrades a cluster rolls every instance to the same package version.

## Considered options

- **A version field on every message.** Rejected: a field that nothing acts on
  is noise, and a field that something acts on needs a compatibility matrix the
  project does not want to maintain.
- **A handshake on the system topic.** Rejected: the transport has no history
  and no request/reply, so a handshake would need its own protocol, and an
  instance would still have to decide what to do with a peer it cannot talk to.

## Consequences

- Wire types can change without a migration path. A breaking change is a major
  bump of the spec and of every package, and the changelog says so.
- A future implementation in another language targets one spec version and
  states which one. Interoperability holds only between implementations of the
  same major version.
- If a mixed-version cluster becomes a real need, this decision is the place to
  revisit, and the system topic is the natural carrier.
