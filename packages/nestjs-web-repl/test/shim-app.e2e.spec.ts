import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WebReplModule, WebReplService } from 'nestjs-web-repl';
import type { WebReplEvent, WebReplModuleOptions } from 'nestjs-web-repl';

// A consumer app written against the legacy entry point: the module, the DI
// token-bearing service and the option/event TYPES all come from
// `nestjs-web-repl`, and the ConfigurableModuleBuilder's register /
// registerAsync work through the re-export (incl. runtime `enabled`).
function consumerApp(dynamic: ReturnType<typeof WebReplModule.register>) {
  @Module({ imports: [dynamic] })
  class ConsumerAppModule {}
  return ConsumerAppModule;
}

const boot = async (dynamic: ReturnType<typeof WebReplModule.register>): Promise<INestApplication> => {
  const mod = await Test.createTestingModule({ imports: [consumerApp(dynamic)] }).compile();
  const app = mod.createNestApplication();
  await app.init();
  return app;
};

describe('a Nest app importing nestjs-web-repl', () => {
  it('register({ enabled: false }) 404s every route and refuses to execute', async () => {
    const options: WebReplModuleOptions = { enabled: false };
    const app = await boot(WebReplModule.register(options));
    const http = app.getHttpServer();
    expect((await request(http).get('/repl/x/ui')).status).toBe(404);
    expect((await request(http).post('/repl/x').send({ command: '1+1' })).status).toBe(404);
    expect((await request(http).get('/repl/x').set('Accept', 'text/event-stream')).status).toBe(404);
    await expect(app.get(WebReplService).dispatch('x', '1+1')).rejects.toThrow();
    await app.close();
  });

  it('register({ enabled: true }) serves the UI and runs a command whose output reaches the stream', async () => {
    const app = await boot(WebReplModule.register({ enabled: true, instanceId: 'shim-A' }));
    const http = app.getHttpServer();
    expect((await request(http).get('/repl/shim/ui')).status).toBe(200);

    const events: WebReplEvent[] = [];
    const sub = app.get(WebReplService).stream('shim').subscribe((e) => events.push(e as WebReplEvent));
    const res = await request(http).post('/repl/shim').send({ command: '6 * 7' });
    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(events.some((e) => JSON.stringify(e.data).includes('42'))).toBe(true);
    });
    sub.unsubscribe();
    await app.close();
  });

  it('registerAsync({ enabled: false }) is enforced at runtime too', async () => {
    const app = await boot(WebReplModule.registerAsync({ useFactory: () => ({ enabled: false }) }));
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(404);
    await app.close();
  });
});
