import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { InMemoryWebReplAdapter, RemoteReplEngine } from '@remote-repl/core';
import { createReplEngine, createReplRouter } from './index';

// Real app, real engine, in-memory transport: the Express HTTP seam
// end-to-end (the spec's "HTTP seams" testing decision).

async function readUntilDone(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  let text = '';
  const decoder = new TextDecoder();
  while (!text.includes('"data":{"done":true}')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('createReplEngine + createReplRouter on a real Express app', () => {
  let engine: RemoteReplEngine;
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base: string;

  beforeAll(async () => {
    engine = createReplEngine({
      options: { enabled: true, heartbeatInterval: 60_000 },
      transport: new InMemoryWebReplAdapter(),
      context: { answer: 42 },
    });
    await engine.start();
    const app = express();
    app.use('/repl', createReplRouter({ engine }));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await engine.stop();
  });

  it('returns a RemoteReplEngine', () => {
    expect(engine).toBeInstanceOf(RemoteReplEngine);
  });

  it('evaluates a POSTed command against the supplied context and streams the result', async () => {
    const ac = new AbortController();
    const streaming = readUntilDone(`${base}/repl/e2e`, ac.signal);
    const post = await fetch(`${base}/repl/e2e`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'answer + 1' }),
    });
    expect(post.status).toBe(202);
    const { commandId } = (await post.json()) as { commandId: string };
    const text = await streaming;
    ac.abort();
    expect(text).toContain(`"commandId":"${commandId}"`);
    expect(text).toContain('43');
  }, 15_000);

  it('accepts a buildContext callback instead of a context object', async () => {
    const built = createReplEngine({
      options: { enabled: true },
      transport: new InMemoryWebReplAdapter(),
      buildContext: () => ({ fromBuilder: true }),
    });
    expect(built).toBeInstanceOf(RemoteReplEngine);
    await built.stop();
  });
});

describe('a disabled engine', () => {
  it('subscribes to nothing on start() and the router 404s every route', async () => {
    const transport = new InMemoryWebReplAdapter();
    const subscribe = vi.spyOn(transport, 'subscribe');
    const engine = createReplEngine({ options: { enabled: false }, transport, context: {} });
    await engine.start();
    expect(subscribe).not.toHaveBeenCalled();

    const app = express();
    app.use('/repl', createReplRouter({ engine }));
    expect((await request(app).get('/repl')).status).toBe(404);
    expect((await request(app).post('/repl/x').send({ command: '1' })).status).toBe(404);
    expect((await request(app).get('/repl/x').set('Accept', 'text/event-stream')).status).toBe(404);
    expect((await request(app).get('/repl/x/ui')).status).toBe(404);
    expect((await request(app).get('/repl/x/vs/loader.js')).status).toBe(404);
    await engine.stop();
  });
});

describe('user middleware in front of the router', () => {
  it('an auth middleware can reject every REPL route with 401 before the router runs', async () => {
    const engine = { enabled: true, dispatch: vi.fn(), events: vi.fn() };
    const requireToken = (req: Request, res: Response, next: NextFunction) => {
      if (req.get('authorization') !== 'Bearer s3cret') {
        res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
        return;
      }
      next();
    };
    const app = express();
    app.use('/repl', requireToken, createReplRouter({ engine }));

    for (const path of ['/repl', '/repl/x/ui', '/repl/x/vs/loader.js']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post('/repl/x').send({ command: '1' })).status).toBe(401);
    expect(engine.dispatch).not.toHaveBeenCalled();
    expect(engine.events).not.toHaveBeenCalled();

    const ok = await request(app).get('/repl/x/ui').set('Authorization', 'Bearer s3cret');
    expect(ok.status).toBe(200);
  });
});
