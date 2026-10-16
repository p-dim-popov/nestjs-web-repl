/** Transport topic names. Fixed wire protocol -- shared by every instance and adapter. */
export const TOPICS = {
  cmd: 'webrepl:cmd',
  out: 'webrepl:out',
  sys: 'webrepl:sys',
} as const;

export const DEFAULTS = {
  sessionTtl: 1_800_000,
  replayBufferSize: 200,
  heartbeatInterval: 15_000,
  // How often a live owner re-announces `claim` for the channels it owns.
  ownerHeartbeatInterval: 10_000,
  // How long an ownership record is trusted since the last claim/heartbeat
  // seen for it. Must stay at least 2x ownerHeartbeatInterval -- see the
  // engine's constructor clamp -- so a live owner never looks stale between
  // its own heartbeats.
  ownerLeaseTtl: 30_000,
} as const;
