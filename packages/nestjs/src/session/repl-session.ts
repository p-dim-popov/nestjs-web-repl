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
// own standalone `output` write, for every line that leaves a command
// syntactically incomplete so far (an unmatched brace/paren/template
// literal), whether or not the command is eventually completed by a later
// line in the same batch. It is therefore only ever a *transient* signal,
// never by itself proof that a command is permanently stuck -- see
// checkForStuckIncompleteInput() for how genuine incompleteness is
// determined. Verified empirically on Node v26.
const CONTINUATION_PROMPT = '| ';

export class ReplSession {
  private readonly input = new PassThrough();
  private readonly server: REPLServer;
  private readonly evalTimeoutMs: number;
  // A prompt string unique to this instance (via crypto.randomUUID()) so
  // that no two sessions ever share a sentinel, and collisions with
  // arbitrary user-controlled output are effectively impossible. node:repl
  // (with terminal: false) re-writes the prompt to `output` exactly once
  // per completed top-level statement, and, critically, only after that
  // statement has fully settled: after a synchronous result, after an
  // awaited top-level promise resolves (however long that takes), and
  // after the domain-based uncaught-exception handler finishes reporting a
  // thrown error. That makes "the sentinel appeared in output" a
  // deterministic, timing-independent "this statement is done" signal that
  // works uniformly across all of those cases.
  private readonly sentinel = `<<webrepl:done:${randomUUID()}>>`;
  // The internal REPLServer state holding whatever raw source has been
  // accumulated so far but not yet parsed into a complete, evaluatable
  // statement -- empty once a submitted command is either fully complete
  // or hasn't started. Located empirically on Node v26 (see constructor);
  // used to distinguish "still working through a multi-line command" from
  // "genuinely parked on incomplete input that will never complete".
  private readonly bufferedCommandSymbol: symbol | undefined;
  private queue: Promise<void> = Promise.resolve();
  private buffer = '';
  private resolveCurrent: (() => void) | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private closed = false;

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

    this.bufferedCommandSymbol = Object.getOwnPropertySymbols(this.server).find(
      (s) => s.description === 'bufferedCommand',
    );

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
   * The bare continuation-prompt marker is filtered out (never forwarded
   * as output) but, on its own, is NOT treated as a "this command is
   * stuck" signal -- a legitimate multi-line command supplied as one
   * eval() string transiently produces this marker for every line that
   * doesn't yet close out a statement before the final line completes it.
   * Reacting to the first occurrence would wrongly abort those valid
   * commands. See checkForStuckIncompleteInput() for the real recovery
   * path.
   */
  private handleOutput(text: string): void {
    if (text === CONTINUATION_PROMPT) {
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
   * Called shortly after a command has been written to `input`, once
   * node:repl has had a chance to drain and process every line of it
   * (including every line of a multi-line command written as one
   * string). If the eval already resolved via the sentinel, this is a
   * no-op. Otherwise, reads node:repl's own buffered-command state: a
   * non-empty buffer at this point means the submitted text left a
   * trailing statement that is syntactically incomplete and will never
   * complete on its own (there is no more input coming for it), so we
   * recover instead of waiting forever. An empty buffer means parsing
   * fully consumed the input -- whether it already finished evaluating
   * (sync) or is still running (e.g. a pending top-level await) -- so we
   * leave it alone and let the sentinel (or, failing that, the watchdog)
   * resolve it whenever it's actually done.
   */
  private checkForStuckIncompleteInput(): void {
    if (!this.resolveCurrent) return;
    if (this.bufferedCommandSymbol === undefined) return;
    const buffered = (this.server as unknown as Record<symbol, unknown>)[this.bufferedCommandSymbol];
    if (typeof buffered === 'string' && buffered.length > 0) {
      this.recoverFromIncompleteInput();
    }
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
    if (this.closed) {
      // The session was closed before this queued eval() got its turn.
      // Resolve immediately rather than writing to a destroyed input
      // stream (which would hang or error).
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      // Registering the resolver before writing guarantees we never miss
      // the sentinel that reports this command's completion, however long
      // (or short) evaluation takes.
      this.resolveCurrent = resolve;

      // Defense-in-depth safety net: the drain-check below is the
      // primary, deterministic mechanism for avoiding a permanent hang on
      // incomplete input. This watchdog only matters if some other,
      // unanticipated input shape defeats both the sentinel and the
      // buffered-command check; it should not fire in normal use.
      this.watchdog = setTimeout(() => {
        this.server.clearBufferedCommand?.();
        this.opts.onOutput('Error: eval timed out\n');
        this.settle();
      }, this.evalTimeoutMs);
      this.watchdog.unref?.();

      this.input.write(command + '\n');

      // Give node:repl's readline two macrotask ticks to fully drain and
      // process every line of the command just written (verified
      // empirically sufficient on Node v26, including for multi-line
      // commands where all of the processing actually happens
      // synchronously within the input.write() call above), then check
      // whether it's left holding an incomplete trailing statement.
      setImmediate(() => setImmediate(() => this.checkForStuckIncompleteInput()));
    });
  }

  close(): void {
    this.closed = true;
    // Resolve any eval() a caller might still be awaiting so shutdown
    // never leaves it hanging.
    this.settle();
    this.input.end();
    this.input.destroy();
    this.server.close();
  }
}
