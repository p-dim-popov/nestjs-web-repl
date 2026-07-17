import { start, type REPLServer } from 'node:repl';
import { PassThrough, Writable } from 'node:stream';

export interface ReplSessionOptions {
  context: Record<string, unknown>;
  onOutput: (chunk: string) => void;
}

// A prompt string that will never occur in legitimate REPL output (result
// echoes, console output, or error reports). node:repl (with terminal:
// false) re-writes the prompt to `output` exactly once per command, and,
// critically, only after that command has fully settled: after a
// synchronous result, after an awaited top-level promise resolves (however
// long that takes), and after the domain-based uncaught-exception handler
// finishes reporting a thrown error. That makes "the sentinel appeared in
// output" a deterministic, timing-independent "this command is done"
// signal that works uniformly across all of those cases.
const SENTINEL = ' <<webrepl:done:9f3a1c>> ';

export class ReplSession {
  private readonly input = new PassThrough();
  private readonly server: REPLServer;
  private queue: Promise<void> = Promise.resolve();
  private buffer = '';
  private resolveCurrent: (() => void) | null = null;

  constructor(private readonly opts: ReplSessionOptions) {
    const output = new Writable({
      write: (chunk, _enc, cb) => {
        this.handleOutput(chunk.toString());
        cb();
      },
    });

    this.server = start({
      input: this.input,
      output,
      terminal: false,
      useColors: false,
      prompt: SENTINEL,
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

    // The initial prompt is written synchronously inside start(), before
    // this constructor returns and therefore before any eval() call could
    // possibly have registered a resolver yet. handleOutput() strips it
    // (resolveCurrent is still null at this point) and forwards nothing,
    // so it never leaks into onOutput and never spuriously resolves the
    // first real eval().
  }

  /**
   * Buffers incoming output text, strips every occurrence of SENTINEL
   * before it reaches onOutput, and resolves the in-flight eval() promise
   * (if any) each time a sentinel is found. A trailing partial match of
   * SENTINEL is held back across writes so a sentinel split across two
   * stream chunks is never mistakenly forwarded or missed.
   */
  private handleOutput(text: string): void {
    this.buffer += text;

    let idx: number;
    while ((idx = this.buffer.indexOf(SENTINEL)) !== -1) {
      const before = this.buffer.slice(0, idx);
      if (before.length) this.opts.onOutput(before);
      this.buffer = this.buffer.slice(idx + SENTINEL.length);

      const resolve = this.resolveCurrent;
      this.resolveCurrent = null;
      resolve?.();
    }

    const holdBack = this.partialSentinelSuffixLength(this.buffer);
    if (this.buffer.length > holdBack) {
      const flush = this.buffer.slice(0, this.buffer.length - holdBack);
      this.opts.onOutput(flush);
      this.buffer = this.buffer.slice(this.buffer.length - holdBack);
    }
  }

  /** Length of the longest suffix of `text` that is also a prefix of SENTINEL. */
  private partialSentinelSuffixLength(text: string): number {
    const max = Math.min(text.length, SENTINEL.length - 1);
    for (let len = max; len > 0; len--) {
      if (text.endsWith(SENTINEL.slice(0, len))) return len;
    }
    return 0;
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
      // Registering the resolver before writing guarantees we never miss
      // the sentinel that reports this command's completion, however long
      // (or short) evaluation takes.
      this.resolveCurrent = resolve;
      this.input.write(command + '\n');
    });
  }

  close(): void {
    this.server.close();
  }
}
