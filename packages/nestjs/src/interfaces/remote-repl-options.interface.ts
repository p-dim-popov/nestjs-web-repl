import type { ModuleMetadata, Type } from '@nestjs/common';
import type { RemoteReplTransport, RemoteReplOptions } from '@remote-repl/core';
// Type-only import (erased at runtime — no circular dependency).
import type { RemoteReplController } from '../remote-repl.controller';

/**
 * Runtime options -- the only thing registerAsync's factory resolves. Same
 * shape as core's `RemoteReplOptions`; kept as a named alias for the public API.
 */
export interface RemoteReplModuleOptions extends RemoteReplOptions {}

/** Transport configured as a DI-capable provider (or a ready instance). */
export type RemoteReplTransportConfig =
  | RemoteReplTransport
  | Type<RemoteReplTransport>
  | { useClass: Type<RemoteReplTransport>; imports?: ModuleMetadata['imports'] }
  | {
      useFactory: (...args: any[]) => RemoteReplTransport | Promise<RemoteReplTransport>;
      inject?: any[];
      imports?: ModuleMetadata['imports'];
    };

/** Static composition — passed synchronously to both register and registerAsync. */
export interface RemoteReplModuleExtras {
  /** Bring your own controller (extend RemoteReplController + add guards). Default: built-in. */
  controller?: Type<RemoteReplController>;
  /** Multi-instance coordination. Default: RemoteReplInMemoryTransport. */
  transport?: RemoteReplTransportConfig;
}
