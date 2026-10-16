import { WEB_REPL_OPTIONS, WEB_REPL_ADAPTER, WEB_REPL_CLOCK } from './constants';

describe('DI tokens', () => {
  it('exposes distinct DI tokens', () => {
    expect(typeof WEB_REPL_OPTIONS).toBe('symbol');
    expect(WEB_REPL_OPTIONS).not.toBe(WEB_REPL_ADAPTER);
    expect(typeof WEB_REPL_CLOCK).toBe('symbol');
    expect(WEB_REPL_CLOCK).not.toBe(WEB_REPL_OPTIONS);
    expect(WEB_REPL_CLOCK).not.toBe(WEB_REPL_ADAPTER);
  });
});
