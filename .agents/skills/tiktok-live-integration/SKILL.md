---
name: tiktok-live-integration
description: Design, implement, test, or diagnose TikTok LIVE event ingestion for TikTokHelper. Use for tiktok-live-connector, stream lifecycle, gift streaks, normalized events, reconnects, fixtures, or connector upgrades; not for frontend presentation alone.
---

# TikTok LIVE integration

Keep the unofficial connector behind a project-owned adapter. Inspect the installed package version, lockfile, exports, types, changelog, and license before writing version-dependent code. Do not copy examples from another major version or update the package merely to match documentation.

## Integration boundary

- Run the connector only in the backend. Never expose connector objects, cookies, signing keys, or raw payloads to the browser.
- Translate incoming payloads into the project contracts in `packages/contracts`; unknown fields remain internal diagnostics.
- Keep connector setup, normalization, lifecycle, and business rules in separate modules. Replacing the connector must not require rewriting UI or stored rules.
- Treat TikTok LIVE access as best-effort: it is an unofficial reverse-engineered interface that may change without notice.

## Lifecycle and safety

- Model `idle`, `connecting`, `live`, `offline`, `reconnecting`, `failed`, and `stopped` explicitly.
- Allow only one active connector per workspace/channel. Dispose listeners, timers, sockets, and abort controllers before replacement.
- Use bounded exponential backoff with jitter and a stopping condition. Manual stop must cancel reconnect.
- Normalize expected offline/stream-end states separately from network or protocol failures.
- Do not log chat text, cookies, tokens, or complete raw events by default. Structured logs may include event type, room identifier, attempt, duration, and sanitized error class.

## Gifts and repeat handling

Gift streak updates are not independent gifts. Define a stable event identity and finalize a streak only according to the installed connector's semantics. State-changing reactions must be idempotent; visual previews may be ephemeral.

## Verification

Use sanitized recorded fixtures for ordinary tests. Cover normalization, malformed payloads, duplicate event identities, streak completion, stream end, reconnect, and cleanup. A real public LIVE check is a separate, explicitly identified integration test and never replaces deterministic tests.

Read [references/event-contract.md](references/event-contract.md) when defining or changing normalized events, persistence, or replay behavior.
