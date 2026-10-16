import { Module } from '@nestjs/common';
import { WebReplModule } from '../src';
import { CatService } from './cat.service';

@Module({
  imports: [
    WebReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
      instanceId: process.env.INSTANCE_ID,
    }),
  ],
  providers: [CatService],
})
export class AppModule {}
