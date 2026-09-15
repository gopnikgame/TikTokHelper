# ADR-004: Ownership, quarantine, and deletion of shared sounds

## Status

Accepted

## Date

2026-09-15

## Context

The sound catalogue is shared by all users, while gift mappings belong to individual workspaces. Users need to manage files they upload without being able to remove another person's sound or silently break another workspace. The service administrator must also be able to respond to copyright complaints.

## Decision

- Each uploaded sound records its creating application user. Legacy built-in sounds have no creator.
- A normal user may permanently delete only their own active sound and only when no workspace mapping references it.
- A global administrator may place any active sound in quarantine with a recorded reason. The default reason offered by the interface is `Нарушение авторских прав`.
- Quarantined sounds are excluded from selectable sounds and runtime mappings. Connected browsers receive an invalidation event, reload mappings, and clear their playback queues.
- Permanent administrator deletion is a separate confirmed action available only after quarantine. It removes every remaining mapping before deleting the catalogue row and uploaded file.
- Global administrator status is an explicit database role. It is never inferred from a display name, workspace ownership, registration order, or trusted-local access.

## Consequences

Quarantine is fast and reversible at the data level until permanent deletion. Existing mappings remain visible through the usage count during quarantine, so impact can be reviewed. Final deletion is intentionally destructive and removes those mappings. Trusted local access remains suitable for operating a stream but cannot perform global moderation without an authenticated administrator session.
