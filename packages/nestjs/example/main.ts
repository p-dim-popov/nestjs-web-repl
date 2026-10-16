import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? 3000));
  // eslint-disable-next-line no-console
  console.log(`web-repl example on :${process.env.PORT ?? 3000} — open /repl/dev/ui`);
}
void bootstrap();
