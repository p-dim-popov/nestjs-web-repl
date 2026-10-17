import { EventEmitter } from 'node:events';
import type { RemoteReplTransport } from '../protocol/transport';

/** The default transport: one process, every instance in the same event loop. */
export class RemoteReplInMemoryTransport implements RemoteReplTransport {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publish(topic: string, message: string): Promise<void> {
    queueMicrotask(() => this.emitter.emit(topic, message));
  }

  async subscribe(topic: string, handler: (message: string) => void): Promise<void> {
    this.emitter.on(topic, handler);
  }

  close(): void {
    this.emitter.removeAllListeners();
  }
}
