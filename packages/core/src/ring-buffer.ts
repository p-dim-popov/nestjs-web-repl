import type { RemoteReplEvent } from './protocol/messages';

export class EventRingBuffer {
  private readonly events: RemoteReplEvent[] = [];

  constructor(private readonly capacity: number) {}

  push(event: RemoteReplEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  since(lastEventId: number | null): RemoteReplEvent[] {
    if (lastEventId === null) return [...this.events];
    return this.events.filter((e) => e.id > lastEventId);
  }

  clear(): void {
    this.events.length = 0;
  }

  isEmpty(): boolean {
    return this.events.length === 0;
  }
}
