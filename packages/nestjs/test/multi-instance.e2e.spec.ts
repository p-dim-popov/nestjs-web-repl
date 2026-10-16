import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebReplModule } from '../src/web-repl.module';
import { InMemoryWebReplAdapter } from '../src/adapters/in-memory-web-repl.adapter';

// Boots a real, listening Nest app wired to WebReplModule, sharing the given
// adapter instance with any other app booted the same way. Because
// InMemoryWebReplAdapter is just an in-process EventEmitter, two apps in the
// same test process that share one adapter instance behave like two
// horizontally-scaled instances behind a real pub/sub backend: both
// WebReplService instances subscribe to the same 'cmd'/'out'/'sys' topics.
const boot = async (
  instanceId: string,
  adapter: InMemoryWebReplAdapter,
): Promise<INestApplication> => {
  const mod = await Test.createTestingModule({
    imports: [WebReplModule.register({ enabled: true, instanceId, adapter })],
  }).compile();
  const app: INestApplication = mod.createNestApplication();
  await app.init();
  await app.listen(0);
  return app;
};

describe('multi-instance web-repl (cross-instance routing + fan-out)', () => {
  const adapter = new InMemoryWebReplAdapter();
  let a: INestApplication;
  let b: INestApplication;

  beforeAll(async () => {
    a = await boot('A', adapter);
    b = await boot('B', adapter);
  });

  afterAll(async () => {
    await a.close();
    await b.close();
  });

  // This is the core cross-instance proof: `const total = 100` is POSTed to
  // instance A, then `total + 1` is POSTed to instance B for the SAME
  // channel. If ownership routing works, whichever instance first claimed
  // the channel (A, since it saw the first command) executes BOTH commands
  // in its one ReplSession, so `total` is still in scope for the second
  // command and the result is 101. If B wrongly ran its own command in a
  // separate session, `total` would be undefined there and evaluating it
  // would throw a ReferenceError -- so asserting the SSE stream contains
  // '101' (and not a ReferenceError) genuinely proves single-owner routing,
  // not just that some output arrived.
  //
  // The SSE stream is read via a raw http.get against instance B's bound
  // port (the same technique already proven in web-repl.module.spec.ts),
  // rather than the `eventsource` package: Node's http client is sufficient
  // to accumulate an SSE response body, so no extra dependency is needed.
  // Reading from B (not A) additionally proves output fan-out: B never
  // executes the command, yet its own SSE stream still observes the output
  // produced by A's execution, because both instances' WebReplService
  // subscribe to the shared adapter's 'out' topic.
  it('persists a variable across commands posted to different instances and fans output to both', async () => {
    const channel = 'shared';
    const { port: portB } = b.getHttpServer().address() as AddressInfo;

    const sseOutput = await new Promise<string>((resolve, reject) => {
      let acc = '';
      const req = http.get(
        `http://127.0.0.1:${portB}/repl/${channel}`,
        { headers: { Accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            acc += chunk;
            if (acc.includes('101')) {
              res.destroy();
              req.destroy();
              resolve(acc);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);

      // Let the SSE connection on B establish before dispatching anything.
      // (Strictly, B's per-channel ring buffer would replay history to a
      // late subscriber too, but connecting first mirrors the already
      // proven pattern in web-repl.module.spec.ts and keeps this test
      // honest about ordering.)
      setTimeout(() => {
        request(a.getHttpServer())
          .post(`/repl/${channel}`)
          .send({ command: 'const total = 100' })
          .then((res) => {
            if (res.status !== 202) {
              reject(new Error(`dispatch to A failed: ${res.status} ${JSON.stringify(res.body)}`));
              return;
            }
            // Give A's async claim -> session -> eval -> fan-out pipeline
            // time to fully settle before B's command for the same channel
            // arrives, so ownership is unambiguously held by A.
            setTimeout(() => {
              request(b.getHttpServer())
                .post(`/repl/${channel}`)
                .send({ command: 'total + 1' })
                .then((res2) => {
                  if (res2.status !== 202) {
                    reject(
                      new Error(`dispatch to B failed: ${res2.status} ${JSON.stringify(res2.body)}`),
                    );
                  }
                })
                .catch(reject);
            }, 150);
          })
          .catch(reject);
      }, 100);

      setTimeout(() => reject(new Error('timed out waiting for SSE output event containing 101')), 8000);
    });

    expect(sseOutput).toContain('"type":"output"');
    expect(sseOutput).toContain('101');
    expect(sseOutput).not.toContain('ReferenceError');
  }, 15000);
});
