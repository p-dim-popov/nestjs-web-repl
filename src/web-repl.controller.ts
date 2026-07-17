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
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { WEB_REPL_OPTIONS } from './constants';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';
import type { WebReplEvent } from './interfaces/web-repl-messages.interface';
import { WebReplService } from './web-repl.service';
import { renderReplUi } from './ui/repl-ui.html';

// IMPORTANT 2: the heartbeat is emitted as a real WebReplEvent with the
// sentinel `id: 0`. Per the SSE spec, any non-null `id` field (including
// "0") overwrites the browser EventSource's last-event-id -- so if every
// heartbeat carried `id: "0"`, almost any reconnect after an idle period
// would send `Last-Event-ID: 0`, and EventRingBuffer.since(0) returns the
// entire buffer, defeating replay dedup.
//
// NOTE: this can't be fixed by simply *omitting* `id` from the MessageEvent
// -- @nestjs/core's SseStream.writeMessage() auto-assigns its own
// monotonically increasing id to any message whose `id` is undefined/null
// (see node_modules/@nestjs/core/router/sse-stream.js), so an "omitted" id
// still lands on the wire as a small, framework-generated counter value
// that is just as disconnected from real event ids as the "0" sentinel
// was -- reproducing the same "reconnect replays everything" bug through a
// different number. Instead, stamp every heartbeat with the id of the
// *last real event this connection has actually sent* (or the client's
// original Last-Event-ID cursor if none has been sent yet on this
// connection). Per the SSE spec, receiving an id equal to the one the
// client already has is a no-op for its reconnection cursor, so heartbeats
// stop perturbing Last-Event-ID once at least one real event has flowed.
// Exported as a pure function so it's directly unit-testable without
// asserting on raw SSE wire text.
export function toSseFrame(event: WebReplEvent, lastRealId: number): MessageEvent {
  const id = event.id === 0 ? lastRealId : event.id;
  return { id: String(id), type: 'message', data: JSON.stringify(event) };
}

@Controller('repl')
export class WebReplController {
  constructor(
    protected readonly service: WebReplService,
    @Inject(WEB_REPL_OPTIONS) private readonly options: WebReplModuleOptions,
  ) {}

  @Post(':channel')
  @HttpCode(202)
  async dispatch(
    @Param('channel') channel: string,
    @Body() body: { command?: unknown },
  ): Promise<{ accepted: true; commandId: string }> {
    // CRITICAL: forRootAsync always registers this controller regardless
    // of the resolved `enabled` value (providers/controllers must be
    // declared statically before useFactory ever runs). Re-check at
    // request time so a disabled async module 404s on every route, just
    // like the sync forRoot(enabled: false) path that registers nothing.
    if (!this.options.enabled) throw new NotFoundException();
    if (typeof body?.command !== 'string' || body.command.trim().length === 0) {
      throw new BadRequestException('command must be a non-empty string');
    }
    const { commandId } = await this.service.dispatch(channel, body.command);
    return { accepted: true, commandId };
  }

  @Sse(':channel')
  stream(
    @Param('channel') channel: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    if (!this.options.enabled) throw new NotFoundException();
    const parsed = lastEventId ? Number(lastEventId) : null;
    const cursor = Number.isNaN(parsed as number) ? null : parsed;
    // Tracks the id of the last real (non-heartbeat) event sent on THIS
    // connection, so heartbeats can be stamped with it instead of the "0"
    // sentinel -- see toSseFrame() above. Seeded from the client's own
    // reconnect cursor (or 0, meaning "nothing yet") so a heartbeat fired
    // before any real event still reports a harmless/idempotent id.
    let lastRealId = cursor ?? 0;
    return this.service.stream(channel, cursor).pipe(
      map((event) => {
        const frame = toSseFrame(event, lastRealId);
        if (event.id !== 0) lastRealId = event.id;
        return frame;
      }),
    );
  }

  @Get(':channel/ui')
  @Header('content-type', 'text/html')
  ui(@Param('channel') channel: string): string {
    if (!this.options.enabled) throw new NotFoundException();
    return renderReplUi(channel);
  }
}
