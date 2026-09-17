# TikTokHelper rewrite tasks

## Task 1: Resolve connector license and replacement boundary

**Description:** Determine whether the selected TikTok connector can be used in the intended privately hosted service and document acceptable alternatives without committing the rest of the product to one library.

**Acceptance criteria:**
- [x] Exact dependency version and license text are recorded.
- [x] Private household use and possible future sharing are evaluated separately.
- [x] A clear go, conditional-go, or replace decision is approved.

**Verification:**
- [x] Findings link to the versioned primary license and package sources.
- [x] The adapter contract remains implementable by at least one alternative.

**Dependencies:** None

**Files likely touched:** `docs/decisions/`, `packages/contracts/`

**Estimated scope:** Small

## Task 2: Inventory the real operator workflow

**Description:** Turn the legacy implementation and the wife's actual usage into a prioritized behavior specification before selecting UI screens.

**Acceptance criteria:**
- [x] Required, optional, and rejected legacy functions are listed.
- [x] Speech, sounds, gifts, connection control, and OBS needs have concrete scenarios.
- [x] Initial access and device/browser assumptions are recorded.

**Verification:**
- [x] Ivan and the operator review the workflow list.
- [x] Every phase-one screen maps to an accepted scenario.

**Dependencies:** None

**Files likely touched:** `docs/product/workflows.md`

**Estimated scope:** Small

## Checkpoint: approve scope

- [x] Tasks 1 and 2 are complete.
- [x] Stack, first-release scope, identity boundary, and connector choice are approved before implementation.

## Task 3: Bootstrap the TypeScript workspace

**Description:** Preserve the archive and create the minimal Fastify, React/Vite, and shared-contract workspace with pinned tooling.

**Acceptance criteria:**
- [x] Rewrite branch and legacy tag are reviewed before creation.
- [x] Server, web, and contracts packages build from a clean checkout.
- [x] Standard typecheck, test, lint, and build commands are documented.

**Verification:**
- [x] Clean install succeeds from the lockfile.
- [x] Typecheck, tests, lint, and production build exit successfully.

**Dependencies:** Scope checkpoint

**Files likely touched:** `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`

**Estimated scope:** Medium

## Task 4: Define contracts and Fastify foundation

**Description:** Establish runtime-validated HTTP/event contracts, application construction, health/readiness, and redacted structured logging.

**Acceptance criteria:**
- [x] App construction is separate from process startup.
- [x] Inbound API and Socket.IO payloads have shared runtime schemas.
- [x] Health, readiness, error shape, and log-redaction behavior are tested.

**Verification:**
- [x] `fastify.inject()` tests pass without opening a network port.
- [x] Representative secrets and chat text do not appear in captured logs.

**Dependencies:** Task 3

**Files likely touched:** `apps/server/src/`, `packages/contracts/src/`

**Estimated scope:** Medium

## Task 5: Add PostgreSQL persistence and settings slice

**Description:** Introduce Drizzle, the initial schema and migration, then deliver settings persistence from database through API to browser.

**Acceptance criteria:**
- [x] Workspace-scoped schema covers channels, rules, sounds, preferences, and minimal idempotency records.
- [x] Migration SQL is generated and reviewed rather than using destructive schema push.
- [x] Settings survive browser and application restart.

**Verification:**
- [x] Integration tests pass against an isolated PostgreSQL database.
- [x] Empty-database migration and backup/restore procedure are verified.
- [x] Cross-workspace repository tests reject leakage.

**Dependencies:** Task 4

**Files likely touched:** `apps/server/src/db/`, `apps/server/drizzle/`, `apps/web/src/features/settings/`

**Estimated scope:** Medium

## Checkpoint: persisted foundation

- [x] Tasks 3-5 pass all focused and full checks.
- [x] Settings work end to end before adding a live external dependency.

## Task 6: Implement the TikTok adapter

**Description:** Add the isolated connector, lifecycle state machine, normalization, gift handling, reconnect, and cleanup using sanitized fixtures.

**Acceptance criteria:**
- [x] Only project-owned event contracts leave the adapter.
- [x] One connector exists per workspace/channel and manual stop cancels reconnect.
- [x] Gift streaks and state-changing events are idempotent.

**Verification:**
- [x] Fixture tests cover normal, malformed, duplicate, offline, reconnect, and shutdown paths.
- [x] A separately approved real LIVE smoke test confirms current connector compatibility.

**Dependencies:** Tasks 1, 4, 5

**Files likely touched:** `apps/server/src/tiktok/`, `packages/contracts/src/events/`, `tests/fixtures/`

**Estimated scope:** Medium

## Task 7: Implement realtime recovery

**Description:** Connect backend state to browsers with typed Socket.IO rooms, snapshot-first recovery, bounded buffers, acknowledgements, and authorization boundaries.

**Acceptance criteria:**
- [x] Room membership is derived and authorized server-side.
- [x] Reconnect sends a snapshot before live deltas and rejects stale generations.
- [x] High-rate low-value updates are coalesced rather than queued without bounds.

**Verification:**
- [x] Integration tests cover unauthorized rooms, sequence gaps, duplicate commands, reconnect, and slow clients.
- [x] Repeated page reconnects do not duplicate server listeners or TikTok connectors.

**Dependencies:** Tasks 4 and 6

**Files likely touched:** `apps/server/src/realtime/`, `apps/web/src/realtime/`, `packages/contracts/src/socket/`

**Estimated scope:** Medium

## Task 8: Build the browser operator workflow

**Description:** Deliver the first usable React interface for connection control, status, event feed, mappings, sound playback, and speech.

**Acceptance criteria:**
- [x] Audio activation and unavailable output states are explicit; text-to-speech remains deferred by the accepted workflow.
- [x] Connection, offline, reconnecting, failed, and stopped states are understandable.
- [x] Settings and mappings are usable on desktop and the agreed mobile sizes.

**Verification:**
- [x] Component tests cover queues and error states.
- [ ] Playwright covers initial load, activation, events, reload/reconnect, and responsive layout with a fake source.
- [ ] A manual browser check confirms actual speech and sound output.

**Dependencies:** Tasks 5 and 7

**Files likely touched:** `apps/web/src/`, `packages/contracts/src/`

**Estimated scope:** Medium

## Checkpoint: local product

- [ ] Tasks 6-8 pass automated checks and an operator walkthrough.
- [ ] The browser can recover without creating a second live connection.

## Task 9: Package the production application

**Description:** Create a hardened application image and Compose model for the app, PostgreSQL, persistent media, and explicit migrations.

**Acceptance criteria:**
- [ ] Database and media use named persistent storage and are not publicly exposed.
- [ ] App and database have meaningful healthchecks and graceful shutdown.
- [ ] Secrets remain outside images, Git, and rendered diagnostic output.

**Verification:**
- [ ] Image builds from a clean checkout.
- [ ] `docker compose config --quiet` passes.
- [ ] Fresh install, restart, migration failure, and persistence scenarios are exercised locally.

**Dependencies:** Tasks 5 and 8

**Files likely touched:** `Dockerfile`, `compose.yaml`, `deploy/`

**Estimated scope:** Medium

## Task 10: Deploy through Proxmox and Caddy

**Description:** Provision or select the dedicated VM, deploy the reviewed release, establish access control, and verify the real browser workflow through the public endpoint.

**Acceptance criteria:**
- [ ] Live VM, storage, DNS, Caddy, resource, and backup state are inventoried before mutation.
- [ ] A verified backup and rollback procedure exist before deployment.
- [ ] Public access requires the agreed identity boundary and PostgreSQL is internal only.

**Verification:**
- [ ] Services and healthchecks pass; fresh logs contain no secret or chat leakage.
- [ ] HTTPS, WebSocket, persistence, speech, sounds, reconnect, and operator workflow pass externally.
- [ ] PostgreSQL/media restore is tested or explicitly scheduled as an unresolved gate.

**Dependencies:** Tasks 1, 2, and 9

**Files likely touched:** `deploy/`, project operations documentation, reviewed Caddy fragment on the target

**Estimated scope:** Medium

## Checkpoint: production handoff

- [ ] All acceptance criteria and verification commands are recorded with fresh results.
- [ ] Known TikTok reliability/licensing limitations and rollback instructions are documented.
- [ ] Ivan and the operator accept the real browser flow.

## Task 11: Define configurable speech and reaction contracts

**Description:** Define additive runtime-validated contracts for support levels, speech policy, event reactions, template variables, and browser actions.

**Acceptance criteria:**
- [x] Every rule belongs to one workspace and is disabled/silent until explicitly configured.
- [x] Templates accept only documented variables and bounded text.
- [x] Moderator speech is an explicit workspace option with its own cooldown.

**Verification:**
- [x] Contract tests accept representative rules and reject unknown variables, oversized templates, invalid thresholds, and additional fields.
- [x] Existing gift, sound, and settings contracts remain backward compatible.

**Dependencies:** Tasks 5, 7, and 8

**Files likely touched:** `packages/contracts/src/automation.ts`, `packages/contracts/src/index.ts`

**Estimated scope:** Small

## Task 12: Persist workspace speech configuration

**Description:** Add reviewed Drizzle migrations, repository methods, and authenticated REST routes for levels, event reactions, and speech policy.

**Acceptance criteria:**
- [x] Levels, reactions, and policy survive restart and remain workspace-scoped.
- [x] Sound references use the shared library and cannot reference quarantined or missing sounds.
- [x] Empty workspaces receive no enabled speech or event reactions.

**Verification:**
- [ ] Empty-database migration and production-backup gates pass.
- [x] API tests cover CRUD, ordering, validation, and cross-workspace isolation.

**Dependencies:** Task 11

**Files likely touched:** `apps/server/drizzle/`, `apps/server/src/db/schema.ts`, `apps/server/src/automation/`

**Estimated scope:** Medium

## Task 13: Track supporters and grant privileges

**Description:** Identify gift senders, aggregate support points, and create idempotent level achievements without retaining raw events.

**Acceptance criteria:**
- [x] Gift series increment totals exactly once.
- [x] Crossing a threshold grants its configured privilege once.
- [x] Current-stream and lifetime totals are distinguishable.

**Verification:**
- [ ] Tests cover duplicate events, series, multiple crossed levels, username changes, and concurrent updates.

**Dependencies:** Task 12

**Files likely touched:** `apps/server/src/tiktok/`, `apps/server/src/supporters/`, `packages/contracts/src/socket.ts`

**Estimated scope:** Medium

## Task 14: Execute bounded browser speech and event sounds

**Description:** Evaluate moderator and earned privileges server-side, then send typed speech/sound actions for browser playback.

**Acceptance criteria:**
- [x] No configured action means silence.
- [x] Speech respects language, cooldown, maximum length, duplicate suppression, and bounded queue policy.
- [x] Event sounds and gift sounds share browser audio ownership without uncontrolled overlap.

**Verification:**
- [x] Unit tests cover template rendering and policy decisions.
- [ ] Browser tests cover audio activation, voice fallback, queue overflow, and stop/clear.

**Dependencies:** Task 13

**Files likely touched:** `apps/server/src/automation/`, `apps/web/src/speech/`, `apps/web/src/audio/`

**Estimated scope:** Medium

## Task 15: Build the mobile rule editor

**Description:** Add a dedicated progressive-disclosure settings surface for levels, moderator speech, event reactions, templates, sounds, and test playback.

**Acceptance criteria:**
- [x] Users edit rules using human labels, not JSON or internal event names.
- [x] Available variables are shown next to each template and can be inserted by tapping.
- [x] Create, edit, reorder, disable, test, and delete flows work on mobile.

**Verification:**
- [x] Component and Playwright tests cover empty, loading, error, long-name, and compact-width states.
- [ ] Manual iPhone check confirms editing and test speech after one audio-unlock gesture.

**Dependencies:** Tasks 12 and 14

**Files likely touched:** `apps/web/src/`, `apps/web/src/styles.css`

**Estimated scope:** Medium

## Task 16: Add a versioned browser audio cache

**Description:** Cache only enabled gift/reaction/support-level sound bytes in the browser, reuse decoded buffers, and preserve a clean migration path to a future installable PWA.

**Acceptance criteria:**
- [x] Every cacheable sound exposes a server-derived SHA-256, byte size, MIME type, status, and same-origin URL.
- [x] The browser persistently caches only sounds reachable from enabled rules and uses a bounded decoded `AudioBuffer` store.
- [x] Cache keys and namespaces follow `.agents/skills/browser-audio-cache/references/cache-contract.md`.
- [x] Authentication, workspace JSON, chat, TikTok events, and navigation responses never enter audio/model caches.
- [x] Cache, quota, or decode failure falls back to the existing media-element playback without breaking the live UI.
- [x] Cache names remain adoptable by a future Service Worker without migrating user data.

**Verification:**
- [x] Unit tests cover exact-version lookup, in-flight deduplication, changed hashes, bounded eviction, quarantine, and fallback.
- [x] Chromium browser tests prove first-download and persistent reuse without a second media transfer.
- [ ] Manual Firefox, Safari macOS/iPhone, Android Chromium, and Yandex checks are recorded separately when devices are available.

**Dependencies:** Tasks 8 and 14

**Files likely touched:** `packages/contracts/src/sounds.ts`, `apps/server/src/sounds/`, `apps/web/src/audio/`

**Estimated scope:** Medium

## Checkpoint: speech privileges

- [ ] Tasks 11-15 pass `pnpm run verify`.
- [ ] Production backup, migration, deploy, and rollback checks pass.
- [ ] Real LIVE verifies one moderator message, one threshold crossing, one announcement, and one event sound.
