import {
  RemoteReplEngine,
  type RemoteReplContextFactory,
  type RemoteReplLogger,
  type RemoteReplTransport,
  type RemoteReplOptions,
} from '@remote-repl/core';

interface ReplEngineBaseOptions {
  /** Engine options; `enabled` is required and is the only safety rail. */
  options: RemoteReplOptions;
  /**
   * The pub/sub transport: Redis for a cluster. Default: the in-memory
   * transport, which is correct for exactly one instance.
   */
  transport?: RemoteReplTransport;
  /** Defaults to `console`. */
  logger?: RemoteReplLogger;
}

/**
 * What an Express app has instead of a DI container: either a ready context
 * object (the globals every REPL session sees) or a callback that builds a
 * fresh one per session.
 */
export type RemoteReplEngineOptions =
  | (ReplEngineBaseOptions & { context: Record<string, unknown>; buildContext?: never })
  | (ReplEngineBaseOptions & { buildContext: RemoteReplContextFactory; context?: never });

/**
 * Builds the framework-free engine for an Express app. The caller owns its
 * lifecycle: `await engine.start()` once the app boots (a no-op when
 * disabled, so it never subscribes) and `await engine.stop()` on shutdown.
 */
export function createRemoteReplEngine(opts: RemoteReplEngineOptions): RemoteReplEngine {
  const buildContext: RemoteReplContextFactory = opts.buildContext ?? (() => ({ ...opts.context }));
  return new RemoteReplEngine(opts.options, opts.transport, buildContext, undefined, opts.logger);
}
