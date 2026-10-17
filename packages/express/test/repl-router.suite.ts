import type express5 from 'express';
import request from 'supertest';
import type { createReplRouter as createReplRouterFn } from '../src/repl-router';

/**
 * The router's HTTP contract, run once per supported Express major. The
 * spec that calls this decides which `express` the router module resolved
 * (Express 5 by default; `repl-router.express4.spec.ts` mocks `express` to
 * the `express4` alias), so this file knows nothing about versions beyond
 * checking it got the one it was promised.
 */
export function describeReplRouter(
  label: string,
  express: typeof express5,
  createReplRouter: typeof createReplRouterFn,
  major: 4 | 5,
): void {
  // The router reads `enabled` from the engine itself: there is no separate
  // option, so the two layers of the safety rail can never disagree.
  const fakeEngine = (enabled = true) => ({
    enabled,
    dispatch: vi.fn(async () => ({ commandId: 'cmd_x' })),
    events: vi.fn(),
  });

  function mount(engine: ReturnType<typeof fakeEngine>) {
    const app = express();
    app.use('/repl', createReplRouter({ engine }));
    return app;
  }

  describe(`${label}: createReplRouter: enabled comes from the engine`, () => {
    it('404s every route when the engine is disabled, with no other option involved', async () => {
      const engine = fakeEngine(false);
      const app = mount(engine);
      expect((await request(app).get('/repl')).status).toBe(404);
      expect((await request(app).post('/repl/x').send({ command: '1+1' })).status).toBe(404);
      expect((await request(app).get('/repl/x').set('Accept', 'text/event-stream')).status).toBe(404);
      expect((await request(app).get('/repl/x/ui')).status).toBe(404);
      expect((await request(app).get('/repl/x/vs/loader.js')).status).toBe(404);
      expect(engine.dispatch).not.toHaveBeenCalled();
      expect(engine.events).not.toHaveBeenCalled();
    });

    it('every 404 carries the same body', async () => {
      const app = mount(fakeEngine(false));
      for (const path of ['/repl', '/repl/x', '/repl/x/ui', '/repl/x/vs/loader.js']) {
        expect((await request(app).get(path)).body).toEqual({ statusCode: 404, message: 'Not Found' });
      }
      const missingAsset = await request(mount(fakeEngine())).get('/repl/x/vs/nope.js');
      expect(missingAsset.body).toEqual({ statusCode: 404, message: 'Not Found' });
    });
  });

  describe(`${label}: createReplRouter: POST /:channel`, () => {
    it('accepts a command with 202 and returns commandId', async () => {
      const engine = fakeEngine();
      const res = await request(mount(engine)).post('/repl/chanA').send({ command: '1+1' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: true, commandId: 'cmd_x' });
      expect(engine.dispatch).toHaveBeenCalledWith('chanA', '1+1');
    });
  });

  describe(`${label}: createReplRouter: POST /:channel rejects bad bodies`, () => {
    it.each([
      ['a missing command', {}],
      ['a whitespace-only command', { command: '   ' }],
      ['a non-string command', { command: 123 }],
    ])('rejects %s with 400 and the handler message, never dispatching', async (_label, body) => {
      const engine = fakeEngine();
      const res = await request(mount(engine)).post('/repl/chanA').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ statusCode: 400, message: 'command must be a non-empty string' });
      expect(engine.dispatch).not.toHaveBeenCalled();
    });

    it('returns 404 and never dispatches when disabled', async () => {
      const engine = fakeEngine(false);
      const res = await request(mount(engine)).post('/repl/chanA').send({ command: '1+1' });
      expect(res.status).toBe(404);
      expect(engine.dispatch).not.toHaveBeenCalled();
    });
  });

  describe(`${label}: createReplRouter: GET / (landing)`, () => {
    it('redirects to a random channel UI under the MOUNT path (no base-path option)', async () => {
      const res = await request(mount(fakeEngine())).get('/repl');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/repl\/[a-z0-9]{8}\/ui$/);
    });

    it('uses whatever path the user mounted at as the base', async () => {
      const app = express();
      app.use('/internal/debug/repl', createReplRouter({ engine: fakeEngine() }));
      const res = await request(app).get('/internal/debug/repl');
      expect(res.headers.location).toMatch(/^\/internal\/debug\/repl\/[a-z0-9]{8}\/ui$/);
    });

    it('generates a fresh channel per visit', async () => {
      const app = mount(fakeEngine());
      const a = await request(app).get('/repl');
      const b = await request(app).get('/repl');
      expect(a.headers.location).not.toBe(b.headers.location);
    });

    it('returns 404 when disabled', async () => {
      const res = await request(mount(fakeEngine(false))).get('/repl');
      expect(res.status).toBe(404);
    });
  });

  describe(`${label}: createReplRouter: GET /:channel/ui and /:channel/vs/*`, () => {
    it('serves an HTML page mentioning the channel and Monaco', async () => {
      const res = await request(mount(fakeEngine())).get('/repl/chanA/ui');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('chanA');
      expect(res.text.toLowerCase()).toContain('monaco');
    });

    it('escapes </script> in the channel name so it cannot break out of the script context', async () => {
      const evil = '</script><script>alert(1)</script>';
      const res = await request(mount(fakeEngine())).get(`/repl/${encodeURIComponent(evil)}/ui`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('</script><script>alert(1)');
    });

    it('serves vs/loader.js as JavaScript', async () => {
      const res = await request(mount(fakeEngine())).get('/repl/chanA/vs/loader.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.text.length).toBeGreaterThan(0);
    });

    it('serves a nested asset path', async () => {
      const res = await request(mount(fakeEngine())).get('/repl/chanA/vs/base/worker/workerMain.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
    });

    it('404s on a traversal attempt', async () => {
      const res = await request(mount(fakeEngine())).get('/repl/chanA/vs/..%2f..%2fpackage.json');
      expect(res.status).toBe(404);
    });

    it('404s on a missing asset', async () => {
      const res = await request(mount(fakeEngine())).get('/repl/chanA/vs/nope.js');
      expect(res.status).toBe(404);
    });

    it('404s on both when disabled', async () => {
      const app = mount(fakeEngine(false));
      expect((await request(app).get('/repl/x/ui')).status).toBe(404);
      expect((await request(app).get('/repl/x/vs/loader.js')).status).toBe(404);
    });
  });

  // An async iterator over a fixed list that reports whether return() was
  // called, so the disconnect-cleanup contract (the adapter MUST call
  // return() on close) is observable at the HTTP seam.
  function finiteEvents(events: unknown[]) {
    const state = { returned: false };
    async function* gen() {
      try {
        for (const e of events) yield e;
      } finally {
        state.returned = true;
      }
    }
    return { iterator: gen(), state };
  }

  describe(`${label}: createReplRouter: GET /:channel (SSE)`, () => {
    it('writes event-stream headers and frames; heartbeats repeat the last real event id', async () => {
      const engine = fakeEngine();
      const { iterator } = finiteEvents([
        { id: 5, type: 'output', commandId: 'cmd_1', data: 'hi' },
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
        { id: 0, type: 'system', commandId: null, data: { ping: true } },
      ]);
      engine.events.mockReturnValueOnce(iterator as never);
      const res = await request(mount(engine))
        .get('/repl/chanA')
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '3');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['x-accel-buffering']).toBe('no');
      expect(engine.events).toHaveBeenCalledWith('chanA', 3);
      expect(res.text.startsWith('\n')).toBe(true);
      expect(res.text.match(/^id: .*$/gm)).toEqual(['id: 5', 'id: 5', 'id: 5']);
      // PROTOCOL.md §6: `event: message`, `id`, then the whole event as one JSON line.
      expect(res.text).toContain(
        'event: message\nid: 5\ndata: {"id":5,"type":"output","commandId":"cmd_1","data":"hi"}\n\n',
      );
    });

    it('passes a null cursor when Last-Event-ID is absent', async () => {
      const engine = fakeEngine();
      engine.events.mockReturnValueOnce(finiteEvents([]).iterator as never);
      await request(mount(engine)).get('/repl/chanA');
      expect(engine.events).toHaveBeenCalledWith('chanA', null);
    });

    it('returns 404 and never opens the engine stream when disabled', async () => {
      const engine = fakeEngine(false);
      const res = await request(mount(engine)).get('/repl/x').set('Accept', 'text/event-stream');
      expect(res.status).toBe(404);
      expect(engine.events).not.toHaveBeenCalled();
    });

    it('calls return() on the frame iterator when the client disconnects mid-stream', async () => {
      const engine = fakeEngine();
      const state = { returned: false };
      // Never-ending source: the only way it finishes is through return().
      const pending: AsyncIterableIterator<unknown> = {
        next: () => new Promise(() => undefined),
        return: async () => {
          state.returned = true;
          return { value: undefined, done: true };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      engine.events.mockReturnValueOnce(pending as never);
      const server = mount(engine).listen(0);
      try {
        const { port } = server.address() as { port: number };
        const ac = new AbortController();
        const res = await fetch(`http://127.0.0.1:${port}/repl/chanA`, { signal: ac.signal });
        expect(res.status).toBe(200);
        ac.abort();
        await vi.waitFor(() => expect(state.returned).toBe(true));
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });

  describe(`${label}: the router is running on Express ${major}`, () => {
    it('is the expected Express major', () => {
      // Express 5 removed the deprecated `app.del` alias; Express 4 has it.
      const app = express() as unknown as { del?: unknown };
      expect(typeof app.del === 'function').toBe(major === 4);
    });
  });
}
