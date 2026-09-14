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
