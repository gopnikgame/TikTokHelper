---
name: socketio-realtime
description: Design, implement, test, or diagnose TikTokHelper's Socket.IO contracts and connection lifecycle. Use for events, rooms, snapshots, reconnects, authorization, backpressure, or duplicate subscriptions; not for generic REST endpoints.
---

# Socket.IO real-time layer

Use Socket.IO as a same-origin transport between the Fastify backend and React browser client. The first deployment is a single backend instance on one VM; do not add Redis, sticky sessions, or horizontal scaling without an observed need and an approved architecture change.

## Contracts and access

- Define client-to-server and server-to-client event maps in `packages/contracts` and validate every inbound payload at runtime.
- Authenticate the socket during the handshake, then authorize each workspace/channel subscription separately. Never trust a client-provided room name as proof of access.
- Derive room identifiers on the server. Remove listeners and leave rooms during logout, workspace changes, reconnect replacement, and shutdown.
- Keep control commands distinct from emitted TikTok events. Commands return an acknowledgement with a typed success or error result.

## Recovery and delivery

- Treat delivery as at-most-once unless the application explicitly adds acknowledgement and retry semantics.
- On connect or reconnect, send a current snapshot before live deltas. Use a bounded recent-event buffer for short gaps.
- Assign connection generations and per-generation sequence numbers so the client can reject stale events.
- Make state-changing commands idempotent with a command identifier. Do not apply blanket persistence or exactly-once claims to ephemeral chat/like events.
- Bound queues and buffers. Prefer dropping/coalescing low-value high-rate updates, such as viewer counts or likes, over unbounded memory growth.

## Verification

Test unauthorized room access, malformed payloads, duplicated commands, reconnect snapshot ordering, stale generations, listener cleanup, buffer overflow policy, and graceful server shutdown. Browser tests should use a controllable fake event source; the real TikTok integration is a separate test boundary.

Read [references/delivery-model.md](references/delivery-model.md) before changing acknowledgement, replay, buffering, or scaling behavior.
