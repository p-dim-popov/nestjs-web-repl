import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject, merge, from, interval } from 'rxjs';
import { map } from 'rxjs/operators';
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
}

@Injectable()
export class WebReplService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WebReplService');
  private readonly instanceId: string;
  private readonly sessionTtl: number;
  private readonly replayBufferSize: number;
  private readonly heartbeatInterval: number;
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
  }

  async onModuleInit(): Promise<void> {
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
    const commandId = `cmd_${(++this.counter).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const msg: CmdMessage = { channel, commandId, command, originInstanceId: this.instanceId };
    await this.safePublish(TOPICS.cmd, msg);
    return { commandId };
  }

  stream(channel: string, lastEventId: number | null): Observable<WebReplEvent> {
    const state = this.getChannel(channel);
    const replayed = state.buffer.since(lastEventId);
    const heartbeat = interval(this.heartbeatInterval).pipe(
      map(
        (): WebReplEvent => ({ id: 0, type: 'system', commandId: null, data: { ping: true } }),
      ),
    );
    return merge(from(replayed), state.live.asObservable(), heartbeat);
  }

  private async onCmd(msg: CmdMessage): Promise<void> {
    const owner = this.ownership.get(msg.channel);
    const iAmOwner = owner === this.instanceId;
    const noOwner = owner === undefined;

    if (!iAmOwner && !(noOwner && msg.originInstanceId === this.instanceId)) return;

    if (noOwner) {
      this.ownership.set(msg.channel, this.instanceId);
      await this.safePublish(TOPICS.sys, {
        channel: msg.channel,
        kind: 'claim',
        instanceId: this.instanceId,
      } satisfies SysMessage);
    }

    const state = this.getChannel(msg.channel);
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
    state.execQueue = state.execQueue.then(() => this.executeCommand(msg, state));
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
    }
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
