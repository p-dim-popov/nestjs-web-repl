import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';

// Resolve Monaco's `min/vs` directory. In a published install the build
// step (scripts/copy-monaco.mjs) copied it next to this compiled module at
// dist/ui/vs. When running from source (dev/test) that copy is absent, so
// fall back to the monaco-editor devDependency through Node's resolver
// (in the workspace it is hoisted to the root node_modules; the resolver
// walks up from this file, so no path is hardcoded).
//
// `moduleDir` is injectable so the bundled-copy branch is testable; the
// result is cached only for the real module directory.
let cachedVsDir: string | undefined;
export function monacoVsDir(moduleDir: string = __dirname): string {
  const isDefault = moduleDir === __dirname;
  if (isDefault && cachedVsDir) return cachedVsDir;
  const bundled = join(moduleDir, 'vs');
  const vsDir = existsSync(bundled)
    ? bundled
    : dirname(require.resolve('monaco-editor/min/vs/loader.js'));
  if (isDefault) cachedVsDir = vsDir;
  return vsDir;
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
export function resolveMonacoFile(relPath: string, moduleDir?: string): MonacoAsset | null {
  const root = monacoVsDir(moduleDir);
  const full = normalize(join(root, relPath));
  if (full !== root && !full.startsWith(root + sep)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  const ext = extname(full).toLowerCase();
  return {
    buffer: readFileSync(full),
    contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
  };
}
