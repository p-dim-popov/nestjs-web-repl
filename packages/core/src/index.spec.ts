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
