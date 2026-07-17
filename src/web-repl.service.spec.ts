import { firstValueFrom, toArray } from 'rxjs';
import { take } from 'rxjs/operators';
import { WebReplService } from './web-repl.service';
import { InMemoryWebReplAdapter } from './adapters/in-memory-web-repl.adapter';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';

const makeService = async (instanceId: string, adapter: InMemoryWebReplAdapter) => {
  const options: WebReplModuleOptions = { enabled: true, instanceId, adapter };
  const svc = new WebReplService(options, adapter, () => ({ marker: () => 'ctx-ok' }));
  await svc.onModuleInit();
  return svc;
};

describe('WebReplService', () => {
  it('executes a command and streams a command echo plus output', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);

    const events = firstValueFrom(svc.stream('c1', null).pipe(take(2), toArray()));
    const { commandId } = await svc.dispatch('c1', '2 + 3');
    const got = await events;

    expect(got[0].type).toBe('command');
    expect(got[0].commandId).toBe(commandId);
    expect(got[1].type).toBe('output');
    expect(String(got[1].data)).toContain('5');
    await svc.onModuleDestroy();
  });

  it('routes execution to the owning instance only', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const a = await makeService('A', adapter);
    const b = await makeService('B', adapter);

    // A owns c2 because A receives the HTTP dispatch (origin = A).
    await a.dispatch('c2', 'const v = 10');
    await new Promise((r) => setTimeout(r, 20));
    // Command posted at B for the same channel must still execute on A (owner),
    // so the variable persists.
    const events = firstValueFrom(b.stream('c2', null).pipe(
      // skip replayed events, take the next output
      take(4), toArray(),
    ));
    await b.dispatch('c2', 'v + 5');
    const got = await events;
    expect(got.some((e) => e.type === 'output' && String(e.data).includes('15'))).toBe(true);

    await a.onModuleDestroy();
    await b.onModuleDestroy();
  });

  it('replays buffered events to a late subscriber', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);
    await svc.dispatch('c3', '7 * 6');
    await new Promise((r) => setTimeout(r, 20));

    const replay = await firstValueFrom(svc.stream('c3', null).pipe(take(2), toArray()));
    expect(replay[0].type).toBe('command');
    expect(replay.some((e) => String(e.data).includes('42'))).toBe(true);
    await svc.onModuleDestroy();
  });
});
