import { Logger } from '@nestjs/common';
import type { WebReplAdapter } from '../../interfaces/web-repl-adapter.interface';

type Handler = (message: string) => void;

/**
 * Library-agnostic Redis pub/sub bridge. Subclasses wire the abstract hooks to a
 * concrete client. Topics are opaque; the service owns the `webrepl:*` names.
 */
export abstract class BaseRedisWebReplAdapter implements WebReplAdapter {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly subscribed = new Set<string>();
  private readonly logger = new Logger(this.constructor.name);

  async publish(topic: string, message: string): Promise<void> {
    await this.doPublish(topic, message);
  }

  async subscribe(topic: string, handler: Handler): Promise<void> {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set<Handler>();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    if (!this.subscribed.has(topic)) {
      await this.ensureSubscribed(topic);
      this.subscribed.add(topic);
    }
  }

  /** Fan an inbound message out to every handler registered for the topic. */
  protected dispatch(topic: string, message: string): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(message);
      } catch (err) {
        // A handler fault (e.g. malformed inbound JSON on a shared Redis
        // channel) must not escape into the client's message emitter and crash
        // the process, nor abort delivery to the remaining handlers.
        this.logger.error(
          `web-repl adapter handler for "${topic}" threw: ${String(err)}`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.teardown();
    this.handlers.clear();
    this.subscribed.clear();
  }

  protected abstract doPublish(topic: string, message: string): Promise<void>;
  protected abstract ensureSubscribed(topic: string): Promise<void>;
  protected abstract teardown(): Promise<void>;
}
