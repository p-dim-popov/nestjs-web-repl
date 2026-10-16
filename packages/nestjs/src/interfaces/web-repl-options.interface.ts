import type { ModuleMetadata, Type } from '@nestjs/common';
import type { WebReplAdapter } from './web-repl-adapter.interface';
// Type-only import (erased at runtime — no circular dependency).
import type { WebReplController } from '../web-repl.controller';

/** Runtime options — the only thing registerAsync's factory resolves. */
export interface WebReplModuleOptions {
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
   * WebReplService's constructor).
   */
  ownerLeaseTtl?: number;
}

/** Adapter configured as a DI-capable provider (or a ready instance). */
export type WebReplAdapterConfig =
  | WebReplAdapter
  | Type<WebReplAdapter>
  | { useClass: Type<WebReplAdapter>; imports?: ModuleMetadata['imports'] }
  | {
      useFactory: (...args: any[]) => WebReplAdapter | Promise<WebReplAdapter>;
      inject?: any[];
      imports?: ModuleMetadata['imports'];
    };

/** Static composition — passed synchronously to both register and registerAsync. */
export interface WebReplModuleExtras {
  /** Bring your own controller (extend WebReplController + add guards). Default: built-in. */
  controller?: Type<WebReplController>;
  /** Multi-instance coordination. Default: InMemoryWebReplAdapter. */
  adapter?: WebReplAdapterConfig;
}
