import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RemoteReplEngine,
  ReplDisabledError,
  type ContextFactory,
  type WebReplAdapter,
  type WebReplEvent,
} from '@remote-repl/core';
import { WEB_REPL_ADAPTER, WEB_REPL_OPTIONS, WEB_REPL_CLOCK, WEB_REPL_CONTEXT_FACTORY } from './constants';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';

/**
 * The NestJS face of `@remote-repl/core`'s `RemoteReplEngine`: DI
 * construction, lifecycle hooks delegating to `start()`/`stop()`, the
 * core `ReplDisabledError` mapped to Nest's `NotFoundException`, and an
 * RxJS `Observable` view of a channel stream for the controller.
 *
 * All engine behaviour (ownership lease, serialization, replay, GC,
 * runtime `enabled` enforcement) lives in core -- see
 * `packages/core/src/engine/remote-repl-engine.ts`.
 */
@Injectable()
export class WebReplService extends RemoteReplEngine implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(WEB_REPL_OPTIONS) options: WebReplModuleOptions,
    @Inject(WEB_REPL_ADAPTER) adapter: WebReplAdapter,
    @Inject(WEB_REPL_CONTEXT_FACTORY) buildContext: ContextFactory,
    @Inject(WEB_REPL_CLOCK) clock: () => number = () => Date.now(),
  ) {
    super(options, adapter, buildContext, clock, new Logger('WebReplService'));
  }

  onModuleInit(): Promise<void> {
    return this.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }

  override async dispatch(channel: string, command: string): Promise<{ commandId: string }> {
    try {
      return await super.dispatch(channel, command);
    } catch (err) {
      throw toNestError(err);
    }
  }

  /**
   * Observable view of `openStream()`. Subscribing opens the stream (the
   * replay snapshot and subscriber bookkeeping happen at SUBSCRIBE time,
   * not when the controller calls this), unsubscribing closes it
   * synchronously. Throws `NotFoundException` synchronously when disabled.
   */
  stream(channel: string, lastEventId: number | null): Observable<WebReplEvent> {
    try {
      // Surface the disabled state before handing back an Observable.
      this.assertEnabled();
    } catch (err) {
      throw toNestError(err);
    }
    return new Observable<WebReplEvent>((subscriber) => {
      const sub = this.openStream(channel, lastEventId, {
        next: (event) => subscriber.next(event),
        complete: () => subscriber.complete(),
      });
      return () => sub.close();
    });
  }
}

function toNestError(err: unknown): unknown {
  return err instanceof ReplDisabledError ? new NotFoundException() : err;
}
