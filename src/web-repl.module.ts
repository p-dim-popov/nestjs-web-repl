import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WEB_REPL_ADAPTER, WEB_REPL_OPTIONS, WEB_REPL_CLOCK } from './constants';
import type {
  WebReplModuleOptions,
  WebReplModuleAsyncOptions,
} from './interfaces/web-repl-options.interface';
import { InMemoryWebReplAdapter } from './adapters/in-memory-web-repl.adapter';
import { WebReplService } from './web-repl.service';
import { WebReplController } from './web-repl.controller';
import { buildReplContext } from './context/build-repl-context';

const CONTEXT_FACTORY = 'WEB_REPL_CONTEXT_FACTORY';

@Module({})
export class WebReplModule {
  static forRoot(options: WebReplModuleOptions): DynamicModule {
    if (!options.enabled) return { module: WebReplModule };
    return this.assemble([{ provide: WEB_REPL_OPTIONS, useValue: options }], options);
  }

  static forRootAsync(async: WebReplModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: WEB_REPL_OPTIONS,
      useFactory: async.useFactory,
      inject: async.inject ?? [],
    };
    // registerController is read from resolved options only at request time
    // in the sense that this module has no way to inspect the value
    // useFactory will eventually produce until it runs -- and providers /
    // controllers must be declared statically. So forRootAsync always
    // registers the default controller; callers who need to omit it should
    // use forRoot() with a statically-known `registerController: false`.
    return {
      module: WebReplModule,
      imports: async.imports ?? [],
      providers: [optionsProvider, ...this.sharedProviders()],
      controllers: [WebReplController],
      // WEB_REPL_OPTIONS must be exported alongside WebReplService: since
      // WebReplController (and any subclass of it, per the README's
      // "Securing it" pattern) now injects WEB_REPL_OPTIONS to enforce
      // `enabled` at runtime (see CRITICAL 1), a caller who mounts their
      // own guarded subclass controller on a SIBLING module (with
      // registerController: false) needs to be able to resolve it too.
      exports: [WebReplService, WEB_REPL_OPTIONS],
    };
  }

  private static assemble(
    optionProviders: Provider[],
    options: WebReplModuleOptions,
  ): DynamicModule {
    return {
      module: WebReplModule,
      providers: [...optionProviders, ...this.sharedProviders()],
      controllers: options.registerController === false ? [] : [WebReplController],
      exports: [WebReplService, WEB_REPL_OPTIONS],
    };
  }

  private static sharedProviders(): Provider[] {
    return [
      {
        provide: WEB_REPL_ADAPTER,
        useFactory: (opts: WebReplModuleOptions) => opts.adapter ?? new InMemoryWebReplAdapter(),
        inject: [WEB_REPL_OPTIONS],
      },
      {
        provide: CONTEXT_FACTORY,
        useFactory: (moduleRef: ModuleRef) => () => buildReplContext(moduleRef),
        inject: [ModuleRef],
      },
      {
        provide: WEB_REPL_CLOCK,
        useValue: () => Date.now(),
      },
      WebReplService,
    ];
  }
}
