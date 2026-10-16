import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';

// Resolve Monaco's `min/vs` directory. In a published install the build
// step (scripts/copy-monaco.mjs) copied it next to this compiled module at
// dist/ui/vs. When running from source (dev/test) that copy is absent, so
// fall back to the monaco-editor devDependency resolved from node_modules.
let cachedVsDir: string | undefined;
export function monacoVsDir(): string {
  if (cachedVsDir) return cachedVsDir;
  const bundled = join(__dirname, 'vs');
  cachedVsDir = existsSync(bundled)
    ? bundled
    : dirname(require.resolve('monaco-editor/min/vs/loader.js'));
  return cachedVsDir;
}

const MIME_BY_EXT: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export interface MonacoAsset {
  buffer: Buffer;
  contentType: string;
}

// Resolve one file under the vs root. Returns null for a miss, a directory,
// OR any path that escapes the root -- the sole traversal guard for the
// asset route. path.join neutralizes a leading "/" (absolute paths become
// root-relative) and normalize collapses ".." so the startsWith check
// reliably rejects escapes.
export function resolveMonacoFile(relPath: string): MonacoAsset | null {
  const root = monacoVsDir();
  const full = normalize(join(root, relPath));
  if (full !== root && !full.startsWith(root + sep)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  const ext = extname(full).toLowerCase();
  return {
    buffer: readFileSync(full),
    contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
  };
}
