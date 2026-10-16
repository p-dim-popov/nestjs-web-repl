import * as core from './index';

// The barrel is the only seam consumers (the nestjs package today, other
// framework adapters later) are allowed to import from.
describe('@remote-repl/core barrel', () => {
  it('exports the protocol constants and the ring buffer', () => {
    expect(core.TOPICS.cmd).toBe('webrepl:cmd');
    expect(core.DEFAULTS.replayBufferSize).toBe(200);
    expect(new core.EventRingBuffer(2).isEmpty()).toBe(true);
  });
});

describe('@remote-repl/core barrel: session and transport', () => {
  it('exports ReplSession and the in-memory adapter', () => {
    expect(typeof core.ReplSession).toBe('function');
    expect(typeof core.InMemoryWebReplAdapter).toBe('function');
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
    expect(new core.ReplDisabledError()).toBeInstanceOf(Error);
  });
});

describe('@remote-repl/core barrel: route handlers', () => {
  it('exports the handler factory, its errors and the SSE wire constants', () => {
    expect(typeof core.createReplHandlers).toBe('function');
    expect(new core.InvalidCommandError().message).toBe('command must be a non-empty string');
    expect(core.parseLastEventId('3')).toBe(3);
    expect(core.SSE_RESPONSE_HEADERS['Content-Type']).toBe('text/event-stream');
    expect(core.sseFrameToText({ id: '1', type: 'message', data: 'x' })).toContain('id: 1\n');
  });
});
