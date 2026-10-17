import * as core from './index';

// The barrel is the public API of @remote-repl/core and the only seam the
// framework packages import from. Its runtime keys are pinned here: the ring
// buffer, the Node session implementation, the UI renderer, the Monaco asset
// resolver and the SSE/landing helpers stay internal and are reached through
// the handlers (ADR 0005). Types are checked by the typecheck, not here.
describe('@remote-repl/core barrel', () => {
  it('exports exactly the public runtime surface', () => {
    expect(Object.keys(core).sort()).toEqual(
      [
        'REMOTE_REPL_DEFAULTS',
        'REMOTE_REPL_SSE_RESPONSE_HEADERS',
        'REMOTE_REPL_SSE_STREAM_PREAMBLE',
        'REMOTE_REPL_TOPICS',
        'RemoteReplDisabledError',
        'RemoteReplEngine',
        'RemoteReplInMemoryTransport',
        'RemoteReplInvalidCommandError',
        'createRemoteReplHandlers',
        'parseRemoteReplLastEventId',
      ].sort(),
    );
  });

  it('exports the wire constants with remote-repl:* topics', () => {
    expect(core.REMOTE_REPL_TOPICS).toEqual({
      cmd: 'remote-repl:cmd',
      out: 'remote-repl:out',
      sys: 'remote-repl:sys',
    });
    expect(core.REMOTE_REPL_DEFAULTS.replayBufferSize).toBe(200);
  });

  it('exports the engine, the in-memory transport and both errors', () => {
    expect(typeof core.RemoteReplEngine).toBe('function');
    expect(typeof core.RemoteReplInMemoryTransport).toBe('function');
    expect(new core.RemoteReplDisabledError()).toBeInstanceOf(Error);
    expect(new core.RemoteReplInvalidCommandError().message).toBe('command must be a non-empty string');
  });

  it('exports the handler factory and the SSE wire helpers', () => {
    expect(typeof core.createRemoteReplHandlers).toBe('function');
    expect(core.parseRemoteReplLastEventId('3')).toBe(3);
    expect(core.REMOTE_REPL_SSE_RESPONSE_HEADERS['Content-Type']).toBe('text/event-stream');
    expect(core.REMOTE_REPL_SSE_STREAM_PREAMBLE).toBe('\n');
  });
});
