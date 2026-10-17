# nestjs-web-repl

Live NestJS REPL over HTTP: a `POST` command endpoint, an SSE output stream and
a Monaco browser UI, backed by real `@nestjs/core` REPL sessions inside the
host app.

This package is a **compatibility shim**. The implementation lives in the
`@remote-repl` packages. `nestjs-web-repl` keeps the names that 2.3.x apps
import, as deprecated aliases, and also exports the new names:

| Import                  | Contains                                                              |
| ----------------------- | --------------------------------------------------------------------- |
| `nestjs-web-repl`       | everything in `@remote-repl/nestjs`, plus the legacy aliases below    |
| `nestjs-web-repl/redis` | everything in `@remote-repl/redis`, plus the legacy aliases below     |

An app on 2.3.x needs no code change:

```ts
import { WebReplModule } from 'nestjs-web-repl';
import { IoRedisWebReplAdapter } from 'nestjs-web-repl/redis';

WebReplModule.register({
  enabled: process.env.REPL_ENABLED === 'true',
  adapter: new IoRedisWebReplAdapter(client),
});
```

The peer dependencies (`@nestjs/common`, `@nestjs/core`, `rxjs`, and the
optional `ioredis` / `redis` clients) and the behaviour are those of
`@remote-repl/nestjs`.

> **Wire change.** 2.4.0 speaks the `remote-repl` wire protocol 1.0.0. It is
> not interoperable with 2.3.x on one Redis. During a rolling upgrade the old
> and the new instances do not see each other; the window closes when the last
> 2.3.x instance stops. See `PROTOCOL.md` §8.1 in `@remote-repl/core`.

## Migration

Every legacy name is a `@deprecated` alias of its replacement. Your editor
shows the replacement on hover. To migrate, install `@remote-repl/nestjs`
(and `@remote-repl/redis` if you use it) and rename:

| `nestjs-web-repl` (deprecated) | `@remote-repl/nestjs`                                   |
| ------------------------------ | ------------------------------------------------------- |
| `WebReplModule`                | `RemoteReplModule`                                      |
| `register({ adapter })`        | `register({ transport })` (same values: instance, class, `{ useClass }`, `{ useFactory }`) |
| `WebReplController`            | `RemoteReplController`                                  |
| `WebReplService`               | `RemoteReplService`                                     |
| `InMemoryWebReplAdapter`       | `RemoteReplInMemoryTransport`                           |
| `WEB_REPL_OPTIONS`             | `REMOTE_REPL_OPTIONS`                                   |
| `WebReplAdapter`               | `RemoteReplTransport` (`onModuleDestroy()` → `close()`) |
| `WebReplModuleOptions`         | `RemoteReplModuleOptions`                               |
| `WebReplModuleExtras`          | `RemoteReplModuleExtras`                                |
| `WebReplAdapterConfig`         | `RemoteReplTransportConfig`                             |
| `WebReplEvent`                 | `RemoteReplEvent`                                       |
| `SseEventType`                 | `RemoteReplSseEventType`                                |

| `nestjs-web-repl/redis` (deprecated) | `@remote-repl/redis`               |
| ------------------------------------ | ---------------------------------- |
| `IoRedisWebReplAdapter`              | `RemoteReplIoRedisTransport`       |
| `NodeRedisWebReplAdapter`            | `RemoteReplNodeRedisTransport`     |
| `BaseRedisWebReplAdapter`            | `RemoteReplBaseRedisTransport`     |
| `RedisWebReplAdapterOptions`         | `RemoteReplRedisTransportOptions`  |
| `RedisWebReplLogger`                 | `RemoteReplRedisLogger`            |
| `IoRedisLike`, `NodeRedisLike`       | `RemoteReplIoRedisLike`, `RemoteReplNodeRedisLike` |

A transport that implements only `onModuleDestroy()` keeps working: the engine
calls it when `close()` is absent. There is no runtime deprecation warning.

**Security:** the endpoints execute arbitrary code by design and the package
ships no authentication. Keep `enabled: false` outside trusted environments and
put the routes behind your own guard. Full documentation, options and the
security notes are in the repository README:
https://github.com/p-dim-popov/remote-repl#readme

This package ships no `bin`. Install the Claude Code skill with
`npx skills add p-dim-popov/remote-repl/skills/nestjs-web-repl`.

## License

MIT
