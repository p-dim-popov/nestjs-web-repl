# @remote-repl/core

The framework- and runtime-agnostic core of remote-repl: REPL sessions, the
wire protocol types, the in-memory transport, the browser UI (page template and Monaco bundle) and the
SSE helpers. Framework adapters (`nestjs-web-repl` today) build on it; it has
no framework, transport-client or RxJS dependency.

## Protocol

The wire protocol is specified in [`PROTOCOL.md`](./PROTOCOL.md) (prose,
versioned) and [`schema/protocol.schema.json`](./schema/protocol.schema.json)
(JSON Schema, generated from `src/protocol/messages.ts`). Both ship in the
package. Regenerate the schema after changing the types:

```bash
npm run schema:generate   # writes schema/protocol.schema.json
npm run schema:check      # exits 1 if the committed schema is out of date (CI)
```
