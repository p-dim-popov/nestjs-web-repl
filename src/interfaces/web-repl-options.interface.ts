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
  /** When false, the default controller is not registered (user registers a subclass). Default true. */
  registerController?: boolean;
}

export interface WebReplModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => WebReplModuleOptions | Promise<WebReplModuleOptions>;
  inject?: any[];
}
