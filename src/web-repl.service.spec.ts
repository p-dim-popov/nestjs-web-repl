import { NotFoundException } from '@nestjs/common';
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

  it('keeps the channel alive after a command whose execution throws', async () => {
    const adapter = new InMemoryWebReplAdapter();
    let calls = 0;
    // ensureSession only caches state.session *after* the ReplSession is
    // successfully constructed, so a throwing buildContext() leaves
    // nothing cached -- the factory is called again on the next command,
    // which is what lets cmd2 recover and succeed.
    const factory = () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return { marker: () => 'ok' };
    };
    const svc = await makeService('A', adapter, factory);

    const events: Array<{ type: string; commandId: string | null; data: unknown }> = [];
    const sub = svc.stream('c5', null).subscribe((e) => events.push(e));

    const { commandId: id1 } = await svc.dispatch('c5', '1 + 1');
    await new Promise((r) => setTimeout(r, 20));
    const { commandId: id2 } = await svc.dispatch('c5', '3 + 4');
    await new Promise((r) => setTimeout(r, 50));
    sub.unsubscribe();

    const errorEvent = events.find(
      (e) =>
        e.type === 'system' &&
        e.commandId === id1 &&
        typeof (e.data as { error?: unknown })?.error === 'string',
    );
    expect(errorEvent).toBeDefined();

    const outputEvent = events.find((e) => e.type === 'output' && e.commandId === id2);
    expect(outputEvent).toBeDefined();
    expect(String(outputEvent?.data)).toContain('7');

    await svc.onModuleDestroy();
  });

  it('drops late output from a disposed session after a channel release (regression guard)', async () => {
    // ReplSession does not guarantee zero onOutput writes after close() (a
    // genuinely in-flight async eval can still emit late). Rather than
    // race a real timing window to provoke that, drive the guard
    // deterministically: grab the actual session the service created,
    // force the same teardown a TTL/ownership release performs, then
    // invoke that session's stored onOutput closure directly to simulate
    // the late write and assert it's dropped, not re-buffered/replayed.
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);

    await svc.dispatch('c6', '1 + 1');
    await new Promise((r) => setTimeout(r, 20));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = svc as any;
    const state = internals.channels.get('c6');
    const session = state.session;
    expect(session).toBeDefined();

    const events: Array<{ type: string; data: unknown }> = [];
    const sub = svc.stream('c6', null).subscribe((e) => events.push(e));

    // Same teardown path onSys runs for a `sys release` message.
    internals.onSys({ channel: 'c6', kind: 'release', instanceId: 'A' });

    // Simulate the disposed session's in-flight eval delivering output
    // after teardown.
    session.opts.onOutput('late-output-after-release');
    await new Promise((r) => setTimeout(r, 20));
    sub.unsubscribe();

    expect(events.some((e) => String(e.data).includes('late-output-after-release'))).toBe(false);
    expect(
      state.buffer
        .since(null)
        .some((e: { data: unknown }) => String(e.data).includes('late-output-after-release')),
    ).toBe(false);

    await svc.onModuleDestroy();
  });

  // --- CRITICAL 1: `enabled` must be enforced at runtime, not just at
  // module-registration time, so a forRootAsync-resolved `enabled: false`
  // can't ship a live execution endpoint. ---
  describe('when disabled at runtime', () => {
    const makeDisabledService = (adapter: InMemoryWebReplAdapter) => {
      const options: WebReplModuleOptions = { enabled: false, instanceId: 'D', adapter };
      return new WebReplService(options, adapter, () => ({ marker: () => 'ctx-ok' }));
    };

    it('does not subscribe to the adapter on onModuleInit', async () => {
      const adapter = new InMemoryWebReplAdapter();
      const subscribeSpy = vi.spyOn(adapter, 'subscribe');
      const svc = makeDisabledService(adapter);

      await svc.onModuleInit();

      expect(subscribeSpy).not.toHaveBeenCalled();
      await svc.onModuleDestroy();
    });

    it('dispatch() throws NotFoundException and never publishes a command', async () => {
      const adapter = new InMemoryWebReplAdapter();
      const publishSpy = vi.spyOn(adapter, 'publish');
      const svc = makeDisabledService(adapter);
      await svc.onModuleInit();

      await expect(svc.dispatch('dchan', '1 + 1')).rejects.toThrow(NotFoundException);
      expect(publishSpy).not.toHaveBeenCalled();

      await svc.onModuleDestroy();
    });

    it('stream() throws NotFoundException instead of returning an observable', async () => {
      const adapter = new InMemoryWebReplAdapter();
      const svc = makeDisabledService(adapter);
      await svc.onModuleInit();

      expect(() => svc.stream('dchan', null)).toThrow(NotFoundException);

      await svc.onModuleDestroy();
    });
  });

  // --- IMPORTANT 3 / MINOR 4: a channel created merely by a GET (SSE
  // subscribe) with no dispatched command must be evicted once its last
  // subscriber disconnects, so an unauthenticated client looping
  // `GET /repl/<random>` can't grow the channels map without bound. ---
  it('evicts a subscriber-less, session-less, empty-buffer channel once the last subscriber unsubscribes', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = svc as any;

    const sub = svc.stream('ghost-chan', null).subscribe();
    // Subscribing lazily creates the channel state (via getChannel at
    // subscribe time), so it should now be present in the map.
    expect(internals.channels.has('ghost-chan')).toBe(true);

    sub.unsubscribe();

    // No command was ever dispatched on this channel, so there is no
    // session and the replay buffer is empty -- the channel must be
    // evicted, not retained forever.
    expect(internals.channels.has('ghost-chan')).toBe(false);

    await svc.onModuleDestroy();
  });

  it('does not evict a channel that still has buffered replay history after its subscriber leaves', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = svc as any;

    await svc.dispatch('busy-chan', '1 + 1');
    await new Promise((r) => setTimeout(r, 20));

    const sub = svc.stream('busy-chan', null).subscribe();
    sub.unsubscribe();

    // The channel has a live session and/or buffered events -- it must be
    // retained so a reconnecting client can still replay history.
    expect(internals.channels.has('busy-chan')).toBe(true);

    await svc.onModuleDestroy();
  });

  // --- Follow-up fix from re-review: the eviction guard above (subscriber
  // count + no session + empty buffer) has no notion of an in-flight
  // command. onCmd captures `state` and passes it down to
  // executeCommand(), which lazily creates the ReplSession in
  // ensureSession(). If the last subscriber unsubscribes -- and evicts the
  // channel -- in the window between onCmd fetching `state` and
  // ensureSession() actually running, the session gets created on the now
  // off-map, orphaned `state` object, while later emit() calls re-resolve
  // through getChannel() to a brand-new state: the command's own 'command'
  // event lands correctly (its commandId is passed explicitly), but its
  // 'output' event(s) -- which read state.currentCommandId off the
  // orphaned closure -- get mis-tagged commandId: null, the orphaned
  // ReplSession is leaked (never close()d), and the next command on the
  // channel gets a second, disconnected session (breaking REPL variable
  // continuity). Reproduced deterministically (not via real timer/microtask
  // racing) by calling the private onCmd() directly and unsubscribing in
  // the exact window between its synchronous `pending` increment and its
  // first `await`. ---
  it('keeps an in-flight command session-consistent even if the last subscriber unsubscribes mid-dispatch', async () => {
    const adapter = new InMemoryWebReplAdapter();
    const svc = await makeService('A', adapter);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = svc as any;

    const channel = 'race-chan';
    const sub = svc.stream(channel, null).subscribe();
    const stateBefore = internals.channels.get(channel);
    expect(stateBefore).toBeDefined();

    const msg = {
      channel,
      commandId: 'race-cmd-1',
      command: '1 + 1',
      originInstanceId: 'A',
    };

    // onCmd increments `pending` and resolves `state` SYNCHRONOUSLY, before
    // its first `await` (the ownership `claim` publish, since this is a
    // brand-new channel) -- so calling it without awaiting, then
    // unsubscribing immediately, deterministically lands in the exact
    // vulnerable window the review identified.
    const onCmdDone: Promise<void> = internals.onCmd(msg);

    expect(stateBefore.pending).toBeGreaterThan(0);

    sub.unsubscribe();

    // The channel must survive the eviction check that unsubscribing
    // triggers, because a command is still pending on it.
    expect(internals.channels.has(channel)).toBe(true);
    expect(internals.channels.get(channel)).toBe(stateBefore);

    await onCmdDone;
    await new Promise((r) => setTimeout(r, 30));

    // Still the exact same ChannelState object -- no orphaned/duplicate
    // state was created for this channel while the command ran.
    expect(internals.channels.get(channel)).toBe(stateBefore);

    // Exactly one session exists, and it's the one that actually executed
    // the command (not orphaned on a since-deleted state object).
    expect(stateBefore.session).toBeDefined();

    const events = stateBefore.buffer.since(null) as Array<{
      type: string;
      commandId: string | null;
      data: unknown;
    }>;
    const outputEvent = events.find((e) => e.type === 'output');
    expect(outputEvent).toBeDefined();
    expect(outputEvent?.commandId).toBe('race-cmd-1');
    expect(String(outputEvent?.data)).toContain('2');

    await svc.onModuleDestroy();
  });
});
