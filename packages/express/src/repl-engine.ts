import {
  RemoteReplEngine,
  type ContextFactory,
  type EngineLogger,
  type WebReplAdapter,
  type WebReplOptions,
} from '@remote-repl/core';

interface ReplEngineBaseOptions {
  /** Engine options; `enabled` is required and is the only safety rail. */
  options: WebReplOptions;
  /** The pub/sub transport (in-memory for one instance, Redis for a cluster). */
  transport: WebReplAdapter;
  /** Defaults to `console`. */
  logger?: EngineLogger;
}

/**
 * What an Express app has instead of a DI container: either a ready context
 * object (the globals every REPL session sees) or a callback that builds a
 * fresh one per session.
 */
export type ReplEngineOptions =
  | (ReplEngineBaseOptions & { context: Record<string, unknown>; buildContext?: never })
  | (ReplEngineBaseOptions & { buildContext: ContextFactory; context?: never });

/**
 * Builds the framework-free engine for an Express app. The caller owns its
 * lifecycle: `await engine.start()` once the app boots (a no-op when
 * disabled, so it never subscribes) and `await engine.stop()` on shutdown.
 */
export function createReplEngine(opts: ReplEngineOptions): RemoteReplEngine {
  const buildContext: ContextFactory = opts.buildContext ?? (() => ({ ...opts.context }));
  return new RemoteReplEngine(opts.options, opts.transport, buildContext, undefined, opts.logger);
}
