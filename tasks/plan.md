# Implementation Plan: TikTokHelper browser rewrite

## Overview

Replace the archived ASP.NET/Node hybrid with a browser-first TypeScript application hosted in a dedicated Proxmox VM. The backend maintains TikTok LIVE connections and persisted configuration; the browser provides control, speech, sounds, and optional OBS views. PostgreSQL is used from the first runnable version. The rewrite proceeds on a new branch after this plan is reviewed, preserving the legacy history.

## Architecture decisions

- Use a pnpm workspace with `apps/server`, `apps/web`, and `packages/contracts`.
- Build one production application image: Fastify serves the Vite output and Socket.IO on the same origin. PostgreSQL is the only other required container.
- Use Drizzle ORM and generated, reviewed migrations. Run migrations as a bounded deployment job, not implicitly during every application startup.
- Keep one backend replica and no Redis initially. The server owns active connectors and a bounded recent-event buffer.
- Store configuration and minimal business/audit records; do not persist the complete LIVE event stream by default.
- Keep identity provider integration replaceable. Production must still have an access boundary from its first public deployment.
- Keep the TikTok connector behind an adapter so licensing or technical changes can replace it without changing UI contracts.
- Publish the exact deployed application source through the public GitHub repository under the accepted AGPL path; keep Forgejo as the private backup mirror and keep all runtime data and secrets outside both repositories.

## Phase 0: decisions and evidence

- Confirm connector licensing and distribution constraints for the intended private browser service and possible future sharing.
- Observe the legacy UI and record the wife's actual workflows, required reactions, speech behavior, sound mappings, and OBS needs.
- Confirm the initial access model and whether the mentioned provider is Authelia, Authentik, or another OIDC/forward-auth service.
- Inventory the intended Proxmox VM, domain, Caddy route, backup target, and resource budget without changing live infrastructure.

## Phase 1: foundation

- Tag the archived state and create a dedicated rewrite branch after approval.
- Create the pinned Node/pnpm workspace, shared TypeScript configuration, linting, type checking, and test commands.
- Define project-owned HTTP, Socket.IO, and normalized TikTok event contracts with runtime schemas.
- Add Fastify application construction, health/readiness endpoints, structured redacted logging, and fixture-driven tests.

### Checkpoint: foundation

- Type check, unit tests, and production builds pass from a clean checkout.
- The backend can be tested with `fastify.inject()` without opening ports.
- No secret, raw TikTok payload, or legacy database is introduced into the rewrite tree.

## Phase 2: PostgreSQL and settings slice

- Model workspaces, channels, client preferences, sound assets, rules, and minimal event/idempotency records.
- Generate and review the initial migration; add PostgreSQL integration tests against an isolated database.
- Implement one vertical slice: load and save channel settings through validated API routes and the React UI.
- Add sound upload/storage rules, size/type limits, and backup behavior after choosing whether files live on a volume or object-like local storage.

### Checkpoint: persisted configuration

- A browser reload preserves settings and mappings.
- Migration succeeds on an empty database and has a tested rollback/recovery procedure appropriate to its risk.
- Workspace scoping is enforced in repository queries even with one initial user.

## Phase 3: TikTok connection slice

- Implement the connector adapter and explicit lifecycle state machine.
- Normalize connection, chat, member, like, follow, share, gift, and stream-end events from sanitized fixtures.
- Implement gift-streak finalization, stable event identity where possible, bounded reconnect with cancellation, and complete cleanup.
- Expose start/stop/status commands without leaking connector payloads or credentials.

### Checkpoint: deterministic TikTok behavior

- Fixture tests cover malformed data, duplicates, gifts, stream end, reconnect, and shutdown.
- One connector is active per workspace/channel and manual stop prevents reconnect.
- A real LIVE test remains a separate, documented check rather than a unit-test dependency.

## Phase 4: realtime browser workflow

- Implement typed Socket.IO handshake, server-derived rooms, command acknowledgements, snapshot-first recovery, and bounded buffering.
- Build the operator screen for connection state, channel control, event feed, sound mappings, and speech settings.
- Implement browser audio activation, speech queue policy, sound preview, error states, and client-specific voice/output preferences.
- Add an optional token-scoped OBS/browser-source view only if the workflow inventory confirms it is needed.

### Checkpoint: end-to-end local workflow

- Browser tests cover first load, audio activation, start/stop, representative events, reconnect, stale events, and mobile layout.
- Closing and reopening the page restores state without creating a second TikTok connector.
- A failed or offline stream is understandable and recoverable without server access.

## Phase 5: packaging, access, and deployment

- Create a multi-stage production image and Compose model with `app`, `db`, and an explicit migration job.
- Add healthchecks, graceful shutdown, named PostgreSQL/media volumes, non-root execution where compatible, and secrets outside Git.
- Implement the agreed initial access boundary and preserve a path to external OIDC/forward-auth identities and multiple workspaces.
- Provision and deploy only after live Proxmox/Caddy inventory, backup, reviewed diff, and explicit approval.
- Verify internal readiness, public HTTPS, WebSocket upgrade, logs, persistence, browser sound/speech, reconnect, and backup restoration.

### Checkpoint: production readiness

- Clean-clone build and automated tests pass.
- Compose resolves with `docker compose config --quiet`; containers are healthy and the public user flow is verified.
- PostgreSQL and media backups have a documented and tested restoration path.
- Known limitations of the unofficial TikTok integration and the chosen license posture are documented.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unofficial TikTok protocol changes | High | Isolated adapter, pinned version, fixtures, explicit degraded state, monitored reconnect failures |
| Connector license conflicts with a closed hosted service | High | Resolve before implementation commitment; preserve replaceable adapter boundary |
| Duplicate gift processing | High | Stable identity, streak finalization, idempotency record and deterministic tests |
| Browser autoplay or background throttling | Medium | Explicit audio activation, visible state, bounded queues, real-browser tests |
| Event volume overloads browser or database | Medium | Coalescing, bounded buffers, selective persistence and retention |
| Future multi-user data leakage | High | Workspace scope in schema/repositories from day one; separate authentication and authorization |
| VM or PostgreSQL failure | High | Healthchecks, graceful shutdown, SSD workload placement, verified backups and restore drill |

## Open questions

- Is the future identity provider Authelia, Authentik, or something else?
- Which legacy functions did the wife actually use, and which should be dropped?
- Is an OBS browser-source overlay required in the first release?
- Should sound files be shared per workspace or private per operator/browser?
- How much event history, if any, is useful beyond a short live buffer and minimal gift audit?
- Which domain and dedicated VM should host the service?

## Phase 6: configurable speech privileges and event reactions

- Add workspace-scoped support levels with user-defined names, point thresholds, privilege duration, chat-speech cooldown, optional announcement template, and optional sound.
- Add workspace-scoped event reactions for moderator first-seen, donor first-seen, and support-level reached. Speech and sound actions are independently optional and disabled by default.
- Add a global workspace speech policy with optional permanent moderator speech, bounded queues, message length limits, and cooldowns.
- Track aggregate supporter totals without storing raw chat or the complete gift-event stream. Grant level achievements transactionally and idempotently.
- Render templates from an allowlist of documented variables such as `{user}`, `{username}`, `{message}`, `{gift}`, `{count}`, `{points}`, `{total}`, `{level}`, and `{threshold}`.
- Keep voice selection and browser audio activation local to the output device; store business rules and templates on the server.

### Checkpoint: configurable speech foundation

- Empty text and sound selections produce no reaction.
- Workspace members cannot read or change another workspace's rules or supporter totals.
- Duplicate gift events cannot grant points or achievements twice.
- Moderator speech and earned speech privileges respect cooldown, length, queue, and content filters.
- Mobile users can create, test, reorder, disable, and delete rules without editing JSON.

## Phase 7: browser media cache and future PWA foundation

- Add server-derived content hashes and byte sizes for built-in and uploaded sounds.
- Warm only media referenced by enabled gift mappings, support levels, and event reactions after the browser audio gesture.
- Keep persistent full responses in a versioned audio Cache and decoded `AudioBuffer` objects in a bounded in-memory store.
- Keep the current media-element route as a compatibility fallback for unsupported formats, unavailable storage, quota pressure, and decode failures.
- Reserve separate namespaces for the later app shell and downloadable neural TTS models; do not cache authenticated APIs or live/user data.
- Introduce a Service Worker only when implementing the installable PWA, using an explicit update flow that cannot silently disrupt an active LIVE session.

### Checkpoint: cache without stale application state

- Repeated playback avoids a second media download and repeated decoding while preserving series overlap semantics.
- Changed, quarantined, deleted, and unreferenced assets stop being selected and are pruned safely.
- Cache eviction or unavailability degrades to network playback without affecting chat or TikTok connection state.
- Browser storage contains no session, workspace, chat, participant, or live-event responses.
- The future Service Worker can adopt the audio cache namespace and key contract without rewriting cached media.

## Phase 8: deterministic browser workflow source

- Introduce a process-injected connector factory used by the session manager; keep the real connector as the only production composition.
- Provide a deterministic scripted connector exclusively from the browser-test harness, without an HTTP endpoint or production environment switch.
- Drive sanitized connection, chat, emoji, gift streak, duplicate, reconnect, moderator, and supporter events through the existing normalized contracts.
- Add repeatable browser workflow scenarios for snapshot recovery, rendering, audio ownership, speech policy, stop/clear, and the responsive viewport matrix.

### Checkpoint: browser workflows without a real LIVE

- The production startup path cannot select or expose the fake source.
- Server tests prove scripted events use the same session/realtime boundary and do not create duplicate connectors after browser reload.
- Browser scenarios are deterministic, require no TikTok account, and leave no runtime test controls in the public application.
