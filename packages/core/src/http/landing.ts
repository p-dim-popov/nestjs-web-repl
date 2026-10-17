// The landing route (GET <base> with no channel) sends the visitor to a
// randomly named channel. The name is NOT a security boundary -- any
// channel has always been reachable by typing its name; the user's guard
// is the only access control. Random purely so two visitors don't collide
// by default. toString(36) can return fewer digits than needed, hence the
// accumulate-and-slice.
export function randomChannelName(): string {
  let s = '';
  while (s.length < 8) s += Math.random().toString(36).slice(2);
  return s.slice(0, 8);
}

// Builds the redirect target from the request's own URL rather than a
// hardcoded /repl prefix, so the route stays correct under a global prefix
// (e.g. Nest's app.setGlobalPrefix()). Strips the query string and any
// trailing slash.
export function landingRedirectUrl(rawUrl: string, channel: string): string {
  const path = rawUrl.split('?')[0].replace(/\/+$/, '');
  return `${path}/${channel}/ui`;
}
