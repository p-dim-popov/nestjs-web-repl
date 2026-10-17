import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RemoteReplEngine,
  RemoteReplDisabledError,
  type RemoteReplContextFactory,
  type RemoteReplTransport,
  type RemoteReplEvent,
} from '@remote-repl/core';
import { REMOTE_REPL_TRANSPORT, REMOTE_REPL_OPTIONS, REMOTE_REPL_CLOCK, REMOTE_REPL_CONTEXT_FACTORY } from './constants';
import type { RemoteReplModuleOptions } from './interfaces/remote-repl-options.interface';

/**
 * The NestJS face of `@remote-repl/core`'s `RemoteReplEngine`: DI
 * construction, lifecycle hooks delegating to `start()`/`stop()`, the
 * core `RemoteReplDisabledError` mapped to Nest's `NotFoundException`, and an
 * RxJS `Observable` view of a channel stream for the controller.
 *
 * All engine behaviour (ownership lease, serialization, replay, GC,
 * runtime `enabled` enforcement) lives in core -- see
 * `packages/core/src/engine/remote-repl-engine.ts`.
 */
@Injectable()
export class RemoteReplService extends RemoteReplEngine implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(REMOTE_REPL_OPTIONS) options: RemoteReplModuleOptions,
    @Inject(REMOTE_REPL_TRANSPORT) transport: RemoteReplTransport,
    @Inject(REMOTE_REPL_CONTEXT_FACTORY) buildContext: RemoteReplContextFactory,
    @Inject(REMOTE_REPL_CLOCK) clock: () => number = () => Date.now(),
  ) {
    super(options, transport, buildContext, clock, new Logger('RemoteReplService'));
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
  stream(channel: string, lastEventId: number | null): Observable<RemoteReplEvent> {
    try {
      // Surface the disabled state before handing back an Observable.
      this.assertEnabled();
    } catch (err) {
      throw toNestError(err);
    }
    return new Observable<RemoteReplEvent>((subscriber) => {
      const sub = this.openStream(channel, lastEventId, {
        next: (event) => subscriber.next(event),
        complete: () => subscriber.complete(),
      });
      return () => sub.close();
    });
  }
}

function toNestError(err: unknown): unknown {
  return err instanceof RemoteReplDisabledError ? new NotFoundException() : err;
}
