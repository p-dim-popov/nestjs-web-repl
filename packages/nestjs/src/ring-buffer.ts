import type { WebReplEvent } from './interfaces/web-repl-messages.interface';

export class EventRingBuffer {
  private readonly events: WebReplEvent[] = [];

  constructor(private readonly capacity: number) {}

  push(event: WebReplEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  since(lastEventId: number | null): WebReplEvent[] {
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
