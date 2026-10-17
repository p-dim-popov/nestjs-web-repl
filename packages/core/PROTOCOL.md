# remote-repl wire protocol

**Spec version: 1.0.0** (see [Versioning](#8-versioning)).

This document is the language-neutral contract between every remote-repl
implementation: the Node core in this repository, each framework adapter that
embeds it, and any future implementation in another language. It defines what
travels on the transport topics, what travels on the HTTP/SSE surface, and how
a cluster of instances agrees on who executes a command. A developer who has
never read the TypeScript source should be able to implement a compatible
server or client from this document alone.

The machine-readable companion is [`schema/protocol.schema.json`](./schema/protocol.schema.json)
(JSON Schema draft-07). It is **generated** from the TypeScript types in
`src/protocol/messages.ts`, which are the source of truth for message shapes.
The prose here owns the semantics the schema cannot express (ordering, timing,
ownership). `npm run schema:check` fails CI when the committed schema and the
types diverge; a human keeps this prose in step with both.

Key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

Terms: an **instance** is one running process of an application that embeds
remote-repl. A **cluster** is the set of instances that share one transport
namespace. A **channel** is a user-chosen string naming one REPL session; a
channel has at most one **owner** instance at a time. The **origin** of a
command is the instance whose HTTP endpoint received it.

---

## 1. Transport

### 1.1 Transport contract

The engine talks to the cluster through a transport with two operations:

- `publish(topic, message)` — deliver one opaque string to every subscriber of
  `topic`, **including the publishing instance itself** (loopback). An
  implementation MUST NOT suppress delivery to the publisher: the owner of a
  channel relies on receiving its own output messages (§4.3).
- `subscribe(topic, handler)` — receive every message published on `topic`
  from then on.

The transport moves opaque strings. It MUST NOT parse, reorder or merge
messages. Delivery is at-most-once, in publish order per publisher. Messages
published before an instance subscribed are not delivered (no history). An
in-process event bus and Redis Pub/Sub both satisfy this contract.

### 1.2 Topics and the prefix convention

Three fixed topic names (`Topic` in the schema):

| Topic         | Message type | Published by                    |
|---------------|--------------|---------------------------------|
| `webrepl:cmd` | `CmdMessage` | the origin of a command (§4.1)  |
| `webrepl:out` | `OutMessage` | the owner of the channel (§4.3) |
| `webrepl:sys` | `SysMessage` | the owner (claim/release) (§5)  |

A transport MAY namespace a cluster by prepending a **prefix** string to every
topic name it publishes and subscribes to. The prefix is concatenated as-is,
with no separator inserted: prefix `app-a:` turns `webrepl:cmd` into
`app-a:webrepl:cmd`. The engine never sees the prefix; it always publishes and
subscribes with the bare names above. On receipt, a prefixed transport strips
the prefix and drops any message whose wire topic does not start with it.
Instances that use different prefixes on the same medium form separate
clusters and never interact. The default is no prefix.

### 1.3 Encoding

Every message is one JSON text (RFC 8259) encoded as UTF-8, a single JSON
object, with exactly the properties listed for its type. The schema marks
every object `additionalProperties: false`; the reference implementation
ignores unknown properties on receipt rather than rejecting them, and a
receiver MAY do either. A message that fails to parse is dropped.

---

## 2. Identifiers

- **Instance id** (`instanceId`, `originInstanceId`): a non-empty string,
  unique per instance within the cluster for the lifetime of the cluster.
  The reference implementation uses `inst_` followed by 8 random base-36
  characters when none is configured.
- **Command id** (`commandId`): an opaque non-empty string, unique within the
  cluster for at least as long as the command's events may still be in a
  replay buffer. The reference implementation uses
  `cmd_<per-instance counter, base 36>_<4 random base-36 characters>`.
  Clients MUST treat it as opaque.
- **Event id** (`id` on an event): see §4.4.

---

## 3. Message and event shapes

The authoritative shapes are in the schema; this section names them and fixes
the semantics of each field.

### 3.1 `CmdMessage` (topic `webrepl:cmd`)

```json
{ "channel": "dev", "commandId": "cmd_1_ab12", "command": "1 + 1", "originInstanceId": "inst_a" }
```

| Field              | Type   | Meaning                                                 |
|--------------------|--------|---------------------------------------------------------|
| `channel`          | string | the channel the command targets                         |
| `commandId`        | string | id minted by the origin (§2)                            |
| `command`          | string | the source text to evaluate, verbatim, non-empty        |
| `originInstanceId` | string | the instance that received the HTTP request             |

### 3.2 `OutMessage` (topic `webrepl:out`)

```json
{ "channel": "dev", "event": { "id": 2, "type": "output", "commandId": "cmd_1_ab12", "data": "2\n" } }
```

`event` is a `TransportEvent` (§3.4). The schema names this exact wire shape
`WireOutMessage` (`OutMessage<TransportEvent>`).

### 3.3 `SysMessage` (topic `webrepl:sys`)

```json
{ "channel": "dev", "kind": "claim", "instanceId": "inst_a" }
```

| Field        | Type                   | Meaning                                                |
|--------------|------------------------|--------------------------------------------------------|
| `channel`    | string                 | the channel whose ownership changes                    |
| `kind`       | `"claim"`\|`"release"` | `claim` asserts (or renews) ownership; `release` ends it |
| `instanceId` | string                 | the instance asserting or releasing ownership          |

System messages are internal to the cluster. They are never forwarded to
SSE clients, and they are unrelated to the client-visible `system` *event
type* below.

### 3.4 Events

An event is the unit of a channel's history. It is the `event` of an
`OutMessage` and, serialized, the `data` line of an SSE frame (§6). Every
event has the envelope `{ id, type, commandId, data }`; `type` selects the
shape of `data`:

| Variant        | `type`      | `commandId`      | `data`                              | Emitted when                                               |
|----------------|-------------|------------------|-------------------------------------|------------------------------------------------------------|
| `CommandEvent` | `"command"` | string           | `{ "command": string, "instanceId": string }` | the owner is about to execute the command; `instanceId` is the owner |
| `OutputEvent`  | `"output"`  | string or `null` | string: one raw chunk of REPL output, verbatim (includes the REPL's own formatting of the result and any console output) | the REPL writes output; tagged with the command executing at that moment, `null` only if none is |
| `DoneEvent`    | `"system"`  | string           | `{ "done": true }`                  | once per executed command, after its last output chunk, even if it produced no output |
| `ErrorEvent`   | `"system"`  | string           | `{ "error": string }`               | the command could not be executed at all (e.g. the session could not be created); the channel stays usable |
| `PingEvent`    | `"system"`  | `null`           | `{ "ping": true }`                  | SSE keep-alive; **SSE-only**, see §6.4                     |

`TransportEvent` = `CommandEvent | OutputEvent | DoneEvent | ErrorEvent`: the
events that travel on `webrepl:out` and are replayable.
`SseEvent` = `TransportEvent | PingEvent`: everything a client can receive.
A `PingEvent` MUST NOT be published on the transport or stored for replay.

A command that throws inside the REPL is a *successful execution* at this
level: the thrown error is rendered by the REPL as `output` chunks, followed
by `done`. `ErrorEvent` is reserved for failures to execute.

---

## 4. Command lifecycle

### 4.1 Dispatch

On an accepted `POST` (§6.2) the origin mints a `commandId`, publishes a
`CmdMessage` on `webrepl:cmd`, and returns the id to the HTTP client without
waiting for execution. If the publish fails, the origin still returns the id;
the failure is logged, not surfaced.

### 4.2 Who executes

Every instance receives every `CmdMessage`. Each applies this decision, in
order, using only its local view (§5.1):

1. If this instance is the recorded owner of `channel`: execute.
2. Otherwise, if the channel is **effectively ownerless** (§5.4) *and* this
   instance is the origin (`originInstanceId` equals its own id): claim it
   (§5.2), then execute.
3. Otherwise: ignore the message.

Rule 2's origin restriction means at most one instance claims a channel per
command; the others wait for the resulting `claim` message. Rule 1 means an
instance that believes it owns a channel keeps executing even if peers
consider its lease stale; the lease only governs *takeover by others*.

### 4.3 Execution

The executing instance:

1. Marks the command *pending* on the channel (used by §5.6) before any
   asynchronous step.
2. Resets the channel's idle timer (§5.5).
3. Appends the command to the channel's **serial execution queue**. Commands
   on one channel execute strictly one after another; the next starts only
   after the previous one's `done` or `error` event has been published.
   Commands on different channels are independent.
4. When the command's turn comes: ensure a REPL session exists for the
   channel (one session per channel per owner; created on first use with the
   host application's context), then publish, in this order, as `OutMessage`s:
   - a `CommandEvent`;
   - zero or more `OutputEvent`s as the session writes output, each tagged
     with this command's id;
   - a `DoneEvent`.

   If step 4 fails before or during evaluation in a way the session does not
   itself report as output (for example the context factory throws), publish
   an `ErrorEvent` with the command's id instead of `done`.
5. Clears *pending* once the `done`/`error` event has been published.

The owner does **not** write events into its own replay buffer or SSE streams
directly. Like every other instance, it processes them when they arrive back
on `webrepl:out` (§1.1 loopback), so all instances observe one identical
history for the channel.

### 4.4 Event ids and the replay buffer

Every instance keeps, per channel, a **replay buffer**: a ring of the most
recent `replayBufferSize` events (default 200; the oldest is dropped when
full) and a *next id* counter.

- The owner assigns `id` to each event it publishes: `next id + 1`, so ids on
  a channel are positive integers, strictly increasing in publish order.
- On every received `OutMessage`, each instance (owner included) sets its
  *next id* for the channel to `max(next id, event.id)`, appends the event to
  the replay buffer, and forwards it to the channel's live SSE subscribers.
- Ids are unique and monotonic within one owner's tenure. A new owner after a
  takeover (§5.4) continues from the highest id *it* has observed for the
  channel; if it has observed none, numbering restarts at 1. A client's
  `Last-Event-ID` cursor is therefore reliable within a tenure and
  best-effort across one.
- `id` 0 is reserved for the SSE heartbeat (§6.4) and never appears in a
  buffer.

---

## 5. Ownership and the lease

### 5.1 Local view

Each instance keeps, per channel, the id of the recorded owner (if any) and
the local clock time at which it last saw a `claim` for that owner
(*seen-at*). Both are updated only by `SysMessage`s and by this instance's own
claims. Clocks are local; instances never compare timestamps with each other.

### 5.2 Claim

To claim a channel, an instance records itself as owner with *seen-at* = now,
then publishes `{ kind: "claim" }`. On receiving any `claim`, every instance
(the claimant included, via loopback) records the sender as owner and sets
*seen-at* = now. **Last claim wins**: if two origins claim the same new
channel at nearly the same instant, both execute their own command, and the
claim processed last decides the owner from then on. This window exists only
for the first command on a channel and is accepted.

### 5.3 Heartbeat (lease renewal)

Every `ownerHeartbeatInterval` (default 10 000 ms) an instance re-publishes
`{ kind: "claim" }` for every channel it owns *and* still holds a live
session for. Peers treat these exactly like first claims (§5.2), refreshing
*seen-at*. An owned channel whose session has already been disposed is not
renewed.

### 5.4 Lease expiry and takeover

An instance considers a channel's lease **expired** when it has a recorded
owner and `now − seen-at > ownerLeaseTtl` on its own clock. A channel is
**effectively ownerless** for the §4.2 decision when it has no recorded
owner, or its lease is expired *and* the recorded owner is some other
instance. (An instance never treats its own ownership as expired.)

Only the origin of the next command takes over an expired channel (§4.2 rule
2). The takeover is a fresh claim: the dead owner's session, variables and
in-flight state are gone; the new owner starts an empty session. This trades
the loss of in-memory state for availability of the channel.

**Clamp.** `ownerLeaseTtl` (default 30 000 ms) MUST be at least
`2 × ownerHeartbeatInterval`. An implementation MUST enforce this at startup
by raising the lease to that minimum (and SHOULD warn), never by failing to
start. The 2× margin guarantees a live owner always has at least one full
heartbeat interval of slack against publish and delivery jitter as measured
on a *peer's* clock, so a live, heartbeating owner is never preempted. A bare
`lease > heartbeat` is insufficient: one late heartbeat could make a live
owner look stale to a peer.

### 5.5 Release on idle

The executing instance resets a per-channel idle timer to `sessionTtl`
(default 1 800 000 ms, 30 min) every time it accepts a command for execution
(§4.3 step 2). When the timer fires, it publishes `{ kind: "release" }`. On
receiving a `release`, every instance forgets the channel's owner and
*seen-at*, closes its local session for the channel if it has one, and clears
the channel's replay buffer. The next command for the channel is handled by
rule 2 of §4.2 (no owner), by whichever instance is its origin.

A clean shutdown closes an instance's sessions but does **not** publish
`release`; its channels become usable again through lease expiry (§5.4).

### 5.6 Channel state eviction

Besides ownership, each instance keeps per-channel local state (replay
buffer, live subscribers, session). It MAY evict that state when **all**
hold: no command is *pending* (§4.3), no SSE subscriber is attached, no
session exists, and the replay buffer is empty. Eviction MUST NOT happen
while a command is pending, or the command's output could be attributed to a
fresh state and mis-tagged. A channel with buffered history but no
subscribers is kept until a `release` clears the buffer, so a reconnecting
client can still replay. Eviction removes the local *seen-at* but not the
recorded owner: ownership is cluster state and changes only through
`claim`/`release`.

### 5.7 Disabled instances

An instance with `enabled = false` is inert: it MUST NOT subscribe to or
publish on any topic, MUST NOT start the heartbeat, and MUST answer every
HTTP route in §6 with 404. This is enforced at runtime, not only at
configuration time.

---

## 6. HTTP and SSE surface

All routes are relative to a **base path** chosen by the embedding
application (the reference implementations use `/repl`). The browser UI is
coupled to this layout through relative URLs, so an implementation that serves
the UI MUST serve all of the routes below under one base path.

| Method | Path                         | Purpose                                  |
|--------|------------------------------|------------------------------------------|
| GET    | `<base>`                     | redirect (302) to `<base>/<random 8 base-36 chars>/ui` |
| POST   | `<base>/:channel`            | dispatch a command (§6.2)                |
| GET    | `<base>/:channel`            | SSE stream of the channel (§6.3)         |
| GET    | `<base>/:channel/ui`         | the browser UI, `text/html`              |
| GET    | `<base>/:channel/vs/*`       | the editor's static assets (§7)          |

### 6.1 Channel names

`:channel` is any non-empty path segment; implementations decode it as the
channel name without further normalisation. When rendering the UI the name
MUST be escaped for the script context and URL-encoded in URLs (it is user
input on an arbitrary-code-execution surface). Random channel names from the
landing redirect are a collision-avoidance convenience, not a secret.

### 6.2 `POST <base>/:channel`

Request body: JSON `{ "command": string }`. If `command` is not a string, or
is empty after trimming whitespace, respond `400`. Otherwise dispatch (§4.1)
and respond `202` with body `{ "accepted": true, "commandId": string }`. The
result arrives on the SSE stream, never in this response.

### 6.3 `GET <base>/:channel` (SSE)

Response headers: `Content-Type: text/event-stream`, plus the usual
no-cache, keep-alive and no-buffering headers. The reference implementation
writes a single `\n` before the first frame; clients MUST tolerate leading
blank lines (they are no-ops in SSE).

**Frame layout.** Each event is one SSE frame:

```
event: message
id: <event id, decimal>
data: <the SseEvent as one JSON line>

```

`data` is the serialized event (§3.4) on a single line (JSON escapes
newlines). Browser `EventSource` clients receive it as a `message` event.

**Replay contract.** On connect, parse the `Last-Event-ID` request header as
a decimal integer:

- header absent, or not a number → cursor is *none*: send the entire replay
  buffer, oldest first;
- otherwise cursor = that number: send every buffered event with
  `id > cursor`, oldest first.

Replay is taken as a snapshot at subscription time and the live feed is
attached in the same step, so no event is skipped or duplicated between the
two. Live events follow in arrival order.

### 6.4 Heartbeat and the id-stamping rule

Every `heartbeatInterval` (default 15 000 ms) per connection, the server
sends a `PingEvent` frame to keep the connection alive through proxies. Pings
are per-connection, never published, never buffered.

The `id:` line of a ping frame MUST be the **id of the last non-ping event
sent on this connection**, or, if none has been sent yet, the client's
`Last-Event-ID` cursor (or `0` when there was none). The `data` payload still
carries `"id": 0`. Omitting the `id:` line is NOT allowed either: SSE servers
commonly auto-number id-less frames, which would overwrite the client's
cursor with a meaningless counter.

Rationale: per the SSE specification a client sets its reconnection cursor
from every `id:` line it receives. Stamping pings with the last real id makes
them idempotent for the cursor, so an idle connection can reconnect and
receive only what it missed instead of replaying the whole buffer. The
reference behaviour, given a client that reconnected with
`Last-Event-ID: 5` and then received only pings, is `id: 5` on every ping;
after a real event with id 7 flows, subsequent pings carry `id: 7`.

---

## 7. The browser UI

The browser UI is served from the application's own origin (no CDN) and has
two parts with different natures:

- **The UI bundle** (`<base>/<channel>/vs/*`) is static: the Monaco editor
  asset tree that the Node core copies from `monaco-editor` at build time.
  Any implementation MAY serve the same tree the Node core ships, byte for
  byte. The asset route MUST reject any path that escapes the asset root and
  MUST answer 404 for misses.
- **The UI page** (`<base>/<channel>/ui`) is NOT a static file. It is a
  small HTML template rendered per request (`renderReplUi(channel)` in the
  Node core) that inlines the channel name into an inline `<script>`. The
  channel comes from the URL, so it is attacker-controlled. Another
  implementation MUST port the template and apply the same escaping rules:
  1. Embed the channel in the script as a JSON string literal
     (`JSON.stringify(channel)`), never by plain concatenation.
  2. In that literal, replace every `<` with `\u003c`, so the HTML tokenizer
     (which runs before any JavaScript) never sees a `</script>` sequence.
  3. In that literal, replace U+2028 and U+2029 with `\u2028` and `\u2029`
     (JSON allows them raw; JavaScript source treats them as line
     terminators).
  4. Where the channel appears in HTML text (the `<title>`), strip `<`, `>`,
     `"`, `'` and `&`.
  5. Build the SSE and POST URL with `encodeURIComponent(channel)` and render
     every SSE payload via `textContent`, never `innerHTML`.

The page fetches `../<channel>` (relative to the UI page) for SSE and POST
and loads the editor from `vs/loader.js`, also relative to the UI page. An
implementation that serves both parts then only needs the routes of §6.

---

## 8. Versioning

- This document carries a semantic version (top of file). The JSON Schema is
  versioned with it and regenerated from the types in the same change.
- A change that only **adds** (a new optional property, a new event variant,
  a new topic, a relaxed constraint) is a **minor** bump.
- A change that **breaks** an existing reader or writer (renamed or removed
  property, changed type, changed semantics of an existing field, tightened
  constraint, changed topic name) is a **major** bump.
- There is **no wire version field and no handshake**. The version is
  documentation: it tells an implementer when they must update. Instances in
  one cluster MUST run implementations of the same spec version; mixed-version
  clusters and clusters that mix implementations in different languages are
  not supported scenarios and have undefined behaviour.

## 9. Defaults summary

| Knob                     | Default      | Governs                                   |
|--------------------------|--------------|-------------------------------------------|
| `replayBufferSize`       | 200 events   | per-channel replay buffer (§4.4)          |
| `heartbeatInterval`      | 15 000 ms    | SSE ping per connection (§6.4)            |
| `ownerHeartbeatInterval` | 10 000 ms    | owner `claim` renewal (§5.3)              |
| `ownerLeaseTtl`          | 30 000 ms    | lease expiry; clamped ≥ 2× heartbeat (§5.4) |
| `sessionTtl`             | 1 800 000 ms | idle `release` (§5.5)                     |

`heartbeatInterval` and `ownerHeartbeatInterval` are unrelated mechanisms
(client keep-alive vs. cluster lease) and MUST stay independent knobs.
