import { resolveMonacoFile } from './monaco-assets';

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
