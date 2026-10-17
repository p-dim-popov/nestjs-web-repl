import type { RemoteReplTransport } from '@remote-repl/core';

type Handler = (message: string) => void;

/**
 * Minimal logger surface the transports report through. Any object with
 * `warn`/`error` fits: `console`, a Nest `Logger`, pino, a custom sink.
 */
export interface RemoteReplRedisLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface RemoteReplRedisTransportOptions {
  /**
   * Prepended verbatim to every topic name on the wire (e.g. `'my-app:'`), so
   * two apps sharing one Redis never exchange REPL output or ownership.
   * Default: none -- topic names are byte-identical to the engine's own.
   */
  prefix?: string;
  /**
   * Where handler faults are reported. Default: `console` -- a fault is never
   * silently swallowed, and the package carries no framework logger.
   */
  logger?: RemoteReplRedisLogger;
}

/**
 * Library-agnostic Redis pub/sub bridge. Subclasses wire the abstract hooks to a
 * concrete client. Topics are opaque; the engine owns the `remote-repl:*` names.
 * The abstract hooks and `dispatch` speak WIRE topic names (prefix applied);
 * the public `publish`/`subscribe` speak the engine's bare names.
 */
export abstract class RemoteReplBaseRedisTransport implements RemoteReplTransport {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly subscribed = new Set<string>();
  private readonly logger: RemoteReplRedisLogger;
  private readonly prefix: string;

  constructor(options: RemoteReplRedisTransportOptions = {}) {
    this.prefix = options.prefix ?? '';
    this.logger = options.logger ?? console;
  }

  async publish(topic: string, message: string): Promise<void> {
    await this.doPublish(this.prefix + topic, message);
  }

  async subscribe(topic: string, handler: Handler): Promise<void> {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set<Handler>();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    if (!this.subscribed.has(topic)) {
      await this.ensureSubscribed(this.prefix + topic);
      this.subscribed.add(topic);
    }
  }

  /** Fan an inbound message (by WIRE topic) out to every handler registered for the bare topic. */
  protected dispatch(wireTopic: string, message: string): void {
    if (!wireTopic.startsWith(this.prefix)) return;
    const topic = wireTopic.slice(this.prefix.length);
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
          `[${this.constructor.name}] remote-repl transport handler for "${topic}" threw: ${String(err)}`,
        );
      }
    }
  }

  async close(): Promise<void> {
    await this.teardown();
    this.handlers.clear();
    this.subscribed.clear();
  }

  protected abstract doPublish(topic: string, message: string): Promise<void>;
  protected abstract ensureSubscribed(topic: string): Promise<void>;
  protected abstract teardown(): Promise<void>;
}
