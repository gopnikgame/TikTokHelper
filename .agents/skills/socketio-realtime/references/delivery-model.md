# Delivery model

## Initial scope

One Fastify process owns active TikTok connections and Socket.IO clients. PostgreSQL stores configuration and idempotency records, not transient socket queues. Redis is intentionally absent.

## Connection sequence

1. Authenticate the handshake or accept only the explicitly configured development identity.
2. Resolve the allowed workspace server-side.
3. Join server-derived rooms.
4. Send a snapshot with its configuration revision and connector generation.
5. Begin live deltas with monotonically increasing sequence numbers.

If a delta arrives before its snapshot, the client queues only a small bounded number and requests resynchronization. If a sequence gap cannot be recovered from the recent buffer, request a new snapshot.

## Backpressure

- Connection state and finalized gifts are high priority.
- Chat, follow, share, and member events are normal priority.
- Like/viewer counters are coalescible; retain the newest value for a short interval.
- Disconnect slow clients when their bounded queue cannot recover. Never let one browser exhaust server memory.

## Future scale trigger

Consider a shared adapter only when multiple backend replicas are an actual requirement. At that point document session affinity or WebSocket-only transport, cross-node room propagation, connector ownership, failover, and duplicate business-event handling before adding Redis or another broker.
