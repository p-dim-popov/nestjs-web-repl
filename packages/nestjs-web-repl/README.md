# nestjs-web-repl

Live NestJS REPL over HTTP: a `POST` command endpoint, an SSE output stream and
a Monaco-based browser UI, backed by real `@nestjs/core` REPL sessions inside
the host app.

This package is a **compatibility shim**. The implementation moved to the
`@remote-repl` packages; `nestjs-web-repl` re-exports them under the name
existing installs already use:

| Import                  | Re-exports              |
| ----------------------- | ----------------------- |
| `nestjs-web-repl`       | `@remote-repl/nestjs`   |
| `nestjs-web-repl/redis` | `@remote-repl/redis`    |

Nothing else lives here. The exports, the peer dependencies (`@nestjs/common`,
`@nestjs/core`, `rxjs`, and the optional `ioredis` / `redis` clients) and the
behaviour are those of `@remote-repl/nestjs`, so no consumer code changes.

```ts
import { WebReplModule } from 'nestjs-web-repl';
import { IoRedisWebReplAdapter } from 'nestjs-web-repl/redis';
```

**Security:** the endpoints execute arbitrary code by design and the package
ships no authentication. Keep `enabled: false` outside trusted environments and
put the routes behind your own guard. Full documentation, options and the
security notes are in the repository README:
https://github.com/p-dim-popov/node-remote-repl#readme

This package ships no `bin`. Install the Claude Code skill with
`npx skills add p-dim-popov/node-remote-repl/skills/nestjs-web-repl`.

## License

MIT
