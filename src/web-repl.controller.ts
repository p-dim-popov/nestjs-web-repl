import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { WebReplService } from './web-repl.service';
import { renderReplUi } from './ui/repl-ui.html';

@Controller('repl')
export class WebReplController {
  constructor(protected readonly service: WebReplService) {}

  @Post(':channel')
  @HttpCode(202)
  async dispatch(
    @Param('channel') channel: string,
    @Body() body: { command?: unknown },
  ): Promise<{ accepted: true; commandId: string }> {
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
    const cursor = lastEventId ? Number(lastEventId) : null;
    return this.service.stream(channel, Number.isNaN(cursor as number) ? null : cursor).pipe(
      map((event) => ({
        id: String(event.id),
        type: 'message',
        data: JSON.stringify(event),
      })),
    );
  }

  @Get(':channel/ui')
  @Header('content-type', 'text/html')
  ui(@Param('channel') channel: string): string {
    return renderReplUi(channel);
  }
}
