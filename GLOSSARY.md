# remote-repl

A live, in-process REPL that an application exposes over HTTP. One engine runs
inside the host app and speaks one protocol, so any web framework and any
message transport can carry it. This glossary is the vocabulary shared by the
spec, the tickets, the code and the docs.

## Language

**Engine**:
The framework-free core that owns channels, runs commands, and fans output out
to subscribers. One engine runs per application instance.
_Avoid_: service, core service, REPL server

**Channel**:
A user-chosen name for one REPL session with its own variables and history.
Channels are how people and tabs share or separate REPL state.
_Avoid_: session (that is what a channel contains), room

**Session**:
The live REPL process behind one channel on its owner instance. A session
exists only on the owner and dies with it.
_Avoid_: REPL, context

**Instance**:
One running process of an application that embeds the engine. Replicas behind a
load balancer are separate instances.
_Avoid_: node, replica (use only for instances of the same app)

**Cluster**:
The set of instances that share one transport namespace and therefore see the
same channels.
_Avoid_: fleet, group

**Owner**:
The single instance that holds the session of a channel and executes its
commands. Every other instance only relays.
_Avoid_: leader, master, primary

**Origin**:
The instance whose HTTP endpoint received a command. The origin publishes the
command, and the owner executes it.
_Avoid_: sender, source

**Transport**:
The pub/sub medium that carries protocol messages between the instances of a
cluster: in-memory for one process, Redis for many. A transport moves opaque
strings and never parses them.
_Avoid_: adapter (the historical name, kept only in type names such as
`WebReplAdapter`), bus, broker

**Framework adapter**:
The package that wires the engine to one web framework's HTTP routes, for
example the NestJS or Express adapter. It does HTTP wiring only.
_Avoid_: integration, plugin, binding

**Shared handler layer**:
The framework-free route logic in the core that every framework adapter calls:
landing, post, stream, UI and asset. It owns SSE formatting, cursor stamping,
UI escaping and the asset path guard.
_Avoid_: controller, handlers (bare), middleware

**Lease**:
The time-limited ownership of a channel. The owner renews it by heartbeat, and
a lease that is not renewed within its TTL makes the channel ownerless.
_Avoid_: lock, grant

**Claim**:
The protocol message an instance publishes to take or renew ownership of a
channel. A repeated claim is the owner heartbeat.
_Avoid_: acquire, announce

**Release**:
The protocol message an owner publishes to give up a channel, for example on
clean shutdown or after the session TTL.
_Avoid_: unclaim, drop

**Takeover**:
The act of the origin instance claiming a channel whose lease has expired. The
takeover starts a fresh session, so the old variables are gone.
_Avoid_: failover, preemption (a takeover of a live owner, which must never
happen)

**Owner heartbeat**:
The periodic claim an owner re-publishes for every channel it owns to keep the
lease alive. Not the SSE ping.
_Avoid_: keep-alive, heartbeat (bare, ambiguous with the SSE ping)

**SSE ping**:
The periodic client-visible event that keeps an idle SSE connection open. It
never changes the replay cursor of the client.
_Avoid_: heartbeat (bare), keep-alive

**Topic**:
One of the three fixed names on the transport: command, output and system
messages.
_Avoid_: queue, stream (reserved for the SSE stream)

**Topic prefix**:
An optional string a transport prepends to every topic name so that several
apps can share one medium without seeing each other. Instances with the same
prefix form one cluster.
_Avoid_: namespace, tenant key

**Protocol**:
The versioned, language-neutral contract that defines the topics, the message
shapes, the ownership and lease rules, and the SSE event format. Any
implementation that follows it can join a cluster.
_Avoid_: API, wire format (only one part of the protocol)

**Replay**:
The re-delivery of buffered channel events to an SSE client that reconnects
with a cursor. The buffer per channel is bounded.
_Avoid_: catch-up, history

**UI bundle**:
The self-contained browser UI (HTML page plus editor assets) that the core
ships and every adapter serves from the own origin of the app.
_Avoid_: frontend, web app, Monaco (one component of the bundle)

**Shim**:
The `nestjs-web-repl` package: the legacy name kept as a pure re-export of the
NestJS adapter and the Redis transports. It has no logic of its own.
_Avoid_: alias, legacy package, wrapper

**Enabled flag**:
The runtime switch that, when off, makes every route return 404 and keeps the
engine off the transport. It is a switch, not an access control.
_Avoid_: feature flag, auth
