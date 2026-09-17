# ADR-0005: Use server-derived content identity for browser audio

## Status

Accepted

## Date

2026-09-17

## Context

Gift, reaction, and supporter sounds should remain immediately playable while avoiding a new media download and decode for every event. The application must work across Chromium, Firefox, Safari, and Yandex Browser, and it must leave a clean path to a future installable PWA.

A URL or display name is not a sufficient cache identity: the bytes behind a URL may change, names are editable, and quarantine or deletion must make an asset ineligible without mixing it with authenticated application data.

The production library predates this contract, so existing rows may initially lack byte size or hash even though their files are valid.

## Decision

- The server derives `contentSha256`, `byteSize`, and `mimeType` from the actual stored bytes. Clients never supply trusted cache metadata.
- Every `SoundAsset` returned by the API includes those fields, its status, and a same-origin URL.
- Server startup inspects the complete sound library before listening, updates legacy or changed metadata, and fails instead of returning incomplete cache identities when a referenced file is missing or invalid.
- Database columns remain nullable during the deployment transition because SQL migrations cannot inspect files on the media volume. The runtime API contract is strict: incomplete rows are not presented.
- Browser media caching uses the namespace and key rules in `.agents/skills/browser-audio-cache/references/cache-contract.md`. It remains separate from future app-shell and TTS-model caches.
- Authenticated API responses, navigation, chat, participant data, and live events are never stored in the audio cache.

## Alternatives considered

### Use URL or filename as the version

Rejected because a stable URL cannot distinguish changed bytes and filenames are not immutable content identities.

### Let the browser compute and own hashes

Rejected because every client would pay the hashing cost, metadata could differ between code paths, and the server could not publish one authoritative version.

### Make metadata columns `NOT NULL` in the first migration

Rejected for the initial rollout because PostgreSQL cannot derive values from files mounted into the application container. A single migration would either invent metadata or fail before a controlled file-backed backfill can run.

### Add a Service Worker immediately

Rejected for this phase. Direct Cache API ownership is sufficient for audio and avoids introducing app-shell update behavior while a LIVE page is active. A future PWA may adopt the same audio namespace explicitly.

## Consequences

- Application startup performs bounded file I/O over the sound library and will surface missing or corrupt media before accepting traffic.
- Uploads calculate identity once from the already buffered validated body.
- The browser can key persistent and decoded entries by actual content version and safely prune stale versions.
- A later migration may make the metadata columns non-null after production invariants have been observed, without changing the public API.
