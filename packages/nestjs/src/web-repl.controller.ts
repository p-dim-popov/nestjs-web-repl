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
import { map, type Observable } from 'rxjs';
import { WEB_REPL_OPTIONS } from './constants';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';
import {
  landingRedirectUrl,
  randomChannelName,
  renderReplUi,
  resolveMonacoFile,
  toSseFrame,
} from '@remote-repl/core';
import { WebReplService } from './web-repl.service';

@Controller('repl')
export class WebReplController {
  constructor(
    protected readonly service: WebReplService,
    @Inject(WEB_REPL_OPTIONS) private readonly options: WebReplModuleOptions,
  ) {}

  // Landing route: a visit with no channel gets a random one. Runs on this
  // controller deliberately -- the documented security story is "subclass
  // the controller, add your guard", so guard subclasses cover this route
  // with no changes.
  @Get()
  @Redirect()
  landing(@Req() req: { url: string }): { url: string; statusCode: number } {
    if (!this.options.enabled) throw new NotFoundException();
    return { url: landingRedirectUrl(req.url, randomChannelName()), statusCode: 302 };
  }

  @Post(':channel')
  @HttpCode(202)
  async dispatch(
    @Param('channel') channel: string,
    @Body() body: { command?: unknown },
  ): Promise<{ accepted: true; commandId: string }> {
    // CRITICAL: register/registerAsync always register this controller;
    // `enabled` is enforced at runtime so a disabled module 404s on every
    // route.
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

  // Serves the bundled Monaco editor from our own origin so the UI needs no
  // CDN. The Express 5 splat param arrives as a string[] of path segments;
  // resolveMonacoFile applies the traversal guard and returns null (-> 404)
  // for any escape or miss.
  @Get(':channel/vs/*path')
  vsAsset(@Param('path') segments: string[]): StreamableFile {
    if (!this.options.enabled) throw new NotFoundException();
    const asset = resolveMonacoFile(segments.join('/'));
    if (!asset) throw new NotFoundException();
    return new StreamableFile(asset.buffer, { type: asset.contentType });
  }
}
