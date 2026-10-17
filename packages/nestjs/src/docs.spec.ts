import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// Repo-level documentation coherence: every path the contributor and consumer
// docs point at must exist in the tree, the glossary must define the shared
// vocabulary, and the ADRs must record the split decisions. Lives in this
// package because it already owns the repo-root pins (see packaging.spec.ts).
const repoRoot = join(process.cwd(), '..', '..');
const readDoc = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const packageDirs = readdirSync(join(repoRoot, 'packages'));

// Path-like tokens in backticks (`packages/core/src/...`) or in relative
// markdown links (`](./examples/stackblitz)`). Root-anchored prefixes are
// checked from the repo root; package-relative prefixes (`src/...`,
// `test/...`, `example/...`, `scripts/...`, `schema/...`) pass when at least
// one package contains them. Globs are checked up to the first `*`; build
// outputs (`dist/`) and generic placeholders (`<name>`) are skipped.
const ROOT_PREFIX = /^(packages|docs|skills|examples|\.github)\//;
const PACKAGE_PREFIX = /^(src|test|example|scripts|schema)\//;
const PATH_CHARS = /^[\w./*-]+$/;

function referencedPaths(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/`([^`\n]+)`/g)) out.add(m[1]);
  for (const m of markdown.matchAll(/\]\(\.\/([^)#\s]+)/g)) out.add(m[1]);
  return [...out]
    .map((t) => t.replace(/\/$/, ''))
    .filter((t) => PATH_CHARS.test(t))
    .filter((t) => ROOT_PREFIX.test(t) || PACKAGE_PREFIX.test(t))
    .map((t) => t.split('*')[0].replace(/\/$/, ''));
}

function exists(rel: string): boolean {
  if (existsSync(join(repoRoot, rel))) return true;
  return packageDirs.some((p) => existsSync(join(repoRoot, 'packages', p, rel)));
}

describe.each(['README.md', 'AGENTS.md', 'CONTRIBUTING.md'])('%s', (doc) => {
  it('references only paths that exist in the tree', () => {
    const missing = referencedPaths(readDoc(doc)).filter((p) => !exists(p));
    expect(missing).toEqual([]);
  });
});

describe('README.md', () => {
  const readme = readDoc('README.md');

  it.each([
    '@remote-repl/core',
    '@remote-repl/nestjs',
    '@remote-repl/express',
    '@remote-repl/redis',
    'nestjs-web-repl',
  ])('documents the package %s', (name) => {
    expect(readme).toContain(`\`${name}\``);
  });

  it('gives the Express quick start with createReplEngine + createReplRouter', () => {
    expect(readme).toContain('createReplEngine(');
    expect(readme).toContain('createReplRouter(');
  });

  it('uses the same skills.sh install commands as the skills', () => {
    for (const dir of readdirSync(join(repoRoot, 'skills'))) {
      expect(readme).toContain(`npx skills add p-dim-popov/node-remote-repl/skills/${dir}`);
    }
  });

  it('points at the protocol spec', () => {
    expect(readme).toContain('packages/core/PROTOCOL.md');
  });
});

describe('GLOSSARY.md', () => {
  const glossary = readDoc('GLOSSARY.md');

  it.each([
    'Engine',
    'Channel',
    'Transport',
    'Framework adapter',
    'Shared handler layer',
    'Lease',
    'Claim',
    'Release',
    'Topic prefix',
    'Protocol',
    'UI bundle',
    'Shim',
  ])('defines the term %s', (term) => {
    expect(glossary).toMatch(new RegExp(`^\\*\\*${term}[^*]*\\*\\*:`, 'm'));
  });
});

describe('docs/adr', () => {
  const adrDir = join(repoRoot, 'docs', 'adr');
  const adrs = readdirSync(adrDir).filter((f) => f.endsWith('.md'));

  it.each([
    ['the package split', /package/i],
    ['no rxjs in core', /rxjs/i],
    ['no wire protocol version', /wire.*version|protocol.*version/i],
  ])('records %s', (_what, pattern) => {
    expect(adrs.some((f) => pattern.test(readFileSync(join(adrDir, f), 'utf8')))).toBe(true);
  });

  it('every ADR has Context, Decision and Consequences sections', () => {
    expect(adrs.length).toBeGreaterThanOrEqual(3);
    for (const f of adrs) {
      const body = readFileSync(join(adrDir, f), 'utf8');
      for (const section of ['## Context', '## Decision', '## Consequences']) {
        expect(body, `${f} lacks ${section}`).toContain(section);
      }
    }
  });
});
