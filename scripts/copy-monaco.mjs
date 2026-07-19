// Copies Monaco's min/vs tree into dist so it ships in the package and is
// served from our own origin (no CDN). Runs after tsc in `npm run build`.
// Uses fs.cpSync (no shell cp) so it works on any platform.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = join(root, 'dist', 'ui', 'vs');

if (!existsSync(src)) {
  console.error(`copy-monaco: source not found at ${src} (is monaco-editor installed?)`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-monaco: copied ${src} -> ${dest}`);
