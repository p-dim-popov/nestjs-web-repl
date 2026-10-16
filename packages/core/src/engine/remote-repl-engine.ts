import { TOPICS, DEFAULTS } from '../protocol/constants';
import type { WebReplAdapter } from '../protocol/adapter';
import type { CmdMessage, OutMessage, SysMessage, WebReplEvent } from '../protocol/messages';
import type { WebReplOptions } from '../protocol/options';
import { EventRingBuffer } from '../ring-buffer';
import { ReplSession } from '../session/repl-session';

export type ContextFactory = () => Record<string, unknown>;

/** The minimal logger shape the engine needs; a Nest `Logger` or `console` both fit. */
export interface EngineLogger {
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Thrown by `dispatch()` (as a rejection) and `events()` / `openStream()`
 * (synchronously) when the engine was configured with `enabled: false`.
 * Framework adapters map it to their own 404.
 */
export class ReplDisabledError extends Error {
  constructor() {
    super('remote-repl is disabled');
    this.name = 'ReplDisabledError';
  }
}

/** Receives one subscriber's events; `complete` fires once on engine stop. */
export interface StreamSink {
  next(event: WebReplEvent): void;
  complete(): void;
}

/** Handle returned by `openStream()`; `close()` detaches the sink synchronously. */
export interface StreamSubscription {
  close(): void;
}

interface ChannelState {
  buffer: EventRingBuffer;
  // Live subscribers (the `openStream()` sinks currently attached).
  sinks: Set<StreamSink>;
  nextId: number;
  session?: ReplSession;
  ttlTimer?: ReturnType<typeof setTimeout>;
  currentCommandId: string | null;
  // Serializes the whole announce -> eval -> done unit per channel (not
  // just eval itself) so that currentCommandId is only ever the actively
  // executing command. See onCmd/executeCommand.
  execQueue: Promise<void>;
  // Count of live subscribers currently attached to this channel via
  // openStream(). Used by maybeEvict() to garbage-collect channels that were
  // created merely by an (unauthenticated) GET and never actually used.
  subscriberCount: number;
  // Count of commands currently claimed-for-execution-or-in-flight on this
  // channel (incremented synchronously in onCmd before any await,
  // decremented once the command's execQueue unit fully settles). Used by
  // maybeEvict() to guard against evicting a channel out from under an
  // in-flight command: without this, the last subscriber unsubscribing
  // between onCmd's getChannel() and executeCommand's ensureSession() could
  // evict this exact ChannelState, orphaning the freshly created
  // ReplSession and mis-tagging the command's output with commandId: null.
  pending: number;
}

/**
 * The framework-free REPL engine: transport pub/sub, channel ownership (a
 * heartbeat-renewed lease), per-channel serialized execution, output
 * fan-out, replay buffer, TTL + channel GC and runtime `enabled`
 * enforcement. Framework packages wrap it (nestjs: `WebReplService`).
 *
 * Members are plain TS `private` (never `#private`) on purpose: the
 * behaviour-preservation specs reach internals by name through `as any`.
 */
export class RemoteReplEngine {
  private readonly instanceId: string;
  private readonly sessionTtl: number;
  private readonly replayBufferSize: number;
  private readonly heartbeatInterval: number;
  private readonly enabled: boolean;
  private readonly ownership = new Map<string, string>();
  // Tracks, per channel, the clock() timestamp of the last claim/heartbeat
  // seen for its current owner -- the ownership *lease*. See onCmd's
  // staleness check and heartbeatOwnedChannels().
  private readonly ownerSeenAt = new Map<string, number>();
  private readonly ownerHeartbeatInterval: number;
  private readonly ownerLeaseTtl: number;
  private ownerHeartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly channels = new Map<string, ChannelState>();
  private counter = 0;

  constructor(
    options: WebReplOptions,
    private readonly adapter: WebReplAdapter,
    private readonly buildContext: ContextFactory,
    private readonly clock: () => number = () => Date.now(),
    private readonly logger: EngineLogger = console,
  ) {
    this.instanceId = options.instanceId ?? `inst_${Math.random().toString(36).slice(2, 10)}`;
    this.sessionTtl = options.sessionTtl ?? DEFAULTS.sessionTtl;
    this.replayBufferSize = options.replayBufferSize ?? DEFAULTS.replayBufferSize;
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULTS.heartbeatInterval;
    this.enabled = options.enabled;

    this.ownerHeartbeatInterval = options.ownerHeartbeatInterval ?? DEFAULTS.ownerHeartbeatInterval;
    const requestedLeaseTtl = options.ownerLeaseTtl ?? DEFAULTS.ownerLeaseTtl;
    // Enforce a MARGIN, not just strict inequality: a lease only one tick
    // above the heartbeat interval leaves zero slack for publish/adapter
    // delivery jitter (measured on a PEER's clock) -- a single heartbeat
    // delivered even slightly late could make a live owner look stale to
    // someone else, causing exactly the preemption/split-session/lost-vars
    // failure this feature exists to prevent. Requiring the lease to be at
    // least 2x the heartbeat interval guarantees a live owner always has at
    // least one full heartbeat interval of slack against jitter before it
    // could ever appear stale to a peer.
    const minLeaseTtl = this.ownerHeartbeatInterval * 2;
    if (requestedLeaseTtl < minLeaseTtl) {
      // Clamp rather than throw: this is a debugging tool, it shouldn't fail
      // boot over a misconfigured pair of durations.
      this.ownerLeaseTtl = minLeaseTtl;
      this.logger.warn(
        `ownerLeaseTtl (${requestedLeaseTtl}ms) must be at least 2x ` +
          `ownerHeartbeatInterval (${this.ownerHeartbeatInterval}ms) so a live owner ` +
          `always has a full heartbeat interval of slack against delivery jitter; ` +
          `clamping the effective lease to ${this.ownerLeaseTtl}ms`,
      );
    } else {
      this.ownerLeaseTtl = requestedLeaseTtl;
    }
  }

  async start(): Promise<void> {
    // CRITICAL: `enabled` is the product's only safety rail. Framework
    // wrappers always construct the engine (providers must be declared
    // statically) -- so this runtime check is what keeps a config-driven
    // `enabled: false` from silently subscribing to the command bus and
    // executing arbitrary code.
    if (!this.enabled) return;
    await this.adapter.subscribe(TOPICS.cmd, (m) => this.onCmd(this.parse<CmdMessage>(m)));
    await this.adapter.subscribe(TOPICS.out, (m) => this.onOut(this.parse<OutMessage>(m)));
    await this.adapter.subscribe(TOPICS.sys, (m) => this.onSys(this.parse<SysMessage>(m)));

    // Owner-liveness safety net: a live owner must keep renewing its lease
    // on every channel it owns, or another instance may treat that channel
    // as effectively ownerless once the lease expires (see onCmd). Only
    // started when enabled, mirroring the runtime `enabled` enforcement
    // above -- a disabled instance must never touch the adapter, including
    // via this timer.
    this.ownerHeartbeatTimer = setInterval(
      () => this.heartbeatOwnedChannels(),
      this.ownerHeartbeatInterval,
    );
    this.ownerHeartbeatTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.ownerHeartbeatTimer) clearInterval(this.ownerHeartbeatTimer);
    for (const state of this.channels.values()) {
      if (state.ttlTimer) clearTimeout(state.ttlTimer);
      state.session?.close();
      // Completing a sink typically makes its owner close() the
      // subscription, which may evict the channel while we iterate; Map
      // iteration tolerates deletion.
      for (const sink of [...state.sinks]) sink.complete();
    }
    this.channels.clear();
    await this.adapter.onModuleDestroy?.();
  }

  // Re-announces `claim` for every channel this instance currently owns and
  // still has a live session for -- i.e. is actually still running. This is
  // the heartbeat that keeps a live owner's lease from ever going stale
  // (see onCmd's leaseExpired check). A channel this instance owns per the
  // `ownership` map but no longer has a session for (e.g. torn down by a TTL
  // release already in flight) is intentionally NOT re-claimed here.
  private heartbeatOwnedChannels(): void {
    for (const [channel, state] of this.channels) {
      if (this.ownership.get(channel) !== this.instanceId) continue;
      if (!state.session) continue;
      void this.safePublish(TOPICS.sys, {
        channel,
        kind: 'claim',
        instanceId: this.instanceId,
      } satisfies SysMessage);
    }
  }

  /** Throws `ReplDisabledError` unless the engine was configured `enabled: true`. */
  protected assertEnabled(): void {
    if (!this.enabled) throw new ReplDisabledError();
  }

  async dispatch(channel: string, command: string): Promise<{ commandId: string }> {
    this.assertEnabled();
    const commandId = `cmd_${(++this.counter).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const msg: CmdMessage = { channel, commandId, command, originInstanceId: this.instanceId };
    await this.safePublish(TOPICS.cmd, msg);
    return { commandId };
  }

  /**
   * The synchronous subscription primitive both `events()` and framework
   * stream adapters (e.g. an RxJS Observable) build on. Creates the channel
   * state, counts the subscriber, replays the buffer SYNCHRONOUSLY into the
   * sink, attaches it for live events and starts this subscriber's
   * client-visible `{ping}` heartbeat. `close()` detaches synchronously and
   * runs the channel-eviction check, so a subscriber-less, session-less,
   * empty channel is gone the moment its last subscriber leaves.
   */
  openStream(channel: string, lastEventId: number | null, sink: StreamSink): StreamSubscription {
    this.assertEnabled();
    const state = this.getChannel(channel);
    state.subscriberCount++;
    // Attach before replaying so nothing published between the snapshot
    // and the live attachment can be missed; replay is synchronous and the
    // transport delivers asynchronously, so there is no gap or duplicate.
    state.sinks.add(sink);
    for (const event of state.buffer.since(lastEventId)) sink.next(event);
    // Client-visible keep-alive, per subscriber, never buffered or
    // published. Independent of the owner-liveness heartbeat.
    const ping = setInterval(
      () => sink.next({ id: 0, type: 'system', commandId: null, data: { ping: true } }),
      this.heartbeatInterval,
    );
    ping.unref?.();
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        state.sinks.delete(sink);
        this.onUnsubscribe(channel);
      },
    };
  }

  /**
   * Replayed events, then live events (and `{ping}` heartbeats), as an
   * async iterator. Throws `ReplDisabledError` synchronously when disabled.
   * The subscription is opened eagerly (so nothing published between this
   * call and the first `next()` is missed) and released by `return()` --
   * including a `return()` issued while a `next()` is still pending, which
   * settles that `next()` with `done: true` -- or by `stop()`.
   */
  events(channel: string, lastEventId: number | null): AsyncIterableIterator<WebReplEvent> {
    this.assertEnabled();
    const queue: WebReplEvent[] = [];
    let done = false;
    let waiter: ((result: IteratorResult<WebReplEvent, undefined>) => void) | undefined;
    const settle = () => {
      if (!waiter) return;
      const resolve = waiter;
      waiter = undefined;
      if (queue.length > 0) resolve({ value: queue.shift() as WebReplEvent, done: false });
      else if (done) resolve({ value: undefined, done: true });
    };
    const sub = this.openStream(channel, lastEventId, {
      next: (event) => {
        if (done) return;
        queue.push(event);
        settle();
      },
      complete: () => {
        done = true;
        settle();
      },
    });
    const finish = (): Promise<IteratorResult<WebReplEvent, undefined>> => {
      done = true;
      queue.length = 0;
      sub.close();
      settle();
      return Promise.resolve({ value: undefined, done: true });
    };
    return {
      next: () => {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift() as WebReplEvent, done: false });
        }
        if (done) {
          sub.close();
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          waiter = resolve;
        });
      },
      return: finish,
      throw: finish,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  private async onCmd(msg: CmdMessage): Promise<void> {
    const owner = this.ownership.get(msg.channel);
    const iAmOwner = owner === this.instanceId;

    // Lease staleness: an owned channel is only trusted for
    // `ownerLeaseTtl` since the last claim/heartbeat seen for it. A LIVE
    // owner heartbeats itself well within that window (ownerHeartbeatInterval
    // < ownerLeaseTtl is enforced in the constructor), so this never fires
    // for a healthy owner -- only for one that has stopped heartbeating
    // (crashed / killed without a clean shutdown).
    const seenAt = this.ownerSeenAt.get(msg.channel) ?? 0;
    const leaseExpired = owner !== undefined && this.clock() - seenAt > this.ownerLeaseTtl;
    // A channel whose lease expired under a DIFFERENT instance is treated
    // as ownerless for claiming purposes -- but never for the instance that
    // still (per its own map) believes it owns it; that instance keeps
    // executing via the `iAmOwner` branch below regardless of this flag.
    const effectivelyOwnerless = owner === undefined || (leaseExpired && owner !== this.instanceId);
    const isOrigin = msg.originInstanceId === this.instanceId;

    // Only the ORIGIN instance may claim an effectively-ownerless channel --
    // whether it's brand new or a stale takeover -- so every other instance
    // doesn't stampede the same claim.
    if (!iAmOwner && !(effectivelyOwnerless && isOrigin)) return;

    // Resolve (or create) the channel state and mark a command as pending
    // SYNCHRONOUSLY here, before any `await` below -- i.e. within the same
    // microtask that decided this instance will execute the command. This
    // closes a race with channel eviction (see maybeEvict): without a
    // `pending` guard set this early, the last subscriber could close its
    // stream -- and evict this exact ChannelState from `this.channels` --
    // in the window between here and executeCommand()'s ensureSession()
    // call. That would orphan the freshly created ReplSession on the now
    // off-map `state` object (never close()d) while later emit() calls
    // re-resolve through getChannel() to a brand new state, mis-tagging
    // this command's output with commandId: null and forcing a second,
    // disconnected ReplSession to be created for the next command on the
    // same channel.
    const state = this.getChannel(msg.channel);
    state.pending++;

    if (!iAmOwner) {
      // effectivelyOwnerless && isOrigin: either a brand-new channel, or a
      // takeover of a channel whose previous owner's lease went stale. On
      // takeover, the dead owner's in-memory session (and its variables) is
      // gone -- this instance starts a fresh session. That's an accepted,
      // documented trade-off: the channel becomes usable again instead of
      // being wedged fleet-wide forever.
      this.ownership.set(msg.channel, this.instanceId);
      this.ownerSeenAt.set(msg.channel, this.clock());
      await this.safePublish(TOPICS.sys, {
        channel: msg.channel,
        kind: 'claim',
        instanceId: this.instanceId,
      } satisfies SysMessage);
    }

    this.touchTtl(msg.channel, state);

    // Enqueue the whole announce -> eval -> done unit onto the channel's
    // own execution queue. Without this, a second command dispatched to
    // the same channel while the first's async output is still flushing
    // would run its (synchronous) echo + currentCommandId assignment
    // ahead of the first command's still-in-flight eval, mistagging the
    // first command's trailing output with the second command's id. This
    // guarantees currentCommandId is only ever the actively-executing
    // command, and that a queued command's echo is only emitted once it
    // actually starts executing (correct serial-execution semantics).
    //
    // Every link is wrapped so it always resolves, never rejects: if
    // executeCommand throws (e.g. the injected buildContext() factory or
    // the ReplSession constructor throws), an unguarded rejection would
    // permanently poison state.execQueue -- every later
    // `.then(onFulfilled)` chained onto an already-rejected promise is
    // silently skipped, so every subsequent command on the channel would
    // never execute again, with no client-visible error, until process
    // restart. Instead we log it and best-effort surface it to clients as
    // a `system` event tagged with the failing command's id, then let the
    // chain continue so the channel stays usable.
    state.execQueue = state.execQueue.then(() =>
      this.executeCommand(msg, state)
        .catch((err) => {
          this.logger.error(`command ${msg.commandId} on ${msg.channel} failed: ${String(err)}`);
          try {
            return this.emit(msg.channel, 'system', msg.commandId, {
              error: String((err as Error)?.message ?? err),
            });
          } catch (emitErr) {
            // emit() itself only throws synchronously if JSON.stringify
            // fails on a pathological error message; safePublish already
            // swallows adapter failures. Never let this poison the queue.
            this.logger.error(`failed to report command failure: ${String(emitErr)}`);
            return undefined;
          }
        })
        .finally(() => {
          // Only now -- once this command's announce -> eval -> done (or
          // error) unit has fully settled -- may the channel become
          // eviction-eligible again.
          state.pending--;
          this.maybeEvict(msg.channel, state);
        }),
    );
    await state.execQueue;
  }

  private async executeCommand(msg: CmdMessage, state: ChannelState): Promise<void> {
    const session = this.ensureSession(msg.channel, state);

    await this.emit(msg.channel, 'command', msg.commandId, {
      command: msg.command,
      instanceId: this.instanceId,
    });

    await session.eval(msg.command);

    // Silent statements (e.g. `const v = 10`) produce zero output chunks,
    // so SSE clients have no way to know the command finished without an
    // explicit completion signal. Emit one system event per executed
    // command, after all of its output chunks.
    await this.emit(msg.channel, 'system', msg.commandId, { done: true });
  }

  private ensureSession(channel: string, state: ChannelState): ReplSession {
    if (state.session) return state.session;
    const session = new ReplSession({
      context: this.buildContext(),
      onOutput: (chunk) => {
        // Guard against a stray late write from an in-flight eval landing
        // after this channel's session has been disposed/replaced (e.g.
        // by a TTL release, which clears the buffer) -- ReplSession does
        // not guarantee zero writes after close(). Comparing against the
        // session captured in this closure (rather than a boolean flag)
        // also correctly drops output from a session that's since been
        // replaced by a fresh one for the same channel.
        if (state.session !== session) return;
        void this.emit(channel, 'output', state.currentCommandId, chunk);
      },
    });
    state.session = session;
    return session;
  }

  private async emit(
    channel: string,
    type: WebReplEvent['type'],
    commandId: string | null,
    data: unknown,
  ): Promise<void> {
    const state = this.getChannel(channel);
    if (type === 'command') state.currentCommandId = commandId;
    const event: WebReplEvent = { id: ++state.nextId, type, commandId, data };
    await this.safePublish(TOPICS.out, { channel, event } satisfies OutMessage);
  }

  private onOut(msg: OutMessage): void {
    const state = this.getChannel(msg.channel);
    if (msg.event.id > state.nextId) state.nextId = msg.event.id;
    state.buffer.push(msg.event);
    for (const sink of [...state.sinks]) sink.next(msg.event);
  }

  private onSys(msg: SysMessage): void {
    if (msg.kind === 'claim') {
      this.ownership.set(msg.channel, msg.instanceId);
      this.ownerSeenAt.set(msg.channel, this.clock());
    } else {
      this.ownership.delete(msg.channel);
      this.ownerSeenAt.delete(msg.channel);
      const state = this.channels.get(msg.channel);
      if (state?.session) {
        state.session.close();
        state.session = undefined;
        state.buffer.clear();
      }
      if (state) this.maybeEvict(msg.channel, state);
    }
  }

  // openStream() (a bare GET on the HTTP side) creates and stores a
  // ChannelState for any channel name on first subscribe. Nothing else
  // removes it -- TTL release tears down the session+buffer but would leave
  // the ChannelState in the map forever. An unauthenticated client looping
  // `GET /repl/<random>` would grow `this.channels` without bound. Evict a
  // channel once it has no live subscribers AND no active session AND an
  // empty replay buffer -- a channel with buffered history but no
  // subscribers is deliberately kept around until TTL release clears its
  // buffer, so a reconnecting client can still replay.
  private onUnsubscribe(channel: string): void {
    const state = this.channels.get(channel);
    if (!state) return;
    state.subscriberCount = Math.max(0, state.subscriberCount - 1);
    this.maybeEvict(channel, state);
  }

  private maybeEvict(channel: string, state: ChannelState): void {
    if (state.pending > 0) return;
    if (state.subscriberCount > 0) return;
    if (state.session) return;
    if (!state.buffer.isEmpty()) return;
    this.channels.delete(channel);
    // Mirror the channel GC: a channel this instance no longer tracks state
    // for shouldn't keep a stale ownerSeenAt entry lying around (e.g. a
    // non-owner instance that watched a channel via SSE, saw a remote
    // claim/heartbeat for it, then had its own local ChannelState evicted).
    this.ownerSeenAt.delete(channel);
    // Deliberately NOT deleting `ownership` here (unlike the onSys release
    // branch, which deletes both): `ownership` is cluster-wide state --
    // every instance's map should agree on who owns a channel, and that
    // agreement is only supposed to change via an explicit claim/release
    // message, not as a side effect of one instance's local eviction
    // bookkeeping. `ownerSeenAt`, by contrast, is purely local staleness
    // tracking for this instance's own onCmd checks, so it's fine (and
    // necessary, to avoid leaking) to drop it here. In practice this
    // instance only ever reaches eviction-eligibility (no session, empty
    // buffer) for a channel it owns if execution never produced any
    // buffered output at all, which -- given emit() always buffers at least
    // an error/done system event before pending drops to 0 -- shouldn't
    // happen while genuinely owned; if a future refactor changes that
    // invariant, reconsider this asymmetry.
  }

  private touchTtl(channel: string, state: ChannelState): void {
    if (state.ttlTimer) clearTimeout(state.ttlTimer);
    state.ttlTimer = setTimeout(() => {
      void this.safePublish(TOPICS.sys, {
        channel,
        kind: 'release',
        instanceId: this.instanceId,
      } satisfies SysMessage);
    }, this.sessionTtl);
    state.ttlTimer.unref?.();
  }

  private getChannel(channel: string): ChannelState {
    let state = this.channels.get(channel);
    if (!state) {
      state = {
        buffer: new EventRingBuffer(this.replayBufferSize),
        sinks: new Set(),
        nextId: 0,
        currentCommandId: null,
        execQueue: Promise.resolve(),
        subscriberCount: 0,
        pending: 0,
      };
      this.channels.set(channel, state);
    }
    return state;
  }

  private async safePublish(topic: string, message: unknown): Promise<void> {
    try {
      await this.adapter.publish(topic, JSON.stringify(message));
    } catch (err) {
      this.logger.error(`adapter publish failed on ${topic}: ${String(err)}`);
    }
  }

  private parse<T>(message: string): T {
    return JSON.parse(message) as T;
  }
}
