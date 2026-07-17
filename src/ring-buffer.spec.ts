import { EventRingBuffer } from './ring-buffer';
import type { WebReplEvent } from './interfaces/web-repl-messages.interface';

const ev = (id: number): WebReplEvent => ({ id, type: 'output', commandId: null, data: `e${id}` });

describe('EventRingBuffer', () => {
  it('returns all events for a null cursor', () => {
    const b = new EventRingBuffer(10);
    b.push(ev(1)); b.push(ev(2));
    expect(b.since(null).map((e) => e.id)).toEqual([1, 2]);
  });

  it('returns only events after the cursor', () => {
    const b = new EventRingBuffer(10);
    [1, 2, 3].forEach((i) => b.push(ev(i)));
    expect(b.since(2).map((e) => e.id)).toEqual([3]);
  });

  it('drops oldest beyond capacity', () => {
    const b = new EventRingBuffer(2);
    [1, 2, 3].forEach((i) => b.push(ev(i)));
    expect(b.since(null).map((e) => e.id)).toEqual([2, 3]);
  });

  it('clear empties the buffer', () => {
    const b = new EventRingBuffer(10);
    b.push(ev(1)); b.clear();
    expect(b.since(null)).toEqual([]);
  });
});
