import {
  ConfigurableModuleBuilder,
  type DynamicModule,
  type InjectionToken,
  type Provider,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  REMOTE_REPL_OPTIONS,
  REMOTE_REPL_TRANSPORT,
  REMOTE_REPL_CLOCK,
  REMOTE_REPL_CONTEXT_FACTORY,
} from './constants';
import type {
  RemoteReplModuleOptions,
  RemoteReplModuleExtras,
  RemoteReplTransportConfig,
} from './interfaces/remote-repl-options.interface';
import { RemoteReplInMemoryTransport } from '@remote-repl/core';
import { RemoteReplService } from './remote-repl.service';
import { RemoteReplController } from './remote-repl.controller';
import { buildReplContext } from './context/build-repl-context';

type BuiltTransport = {
  provider: Provider;
  imports: NonNullable<DynamicModule['imports']>;
};

/** Maps a RemoteReplTransportConfig to the REMOTE_REPL_TRANSPORT provider + any imports. */
export function buildTransportProvider(
  config: RemoteReplTransportConfig | undefined,
): BuiltTransport {
  if (config === undefined) {
    return {
      provider: { provide: REMOTE_REPL_TRANSPORT, useClass: RemoteReplInMemoryTransport },
      imports: [],
    };
  }
  if (typeof config === 'function') {
    return { provider: { provide: REMOTE_REPL_TRANSPORT, useClass: config }, imports: [] };
  }
  if ('useClass' in config) {
    return {
      provider: { provide: REMOTE_REPL_TRANSPORT, useClass: config.useClass },
      imports: config.imports ?? [],
    };
  }
  if ('useFactory' in config) {
    return {
      provider: {
        provide: REMOTE_REPL_TRANSPORT,
        useFactory: config.useFactory,
        inject: config.inject ?? [],
      },
      imports: config.imports ?? [],
    };
  }
  // Otherwise it must be a ready-made RemoteReplTransport instance — verify it
  // actually looks like one so a malformed block (e.g. a typo'd `usClass`)
  // fails fast at registration instead of silently becoming a useValue.
  if (
    typeof config !== 'object' ||
    config === null ||
    typeof (config as { publish?: unknown }).publish !== 'function' ||
    typeof (config as { subscribe?: unknown }).subscribe !== 'function'
  ) {
    throw new Error(
      'RemoteReplModule: invalid transport config — expected a RemoteReplTransport instance, a Type, or a { useClass } / { useFactory } block',
    );
  }
  return { provider: { provide: REMOTE_REPL_TRANSPORT, useValue: config }, imports: [] };
}

// The builder generates its own options token (MODULE_OPTIONS_TOKEN). We keep
// the stable REMOTE_REPL_OPTIONS token for RemoteReplService/RemoteReplController to
// inject, aliasing it to the builder's token. The transform closure runs at
// register()-time (after this module is fully evaluated), so it reads
// `optionsToken`, assigned right after build() below.
let optionsToken: InjectionToken;

const definition = new ConfigurableModuleBuilder<RemoteReplModuleOptions>()
  .setClassMethodName('register')
  .setExtras<RemoteReplModuleExtras>(
    { controller: undefined, transport: undefined },
    (def, extras): DynamicModule => {
      const transport = buildTransportProvider(extras.transport);
      return {
        ...def,
        imports: [...(def.imports ?? []), ...transport.imports],
        controllers: [extras.controller ?? RemoteReplController],
        providers: [
          ...(def.providers ?? []),
          { provide: REMOTE_REPL_OPTIONS, useExisting: optionsToken },
          transport.provider,
          {
            provide: REMOTE_REPL_CONTEXT_FACTORY,
            useFactory: (moduleRef: ModuleRef) => () => buildReplContext(moduleRef),
            inject: [ModuleRef],
          },
          { provide: REMOTE_REPL_CLOCK, useValue: () => Date.now() },
          RemoteReplService,
        ],
        exports: [RemoteReplService, REMOTE_REPL_OPTIONS],
      };
    },
  )
  .build();

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } = definition;
optionsToken = MODULE_OPTIONS_TOKEN;
