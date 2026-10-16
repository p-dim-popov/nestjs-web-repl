import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The build step must find monaco-editor through Node's resolver: in the
// npm-workspaces monorepo it is hoisted to the root node_modules, so a
// hardcoded <package>/node_modules path would break the published layout.
describe('scripts/copy-monaco.mjs', () => {
  const src = readFileSync(join(__dirname, 'copy-monaco.mjs'), 'utf8');

  it('resolves the monaco source via createRequire, never a hardcoded node_modules path', () => {
    expect(src).toContain("resolve('monaco-editor/min/vs/loader.js')");
    expect(src).not.toMatch(/['"`][^'"`\n]*node_modules[^'"`\n]*monaco-editor/);
  });

  it("copies into this package's dist/ui/vs, a sibling of the compiled monaco-assets module", () => {
    expect(src).toMatch(/'dist',\s*'ui',\s*'vs'/);
  });
});
