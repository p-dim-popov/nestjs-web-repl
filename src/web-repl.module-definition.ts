import {
  ConfigurableModuleBuilder,
  type DynamicModule,
  type InjectionToken,
  type Provider,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WEB_REPL_OPTIONS, WEB_REPL_ADAPTER, WEB_REPL_CLOCK } from './constants';
import type {
  WebReplModuleOptions,
  WebReplModuleExtras,
  WebReplAdapterConfig,
} from './interfaces/web-repl-options.interface';
import { InMemoryWebReplAdapter } from './adapters/in-memory-web-repl.adapter';
import { WebReplService } from './web-repl.service';
import { WebReplController } from './web-repl.controller';
import { buildReplContext } from './context/build-repl-context';

const CONTEXT_FACTORY = 'WEB_REPL_CONTEXT_FACTORY';

type BuiltAdapter = {
  provider: Provider;
  imports: NonNullable<DynamicModule['imports']>;
};

/** Maps a WebReplAdapterConfig to the WEB_REPL_ADAPTER provider + any imports. */
export function buildAdapterProvider(
  config: WebReplAdapterConfig | undefined,
): BuiltAdapter {
  if (config === undefined) {
    return {
      provider: { provide: WEB_REPL_ADAPTER, useClass: InMemoryWebReplAdapter },
      imports: [],
    };
  }
  if (typeof config === 'function') {
    return { provider: { provide: WEB_REPL_ADAPTER, useClass: config }, imports: [] };
  }
  if ('useClass' in config) {
    return {
      provider: { provide: WEB_REPL_ADAPTER, useClass: config.useClass },
      imports: config.imports ?? [],
    };
  }
  if ('useFactory' in config) {
    return {
      provider: {
        provide: WEB_REPL_ADAPTER,
        useFactory: config.useFactory,
        inject: config.inject ?? [],
      },
      imports: config.imports ?? [],
    };
  }
  // Otherwise it must be a ready-made WebReplAdapter instance — verify it
  // actually looks like one so a malformed block (e.g. a typo'd `usClass`)
  // fails fast at registration instead of silently becoming a useValue.
  if (
    typeof config !== 'object' ||
    config === null ||
    typeof (config as { publish?: unknown }).publish !== 'function' ||
    typeof (config as { subscribe?: unknown }).subscribe !== 'function'
  ) {
    throw new Error(
      'WebReplModule: invalid adapter config — expected a WebReplAdapter instance, a Type, or a { useClass } / { useFactory } block',
    );
  }
  return { provider: { provide: WEB_REPL_ADAPTER, useValue: config }, imports: [] };
}

// The builder generates its own options token (MODULE_OPTIONS_TOKEN). We keep
// the stable WEB_REPL_OPTIONS token for WebReplService/WebReplController to
// inject, aliasing it to the builder's token. The transform closure runs at
// register()-time (after this module is fully evaluated), so it reads
// `optionsToken`, assigned right after build() below.
let optionsToken: InjectionToken;

const definition = new ConfigurableModuleBuilder<WebReplModuleOptions>()
  .setClassMethodName('register')
  .setExtras<WebReplModuleExtras>(
    { controller: undefined, adapter: undefined },
    (def, extras): DynamicModule => {
      const adapter = buildAdapterProvider(extras.adapter);
      return {
        ...def,
        imports: [...(def.imports ?? []), ...adapter.imports],
        controllers: [extras.controller ?? WebReplController],
        providers: [
          ...(def.providers ?? []),
          { provide: WEB_REPL_OPTIONS, useExisting: optionsToken },
          adapter.provider,
          {
            provide: CONTEXT_FACTORY,
            useFactory: (moduleRef: ModuleRef) => () => buildReplContext(moduleRef),
            inject: [ModuleRef],
          },
          { provide: WEB_REPL_CLOCK, useValue: () => Date.now() },
          WebReplService,
        ],
        exports: [WebReplService, WEB_REPL_OPTIONS],
      };
    },
  )
  .build();

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = definition;
optionsToken = MODULE_OPTIONS_TOKEN;
