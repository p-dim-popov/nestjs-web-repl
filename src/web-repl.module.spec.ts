import {
  Controller,
  Inject,
  Injectable,
  INestApplication,
  Module,
  UseGuards,
  type CanActivate,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebReplModule } from './web-repl.module';
import { WebReplController } from './web-repl.controller';
import { WebReplService } from './web-repl.service';
import { WEB_REPL_ADAPTER } from './constants';
import { InMemoryWebReplAdapter } from './adapters/in-memory-web-repl.adapter';
import type { WebReplAdapter } from './interfaces/web-repl-adapter.interface';

const boot = async (mod: { module: unknown }): Promise<INestApplication> => {
  const testMod = await Test.createTestingModule({ imports: [mod as never] }).compile();
  const app = testMod.createNestApplication();
  await app.init();
  return app;
};

describe('WebReplModule (register / registerAsync)', () => {
  it('register(enabled:false): 404 on every route and never executes', async () => {
    const app = await boot(WebReplModule.register({ enabled: false }));
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(404);
    expect((await request(app.getHttpServer()).post('/repl/x').send({ command: '1+1' })).status).toBe(404);
    expect(
      (await request(app.getHttpServer()).get('/repl/x').set('Accept', 'text/event-stream')).status,
    ).toBe(404);
    await expect(app.get(WebReplService).dispatch('x', '1+1')).rejects.toThrow();
    await app.close();
  });

  it('register(enabled:true): serves UI and accepts a command', async () => {
    const app = await boot(WebReplModule.register({ enabled: true, instanceId: 'A' }));
    expect((await request(app.getHttpServer()).get('/repl/e2e/ui')).status).toBe(200);
    expect((await request(app.getHttpServer()).post('/repl/e2e').send({ command: '3+4' })).status).toBe(202);
    await app.close();
  });

  // enabled resolved via the async factory must be enforced at runtime, exactly
  // like the sync path -- otherwise registerAsync({ enabled:false }) would ship a
  // live arbitrary-code-execution endpoint.
  it('registerAsync(enabled:false): 404 on every route and never executes', async () => {
    const app = await boot(
      WebReplModule.registerAsync({ useFactory: () => ({ enabled: false }) }),
    );
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(404);
    expect((await request(app.getHttpServer()).post('/repl/x').send({ command: '1+1' })).status).toBe(404);
    expect(
      (await request(app.getHttpServer()).get('/repl/x').set('Accept', 'text/event-stream')).status,
    ).toBe(404);
    await expect(app.get(WebReplService).dispatch('x', '1+1')).rejects.toThrow();
    await app.close();
  });

  it('registerAsync(enabled:true): serves UI and accepts a command', async () => {
    const app = await boot(
      WebReplModule.registerAsync({ useFactory: () => ({ enabled: true, instanceId: 'async-A' }) }),
    );
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(200);
    expect((await request(app.getHttpServer()).post('/repl/x').send({ command: '1+1' })).status).toBe(202);
    await app.close();
  });

  // Bring-your-own controller: a subclass mounted at a custom path with a guard.
  // The default 'repl' path must NOT also be mounted.
  it('mounts a bring-your-own controller and not the default one', async () => {
    @Injectable()
    class AllowGuard implements CanActivate {
      canActivate(): boolean {
        return true;
      }
    }
    @Controller('internal/repl')
    @UseGuards(AllowGuard)
    class SecureReplController extends WebReplController {}

    const app = await boot(
      WebReplModule.register({ enabled: true, controller: SecureReplController }),
    );
    expect((await request(app.getHttpServer()).get('/internal/repl/x/ui')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(404);
    await app.close();
  });

  it('defaults the adapter to InMemoryWebReplAdapter', async () => {
    const app = await boot(WebReplModule.register({ enabled: true }));
    expect(app.get<WebReplAdapter>(WEB_REPL_ADAPTER)).toBeInstanceOf(InMemoryWebReplAdapter);
    await app.close();
  });

  it('uses a provided adapter instance as-is', async () => {
    const instance = new InMemoryWebReplAdapter();
    const app = await boot(WebReplModule.register({ enabled: true, adapter: instance }));
    expect(app.get<WebReplAdapter>(WEB_REPL_ADAPTER)).toBe(instance);
    await app.close();
  });

  it('builds the adapter via useFactory', async () => {
    const app = await boot(
      WebReplModule.register({
        enabled: true,
        adapter: { useFactory: () => new InMemoryWebReplAdapter() },
      }),
    );
    expect(app.get<WebReplAdapter>(WEB_REPL_ADAPTER)).toBeInstanceOf(InMemoryWebReplAdapter);
    await app.close();
  });

  // useClass + imports: the adapter is a DI-resolved class that injects a
  // dependency from an imported module -- proving the provider-block form wires
  // through Nest's DI, which the old instance-only `adapter` option could not.
  it('builds the adapter via useClass with imports (DI-resolved)', async () => {
    const DEP = Symbol('DEP');
    @Module({ providers: [{ provide: DEP, useValue: 'dep-value' }], exports: [DEP] })
    class DepModule {}

    @Injectable()
    class DiAdapter implements WebReplAdapter {
      constructor(@Inject(DEP) readonly dep: string) {}
      async publish(): Promise<void> {}
      async subscribe(): Promise<void> {}
    }

    const app = await boot(
      WebReplModule.register({
        enabled: true,
        adapter: { useClass: DiAdapter, imports: [DepModule] },
      }),
    );
    const adapter = app.get<DiAdapter>(WEB_REPL_ADAPTER);
    expect(adapter).toBeInstanceOf(DiAdapter);
    expect(adapter.dep).toBe('dep-value');
    await app.close();
  });

  // Wiring proof: 202 alone only proves the command was published. Boot a real
  // app with a sibling provider (CatService), subscribe to SSE, run a command
  // that resolves the provider through the REPL's own get(), and assert the real
  // output streams back -- proving buildReplContext produced an app-wide context.
  it('resolves a real provider through the REPL context and streams output over SSE', async () => {
    @Injectable()
    class CatService {
      findAll(): string[] {
        return ['felix', 'garfield'];
      }
    }
    @Module({
      imports: [WebReplModule.register({ enabled: true, instanceId: 'exec-proof' })],
      providers: [CatService],
    })
    class AppModule {}

    const testMod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = testMod.createNestApplication();
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    const channel = 'exec-proof-chan';

    const sseOutput = await new Promise<string>((resolve, reject) => {
      let acc = '';
      const req = http.get(
        `http://127.0.0.1:${port}/repl/${channel}`,
        { headers: { Accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            acc += chunk;
            if (acc.includes('felix')) {
              res.destroy();
              req.destroy();
              resolve(acc);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      setTimeout(() => {
        request(app.getHttpServer())
          .post(`/repl/${channel}`)
          .send({ command: 'get(CatService).findAll()' })
          .then((res) => {
            if (res.status !== 202) {
              reject(new Error(`dispatch failed: ${res.status} ${JSON.stringify(res.body)}`));
            }
          })
          .catch(reject);
      }, 100);
      setTimeout(() => reject(new Error('timed out waiting for SSE output event')), 8000);
    });

    expect(sseOutput).toContain('"type":"output"');
    expect(sseOutput).toContain('felix');
    expect(sseOutput).toContain('garfield');
    await app.close();
  }, 10000);
});
