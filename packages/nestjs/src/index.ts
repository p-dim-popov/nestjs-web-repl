export { RemoteReplModule } from './remote-repl.module';
export { RemoteReplController } from './remote-repl.controller';
export { RemoteReplService } from './remote-repl.service';
export { RemoteReplInMemoryTransport } from '@remote-repl/core';
export { REMOTE_REPL_OPTIONS } from './constants';
export type { RemoteReplTransport } from '@remote-repl/core';
export type {
  RemoteReplModuleOptions,
  RemoteReplModuleExtras,
  RemoteReplTransportConfig,
} from './interfaces/remote-repl-options.interface';
export type {
  RemoteReplEvent,
  RemoteReplSseEventType,
} from '@remote-repl/core';

// Transitional aliases (ticket #36, migrate phase): the shim still resolves
// the legacy names through this barrel until it owns them. Removed in the
// contract step.
export { RemoteReplModule as WebReplModule } from './remote-repl.module';
export { RemoteReplController as WebReplController } from './remote-repl.controller';
export { RemoteReplService as WebReplService } from './remote-repl.service';
export { RemoteReplInMemoryTransport as InMemoryWebReplAdapter } from '@remote-repl/core';
export { REMOTE_REPL_OPTIONS as WEB_REPL_OPTIONS } from './constants';
