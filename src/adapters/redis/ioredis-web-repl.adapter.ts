import { BaseRedisWebReplAdapter } from './base-redis-web-repl.adapter';

/** Minimal structural surface of an ioredis client (no `ioredis` import). */
export interface IoRedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  duplicate(): IoRedisLike;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}

/**
 * Redis adapter backed by ioredis. Pass one connected client (the publisher);
 * the adapter creates and owns a duplicated subscriber connection.
 */
export class IoRedisWebReplAdapter extends BaseRedisWebReplAdapter {
  private subscriber?: IoRedisLike;

  constructor(private readonly publisher: IoRedisLike) {
    super();
  }

  private ensureSubscriber(): IoRedisLike {
    if (!this.subscriber) {
      this.subscriber = this.publisher.duplicate();
      this.subscriber.on('message', (channel, message) => this.dispatch(channel, message));
    }
    return this.subscriber;
  }

  protected async doPublish(topic: string, message: string): Promise<void> {
    await this.publisher.publish(topic, message);
  }

  protected async ensureSubscribed(topic: string): Promise<void> {
    await this.ensureSubscriber().subscribe(topic);
  }

  protected async teardown(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }
  }
}
