# ADR-002: Single-process realtime delivery and recovery

## Status

Accepted.

## Date

2026-09-14

## Context

The browser must receive connection state, chat, and finalized gift increments without creating a second TikTok connection after a page reconnect. The first production deployment has one Fastify process on one VM, no application login yet, and one configured workspace.

Socket.IO guarantees event ordering, but disconnected clients can miss server events. Rooms are a server-owned routing mechanism rather than an authorization boundary. Unbounded replay queues would allow a slow or abandoned browser to consume increasing memory.

## Decision

- Attach Socket.IO 4.8.3 to Fastify's existing HTTP server and use WebSocket transport only.
- Keep one TikTok session per workspace in the backend; browser tabs only subscribe to its server-derived room.
- Validate every command with the shared runtime schemas and authorize the requested workspace separately.
- Until application authentication is introduced, authorize only `DEFAULT_WORKSPACE_ID` (default `primary`) behind the existing private Caddy access policy.
- Send a current snapshot before joining the room, then replay events produced during the join window.
- Identify connector generations and order their events with monotonic sequence numbers. Clients reject stale generations and request resynchronization on gaps.
- Retain at most 500 recent events per workspace in memory and at most 200 visible events in the browser. PostgreSQL does not store transient chat replay.
- Cache a bounded set of command results and make the session manager itself idempotent for repeated connect commands.
- Do not add Redis, sticky sessions, or multi-node connector ownership until multiple application replicas are an observed requirement.

## Alternatives considered

### A new TikTok connector per browser

Rejected because refreshes and multiple tabs would duplicate upstream connections, gift handling, and reconnect loops.

### Persist every chat event in PostgreSQL

Rejected for the initial product. The requirement is short reconnect recovery, not a permanent chat archive, and storing raw chat would add privacy and retention obligations.

### Redis adapter immediately

Rejected because there is one application process. It would add an operational dependency without improving the current delivery path.

## Consequences

- A short browser disconnect can recover from the in-memory buffer.
- A long gap or process restart produces `requiresFullRefresh` rather than pretending delivery was complete.
- Restarting the application clears transient history but not settings or sound mappings.
- Adding Authentik later changes the identity and workspace authorization function, not the event contract.
- Horizontal scaling requires a new decision covering connector ownership, room propagation, and failover.

## Sources

- [Socket.IO server initialization with Fastify](https://socket.io/docs/v4/server-initialization/#with-fastify)
- [Socket.IO rooms](https://socket.io/docs/v4/rooms/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)
