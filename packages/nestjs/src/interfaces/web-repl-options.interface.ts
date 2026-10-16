import type { ModuleMetadata, Type } from '@nestjs/common';
import type { WebReplAdapter, WebReplOptions } from '@remote-repl/core';
// Type-only import (erased at runtime — no circular dependency).
import type { WebReplController } from '../web-repl.controller';

/**
 * Runtime options -- the only thing registerAsync's factory resolves. Same
 * shape as core's `WebReplOptions`; kept as a named alias for the public API.
 */
export interface WebReplModuleOptions extends WebReplOptions {}

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
