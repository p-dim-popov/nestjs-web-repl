import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject, defer, merge, from, interval } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { WEB_REPL_ADAPTER, WEB_REPL_OPTIONS, TOPICS, DEFAULTS } from './constants';
import type { WebReplAdapter } from './interfaces/web-repl-adapter.interface';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';
import type {
  CmdMessage,
  OutMessage,
  SysMessage,
  WebReplEvent,
} from './interfaces/web-repl-messages.interface';
import { EventRingBuffer } from './ring-buffer';
import { ReplSession } from './session/repl-session';

type ContextFactory = () => Record<string, unknown>;

interface ChannelState {
  buffer: EventRingBuffer;
  live: Subject<WebReplEvent>;
  nextId: number;
  session?: ReplSession;
  ttlTimer?: NodeJS.Timeout;
  currentCommandId: string | null;
  // Serializes the whole announce -> eval -> done unit per channel (not
  // just eval itself) so that currentCommandId is only ever the actively
  // executing command. See onCmd/executeCommand.
  execQueue: Promise<void>;
  // Count of live SSE subscribers currently attached to this channel's
  // stream(). Used by maybeEvict() to garbage-collect channels that were
  // created merely by an (unauthenticated) GET and never actually used --
  // see IMPORTANT 3 in the review.
  subscriberCount: number;
  // Count of commands currently claimed-for-execution-or-in-flight on this
  // channel (incremented synchronously in onCmd before any await,
  // decremented once the command's execQueue unit fully settles). Used by
  // maybeEvict() to guard against evicting a channel out from under an
  // in-flight command: without this, the last SSE subscriber unsubscribing
  // between onCmd's getChannel() and executeCommand's ensureSession() could
  // evict this exact ChannelState, orphaning the freshly created
  // ReplSession and mis-tagging the command's output with commandId: null.
  pending: number;
}

@Injectable()
export class WebReplService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WebReplService');
  private readonly instanceId: string;
  private readonly sessionTtl: number;
  private readonly replayBufferSize: number;
  private readonly heartbeatInterval: number;
  private readonly enabled: boolean;
  private readonly ownership = new Map<string, string>();
  private readonly channels = new Map<string, ChannelState>();
  private counter = 0;

  constructor(
    @Inject(WEB_REPL_OPTIONS) private readonly options: WebReplModuleOptions,
    @Inject(WEB_REPL_ADAPTER) private readonly adapter: WebReplAdapter,
    @Inject('WEB_REPL_CONTEXT_FACTORY') private readonly buildContext: ContextFactory,
  ) {
    this.instanceId = options.instanceId ?? `inst_${Math.random().toString(36).slice(2, 10)}`;
    this.sessionTtl = options.sessionTtl ?? DEFAULTS.sessionTtl;
    this.replayBufferSize = options.replayBufferSize ?? DEFAULTS.replayBufferSize;
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULTS.heartbeatInterval;
    this.enabled = options.enabled;
  }

  async onModuleInit(): Promise<void> {
    // CRITICAL: `enabled` is the product's only safety rail. forRoot()
    // already refuses to register anything when disabled, but
    // forRootAsync() resolves options at DI time and always registers this
    // service/controller -- so this runtime check is what keeps a
    // config-driven `enabled: false` (e.g. from forRootAsync) from
    // silently subscribing to the command bus and executing arbitrary code.
    if (!this.enabled) return;
    await this.adapter.subscribe(TOPICS.cmd, (m) => this.onCmd(this.parse<CmdMessage>(m)));
    await this.adapter.subscribe(TOPICS.out, (m) => this.onOut(this.parse<OutMessage>(m)));
    await this.adapter.subscribe(TOPICS.sys, (m) => this.onSys(this.parse<SysMessage>(m)));
  }

  async onModuleDestroy(): Promise<void> {
    for (const state of this.channels.values()) {
      if (state.ttlTimer) clearTimeout(state.ttlTimer);
      state.session?.close();
      state.live.complete();
    }
    this.channels.clear();
    await this.adapter.onModuleDestroy?.();
  }

  async dispatch(channel: string, command: string): Promise<{ commandId: string }> {
    if (!this.enabled) throw new NotFoundException();
    const commandId = `cmd_${(++this.counter).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const msg: CmdMessage = { channel, commandId, command, originInstanceId: this.instanceId };
    await this.safePublish(TOPICS.cmd, msg);
    return { commandId };
  }

  stream(channel: string, lastEventId: number | null): Observable<WebReplEvent> {
    if (!this.enabled) throw new NotFoundException();
    // Wrapped in defer() so the replay snapshot is taken -- and the
    // subscriber-count bookkeeping runs -- at SUBSCRIBE time rather than
    // when the controller calls stream(). Without this, an event
    // published between the call to stream() and Nest actually attaching
    // the subscription would be missed by both the frozen replay snapshot
    // and the not-yet-attached live subscription (MINOR 4).
    return defer(() => {
      const state = this.getChannel(channel);
      state.subscriberCount++;
      const replayed = state.buffer.since(lastEventId);
      const heartbeat = interval(this.heartbeatInterval).pipe(
        map(
          (): WebReplEvent => ({ id: 0, type: 'system', commandId: null, data: { ping: true } }),
        ),
      );
      return merge(from(replayed), state.live.asObservable(), heartbeat).pipe(
        finalize(() => this.onUnsubscribe(channel)),
      );
    });
  }

  private async onCmd(msg: CmdMessage): Promise<void> {
    const owner = this.ownership.get(msg.channel);
    const iAmOwner = owner === this.instanceId;
    const noOwner = owner === undefined;

    if (!iAmOwner && !(noOwner && msg.originInstanceId === this.instanceId)) return;

    // Resolve (or create) the channel state and mark a command as pending
    // SYNCHRONOUSLY here, before any `await` below -- i.e. within the same
    // microtask that decided this instance will execute the command. This
    // closes a race with channel eviction (see maybeEvict / IMPORTANT 3):
    // without a `pending` guard set this early, the last SSE subscriber
    // could unsubscribe -- and evict this exact ChannelState from
    // `this.channels` -- in the window between here and
    // executeCommand()'s ensureSession() call. That would orphan the
    // freshly created ReplSession on the now off-map `state` object (never
    // close()d) while later emit() calls re-resolve through getChannel()
    // to a brand new state, mis-tagging this command's output with
    // commandId: null and forcing a second, disconnected ReplSession to be
    // created for the next command on the same channel.
    const state = this.getChannel(msg.channel);
    state.pending++;

    if (noOwner) {
      this.ownership.set(msg.channel, this.instanceId);
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
    state.live.next(msg.event);
  }

  private onSys(msg: SysMessage): void {
    if (msg.kind === 'claim') {
      this.ownership.set(msg.channel, msg.instanceId);
    } else {
      this.ownership.delete(msg.channel);
      const state = this.channels.get(msg.channel);
      if (state?.session) {
        state.session.close();
        state.session = undefined;
        state.buffer.clear();
      }
      if (state) this.maybeEvict(msg.channel, state);
    }
  }

  // IMPORTANT 3: stream() (a bare GET) creates and stores a ChannelState
  // for any channel name on first subscribe. Nothing else removes it --
  // TTL release tears down the session+buffer but previously left the
  // ChannelState (and its live Subject) in the map forever. An
  // unauthenticated client looping `GET /repl/<random>` would grow
  // `this.channels` without bound. Evict a channel once it has no live SSE
  // subscribers AND no active session AND an empty replay buffer -- a
  // channel with buffered history but no subscribers is deliberately kept
  // around until TTL release clears its buffer, so a reconnecting client
  // can still replay.
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
        live: new Subject<WebReplEvent>(),
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
