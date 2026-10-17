import { RemoteReplDisabledError } from '../engine/remote-repl-engine';
import type { RemoteReplEvent } from '../protocol/messages';
import { renderReplUi } from '../ui/repl-ui.html';
import { resolveMonacoFile, type RemoteReplAsset } from '../ui/monaco-assets';
import { landingRedirectUrl, randomChannelName } from './landing';
import { sseFrameToText, toSseFrame, type RemoteReplSseFrame } from './sse-frame';

/** The part of the engine's public surface the handlers consume. */
export interface RemoteReplHandlerEngine {
  dispatch(channel: string, command: string): Promise<{ commandId: string }>;
  events(channel: string, lastEventId: number | null): AsyncIterableIterator<RemoteReplEvent>;
}

/**
 * Thrown (as a rejection) by `post()` when the body's `command` is not a
 * non-empty string. Framework packages map it to 400 with `message` as the body.
 */
export class RemoteReplInvalidCommandError extends Error {
  constructor() {
    super('command must be a non-empty string');
    this.name = 'RemoteReplInvalidCommandError';
  }
}

/**
 * The response headers the reference (Nest) SSE implementation sends, so
 * every framework package matches the wire format exactly. Write `REMOTE_REPL_SSE_STREAM_PREAMBLE`
 * once after the headers, then each frame from `stream()` verbatim.
 */
export const REMOTE_REPL_SSE_RESPONSE_HEADERS = Object.freeze({
  'Content-Type': 'text/event-stream',
  Connection: 'keep-alive',
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0, no-transform',
  Pragma: 'no-cache',
  Expire: '0',
  'X-Accel-Buffering': 'no',
});

/** A single leading blank line, written when the SSE headers are committed. */
export const REMOTE_REPL_SSE_STREAM_PREAMBLE = '\n';

/**
 * `Last-Event-ID` request header -> replay cursor. Absent, empty or not a
 * number means "no cursor" (replay everything), per PROTOCOL.md §6.3.
 */
export function parseRemoteReplLastEventId(header: string | null | undefined): number | null {
  if (!header) return null;
  const parsed = Number(header);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface RemoteReplHandlerOptions {
  enabled: boolean;
}

export interface RemoteReplHandlers {
  /** GET <base>: the redirect target for a visitor with no channel. */
  landing(requestUrl: string): string;
  /**
   * POST <base>/:channel. Always async: every failure is a rejection --
   * `RemoteReplDisabledError` when disabled, `RemoteReplInvalidCommandError` for a bad body.
   */
  post(channel: string, body: unknown): Promise<{ commandId: string }>;
  /**
   * GET <base>/:channel (SSE), structured form. Yields `RemoteReplSseFrame`s: the
   * replay since `lastEventId` (see `parseRemoteReplLastEventId`), then live events
   * and `{ping}` heartbeats stamped with the last real id sent on THIS
   * connection (seeded from the client's cursor). For framework packages whose SSE
   * layer wants `{id,type,data}` objects (e.g. Nest's `MessageEvent`)
   * rather than wire text. Opens the engine stream eagerly; the caller
   * MUST call `return()` on disconnect -- that is what closes the engine
   * subscription and lets the channel be GC'd. Throws `RemoteReplDisabledError`
   * synchronously when disabled.
   */
  streamFrames(channel: string, lastEventId: number | null): AsyncIterableIterator<RemoteReplSseFrame>;
  /**
   * GET <base>/:channel (SSE), wire form: `streamFrames()` serialised with
   * `sseFrameToText`, i.e. ready-to-send text frames. Same contract
   * (eager open, MUST `return()` on disconnect, sync `RemoteReplDisabledError`).
   */
  stream(channel: string, lastEventId: number | null): AsyncIterableIterator<string>;
  /** GET <base>/:channel/ui: the browser UI (`text/html`), channel escaped. */
  ui(channel: string): string;
  /**
   * GET <base>/:channel/vs/*: one Monaco asset by its path relative to `vs/`,
   * or null (-> 404) for a miss, a directory or any traversal attempt.
   */
  asset(relativePath: string): RemoteReplAsset | null;
}

export function createRemoteReplHandlers(
  engine: RemoteReplHandlerEngine,
  options: RemoteReplHandlerOptions,
): RemoteReplHandlers {
  const assertEnabled = (): void => {
    if (!options.enabled) throw new RemoteReplDisabledError();
  };
  return {
    landing(requestUrl) {
      assertEnabled();
      return landingRedirectUrl(requestUrl, randomChannelName());
    },
    async post(channel, body) {
      assertEnabled();
      const command = (body as { command?: unknown } | null | undefined)?.command;
      if (typeof command !== 'string' || command.trim().length === 0) {
        throw new RemoteReplInvalidCommandError();
      }
      return engine.dispatch(channel, command);
    },
    streamFrames(channel, lastEventId) {
      assertEnabled();
      const source = engine.events(channel, lastEventId);
      // The id of the last real (non-heartbeat) event sent on this
      // connection, so heartbeats repeat it instead of the `0` sentinel.
      // Seeded from the client's reconnect cursor (or 0 = nothing yet) so a
      // heartbeat fired before any real event is idempotent for the cursor.
      let lastRealId = lastEventId ?? 0;
      return mapIterator(source, (event) => {
        const frame = toSseFrame(event, lastRealId);
        if (event.id !== 0) lastRealId = event.id;
        return frame;
      });
    },
    stream(channel, lastEventId) {
      return mapIterator(this.streamFrames(channel, lastEventId), sseFrameToText);
    },
    ui(channel) {
      assertEnabled();
      return renderReplUi(channel);
    },
    asset(relativePath) {
      assertEnabled();
      return resolveMonacoFile(relativePath);
    },
  };
}

/**
 * Lazily maps an async iterator. Hand-rolled rather than an async generator:
 * a generator queues `return()` behind a pending `next()`, which would delay
 * closing the engine subscription until the next event arrives.
 */
function mapIterator<T, U>(
  source: AsyncIterableIterator<T>,
  fn: (value: T) => U,
): AsyncIterableIterator<U> {
  const finish = async (): Promise<IteratorResult<U, undefined>> => {
    await source.return?.(undefined);
    return { value: undefined, done: true };
  };
  const iterator: AsyncIterableIterator<U> = {
    async next() {
      const result = await source.next();
      if (result.done) return { value: undefined, done: true };
      return { value: fn(result.value), done: false };
    },
    return: finish,
    throw: finish,
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
  return iterator;
}
