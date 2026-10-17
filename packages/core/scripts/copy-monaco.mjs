// Copies Monaco's min/vs tree into dist so it ships in the package and is
// served from our own origin (no CDN). Runs after tsc in `npm run build`.
// Uses fs.cpSync (no shell cp) so it works on any platform.
//
// The source is located through Node's resolver rather than a hardcoded
// node_modules path: in the npm-workspaces monorepo, monaco-editor is hoisted
// to the workspace root, not this package's own node_modules.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(packageRoot, 'dist', 'ui', 'vs');

let src;
try {
  src = dirname(createRequire(import.meta.url).resolve('monaco-editor/min/vs/loader.js'));
} catch {
  console.error('copy-monaco: cannot resolve monaco-editor/min/vs (is monaco-editor installed?)');
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`copy-monaco: source not found at ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-monaco: copied ${src} -> ${dest}`);
