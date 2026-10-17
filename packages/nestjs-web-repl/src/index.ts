import {
  RemoteReplController,
  RemoteReplInMemoryTransport,
  RemoteReplModule,
  RemoteReplService,
  REMOTE_REPL_OPTIONS,
  type RemoteReplEvent,
  type RemoteReplModuleExtras,
  type RemoteReplModuleOptions,
  type RemoteReplSseEventType,
  type RemoteReplTransport,
  type RemoteReplTransportConfig,
} from '@remote-repl/nestjs';
import type { DynamicModule } from '@nestjs/common';

// The new names, so an app on this package can migrate one import at a time.
export * from '@remote-repl/nestjs';

// ---------------------------------------------------------------------------
// Legacy names (nestjs-web-repl <= 2.3.x). Each is a deprecated alias of its
// @remote-repl/nestjs replacement; `WebReplModule` alone has logic, because
// the legacy extra was named `adapter`.

/** @deprecated Use `RemoteReplController` from `@remote-repl/nestjs`. */
export const WebReplController = RemoteReplController;
/** @deprecated Use `RemoteReplController` from `@remote-repl/nestjs`. */
export type WebReplController = RemoteReplController;

/** @deprecated Use `RemoteReplService` from `@remote-repl/nestjs`. */
export const WebReplService = RemoteReplService;
/** @deprecated Use `RemoteReplService` from `@remote-repl/nestjs`. */
export type WebReplService = RemoteReplService;

/** @deprecated Use `RemoteReplInMemoryTransport` from `@remote-repl/nestjs` (or `@remote-repl/core`). */
export const InMemoryWebReplAdapter = RemoteReplInMemoryTransport;
/** @deprecated Use `RemoteReplInMemoryTransport` from `@remote-repl/nestjs` (or `@remote-repl/core`). */
export type InMemoryWebReplAdapter = RemoteReplInMemoryTransport;

/** @deprecated Use `REMOTE_REPL_OPTIONS` from `@remote-repl/nestjs`. */
export const WEB_REPL_OPTIONS = REMOTE_REPL_OPTIONS;

/**
 * @deprecated Use `RemoteReplTransport` from `@remote-repl/nestjs` (or
 * `@remote-repl/core`). Its teardown hook is `close()`; a transport that only
 * implements `onModuleDestroy()` keeps working (the engine calls it instead).
 */
export type WebReplAdapter = RemoteReplTransport & { onModuleDestroy?(): void | Promise<void> };

/** @deprecated Use `RemoteReplModuleOptions` from `@remote-repl/nestjs`. */
export type WebReplModuleOptions = RemoteReplModuleOptions;

/** @deprecated Use `RemoteReplTransportConfig` from `@remote-repl/nestjs`. */
export type WebReplAdapterConfig = RemoteReplTransportConfig;

/**
 * @deprecated Use `RemoteReplModuleExtras` from `@remote-repl/nestjs`; its
 * `transport` extra replaces `adapter`.
 */
export interface WebReplModuleExtras extends Omit<RemoteReplModuleExtras, 'transport'> {
  /** @deprecated Use the `transport` extra of `RemoteReplModule`. */
  adapter?: WebReplAdapterConfig;
}

/** @deprecated Use `RemoteReplEvent` from `@remote-repl/nestjs` (or `@remote-repl/core`). */
export type WebReplEvent = RemoteReplEvent;

/** @deprecated Use `RemoteReplSseEventType` from `@remote-repl/nestjs` (or `@remote-repl/core`). */
export type SseEventType = RemoteReplSseEventType;

type RegisterOptions = Parameters<typeof RemoteReplModule.register>[0];
type RegisterAsyncOptions = Parameters<typeof RemoteReplModule.registerAsync>[0];

// `adapter` -> `transport`, whatever DI form the value takes (a ready
// instance, a class, `{ useClass }`, `{ useFactory }`): the form is the
// VALUE, so renaming the key is the whole translation. An absent `adapter`
// stays absent, so RemoteReplModule's own default (in-memory) applies.
function translate<T extends { adapter?: WebReplAdapterConfig }>(
  options: T,
): Omit<T, 'adapter'> & { transport?: RemoteReplTransportConfig } {
  const { adapter, ...rest } = options;
  return adapter === undefined ? rest : { ...rest, transport: adapter };
}

/**
 * @deprecated Use `RemoteReplModule` from `@remote-repl/nestjs`, with the
 * `transport` extra in place of `adapter`. This class translates the extra
 * and delegates: the dynamic module it returns is `RemoteReplModule`'s.
 */
export class WebReplModule {
  static register(options: WebReplModuleOptions & WebReplModuleExtras): DynamicModule {
    return RemoteReplModule.register(translate(options) as RegisterOptions);
  }

  static registerAsync(
    options: Omit<RegisterAsyncOptions, 'transport'> & WebReplModuleExtras,
  ): DynamicModule {
    return RemoteReplModule.registerAsync(translate(options) as RegisterAsyncOptions);
  }
}
