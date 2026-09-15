# Authentication and multi-user implementation plan

This plan implements ADR-003 without changing production SoloBot or the deployed TikTokHelper
until the corresponding deployment step is separately approved.

## Phase 1: database ownership foundation

- Add `users`, `workspace_memberships`, and `app_sessions`.
- Add repository methods for identity upsert, membership checks, workspace creation, session
  issue/lookup/revoke, and expired-session cleanup.
- Keep the existing `primary` workspace and all current settings/mappings unchanged.
- Require an explicit identity subject for the one-shot `primary` ownership migration; never
  use first-login wins.
- Test uniqueness, expired/revoked sessions, and denied cross-workspace access.

Exit gate: migration applies to a disposable PostgreSQL database, existing data survives, and a
schema-level test proves that one user cannot acquire another workspace implicitly.

## Phase 2: shared catalogue and sound library

- Replace workspace-scoped gift observations with a global gift catalogue keyed by gift ID.
- Make sound assets global while recording creator and content checksum.
- Keep gift-to-sound rules workspace-scoped.
- Migrate current `primary` rows without changing gift IDs, sound UUIDs, storage keys, or files.
- Define upload, rename and delete permissions. Initial recommendation: all authenticated users
  can use sounds; only creator or administrator can rename/archive them; hard deletion is an
  administrator maintenance action after reference checking.

Exit gate: two fixture workspaces see the same catalogue/library but can map the same gift to
different sounds.

## Phase 3: VLine Auth Bridge prototype

- Create the bridge in a separate repository and deployment unit.
- Implement `/authorize`, `/token`, and `/health` exactly as ADR-003 defines.
- Validate SoloBot `/api/auth/me` as an untrusted external response.
- Use an exact allowlist for client and redirect URI; add state/PKCE/replay/rate-limit tests.
- Redact `cookie`, `authorization`, `code`, `clientSecret`, and identity values from logs.
- Test against a mock SoloBot first. A real VLine session test is a distinct, user-approved
  production-read operation.

Exit gate: an intercepted or replayed code, wrong verifier, wrong redirect, wrong client, and
expired code all fail without revealing identity data.

## Phase 4: TikTokHelper local authentication

- Add `/api/auth/session`, `/api/auth/login`, `/auth/callback`, and `/api/auth/logout`.
- Store only a session-token hash in PostgreSQL and only the raw token in a secure cookie.
- Resolve authentication in a Fastify plugin and expose a typed request principal.
- Stop accepting a workspace ID as proof of access. Every workspace route requires membership.
- Authenticate the Socket.IO handshake and authorize every subscribe/connect/disconnect command.
- Preserve current event contracts and room naming.

Exit gate: HTTP and WebSocket integration tests cover anonymous denial, normal access, session
expiry/revocation, and attempted access to a second user's workspace.

## Phase 5: user interface

- Add a VLine login screen and account/session indicator.
- Load the user's available workspace rather than hard-coding `primary`.
- Keep browser audio unlock client-specific.
- Display a clear temporary-unavailable state when new VLine login cannot start; do not sign out
  an already valid local session merely because the bridge is offline.

Exit gate: desktop and mobile browser tests cover login, callback, refresh, logout, reconnect,
audio unlock, and two simultaneous users in separate workspaces.

## Phase 6: staged deployment

- Take fresh PostgreSQL/config/media and VM backups.
- Deploy schema and code with authentication enforcement disabled.
- Deploy the bridge separately and add the narrow reverse-proxy route.
- Assign `primary` to the chosen VLine identity using the audited one-shot command.
- Verify health and contract smoke tests, then enable authentication enforcement.
- Verify one existing household flow and one isolated second-user flow.
- Keep the pre-auth Git tag and VM backup until the authenticated release has run reliably and
  another post-migration backup is verified.

## Rollback boundary

Before enforcement, rollback is application-only because the migrations are additive. After
shared-catalogue migration, restore the matching application revision and PostgreSQL dump
together; do not mix a pre-migration binary with a post-migration schema. The full VM snapshot
is the final recovery layer, not the first rollback mechanism.
