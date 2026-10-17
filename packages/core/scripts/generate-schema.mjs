#!/usr/bin/env node
// Generates schema/protocol.schema.json FROM the TypeScript wire types in
// src/protocol/messages.ts (the source of truth; see PROTOCOL.md).
//
//   node scripts/generate-schema.mjs            write the schema
//   node scripts/generate-schema.mjs --check    regenerate in memory and exit 1
//                                               if the committed file differs
//   node scripts/generate-schema.mjs [--check] --out <path>   override the target
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const outIdx = args.indexOf('--out');
const outPath = outIdx === -1 ? join(pkgRoot, 'schema', 'protocol.schema.json') : resolve(args[outIdx + 1]);

export function generateProtocolSchema() {
  const generator = createGenerator({
    path: join(pkgRoot, 'src', 'protocol', 'messages.ts'),
    tsconfig: join(pkgRoot, 'tsconfig.json'),
    type: '*',
    schemaId: 'https://github.com/p-dim-popov/remote-repl/blob/main/packages/core/schema/protocol.schema.json',
    topRef: true,
    expose: 'export',
    jsDoc: 'extended',
    additionalProperties: false,
    sortProps: true,
    skipTypeCheck: true,
  });
  return JSON.stringify(generator.createSchema(), null, 2) + '\n';
}

const fresh = generateProtocolSchema();
if (check) {
  let committed = null;
  try {
    committed = readFileSync(outPath, 'utf8');
  } catch {
    // missing file: handled below
  }
  if (committed !== fresh) {
    console.error(
      `[schema:check] ${outPath} is out of date with src/protocol/messages.ts.\n` +
        `Run "npm run schema:generate --workspace @remote-repl/core" and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`[schema:check] ${outPath} is up to date.`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, fresh);
  console.log(`[schema:generate] wrote ${outPath}`);
}
