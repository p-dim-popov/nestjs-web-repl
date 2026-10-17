---
status: accepted
---

# One verify workflow, one runtime pin, every runtime blocking

## Context

After the split (ADR 0001) the verification recipe (Redis service, install,
build, typecheck, schema check, test) was written out by hand three times:
the Node job in `ci.yml`, the Bun/Deno job in `ci.yml` and the release job
in `release.yml`. The copies drifted: the release copy lacked the Redis
service and upgraded npm to a different major, so Release went red on `main`
while CI was green on the same commit (PR #38). Bun and Deno ran as
best-effort legs (issue #32) with a bash for-loop and a 30-line attribution
report embedded in YAML. The developer Node version was written nowhere; the
contract suite's need for a live Redis was visible only as `ECONNREFUSED`.

## Decision

1. **One verification module.** `.github/workflows/verify.yml` is a
   `workflow_call` workflow and the only place the verification recipe
   exists. `pr.yml` (on `pull_request`) calls it; `release.yml` (on push to
   `main`) calls it and runs the changesets job behind `needs: verify`. The
   release job itself verifies nothing. `release.yml` keeps its file name
   because npm trusted publishing is keyed on it. `main` is verified exactly
   once per push, by `release.yml`.
2. **Two jobs inside verify, with distinct questions.** The `dev` job is the
   contributor's laptop in CI: the Node version from `mise.toml`, no Redis,
   running typecheck, schema check, build and `npm test`; the contract suite
   skips itself there. It answers "does `npm test` pass without Docker?". The
   `runtime` matrix (Node 22, 24, 26, Bun, Deno) has a Redis service and
   `REDIS_REQUIRED=1` and runs the full suite through `npm run test:runtime
   -- <vitest command>`, the session canary and attribution report included.
   It answers "does the product work on this runtime?". The fast specs run in
   both; that overlap is accepted because the two questions cannot be
   answered by one job.
3. **Every runtime is blocking.** Bun and Deno are promoted from best-effort
   to supported; `continue-on-error` is gone. A red leg is fixed at the
   session seam (`packages/core/src/session/`) or the runtime is dropped from
   the matrix and the docs. The engine is never patched to chase a runtime.
   This reverses the best-effort rule of issue #32, which existed only until
   the legs were green.
4. **`mise.toml` is the single runtime pin.** It pins the dev Node by major
   line and Bun and Deno exactly; a composite `.github/actions/setup` action installs
   them with `mise-action`, restores the npm cache and runs `npm ci`, and
   every job uses it. Matrix Node legs select their version per command with
   `mise x node@<v>`. Floating `latest` runtime versions are gone, because a
   floating version plus a blocking leg is a red `main` with no commit.
5. **Redis lives in the runtime matrix only.** The contract suite declares
   its requirement once, in its harness: without a reachable Redis it skips
   with one warning; with `REDIS_REQUIRED=1` it fails with one message naming
   the fix. The suite is not moved: it tests multi-instance behaviour over
   the Redis transports, not runtime portability, and simply runs wherever
   Redis is present.

## Considered options

- A single workflow file with a `release` job gated by `needs`. Rejected:
  trusted publishing is keyed on `release.yml`.
- The runtime runner as the root `npm test`. Rejected: verifying the product
  on the developer's Node and probing a runtime for parity are different
  modules; `npm test` stays the plain npm-workspaces delegate.
- Static-only `dev` job to avoid the overlap. Rejected: nothing would then
  prove the no-Redis `npm test` path.

## Consequences

- Adding a step or a service to verification is one edit in `verify.yml`.
- A Bun or Deno regression blocks PRs and releases until fixed or dropped.
- Runtime versions go stale until someone bumps `mise.toml`; that is the
  accepted price of a stable `main`.
- Billed CI minutes grow by about one job per PR for the `dev` overlap.
- `engines` is bumped to `>=22` in a separate minor release; Node 20 was
  never tested and is end of life.
