import type { NodeRedisLike } from '../../src/adapters/redis/node-redis-web-repl.adapter';

type Listener = (message: string, channel: string) => void;

/** Shared in-memory pub/sub bus modelling one Redis server. */
export class FakeRedisBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(channel: string, message: string): number {
    const set = this.listeners.get(channel);
    if (!set) return 0;
    for (const l of set) l(message, channel);
    return set.size;
  }

  add(channel: string, listener: Listener): void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set<Listener>();
      this.listeners.set(channel, set);
    }
    set.add(listener);
  }

  remove(entries: Array<[string, Listener]>): void {
    for (const [channel, l] of entries) this.listeners.get(channel)?.delete(l);
  }
}

/** node-redis v4-shaped fake client bound to a bus. */
export class FakeNodeRedis implements NodeRedisLike {
  connected = false;
  quitCalled = false;
  connectCount = 0;
  readonly duplicates: FakeNodeRedis[] = [];
  private readonly own: Array<[string, Listener]> = [];

  constructor(private readonly bus: FakeRedisBus) {}

  async publish(channel: string, message: string): Promise<number> {
    return this.bus.publish(channel, message);
  }

  async subscribe(channel: string, listener: Listener): Promise<void> {
    if (!this.connected) throw new Error('subscribe called before connect');
    this.own.push([channel, listener]);
    this.bus.add(channel, listener);
  }

  duplicate(): FakeNodeRedis {
    const child = new FakeNodeRedis(this.bus);
    this.duplicates.push(child);
    return child;
  }

  async connect(): Promise<void> {
    this.connectCount++;
    this.connected = true;
  }

  async quit(): Promise<void> {
    this.quitCalled = true;
    this.bus.remove(this.own);
    this.connected = false;
  }
}
