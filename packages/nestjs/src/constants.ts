// Nest DI tokens. The wire-protocol constants (REMOTE_REPL_TOPICS, REMOTE_REPL_DEFAULTS) live in
// @remote-repl/core.
export const REMOTE_REPL_OPTIONS = Symbol('REMOTE_REPL_OPTIONS');
export const REMOTE_REPL_TRANSPORT = Symbol('REMOTE_REPL_TRANSPORT');
export const REMOTE_REPL_CLOCK = Symbol('REMOTE_REPL_CLOCK');
export const REMOTE_REPL_CONTEXT_FACTORY = 'REMOTE_REPL_CONTEXT_FACTORY';
