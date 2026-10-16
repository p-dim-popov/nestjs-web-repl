import { landingRedirectUrl, randomChannelName } from './landing';

describe('randomChannelName', () => {
  it('returns exactly 8 lowercase base36 characters, every time', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomChannelName()).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it('varies between calls', () => {
    const names = new Set(Array.from({ length: 20 }, () => randomChannelName()));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('landingRedirectUrl', () => {
  it('appends the channel and /ui to the request path', () => {
    expect(landingRedirectUrl('/repl', 'k3f9x2ab')).toBe('/repl/k3f9x2ab/ui');
  });

  it('normalizes a trailing slash', () => {
    expect(landingRedirectUrl('/repl/', 'k3f9x2ab')).toBe('/repl/k3f9x2ab/ui');
  });

  it('preserves a global prefix', () => {
    expect(landingRedirectUrl('/api/repl', 'k3f9x2ab')).toBe('/api/repl/k3f9x2ab/ui');
  });

  it('drops the query string', () => {
    expect(landingRedirectUrl('/repl?foo=1', 'k3f9x2ab')).toBe('/repl/k3f9x2ab/ui');
  });

  it('strips the query string before the trailing slash', () => {
    expect(landingRedirectUrl('/repl/?foo=1', 'k3f9x2ab')).toBe('/repl/k3f9x2ab/ui');
  });
});
