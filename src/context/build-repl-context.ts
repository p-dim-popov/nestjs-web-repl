import type { ModuleRef } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
// Deep imports: neither of these is re-exported from @nestjs/core's public
// entrypoint (only the `repl()` bootstrap function is public). Both are
// pinned by this package's `@nestjs/core` peerDependency range and
// exercised end-to-end by src/web-repl.module.spec.ts; if a future
// @nestjs/core major relocates them, this is the one file to fix.
import { NestApplicationContext } from '@nestjs/core/nest-application-context';
import { ReplContext } from '@nestjs/core/repl/repl-context';
import type { NestContainer } from '@nestjs/core/injector/container';

/**
 * Builds a live NestJS REPL global scope (`get`, `$`, `resolve`, `select`,
 * `debug`, `methods`, `help`, ...) bound to the running application's DI
 * container.
 *
 * We deliberately do NOT hand `ReplContext` the injected `ModuleRef`
 * directly, even though `ReplContext` only reads `app.container` in its
 * constructor: the REPL's built-in `get`/`resolve`/`select` native
 * functions call `app.get()`, `app.resolve()`, `app.select()` at command
 * time (see @nestjs/core/repl/native-functions/*.js). A `ModuleRef`'s own
 * `get()`/`resolve()` default to `strict: true` (host-module-only lookup)
 * and it has no `select()` at all -- so `get(SomeService)` would silently
 * fail to resolve providers registered in modules other than the one that
 * hosts WebReplModule, which is exactly the common case for a REPL wired
 * in from a shared library module.
 *
 * Instead we pull the process-wide `NestContainer` off the injected
 * `ModuleRef` (every `ModuleRef`, whatever module it belongs to, shares the
 * same container instance -- see `createModuleReferenceType` in
 * @nestjs/core/injector/module.js, `super(self.container)`) and construct a
 * real `NestApplicationContext` around it: the exact class
 * `NestFactory.createApplicationContext`/`NestApplication` build `app`
 * from. That gives the REPL the same app-wide, non-strict
 * `get`/`resolve`/`select` behavior a real `nest start --entrypoint repl`
 * REPL has, regardless of which module happens to host WebReplModule.
 */
export function buildReplContext(moduleRef: ModuleRef): Record<string, unknown> {
  const container = (moduleRef as unknown as { container: NestContainer }).container;
  const root = container.getModules().values().next().value;
  const app = new NestApplicationContext(
    container,
    {},
    root,
  ) as unknown as INestApplicationContext;
  const ctx = new ReplContext(app as never);
  return ctx.globalScope as Record<string, unknown>;
}
