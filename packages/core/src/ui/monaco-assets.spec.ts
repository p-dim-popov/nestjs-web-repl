import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monacoVsDir, resolveMonacoFile } from './monaco-assets';

describe('resolveMonacoFile', () => {
  it('serves loader.js as JavaScript', () => {
    const asset = resolveMonacoFile('loader.js');
    expect(asset).not.toBeNull();
    expect(asset!.contentType).toBe('text/javascript');
    expect(asset!.buffer.length).toBeGreaterThan(0);
  });

  it('serves a nested worker file as JavaScript', () => {
    const asset = resolveMonacoFile('base/worker/workerMain.js');
    expect(asset).not.toBeNull();
    expect(asset!.contentType).toBe('text/javascript');
  });

  it('serves editor CSS as text/css', () => {
    const asset = resolveMonacoFile('editor/editor.main.css');
    expect(asset).not.toBeNull();
    expect(asset!.contentType).toBe('text/css');
  });

  it('serves the codicon font as font/ttf', () => {
    const asset = resolveMonacoFile('base/browser/ui/codicons/codicon/codicon.ttf');
    expect(asset).not.toBeNull();
    expect(asset!.contentType).toBe('font/ttf');
  });

  it('returns null for a relative path escaping the vs root', () => {
    expect(resolveMonacoFile('../../package.json')).toBeNull();
  });

  it('returns null for an absolute path outside the root', () => {
    expect(resolveMonacoFile('/etc/passwd')).toBeNull();
  });

  it('returns null for a missing file inside the root', () => {
    expect(resolveMonacoFile('does-not-exist.js')).toBeNull();
  });
});

// Two layouts must both work: running from source (dev/test) falls back to
// the monaco-editor devDependency through Node's resolver (hoisted to the
// workspace root), while a published install serves the copy that
// scripts/copy-monaco.mjs placed at dist/ui/vs next to the compiled module.
describe('monacoVsDir', () => {
  it('falls back to the monaco-editor package when no bundled copy sits next to the module', () => {
    expect(monacoVsDir()).toMatch(/node_modules[\\/]monaco-editor[\\/]min[\\/]vs$/);
  });

  it('prefers a bundled `vs` sibling of the given module directory when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-monaco-'));
    try {
      mkdirSync(join(dir, 'vs'));
      writeFileSync(join(dir, 'vs', 'loader.js'), '// bundled');
      expect(monacoVsDir(dir)).toBe(join(dir, 'vs'));
      const asset = resolveMonacoFile('loader.js', dir);
      expect(asset!.buffer.toString()).toBe('// bundled');
      expect(asset!.contentType).toBe('text/javascript');
      expect(resolveMonacoFile('../loader.js', dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Under a runtime or module format where neither CJS global is available
// (no `__dirname`, no `require.resolve`), the asset route must degrade to
// "asset not found" (null), never throw out of the handler.
describe('monacoVsDir without a bundled copy or a working package resolver', () => {
  const failingResolver = () => {
    throw new Error('require.resolve is unavailable');
  };

  it('returns null instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-monaco-'));
    try {
      expect(monacoVsDir(dir, failingResolver)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes resolveMonacoFile report every asset as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-monaco-'));
    try {
      expect(resolveMonacoFile('loader.js', dir, failingResolver)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
