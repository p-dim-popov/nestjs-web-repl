import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { RemoteReplController } from './remote-repl.controller';
import { RemoteReplService } from './remote-repl.service';
import { REMOTE_REPL_OPTIONS } from './constants';
import { renderReplUi } from '@remote-repl/core';

describe('RemoteReplController', () => {
  let app: INestApplication;
  const svc = {
    dispatch: vi.fn(async () => ({ commandId: 'cmd_x' })),
    events: vi.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RemoteReplController],
      providers: [
        { provide: RemoteReplService, useValue: svc },
        { provide: REMOTE_REPL_OPTIONS, useValue: { enabled: true } },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('POST accepts a command with 202 and returns commandId', async () => {
    const res = await request(app.getHttpServer())
      .post('/repl/chanA')
      .send({ command: '1+1' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, commandId: 'cmd_x' });
    expect(svc.dispatch).toHaveBeenCalledWith('chanA', '1+1');
  });

  it('POST rejects a missing command with 400', async () => {
    const res = await request(app.getHttpServer()).post('/repl/chanA').send({});
    expect(res.status).toBe(400);
  });

  it('POST rejects a whitespace-only command with 400', async () => {
    const res = await request(app.getHttpServer()).post('/repl/chanA').send({ command: '   ' });
    expect(res.status).toBe(400);
  });

  it('POST rejects a non-string command with 400', async () => {
    const res = await request(app.getHttpServer()).post('/repl/chanA').send({ command: 123 });
    expect(res.status).toBe(400);
  });

  it('GET :channel/ui serves an HTML page mentioning the channel', async () => {
    const res = await request(app.getHttpServer()).get('/repl/chanA/ui');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('chanA');
    expect(res.text.toLowerCase()).toContain('monaco');
  });

  it('GET :channel/vs/loader.js serves Monaco as JavaScript', async () => {
    const res = await request(app.getHttpServer()).get('/repl/chanA/vs/loader.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('GET :channel/vs serves a nested asset path', async () => {
    const res = await request(app.getHttpServer()).get('/repl/chanA/vs/base/worker/workerMain.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
  });

  it('GET :channel/vs 404s on a traversal attempt', async () => {
    const res = await request(app.getHttpServer()).get('/repl/chanA/vs/..%2f..%2fpackage.json');
    expect(res.status).toBe(404);
  });

  it('escapes </script> in the channel to prevent breakout', () => {
    const html = renderReplUi('</script><script>alert(1)</script>');
    expect(html).not.toContain('</script><script>alert(1)'); // not present unescaped in the script context
  });

  it('GET /repl (no channel) redirects to a random channel UI', async () => {
    const res = await request(app.getHttpServer()).get('/repl');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/repl\/[a-z0-9]{8}\/ui$/);
  });

  it('GET /repl generates a fresh channel per visit', async () => {
    const a = await request(app.getHttpServer()).get('/repl');
    const b = await request(app.getHttpServer()).get('/repl');
    expect(a.headers.location).not.toBe(b.headers.location);
  });

  // CRITICAL 1: register()/registerAsync() always register this controller
  // regardless of the resolved `enabled` value, so the controller itself
  // must re-check `enabled` on every route and 404 -- rather than trusting
  // that a disabled module was never wired up.
  describe('when the resolved options are disabled', () => {
    let disabledApp: INestApplication;
    const disabledSvc = {
      dispatch: vi.fn(async () => ({ commandId: 'should-not-be-called' })),
      events: vi.fn(() => { throw new Error('events() should not be reached when disabled'); }),
    };

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [RemoteReplController],
        providers: [
          { provide: RemoteReplService, useValue: disabledSvc },
          { provide: REMOTE_REPL_OPTIONS, useValue: { enabled: false } },
        ],
      }).compile();
      disabledApp = mod.createNestApplication();
      await disabledApp.init();
    });

    afterAll(async () => { await disabledApp.close(); });

    it('GET :channel/ui returns 404', async () => {
      const res = await request(disabledApp.getHttpServer()).get('/repl/x/ui');
      expect(res.status).toBe(404);
    });

    it('POST :channel returns 404 and never dispatches', async () => {
      disabledSvc.dispatch.mockClear();
      const res = await request(disabledApp.getHttpServer())
        .post('/repl/x')
        .send({ command: '1+1' });
      expect(res.status).toBe(404);
      expect(disabledSvc.dispatch).not.toHaveBeenCalled();
    });

    it('GET :channel (SSE) returns 404 and never streams', async () => {
      const res = await request(disabledApp.getHttpServer())
        .get('/repl/x')
        .set('Accept', 'text/event-stream');
      expect(res.status).toBe(404);
      expect(disabledSvc.events).not.toHaveBeenCalled();
    });

    it('GET :channel/vs returns 404 when disabled', async () => {
      const res = await request(disabledApp.getHttpServer()).get('/repl/x/vs/loader.js');
      expect(res.status).toBe(404);
    });

    it('GET /repl (landing) returns 404 when disabled', async () => {
      const res = await request(disabledApp.getHttpServer()).get('/repl');
      expect(res.status).toBe(404);
    });
  });

  it('end-to-end: heartbeats repeat the last real event id instead of clobbering it', async () => {
    svc.events.mockReturnValueOnce(
      (async function* () {
        yield { id: 5, type: 'output', commandId: 'cmd_1', data: 'hi' };
        yield { id: 0, type: 'system', commandId: null, data: { ping: true } };
        yield { id: 0, type: 'system', commandId: null, data: { ping: true } };
      })(),
    );
    const res = await request(app.getHttpServer())
      .get('/repl/chanA')
      .set('Accept', 'text/event-stream');
    expect(res.status).toBe(200);
    const idLines = res.text.match(/^id: .*$/gm);
    // The two heartbeats that follow the real id:5 event must repeat "5",
    // not "0" (the old bug) and not an unrelated auto-incremented counter
    // (the naive-omission pitfall) -- so a reconnect after either
    // heartbeat resumes from id 5, not from the start of the buffer.
    expect(idLines).toEqual(['id: 5', 'id: 5', 'id: 5']);
  });
});
