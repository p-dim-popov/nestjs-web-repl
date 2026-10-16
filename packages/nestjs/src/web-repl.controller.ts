import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Redirect,
  Req,
  Sse,
  StreamableFile,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  createReplHandlers,
  InvalidCommandError,
  parseLastEventId,
  ReplDisabledError,
  type ReplHandlers,
} from '@remote-repl/core';
import { WEB_REPL_OPTIONS } from './constants';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';
import { WebReplService } from './web-repl.service';

/**
 * Thin HTTP wiring over core's shared route handlers (`createReplHandlers`).
 * All route logic -- body validation, landing redirect, UI rendering, the
 * Monaco asset traversal guard, SSE heartbeat id-stamping -- lives in core;
 * this class only maps Nest params in and core's errors out.
 */
@Controller('repl')
export class WebReplController {
  private readonly handlers: ReplHandlers;

  constructor(
    protected readonly service: WebReplService,
    @Inject(WEB_REPL_OPTIONS) private readonly options: WebReplModuleOptions,
  ) {
    // CRITICAL: register/registerAsync always register this controller;
    // `enabled` is enforced at runtime so a disabled module 404s on every
    // route. The handlers read `options.enabled` on every call (the options
    // object is shared, not copied), and `ReplDisabledError` maps to 404 below.
    this.handlers = createReplHandlers(service, options);
  }

  // Landing route: a visit with no channel gets a random one. Runs on this
  // controller deliberately -- the documented security story is "subclass
  // the controller, add your guard", so guard subclasses cover this route
  // with no changes.
  @Get()
  @Redirect()
  landing(@Req() req: { url: string }): { url: string; statusCode: number } {
    return { url: guard(() => this.handlers.landing(req.url)), statusCode: 302 };
  }

  @Post(':channel')
  @HttpCode(202)
  async dispatch(
    @Param('channel') channel: string,
    @Body() body: unknown,
  ): Promise<{ accepted: true; commandId: string }> {
    const { commandId } = await this.handlers.post(channel, body).catch((err: unknown) => {
      throw toHttpException(err);
    });
    return { accepted: true, commandId };
  }

  @Sse(':channel')
  stream(
    @Param('channel') channel: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    // Opened eagerly here (not at subscribe time) so a disabled module fails
    // the request with 404 before Nest commits the SSE headers.
    const frames = guard(() => this.handlers.streamFrames(channel, parseLastEventId(lastEventId)));
    return fromAsyncIterator(frames);
  }

  @Get(':channel/ui')
  @Header('content-type', 'text/html')
  ui(@Param('channel') channel: string): string {
    return guard(() => this.handlers.ui(channel));
  }

  // Serves the bundled Monaco editor from our own origin so the UI needs no
  // CDN. The Express 5 splat param arrives as a string[] of path segments;
  // the handler applies the traversal guard and returns null (-> 404) for
  // any escape or miss.
  @Get(':channel/vs/*path')
  vsAsset(@Param('path') segments: string[]): StreamableFile {
    const asset = guard(() => this.handlers.asset(segments.join('/')));
    if (!asset) throw new NotFoundException();
    return new StreamableFile(asset.buffer, { type: asset.contentType });
  }
}

/** Runs a synchronous handler call, mapping core's errors to Nest's. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw toHttpException(err);
  }
}

function toHttpException(err: unknown): unknown {
  if (err instanceof ReplDisabledError) return new NotFoundException();
  if (err instanceof InvalidCommandError) return new BadRequestException(err.message);
  return err;
}

/**
 * Adapts the handler's frame iterator to the `Observable<MessageEvent>` Nest's
 * `@Sse()` expects (the platform-agnostic convention: no raw req/res here).
 * Unsubscribing (client disconnect) calls `return()`, which is what closes the
 * engine subscription and lets the channel be GC'd.
 */
function fromAsyncIterator<T>(iterator: AsyncIterator<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    let closed = false;
    (async () => {
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || closed) return;
          subscriber.next(value);
        }
      } catch (err) {
        if (!closed) subscriber.error(err);
        return;
      }
    })().then(() => {
      if (!closed) subscriber.complete();
    });
    return () => {
      closed = true;
      void iterator.return?.(undefined);
    };
  });
}
