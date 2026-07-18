#!/usr/bin/env node
import { installSkill } from './install-skill';

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

const USAGE = `nestjs-web-repl — CLI

Usage:
  nestjs-web-repl install-skill [--force]   Install the Claude Code skill into
                                            ./.claude/skills/nestjs-web-repl/

Options:
  --force    Overwrite an existing, locally modified SKILL.md
  --help     Show this help
`;

export function run(argv: string[], cwd: string): RunResult {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    return { code: 0, out: USAGE, err: '' };
  }

  if (subcommand === 'install-skill') {
    const force = rest.includes('--force');
    try {
      const { status, path } = installSkill({ cwd, force });
      switch (status) {
        case 'created':
          return { code: 0, out: `created ${path}\n`, err: '' };
        case 'up-to-date':
          return { code: 0, out: `up to date ${path}\n`, err: '' };
        case 'updated':
          return { code: 0, out: `updated ${path}\n`, err: '' };
        case 'differs':
          return {
            code: 1,
            out: '',
            err:
              `differs from the shipped version: ${path}\n` +
              `re-run with --force to overwrite\n`,
          };
      }
    } catch (err) {
      return { code: 1, out: '', err: `error: ${(err as Error).message}\n` };
    }
  }

  return { code: 2, out: '', err: `unknown command: ${subcommand}\n\n${USAGE}` };
}

if (require.main === module) {
  const result = run(process.argv.slice(2), process.cwd());
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err);
  process.exit(result.code);
}
