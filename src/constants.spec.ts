import { TOPICS, DEFAULTS, WEB_REPL_OPTIONS, WEB_REPL_ADAPTER } from './constants';

describe('constants', () => {
  it('exposes the fixed adapter topics', () => {
    expect(TOPICS).toEqual({ cmd: 'webrepl:cmd', out: 'webrepl:out', sys: 'webrepl:sys' });
  });
  it('exposes sane defaults', () => {
    expect(DEFAULTS.sessionTtl).toBe(1_800_000);
    expect(DEFAULTS.replayBufferSize).toBe(200);
    expect(DEFAULTS.heartbeatInterval).toBe(15_000);
  });
  it('exposes distinct DI tokens', () => {
    expect(typeof WEB_REPL_OPTIONS).toBe('symbol');
    expect(WEB_REPL_OPTIONS).not.toBe(WEB_REPL_ADAPTER);
  });
});
