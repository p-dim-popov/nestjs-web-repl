import { Controller, Injectable, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebReplModule } from './web-repl.module';
import { WebReplController } from './web-repl.controller';
import { WebReplService } from './web-repl.service';

describe('WebReplModule', () => {
  it('registers nothing when disabled', async () => {
    const mod = await Test.createTestingModule({
      imports: [WebReplModule.forRoot({ enabled: false })],
    }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get('/repl/x/ui');
    expect(res.status).toBe(404);
    await app.close();
  });

  it('serves the UI and runs a command end-to-end when enabled', async () => {
    const mod = await Test.createTestingModule({
      imports: [WebReplModule.forRoot({ enabled: true, instanceId: 'A' })],
    }).compile();
    const app: INestApplication = mod.createNestApplication();
    await app.init();

    const ui = await request(app.getHttpServer()).get('/repl/e2e/ui');
    expect(ui.status).toBe(200);

    const post = await request(app.getHttpServer()).post('/repl/e2e').send({ command: '3+4' });
    expect(post.status).toBe(202);

    await app.close();
  });

  // CRITICAL 1: forRootAsync resolves options at DI time and always
  // registers the controller + service (providers/controllers must be
  // declared statically before useFactory ever runs) -- so `enabled` must
  // be re-checked at runtime, or `forRootAsync({ useFactory: () => ({
  // enabled: false }) })` would ship a fully-live arbitrary-code-execution
  // endpoint. This must 404 on all three routes, matching the sync
  // forRoot(enabled: false) path's "nothing registered -> 404" behavior,
  // and must never actually execute a command.
  it('forRootAsync with enabled:false returns 404 on every route and never executes a command', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        WebReplModule.forRootAsync({
          useFactory: () => ({ enabled: false }),
        }),
      ],
    }).compile();
    const app: INestApplication = mod.createNestApplication();
    await app.init();

    const ui = await request(app.getHttpServer()).get('/repl/x/ui');
    expect(ui.status).toBe(404);

    const post = await request(app.getHttpServer()).post('/repl/x').send({ command: '1+1' });
    expect(post.status).toBe(404);

    const sse = await request(app.getHttpServer())
      .get('/repl/x')
      .set('Accept', 'text/event-stream');
    expect(sse.status).toBe(404);

    // Confirm nothing actually ran: the service itself must also refuse to
    // execute, as defense-in-depth beyond the controller's own 404s.
    const svc = app.get(WebReplService);
    await expect(svc.dispatch('x', '1+1')).rejects.toThrow();

    await app.close();
  });

  it('serves the UI and accepts a command when configured via forRootAsync', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        WebReplModule.forRootAsync({
          useFactory: () => ({ enabled: true, instanceId: 'async-A' }),
        }),
      ],
    }).compile();
    const app: INestApplication = mod.createNestApplication();
    await app.init();

    const ui = await request(app.getHttpServer()).get('/repl/x/ui');
    expect(ui.status).toBe(200);

    const post = await request(app.getHttpServer()).post('/repl/x').send({ command: '1+1' });
    expect(post.status).toBe(202);

    await app.close();
  });

  it('omits the controller when registerController is false', async () => {
    const mod = await Test.createTestingModule({
      imports: [WebReplModule.forRoot({ enabled: true, registerController: false })],
    }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get('/repl/x/ui');
    expect(res.status).toBe(404);
    await app.close();
  });

  // Test above only proves the *controller* is gone. registerController:false
  // is meant for callers who mount their own controller in front of the
  // same engine, so the engine itself -- WebReplService -- must still be
  // registered and resolvable even with the default controller omitted.
  it('still registers WebReplService (the engine) when registerController is false', async () => {
    const mod = await Test.createTestingModule({
      imports: [WebReplModule.forRoot({ enabled: true, registerController: false })],
    }).compile();
    const app = mod.createNestApplication();
    await app.init();

    expect(() => app.get(WebReplService)).not.toThrow();
    expect(app.get(WebReplService)).toBeInstanceOf(WebReplService);

    await app.close();
  });

  // Regression guard for the README's documented "Securing it" pattern: a
  // subclass of WebReplController, registered directly on a SIBLING
  // module's `controllers` array (not inside the DynamicModule
  // WebReplModule.forRoot() returns), with `registerController: false` so
  // only the guarded subclass is exposed. WebReplController's constructor
  // now also injects WEB_REPL_OPTIONS (for the enabled-check added in
  // CRITICAL 1) -- that token must be exported by WebReplModule, or this
  // documented pattern breaks with a DI resolution error.
  it('supports the README "Securing it" pattern: a subclass controller registered in a sibling module', async () => {
    @Controller('internal/repl')
    class SecureReplController extends WebReplController {}

    @Module({
      imports: [WebReplModule.forRoot({ enabled: true, registerController: false })],
      controllers: [SecureReplController],
    })
    class AppModule {}

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = mod.createNestApplication();
    await app.init();

    const ui = await request(app.getHttpServer()).get('/internal/repl/x/ui');
    expect(ui.status).toBe(200);

    await app.close();
  });

  // This is the critical wiring test: a 202 from POST /repl/:channel only
  // proves the command was *published*, not that it ran against a working
  // REPL context -- a broken/empty context would 202 identically. Here we
  // boot a real Nest app with a provider (CatService) registered alongside
  // WebReplModule in the same module tree, subscribe to the live SSE
  // stream, dispatch a command that resolves CatService through the REPL's
  // own `get()` native function, and assert the *actual* provider output
  // comes back over SSE. This proves buildReplContext() produced a real,
  // app-wide-resolving ReplContext -- not just a context object that
  // happens to exist.
  it('resolves a real provider through the REPL context and streams its output over SSE', async () => {
    @Injectable()
    class CatService {
      findAll(): string[] {
        return ['felix', 'garfield'];
      }
    }

    @Module({
      imports: [WebReplModule.forRoot({ enabled: true, instanceId: 'exec-proof' })],
      providers: [CatService],
    })
    class AppModule {}

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = mod.createNestApplication();
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

      // Let the SSE connection establish before dispatching the command,
      // so the output isn't published before anyone is subscribed.
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
