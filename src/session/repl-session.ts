import { start, type REPLServer } from 'node:repl';
import { PassThrough, Writable } from 'node:stream';

export interface ReplSessionOptions {
  context: Record<string, unknown>;
  onOutput: (chunk: string) => void;
}

export class ReplSession {
  private readonly input = new PassThrough();
  private readonly server: REPLServer;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ReplSessionOptions) {
    const output = new Writable({
      write: (chunk, _enc, cb) => {
        const text = chunk.toString();
        if (text.length) opts.onOutput(text);
        cb();
      },
    });

    this.server = start({
      input: this.input,
      output,
      terminal: false,
      useColors: false,
      prompt: '',
      ignoreUndefined: true,
    });

    for (const key of Object.keys(opts.context)) {
      this.server.context[key] = opts.context[key];
    }

    this.server.context.console = {
      log: (...a: unknown[]) => {
        opts.onOutput(this.format(a) + '\n');
      },
      info: (...a: unknown[]) => {
        opts.onOutput(this.format(a) + '\n');
      },
      warn: (...a: unknown[]) => {
        opts.onOutput(this.format(a) + '\n');
      },
      error: (...a: unknown[]) => {
        opts.onOutput(this.format(a) + '\n');
      },
      debug: (...a: unknown[]) => {
        opts.onOutput(this.format(a) + '\n');
      },
    };
  }

  private format(args: unknown[]): string {
    return args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
  }

  eval(command: string): Promise<void> {
    this.queue = this.queue.then(() => this.runLine(command));
    return this.queue;
  }

  private runLine(command: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.input.write(command + '\n');
      // Drive the command through the REPLServer's normal line-processing
      // path (as if typed at a terminal) rather than calling `server.eval`
      // directly. `server.eval`'s callback is unreliable for synchronous
      // top-level `throw` statements: node's REPL intercepts those via its
      // domain-based uncaught-exception handler and writes the "Uncaught"
      // report straight to `output` without ever invoking the eval
      // callback, which would hang this promise forever. Writing to
      // `input` sidesteps that: whatever path the REPL takes (normal
      // result echo, console output, or the uncaught-exception report),
      // it all flows through the same `output` stream. Two chained
      // `setImmediate` ticks are enough to let that synchronous
      // processing (and any immediate-scheduled follow-up, such as the
      // uncaught handler) flush before we resolve.
      setImmediate(() => setImmediate(resolve));
    });
  }

  close(): void {
    this.server.close();
  }
}
