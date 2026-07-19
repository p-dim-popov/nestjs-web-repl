# nestjs-web-repl — live demo

A self-contained NestJS app that mounts [`nestjs-web-repl`](https://www.npmjs.com/package/nestjs-web-repl) and exposes a live REPL over HTTP + SSE, with the Monaco editor served from the package itself (no CDN).

**Open it in StackBlitz** (see the badge in the [main README](../../README.md#live-demo)) and the preview boots the app, then redirects to the REPL UI. First boot takes ~30–60s (dependency install + `ts-node` + Nest startup); after that it's instant.

See [`TRY-THESE.md`](./TRY-THESE.md) for commands to run.

Runs on the Express adapter — the one `nestjs-web-repl` is tested against.
