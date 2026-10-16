import { toSseFrame } from './sse-frame';

// A heartbeat frame (WebReplEvent with id: 0) must not clobber the browser
// EventSource's reconnection cursor. Omitting `id` is not an option either:
// SSE servers (Nest's SseStream among them) auto-assign their own counter to
// an id-less message, reproducing the "reconnect replays everything" bug
// through a different number. So every heartbeat is stamped with the id of
// the last real event sent on that connection (or the client's own cursor if
// none has flowed yet), which is idempotent for Last-Event-ID per the spec.
describe('toSseFrame (SSE event mapping)', () => {
  it('returns a plain frame object: string id, type "message", JSON data', () => {
    const event = { id: 7, type: 'output' as const, commandId: 'cmd_1', data: 'hi' };
    expect(toSseFrame(event, 3)).toEqual({
      id: '7',
      type: 'message',
      data: '{"id":7,"type":"output","commandId":"cmd_1","data":"hi"}',
    });
  });

  it('stamps the heartbeat sentinel event (id: 0) with the supplied lastRealId', () => {
    const frame = toSseFrame({ id: 0, type: 'system', commandId: null, data: { ping: true } }, 5);
    expect(frame.id).toBe('5');
  });

  it('stamps a fresh-connection heartbeat (no real event sent yet) with "0"', () => {
    const frame = toSseFrame({ id: 0, type: 'system', commandId: null, data: { ping: true } }, 0);
    expect(frame.id).toBe('0');
  });

  it("uses the event's own id for a normal (non-heartbeat) event, ignoring lastRealId", () => {
    const frame = toSseFrame({ id: 7, type: 'output', commandId: 'cmd_1', data: 'hi' }, 3);
    expect(frame.id).toBe('7');
  });
});
