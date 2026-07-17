export const WEB_REPL_OPTIONS = Symbol('WEB_REPL_OPTIONS');
export const WEB_REPL_ADAPTER = Symbol('WEB_REPL_ADAPTER');

export const TOPICS = {
  cmd: 'webrepl:cmd',
  out: 'webrepl:out',
  sys: 'webrepl:sys',
} as const;

export const DEFAULTS = {
  sessionTtl: 1_800_000,
  replayBufferSize: 200,
  heartbeatInterval: 15_000,
} as const;
