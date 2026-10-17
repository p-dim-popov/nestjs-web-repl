import {
  RemoteReplBaseRedisTransport,
  type RemoteReplRedisTransportOptions,
} from './base-redis.transport';

/** Minimal structural surface of an ioredis client (no `ioredis` import). */
export interface RemoteReplIoRedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  duplicate(): RemoteReplIoRedisLike;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}

/**
 * Redis transport backed by ioredis. Pass one connected client (the publisher);
 * the transport creates and owns a duplicated subscriber connection.
 */
export class RemoteReplIoRedisTransport extends RemoteReplBaseRedisTransport {
  private subscriber?: RemoteReplIoRedisLike;

  constructor(
    private readonly publisher: RemoteReplIoRedisLike,
    options?: RemoteReplRedisTransportOptions,
  ) {
    super(options);
  }

  private ensureSubscriber(): RemoteReplIoRedisLike {
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
    // Detach before awaiting quit() -- see RemoteReplNodeRedisTransport.teardown.
    const sub = this.subscriber;
    this.subscriber = undefined;
    if (sub) await sub.quit();
  }
}
