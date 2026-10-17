import { REMOTE_REPL_OPTIONS, REMOTE_REPL_TRANSPORT, REMOTE_REPL_CLOCK } from './constants';

describe('DI tokens', () => {
  it('exposes distinct DI tokens', () => {
    expect(typeof REMOTE_REPL_OPTIONS).toBe('symbol');
    expect(REMOTE_REPL_OPTIONS).not.toBe(REMOTE_REPL_TRANSPORT);
    expect(typeof REMOTE_REPL_CLOCK).toBe('symbol');
    expect(REMOTE_REPL_CLOCK).not.toBe(REMOTE_REPL_OPTIONS);
    expect(REMOTE_REPL_CLOCK).not.toBe(REMOTE_REPL_TRANSPORT);
  });
});
