import { renderReplUi } from './repl-ui.html';

describe('renderReplUi', () => {
  const html = renderReplUi('main');

  it('places the Run bar between the output and the editor', () => {
    const out = html.indexOf('id="out"');
    const bar = html.indexOf('id="bar"');
    const editor = html.indexOf('id="editor"');
    expect(out).toBeGreaterThanOrEqual(0);
    expect(bar).toBeGreaterThan(out);
    expect(editor).toBeGreaterThan(bar);
  });

  it('sizes the app to the dynamic viewport so the bar is not clipped on mobile', () => {
    expect(html).toContain('100dvh');
  });

  it('enlarges Run and hides the Ctrl+Enter hint on narrow screens', () => {
    expect(html).toMatch(/@media\s*\(max-width:\s*600px\)/);
    expect(html).toMatch(/#run\s+\.kbd-hint\s*\{\s*display:\s*none/);
    expect(html).toMatch(/min-height:\s*44px/);
  });

  it('rebalances the editor to a usable height on narrow screens', () => {
    // Mobile gives the editor a floor so it is not a thin strip under a huge
    // output pane.
    expect(html).toMatch(/#editor\{[^}]*min-height:\s*200px/);
  });

  it('shows a placeholder while there is no output yet', () => {
    expect(html).toMatch(/#out:empty::before\{content:'[^']+'/);
  });

  it('keeps the Ctrl+Enter hint in the desktop markup', () => {
    expect(html).toContain('class="kbd-hint"');
    expect(html).toContain('(Ctrl+Enter)');
  });

  it('escapes an unsafe channel name so it cannot break out of the script', () => {
    const evil = renderReplUi('</script><b>x');
    expect(evil).not.toContain('</script><b>x');
    expect(evil).toContain('\\u003c');
  });
});
