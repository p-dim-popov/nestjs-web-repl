import { REMOTE_REPL_TOPICS, REMOTE_REPL_DEFAULTS } from './constants';

describe('protocol constants', () => {
  it('exposes the fixed transport topics under the remote-repl: prefix', () => {
    expect(REMOTE_REPL_TOPICS).toEqual({
      cmd: 'remote-repl:cmd',
      out: 'remote-repl:out',
      sys: 'remote-repl:sys',
    });
  });
  it('exposes sane defaults', () => {
    expect(REMOTE_REPL_DEFAULTS.sessionTtl).toBe(1_800_000);
    expect(REMOTE_REPL_DEFAULTS.replayBufferSize).toBe(200);
    expect(REMOTE_REPL_DEFAULTS.heartbeatInterval).toBe(15_000);
    expect(REMOTE_REPL_DEFAULTS.ownerHeartbeatInterval).toBe(10_000);
    expect(REMOTE_REPL_DEFAULTS.ownerLeaseTtl).toBe(30_000);
  });
  it('the owner lease default is strictly greater than the owner heartbeat default', () => {
    expect(REMOTE_REPL_DEFAULTS.ownerLeaseTtl).toBeGreaterThan(REMOTE_REPL_DEFAULTS.ownerHeartbeatInterval);
  });
});
