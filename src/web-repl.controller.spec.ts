import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { WebReplController } from './web-repl.controller';
import { WebReplService } from './web-repl.service';
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
      providers: [{ provide: WebReplService, useValue: svc }],
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
});
