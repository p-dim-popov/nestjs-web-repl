/**
 * Runtime options of the REPL engine -- the framework-free part of what a
 * framework package (e.g. `RemoteReplModuleOptions` in @remote-repl/nestjs) accepts.
 */
export interface RemoteReplOptions {
  /** Required. When false the module is inert: every route 404s, no subscribe. */
  enabled: boolean;
  /** Identifies this instance in ownership/system messages. Auto-generated if omitted. */
  instanceId?: string;
  /** Idle ms before a session is disposed. Default 30 min. */
  sessionTtl?: number;
  /** Events kept per channel for SSE replay. Default 200. */
  replayBufferSize?: number;
  /** SSE ping-comment interval in ms. Default 15000. */
  heartbeatInterval?: number;
  /** How often an instance re-announces `claim` for channels it owns. Default 10000. */
  ownerHeartbeatInterval?: number;
  /**
   * How long an ownership record is trusted since the last claim/heartbeat.
   * Default 30000. Clamped to at least `ownerHeartbeatInterval * 2` (see
   * the engine's constructor).
   */
  ownerLeaseTtl?: number;
}
