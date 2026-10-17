#!/usr/bin/env node
// The runtime probe (ADR 0006): run the whole suite on one runtime and say
// where a failure belongs. Usage:
//
//   npm run test:runtime -- <vitest command...>
//   npm run test:runtime -- bun --bun x vitest run
//   npm run test:runtime -- deno run -A npm:vitest run --pool=threads
//   npm run test:runtime -- mise x node@22 -- npx vitest run
//
// 1. The session spec runs FIRST, alone: it is the `node:repl` parity canary
//    (sentinel prompt, continuation prompt, buffered-command state are
//    verified only on Node). See AGENTS.md "Runtime support".
// 2. Then every package's suite, in a loop, through the given command, so
//    vitest runs under THAT runtime (the root `npm test` would run it under
//    Node, because vitest's bin has a node shebang).
// 3. Then the attribution: a red canary means "session layer"; a red suite
//    with a green canary means "elsewhere". Written to $GITHUB_STEP_SUMMARY
//    when set, otherwise to stdout. Exit 0 only when both are green.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: npm run test:runtime -- <vitest command...>');
  process.exit(2);
}

const SESSION_SPEC = 'src/session/repl-session.spec.ts';
const SESSION_SEAM = 'packages/core/src/session/';

const run = (cwd, extra = []) => {
  const result = spawnSync(cmd, [...args, ...extra], { cwd, stdio: 'inherit', shell: false });
  return result.status === 0;
};

const group = (title, body) => {
  if (process.env.GITHUB_ACTIONS) console.log(`::group::${title}`);
  else console.log(`\n== ${title}`);
  try {
    return body();
  } finally {
    if (process.env.GITHUB_ACTIONS) console.log('::endgroup::');
  }
};

const session = group(`session canary (packages/core/${SESSION_SPEC})`, () =>
  run(join(root, 'packages', 'core'), [SESSION_SPEC]),
);

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
let suite = true;
for (const name of packages) {
  const ok = group(`packages/${name}`, () => run(join(root, 'packages', name), ['--passWithNoTests']));
  suite = suite && ok;
}

const outcome = (ok) => (ok ? 'success' : 'failure');
const lines = [
  `## runtime probe: ${[cmd, ...args].join(' ')}`,
  '',
  '| step | outcome |',
  '|---|---|',
  `| session canary (\`packages/core/${SESSION_SPEC}\`) | ${outcome(session)} |`,
  `| full suite | ${outcome(suite)} |`,
  '',
];
if (!session) {
  lines.push(
    '**Attribution: session layer.** `node:repl` completion detection (sentinel',
    'prompt, continuation prompt, buffered-command state) is verified only on Node.',
    'Do not patch the engine or weaken the spec: the drop-in point is the session',
    `seam (\`${SESSION_SEAM}\`, the \`ReplSession\` surface the engine constructs).`,
    'A runtime-specific session implementation goes there, or the runtime is',
    'dropped from the matrix.',
  );
} else if (!suite) {
  lines.push(
    '**Attribution: outside the session layer** (the session canary passed).',
    'Look at the failing package in the log; the `node:repl` seam is not the cause.',
  );
} else {
  lines.push('All green on this runtime.');
}
const report = lines.join('\n') + '\n';
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
else console.log('\n' + report);

process.exit(session && suite ? 0 : 1);
