import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export const SKILL_TARGET_SUBPATH = join(
  '.claude',
  'skills',
  'nestjs-web-repl',
  'SKILL.md',
);

export type InstallStatus = 'created' | 'up-to-date' | 'differs' | 'updated';

export interface InstallSkillOptions {
  cwd: string;
  force?: boolean;
  sourcePath?: string;
}

export interface InstallSkillResult {
  status: InstallStatus;
  path: string;
}

/**
 * Resolve the bundled skill source. Compiled to dist/cli/install-skill.js,
 * so the package root is two levels up; skill/SKILL.md lives there.
 */
export function defaultSourcePath(): string {
  return join(__dirname, '..', '..', 'skill', 'SKILL.md');
}

export function installSkill(options: InstallSkillOptions): InstallSkillResult {
  const { cwd, force = false } = options;
  const sourcePath = options.sourcePath ?? defaultSourcePath();
  const source = readFileSync(sourcePath, 'utf8');
  const path = join(cwd, SKILL_TARGET_SUBPATH);

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    return { status: 'created', path };
  }

  const current = readFileSync(path, 'utf8');
  if (current === source) {
    return { status: 'up-to-date', path };
  }
  if (!force) {
    return { status: 'differs', path };
  }
  writeFileSync(path, source);
  return { status: 'updated', path };
}
