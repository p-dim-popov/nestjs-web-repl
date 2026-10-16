import {
  BaseRedisWebReplAdapter,
  type RedisWebReplAdapterOptions,
} from './base-redis-web-repl.adapter';

/** Minimal structural surface of a node-redis v4 client (no `redis` import). */
export interface NodeRedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>;
  duplicate(): NodeRedisLike;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
}

/**
 * Redis adapter backed by node-redis v4. Pass one connected client (the
 * publisher); the adapter duplicates it, connects the copy (v4 duplicates start
 * disconnected), and owns that subscriber connection.
 */
export class NodeRedisWebReplAdapter extends BaseRedisWebReplAdapter {
  private subscriber?: NodeRedisLike;
  private connecting?: Promise<NodeRedisLike>;

  constructor(
    private readonly publisher: NodeRedisLike,
    options?: RedisWebReplAdapterOptions,
  ) {
    super(options);
  }

  private async ensureSubscriber(): Promise<NodeRedisLike> {
    if (this.subscriber) return this.subscriber;
    if (!this.connecting) {
      const sub = this.publisher.duplicate();
      this.connecting = sub.connect().then(() => {
        this.subscriber = sub;
        return sub;
      });
    }
    return this.connecting;
  }

  protected async doPublish(topic: string, message: string): Promise<void> {
    await this.publisher.publish(topic, message);
  }

  protected async ensureSubscribed(topic: string): Promise<void> {
    const sub = await this.ensureSubscriber();
    await sub.subscribe(topic, (message) => this.dispatch(topic, message));
  }

  protected async teardown(): Promise<void> {
    // Detach BEFORE awaiting quit(): Nest invokes onModuleDestroy on this
    // adapter (it is a provider) AND WebReplService calls it again, so two
    // teardowns run concurrently on shutdown. A real client throws on a
    // second quit(); clearing the field first makes the second call a no-op.
    const sub = this.subscriber;
    this.subscriber = undefined;
    this.connecting = undefined;
    if (sub) await sub.quit();
  }
}
