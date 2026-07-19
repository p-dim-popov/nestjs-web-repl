# Try these in the REPL

The editor is a live REPL bound to this running NestJS app's dependency-injection container. Type a line and press **Run ▶** (or Ctrl+Enter):

- `get(CatService).findAll()` → `['Tom', 'Felix']` — reach into a live provider
- `methods(CatService)` → list a provider's methods
- `get(CounterService).inc()` → run it a few times; the number climbs (provider state persists between commands)
- `const x = 21; x * 2` → your variables persist across commands too
- `debug()` → list this app's modules and providers
- `help()` → the REPL's built-in reference

Everything runs inside your browser's StackBlitz sandbox — nothing touches a shared server.
