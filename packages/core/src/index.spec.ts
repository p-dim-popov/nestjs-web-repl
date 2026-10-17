import * as core from './index';

// The barrel is the only seam consumers (the nestjs package today, other
// framework packages later) are allowed to import from.
describe('@remote-repl/core barrel', () => {
  it('exports the protocol constants and the ring buffer', () => {
    expect(core.REMOTE_REPL_TOPICS.cmd).toBe('remote-repl:cmd');
    expect(core.REMOTE_REPL_DEFAULTS.replayBufferSize).toBe(200);
    expect(new core.EventRingBuffer(2).isEmpty()).toBe(true);
  });
});

describe('@remote-repl/core barrel: session and transport', () => {
  it('exports ReplSession and the in-memory transport', () => {
    expect(typeof core.ReplSession).toBe('function');
    expect(typeof core.RemoteReplInMemoryTransport).toBe('function');
  });
});

describe('@remote-repl/core barrel: UI', () => {
  it('exports the UI renderer and the Monaco asset resolver', () => {
    expect(core.renderReplUi('ch')).toContain('<!doctype html>');
    expect(core.resolveMonacoFile('loader.js')).not.toBeNull();
  });
});

describe('@remote-repl/core barrel: HTTP helpers', () => {
  it('exports the SSE frame mapper and the landing helpers', () => {
    expect(core.toSseFrame({ id: 1, type: 'output', commandId: null, data: 'x' }, 0).id).toBe('1');
    expect(core.randomChannelName()).toHaveLength(8);
    expect(core.landingRedirectUrl('/repl', 'abc')).toBe('/repl/abc/ui');
  });
});

describe('@remote-repl/core barrel: engine', () => {
  it('exports the engine and its disabled error', () => {
    expect(typeof core.RemoteReplEngine).toBe('function');
    expect(new core.RemoteReplDisabledError()).toBeInstanceOf(Error);
  });
});

describe('@remote-repl/core barrel: route handlers', () => {
  it('exports the handler factory, its errors and the SSE wire constants', () => {
    expect(typeof core.createRemoteReplHandlers).toBe('function');
    expect(new core.RemoteReplInvalidCommandError().message).toBe('command must be a non-empty string');
    expect(core.parseRemoteReplLastEventId('3')).toBe(3);
    expect(core.REMOTE_REPL_SSE_RESPONSE_HEADERS['Content-Type']).toBe('text/event-stream');
    expect(core.sseFrameToText({ id: '1', type: 'message', data: 'x' })).toContain('id: 1\n');
  });
});

// Ticket #36: the public surface under the product's own names. The old names
// stay exported as aliases until every package has migrated (expand -> migrate
// -> contract); this block is what the contract step keeps.
describe('@remote-repl/core barrel: RemoteRepl* names', () => {
  it('exports the wire constants under REMOTE_REPL_* with remote-repl:* topics', () => {
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
