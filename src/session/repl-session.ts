import { randomUUID } from 'node:crypto';
import { start, type REPLServer } from 'node:repl';
import { PassThrough, Writable } from 'node:stream';
import { inspect } from 'node:util';

export interface ReplSessionOptions {
  context: Record<string, unknown>;
  onOutput: (chunk: string) => void;
  /**
   * Safety-net timeout (ms) for a single eval(), in case some future input
   * shape defeats both the sentinel-completion signal and the incomplete-
   * input recovery below. Defaults to 30000. A legitimate async command
   * that runs longer than this will be cut off with a timeout error.
   */
  evalTimeoutMs?: number;
}

// The non-terminal node:repl writes this exact two-character string, as its
// own standalone `output` write, whenever a submitted line leaves a command
// syntactically incomplete (an unmatched brace/paren/template literal) and
// it is waiting for more input before it can finish parsing. Verified
// empirically across `{`, `(`, `` ` ``, `function () {`, and `if (...) {`
// on Node v26; this is what a human would see as node's "..." continuation
// indicator in a real terminal.
const CONTINUATION_PROMPT = '| ';

export class ReplSession {
  private readonly input = new PassThrough();
  private readonly server: REPLServer;
  private readonly evalTimeoutMs: number;
  // A prompt string unique to this instance (via crypto.randomUUID()) so
  // that no two sessions ever share a sentinel, and collisions with
  // arbitrary user-controlled output are effectively impossible. node:repl
  // (with terminal: false) re-writes the prompt to `output` exactly once
  // per command, and, critically, only after that command has fully
  // settled: after a synchronous result, after an awaited top-level
  // promise resolves (however long that takes), and after the domain-based
  // uncaught-exception handler finishes reporting a thrown error. That
  // makes "the sentinel appeared in output" a deterministic,
  // timing-independent "this command is done" signal that works uniformly
  // across all of those cases.
  private readonly sentinel = `<<webrepl:done:${randomUUID()}>>`;
  private queue: Promise<void> = Promise.resolve();
  private buffer = '';
  private resolveCurrent: (() => void) | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ReplSessionOptions) {
    this.evalTimeoutMs = opts.evalTimeoutMs ?? 30000;

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
      prompt: this.sentinel,
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
   * Buffers incoming output text, strips every occurrence of the sentinel
   * before it reaches onOutput, and resolves the in-flight eval() promise
   * (if any) each time a sentinel is found. A trailing partial match of
   * the sentinel is held back across writes so a sentinel split across two
   * stream chunks is never mistakenly forwarded or missed.
   *
   * Also watches for the REPL's continuation prompt: a command left
   * incomplete (e.g. `const y = {`) never produces the sentinel on its
   * own, and because evals are serialized that would otherwise hang this
   * session forever. User output can never collide with this check: real
   * console output is captured via the context.console override below
   * (which calls onOutput directly, bypassing this stream entirely), and
   * expression-result echoes are always util.inspect-formatted with a
   * trailing newline (a bare string result would be quoted, e.g. `'| '\n`,
   * never the raw two-character marker checked for here).
   */
  private handleOutput(text: string): void {
    if (text === CONTINUATION_PROMPT && this.resolveCurrent) {
      this.recoverFromIncompleteInput();
      return;
    }

    this.buffer += text;

    let idx: number;
    while ((idx = this.buffer.indexOf(this.sentinel)) !== -1) {
      const before = this.buffer.slice(0, idx);
      if (before.length) this.opts.onOutput(before);
      this.buffer = this.buffer.slice(idx + this.sentinel.length);
      this.settle();
    }

    const holdBack = this.partialSentinelSuffixLength(this.buffer);
    if (this.buffer.length > holdBack) {
      const flush = this.buffer.slice(0, this.buffer.length - holdBack);
      this.opts.onOutput(flush);
      this.buffer = this.buffer.slice(this.buffer.length - holdBack);
    }
  }

  /** Length of the longest suffix of `text` that is also a prefix of the sentinel. */
  private partialSentinelSuffixLength(text: string): number {
    const max = Math.min(text.length, this.sentinel.length - 1);
    for (let len = max; len > 0; len--) {
      if (text.endsWith(this.sentinel.slice(0, len))) return len;
    }
    return 0;
  }

  /**
   * Discards a syntactically-incomplete buffered command so the session
   * doesn't wait forever for input that will never arrive as a
   * continuation of it, reports the failure, and unblocks the eval queue.
   */
  private recoverFromIncompleteInput(): void {
    this.server.clearBufferedCommand?.();
    this.opts.onOutput('SyntaxError: incomplete input\n');
    this.settle();
  }

  /** Resolves the in-flight eval() (if any) and clears its watchdog timer. */
  private settle(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const resolve = this.resolveCurrent;
    this.resolveCurrent = null;
    resolve?.();
  }

  private format(args: unknown[]): string {
    return args
      .map((a) => (typeof a === 'string' ? a : inspect(a)))
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

      // Defense-in-depth safety net: the continuation-prompt check above is
      // the primary, deterministic mechanism for avoiding a permanent hang
      // on incomplete input. This watchdog only matters if some other,
      // unanticipated input shape defeats both the sentinel and the
      // continuation-prompt signal; it should not fire in normal use.
      this.watchdog = setTimeout(() => {
        this.server.clearBufferedCommand?.();
        this.opts.onOutput('Error: eval timed out\n');
        this.settle();
      }, this.evalTimeoutMs);
      this.watchdog.unref?.();

      this.input.write(command + '\n');
    });
  }

  close(): void {
    // Resolve any eval() a caller might still be awaiting so shutdown
    // never leaves it hanging.
    this.settle();
    this.input.end();
    this.input.destroy();
    this.server.close();
  }
}
