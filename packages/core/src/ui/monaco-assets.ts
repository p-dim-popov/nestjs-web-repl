import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';

// Resolve Monaco's `min/vs` directory. In a published install the build
// step (scripts/copy-monaco.mjs) copied it next to this compiled module at
// dist/ui/vs. When running from source (dev/test) that copy is absent, so
// fall back to the monaco-editor devDependency through the module resolver
// (in the workspace it is hoisted to the root node_modules; the resolver
// walks up from this file, so no path is hardcoded).
//
// Both lookups lean on CJS globals (`__dirname`, `require.resolve`) that an
// ESM-ish or non-Node runtime may not provide. Each is guarded: a missing
// global is treated as "that lookup is unavailable", and when nothing
// resolves the result is null (the asset route answers 404), never a throw
// out of the handler. `moduleDir` and `resolvePackage` are injectable so
// both layouts and the unavailable case are testable; the result is cached
// only for the real module directory with the real resolver.
let cachedVsDir: string | null | undefined;

function defaultModuleDir(): string | undefined {
  return typeof __dirname === 'string' ? __dirname : undefined;
}

function resolveMonacoPackage(): string {
  if (typeof require !== 'function' || typeof require.resolve !== 'function') {
    throw new Error('require.resolve is unavailable in this module format');
  }
  return dirname(require.resolve('monaco-editor/min/vs/loader.js'));
}

export function monacoVsDir(
  moduleDir: string | undefined = defaultModuleDir(),
  resolvePackage: () => string = resolveMonacoPackage,
): string | null {
  const isDefault = moduleDir === defaultModuleDir() && resolvePackage === resolveMonacoPackage;
  if (isDefault && cachedVsDir !== undefined) return cachedVsDir;
  const bundled = moduleDir === undefined ? undefined : join(moduleDir, 'vs');
  let vsDir: string | null;
  if (bundled !== undefined && existsSync(bundled)) {
    vsDir = bundled;
  } else {
    try {
      vsDir = resolvePackage();
    } catch {
      vsDir = null;
    }
  }
  if (isDefault) cachedVsDir = vsDir;
  return vsDir;
}

const MIME_BY_EXT: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export interface RemoteReplAsset {
  buffer: Buffer;
  contentType: string;
}

// Resolve one file under the vs root. Returns null for a miss, a directory,
// an unresolvable root, OR any path that escapes the root -- the sole
// traversal guard for the asset route. path.join neutralizes a leading "/"
// (absolute paths become root-relative) and normalize collapses ".." so the
// startsWith check reliably rejects escapes.
export function resolveMonacoFile(
  relPath: string,
  moduleDir?: string,
  resolvePackage?: () => string,
): RemoteReplAsset | null {
  const root = monacoVsDir(moduleDir, resolvePackage);
  if (root === null) return null;
  const full = normalize(join(root, relPath));
  if (full !== root && !full.startsWith(root + sep)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  const ext = extname(full).toLowerCase();
  return {
    buffer: readFileSync(full),
    contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
  };
}
