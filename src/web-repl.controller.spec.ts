import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import request from 'supertest';
import { WebReplController, toSseFrame } from './web-repl.controller';
import { WebReplService } from './web-repl.service';
import { WEB_REPL_OPTIONS } from './constants';
import { renderReplUi } from './ui/repl-ui.html';

describe('WebReplController', () => {
  let app: INestApplication;
  const svc = {
    dispatch: vi.fn(async () => ({ commandId: 'cmd_x' })),
    stream: vi.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WebReplController],
      providers: [
        { provide: WebReplService, useValue: svc },
        { provide: WEB_REPL_OPTIONS, useValue: { enabled: true } },
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

  it('escapes </script> in the channel to prevent breakout', () => {
    const html = renderReplUi('</script><script>alert(1)</script>');
    expect(html).not.toContain('</script><script>alert(1)'); // not present unescaped in the script context
  });

  // CRITICAL 1: register()/registerAsync() always register this controller
  // regardless of the resolved `enabled` value, so the controller itself
  // must re-check `enabled` on every route and 404 -- rather than trusting
  // that a disabled module was never wired up.
  describe('when the resolved options are disabled', () => {
    let disabledApp: INestApplication;
    const disabledSvc = {
      dispatch: vi.fn(async () => ({ commandId: 'should-not-be-called' })),
      stream: vi.fn(() => { throw new Error('stream() should not be reached when disabled'); }),
    };

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [WebReplController],
        providers: [
          { provide: WebReplService, useValue: disabledSvc },
          { provide: WEB_REPL_OPTIONS, useValue: { enabled: false } },
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
      expect(disabledSvc.stream).not.toHaveBeenCalled();
    });
  });

  // IMPORTANT 2: a heartbeat frame (WebReplEvent with id: 0) must not
  // clobber the browser EventSource's reconnection cursor. Naively
  // *omitting* `id` doesn't work here -- @nestjs/core's SseStream
  // auto-assigns its own disconnected monotonic counter to any message
  // with no id (verified against node_modules/@nestjs/core), which would
  // reproduce the same "reconnect replays everything" bug through a
  // different number. Instead each heartbeat must be stamped with the id
  // of the last real event actually sent on that connection (or the
  // client's own reconnect cursor if no real event has flowed yet), which
  // is idempotent for Last-Event-ID per the SSE spec. Asserted directly
  // against the extracted pure mapping function since asserting on the raw
  // SSE `id:` line for the *auto-assignment* pitfall specifically is
  // covered by the end-to-end test below.
  describe('toSseFrame (SSE event mapping)', () => {
    it('stamps the heartbeat sentinel event (id: 0) with the supplied lastRealId', () => {
      const frame = toSseFrame(
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
        5,
      );
      expect(frame.id).toBe('5');
    });

    it('stamps a fresh-connection heartbeat (no real event sent yet) with "0"', () => {
      const frame = toSseFrame(
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
        0,
      );
      expect(frame.id).toBe('0');
    });

    it('uses the event\'s own id for a normal (non-heartbeat) event, ignoring lastRealId', () => {
      const frame = toSseFrame({ id: 7, type: 'output', commandId: 'cmd_1', data: 'hi' }, 3);
      expect(frame.id).toBe('7');
    });
  });

  it('end-to-end: heartbeats repeat the last real event id instead of clobbering it', async () => {
    svc.stream.mockReturnValueOnce(
      of(
        { id: 5, type: 'output', commandId: 'cmd_1', data: 'hi' },
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
      ),
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
