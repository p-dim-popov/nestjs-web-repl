import { firstValueFrom, toArray } from 'rxjs';
import { take } from 'rxjs/operators';
import { WebReplService } from './web-repl.service';
import { InMemoryWebReplAdapter } from './adapters/in-memory-web-repl.adapter';
import type { WebReplModuleOptions } from './interfaces/web-repl-options.interface';

const makeService = async (
  instanceId: string,
  adapter: InMemoryWebReplAdapter,
  contextFactory: () => Record<string, unknown> = () => ({ marker: () => 'ctx-ok' }),
) => {
  const options: WebReplModuleOptions = { enabled: true, instanceId, adapter };
  const svc = new WebReplService(options, adapter, contextFactory);
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

  it("tags each command's output with its own commandId under same-channel overlap", async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter, () => ({
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    }));

    const outputs: Array<{ commandId: string | null; data: unknown }> = [];
    const sub = svc.stream('c4', null).subscribe((e) => {
      if (e.type === 'output') outputs.push({ commandId: e.commandId, data: e.data });
    });

    // cmd1 is still mid-flight (asleep) when cmd2 is dispatched to the same
    // channel. Without per-channel serialization of the announce->eval->done
    // unit, cmd1's trailing output would race ahead and get tagged with
    // cmd2's commandId.
    const { commandId: id1 } = await svc.dispatch('c4', "await sleep(80); console.log('one')");
    await new Promise((r) => setTimeout(r, 10));
    const { commandId: id2 } = await svc.dispatch('c4', "console.log('two')");

    await new Promise((r) => setTimeout(r, 250));
    sub.unsubscribe();

    const oneEvent = outputs.find((e) => String(e.data).includes('one'));
    const twoEvent = outputs.find((e) => String(e.data).includes('two'));
    expect(oneEvent?.commandId).toBe(id1);
    expect(twoEvent?.commandId).toBe(id2);

    await svc.onModuleDestroy();
  });
});
