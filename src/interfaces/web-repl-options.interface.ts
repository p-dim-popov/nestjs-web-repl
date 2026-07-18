import type { ModuleMetadata, Type } from '@nestjs/common';
import type { WebReplAdapter } from './web-repl-adapter.interface';

export interface WebReplModuleOptions {
  /** Required. When false the module registers nothing. */
  enabled: boolean;
  /** Multi-instance coordination. Defaults to InMemoryWebReplAdapter. */
  adapter?: WebReplAdapter;
  /** Identifies this instance in ownership/system messages. Auto-generated if omitted. */
  instanceId?: string;
  /** Idle ms before a session is disposed. Default 30 min. */
  sessionTtl?: number;
  /** Events kept per channel for SSE replay. Default 200. */
  replayBufferSize?: number;
  /** SSE ping-comment interval in ms. Default 15000. */
  heartbeatInterval?: number;
  /**
   * How often an instance re-announces `claim` for each channel it currently
   * owns, keeping its ownership lease alive. Default 10000.
   */
  ownerHeartbeatInterval?: number;
  /**
   * How long an ownership record is trusted since the last claim/heartbeat
   * seen for it, before another instance may take over a channel whose owner
   * has gone silent (e.g. crashed or was killed without a clean shutdown).
   * Default 30000. Enforced minimum: `ownerHeartbeatInterval * 2` -- a live
   * owner must always have at least one full heartbeat interval of slack
   * against publish/delivery jitter, or a single late-arriving heartbeat
   * could make it look stale to a peer and get preempted. If the configured
   * value is below that minimum, the effective lease is clamped up to
   * `ownerHeartbeatInterval * 2` and a warning is logged (this never
   * throws).
   */
  ownerLeaseTtl?: number;
  /** When false, the default controller is not registered (user registers a subclass). Default true. */
  registerController?: boolean;
}

export interface WebReplModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => WebReplModuleOptions | Promise<WebReplModuleOptions>;
  inject?: any[];
}
