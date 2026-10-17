# @remote-repl/core

The framework- and runtime-agnostic core of remote-repl: the engine
(`RemoteReplEngine`), the wire protocol types, the in-memory transport
(`RemoteReplInMemoryTransport`), the browser UI (page template and Monaco
bundle) and the shared route handlers (`createRemoteReplHandlers`). The
framework packages (`@remote-repl/nestjs`, `@remote-repl/express`) build on
it; it has no framework, transport-client or RxJS dependency.

Install it directly only to write a new framework package or a new transport.
A transport implements `RemoteReplTransport` (`publish`, `subscribe`, optional
`close`). The engine uses the in-memory transport when none is given; a
cluster of instances needs one from `@remote-repl/redis`.

## Protocol

The wire protocol is specified in [`PROTOCOL.md`](./PROTOCOL.md) (prose,
versioned) and [`schema/protocol.schema.json`](./schema/protocol.schema.json)
(JSON Schema, generated from `src/protocol/messages.ts`). Both ship in the
package. Regenerate the schema after changing the types:

```bash
npm run schema:generate   # writes schema/protocol.schema.json
npm run schema:check      # exits 1 if the committed schema is out of date (CI)
```
