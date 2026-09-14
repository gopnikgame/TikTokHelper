# Normalized event contract

Every backend-to-client event has an envelope owned by TikTokHelper:

- `eventId`: stable identifier for deduplication when one can be derived; otherwise a generated identifier scoped to the connection.
- `workspaceId` and `channelId`: routing and authorization boundary.
- `connectionId`: identifies the connector generation that produced the event.
- `sequence`: monotonically increasing within one connection.
- `type`: project event discriminator.
- `occurredAt`: upstream timestamp when reliable.
- `receivedAt`: backend receipt timestamp.
- `payload`: validated project-owned payload containing only fields the UI needs.

## Event classes

- **State:** connection status, room metadata, viewer count, stream end. A fresh snapshot supersedes older state.
- **Ephemeral:** chat, member, like, follow, share, visual notification. Deliver live and retain only in a bounded in-memory buffer unless a product requirement says otherwise.
- **Business:** finalized gift and rule execution. Persist the minimal record needed for idempotency and audit.

Do not store every raw TikTok event by default. If temporary raw capture is needed for diagnosis, require an explicit retention limit, sanitize personal data, keep it disabled by default, and exclude it from ordinary logs.

## Client recovery

After reconnect, the client requests a snapshot containing current connection state, active channel, configuration revision, and a bounded recent-event window. Resume from a cursor only when the server still has that window; otherwise return a full snapshot. Never imply that Socket.IO reconnect alone guarantees replay.
