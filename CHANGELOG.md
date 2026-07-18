# 1.0.0 (2026-07-18)


### Bug Fixes

* add --passWithNoTests flag to test script for clean exit on empty test suite ([00378f4](https://github.com/p-dim-popov/nestjs-web-repl/commit/00378f4e7eb94c120440fb22ee46b2cf5bf317b9))
* add timeout and npm cache to release workflow ([2896f2d](https://github.com/p-dim-popov/nestjs-web-repl/commit/2896f2d925a02716c86fdb81e6cde3004195677f))
* close pending-command eviction race in channel garbage collection ([55dfca1](https://github.com/p-dim-popov/nestjs-web-repl/commit/55dfca1b1a02ca7b6ded7124fec6c2700c5a774f))
* detect genuine incomplete input via buffered-command state, not first continuation prompt ([a4b1028](https://github.com/p-dim-popov/nestjs-web-repl/commit/a4b1028f51c9e76dc3097ca5795276c5dd2ea70e))
* enforce a 2x lease/heartbeat margin, not just strict inequality ([36ae39d](https://github.com/p-dim-popov/nestjs-web-repl/commit/36ae39d23d7a8e752832210b1642217b41a07618))
* enforce enabled at runtime, fix SSE heartbeat id/channel leak/replay gap ([c8a486f](https://github.com/p-dim-popov/nestjs-web-repl/commit/c8a486f7d49ca00f333fee2c5a8e4a4d177d13d5))
* isolate execQueue errors so a failing command can't kill a channel ([d4897b7](https://github.com/p-dim-popov/nestjs-web-repl/commit/d4897b730cd5ab3c8340bd8bd99a6aad54099ece))
* neutralize reflected XSS via :channel in the inline UI script ([3246b69](https://github.com/p-dim-popov/nestjs-web-repl/commit/3246b692bffe788ea4ecb40b651aa2522c85d63f))
* randomize eval sentinel per session, recover from incomplete input ([4b97885](https://github.com/p-dim-popov/nestjs-web-repl/commit/4b978852e3ba4fcb8984a37f5a5569b04e202767))
* replace timing-based repl eval completion with sentinel-prompt detection ([d301d57](https://github.com/p-dim-popov/nestjs-web-repl/commit/d301d574de50fb4ea30fba3571176f88517258a2))
* serialize per-channel execute path, guard late output after release ([6d09a27](https://github.com/p-dim-popov/nestjs-web-repl/commit/6d09a27695a2ddefd1e504e27d5d2a8c4732054c))


### Features

* add adapter contract and in-memory adapter ([5a1dcb7](https://github.com/p-dim-popov/nestjs-web-repl/commit/5a1dcb78520c9a715c4d0404b6d42ddbca551caf))
* add constants and core message/option types ([9540904](https://github.com/p-dim-popov/nestjs-web-repl/commit/9540904a14fc422ce44f8aeb356138a00ee39e22))
* add dynamic module, context factory, and public barrel ([b56f587](https://github.com/p-dim-popov/nestjs-web-repl/commit/b56f587cc02539baea28a444feead19ef5bd688b))
* add node:repl-backed session with context seeding and output capture ([9fd164a](https://github.com/p-dim-popov/nestjs-web-repl/commit/9fd164a94475ce2802b0202bfeb4c331fe211b42))
* add per-channel event ring buffer ([12bfabf](https://github.com/p-dim-popov/nestjs-web-repl/commit/12bfabf3ce6606fb8542e423462eed72aeef1b63))
* add REPL controller and inlined Monaco UI ([09358fd](https://github.com/p-dim-popov/nestjs-web-repl/commit/09358fd8f89d0290660ece206b887ee1757b3996))
* add web-repl session engine with ownership, fan-out, replay ([a8d6fdb](https://github.com/p-dim-popov/nestjs-web-repl/commit/a8d6fdb451dcc046784c09e5ecc368a455fe8c3e))
* lease-based channel ownership to survive unclean owner death ([5dda2c2](https://github.com/p-dim-popov/nestjs-web-repl/commit/5dda2c2ed6763a36210f0aaa1467b2e21558fe84))
