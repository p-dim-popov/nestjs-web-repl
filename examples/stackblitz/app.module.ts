import { Module } from '@nestjs/common';
import { WebReplModule } from 'nestjs-web-repl';
import { CatService } from './cat.service';
import { CounterService } from './counter.service';
import { RedirectController } from './redirect.controller';

@Module({
  imports: [
    WebReplModule.register({
      enabled: true,
      instanceId: 'demo',
    }),
  ],
  controllers: [RedirectController],
  providers: [CatService, CounterService],
})
export class AppModule {}
