import { Router, json, type NextFunction, type Request, type Response } from 'express';
import {
  createReplHandlers,
  InvalidCommandError,
  parseLastEventId,
  ReplDisabledError,
  SSE_RESPONSE_HEADERS,
  SSE_STREAM_PREAMBLE,
  type ReplHandlerEngine,
} from '@remote-repl/core';

export interface ReplRouterOptions {
  /** The engine (or anything with its `dispatch` + `events`) the routes drive. */
  engine: ReplHandlerEngine;
  /**
   * The same `enabled` the engine was built with. When false every route
   * 404s (security invariant: `enabled` is enforced at runtime, here AND in
   * the engine).
   */
  enabled: boolean;
}

// Maps the shared handlers' errors to HTTP; anything else goes to Express's
// error pipeline. Explicit (rather than relying on Express 5's promise
// forwarding) so the router behaves identically on Express 4.
function sendError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ReplDisabledError) {
    res.status(404).json({ statusCode: 404, message: 'Not Found' });
  } else if (err instanceof InvalidCommandError) {
    res.status(400).json({ statusCode: 400, message: err.message });
  } else {
    next(err);
  }
}

export function createReplRouter(options: ReplRouterOptions): Router {
  const handlers = createReplHandlers(options.engine, { enabled: options.enabled });
  const router = Router();

  // Landing: a visit with no channel gets a random one. `originalUrl` keeps
  // the mount path, which is how the mount path becomes the base path.
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.redirect(302, handlers.landing(req.originalUrl));
    } catch (err) {
      sendError(err, res, next);
    }
  });

  router.get('/:channel/ui', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.type('text/html').send(handlers.ui(String(req.params.channel)));
    } catch (err) {
      sendError(err, res, next);
    }
  });

  // Self-hosted Monaco. A RegExp path rather than a splat so the route reads
  // the same on Express 4 (`*` -> params[0]) and 5 (`*path` -> string[]):
  // both populate numbered capture groups, already percent-decoded. The
  // traversal guard lives in the handler (null -> 404).
  router.get(/^\/([^/]+)\/vs\/(.+)$/, (req: Request, res: Response, next: NextFunction) => {
    try {
      const asset = handlers.asset(String(req.params[1]));
      if (!asset) {
        res.status(404).json({ statusCode: 404, message: 'Not Found' });
        return;
      }
      res.type(asset.contentType).send(asset.buffer);
    } catch (err) {
      sendError(err, res, next);
    }
  });

  // SSE. The handler yields ready-to-send text frames; we only own the
  // socket. `return()` on close is what releases the engine subscription
  // (and lets the channel be GC'd), so it is wired before the first write.
  router.get('/:channel', (req: Request, res: Response, next: NextFunction) => {
    let frames: AsyncIterableIterator<string>;
    try {
      frames = handlers.stream(
        String(req.params.channel),
        parseLastEventId(req.get('last-event-id')),
      );
    } catch (err) {
      sendError(err, res, next);
      return;
    }
    res.on('close', () => void frames.return?.());
    res.writeHead(200, SSE_RESPONSE_HEADERS);
    res.write(SSE_STREAM_PREAMBLE);
    res.flushHeaders();
    void (async () => {
      try {
        for await (const frame of frames) res.write(frame);
      } finally {
        res.end();
      }
    })();
  });

  router.post('/:channel', json(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { commandId } = await handlers.post(String(req.params.channel), req.body);
      res.status(202).json({ accepted: true, commandId });
    } catch (err) {
      sendError(err, res, next);
    }
  });

  return router;
}
