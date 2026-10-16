import { expectTypeOf } from 'vitest';
import type { WebReplOptions } from './options';

// Framework-free options shape: everything the engine needs, nothing a
// framework module adds (adapter config, controller class, DI imports).
describe('WebReplOptions', () => {
  it('requires only `enabled`; every tuning knob is optional', () => {
    expectTypeOf<WebReplOptions>().toHaveProperty('enabled');
    expectTypeOf<WebReplOptions['enabled']>().toEqualTypeOf<boolean>();
    expectTypeOf<{ enabled: true }>().toMatchTypeOf<WebReplOptions>();
    expectTypeOf<WebReplOptions['ownerLeaseTtl']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<WebReplOptions>().not.toHaveProperty('adapter');
    expect(true).toBe(true);
  });
});
