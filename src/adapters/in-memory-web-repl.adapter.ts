import { EventEmitter } from 'node:events';
import type { WebReplAdapter } from '../interfaces/web-repl-adapter.interface';

export class InMemoryWebReplAdapter implements WebReplAdapter {
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

  onModuleDestroy(): void {
    this.emitter.removeAllListeners();
  }
}
