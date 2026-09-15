# ADR-003: VLine identity bridge and workspace isolation

## Status

Proposed. No production changes have been made.

## Date

2026-09-15

## Context

TikTokHelper currently has one unauthenticated `primary` workspace. HTTP routes accept a
workspace ID from the URL, while Socket.IO authorizes only the configured default workspace.
The product must support several VLine users at the same time with:

- a shared gift catalogue and shared sound library;
- personal gift-to-sound mappings, playback settings, recent TikTok accounts, and LIVE session;
- browser access that does not depend on Telegram being reachable;
- preservation of the existing SoloBot and SoloBrick update path.

SoloBot already owns web identities and browser sessions. Its `Identity.id` is stable while
Telegram ID is optional. Custom FastAPI files inside SoloBot are not an update-safe extension
point: the updater replaces the project tree, preserving selected configuration and `modules`,
but the module loader does not provide a stable API-router plugin contract.

## Decision

### Identity boundary

Use SoloBot as the identity authority, but do not modify its core and do not give
TikTokHelper access to the SoloBot database.

Deploy a separate, minimal VLine Auth Bridge behind the existing `vline.online` reverse proxy
at `/integrations/tiktok-helper/`. The bridge validates the existing VLine browser session by
forwarding it to SoloBot's `/api/auth/me`, then issues a one-time authorization code. It never
receives a password and never exposes the VLine session cookie to TikTokHelper.

TikTokHelper exchanges the code over a back channel, creates its own server-side session, and
stores only the stable external subject and a small display snapshot. It must not store VLine
passwords, SoloBot session tokens, VPN keys, balances, payment data, or Telegram credentials.

### Authorization-code contract

The browser starts this flow:

```text
GET /integrations/tiktok-helper/authorize
    ?client_id=tiktok-helper
    &redirect_uri=https%3A%2F%2Ftiktok.vpnline.online%2Fauth%2Fcallback
    &state=<random>
    &code_challenge=<base64url-sha256>
    &code_challenge_method=S256
```

The bridge accepts only the configured client ID, exact redirect URI, and `S256`. If the VLine
session is absent, it sends the browser to the existing same-origin login and back to this
request. On success it redirects to the fixed TikTokHelper callback with `code` and the original
`state`.

TikTokHelper then performs a server-to-server exchange:

```text
POST /integrations/tiktok-helper/token
Content-Type: application/json
Authorization: Basic <confidential-client-credentials>

{
  "grantType": "authorization_code",
  "code": "<opaque-one-time-code>",
  "codeVerifier": "<pkce-verifier>",
  "redirectUri": "https://tiktok.vpnline.online/auth/callback"
}
```

Successful response:

```json
{
  "subject": "<SoloBot Identity.id>",
  "displayName": "<non-sensitive display label>",
  "role": "user",
  "authenticatedAt": "2026-09-15T00:00:00Z"
}
```

The code is random, stored only as a hash, valid for 60 seconds, bound to the client, redirect
URI and PKCE challenge, and consumed atomically before returning identity data. The bridge
keeps no long-lived access or refresh token. Its client secret is runtime-only and never enters
Git, browser JavaScript, URLs, or logs.

### TikTokHelper session

TikTokHelper stores an opaque random session token only in a `Secure`, `HttpOnly`,
`SameSite=Lax`, host-only cookie. PostgreSQL stores its hash, user ID, creation, last-seen,
expiry, and revocation time. Rotate the session after login and privilege changes.

Use a 30-day idle lifetime and a 90-day absolute lifetime for trusted household devices.
Logging out of TikTokHelper revokes only the TikTokHelper session. A separate explicit action
may also open the VLine logout page; silent cross-service logout is not part of this contract.

Existing TikTokHelper sessions continue during a temporary SoloBot or bridge outage. New
logins fail closed with a generic retry message. TikTok event processing and browser audio do
not call SoloBot per event.

### Tenant model

Add the following ownership model while retaining string workspace IDs for a non-destructive
migration:

```text
users
  id uuid primary key
  identity_provider varchar = 'vline'
  identity_subject varchar
  display_name varchar nullable
  status active|disabled
  created_at, updated_at, last_login_at
  unique(identity_provider, identity_subject)

workspace_memberships
  workspace_id -> workspaces.id
  user_id -> users.id
  role owner|member
  created_at
  primary key(workspace_id, user_id)

app_sessions
  id uuid primary key
  user_id -> users.id
  token_hash unique
  created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at
```

Every protected HTTP route resolves the authenticated user first and checks membership for the
requested workspace. Socket.IO authenticates the handshake, attaches the user ID to socket
state, and checks workspace membership separately before joining a room or executing LIVE
commands. A room name is never treated as an authorization mechanism.

The existing `primary` data is not claimed by the first person who logs in. Deployment must
explicitly associate it with Ivan's or his wife's selected VLine `Identity.id` using a one-shot,
audited migration command. New users receive a new workspace in the same transaction as their
first membership.

### Shared and personal data

- `gift_catalog` is global and keyed by TikTok gift ID. Names, image references, diamond value,
  and first/last seen timestamps are shared.
- `sound_assets` is a shared library. It records creator, media metadata, checksum and status;
  ordinary authenticated users may read active sounds. Upload/delete permissions are separate.
- `gift_sound_rules` remains scoped to a workspace and references a global sound asset.
- playback preferences, recent channels, LIVE connection state and idempotency records remain
  scoped to a workspace.
- chat messages and raw TikTok payloads remain transient and are not added to persistent user
  history by authentication work.

### Local-network convenience

Do not infer a user solely from source IP. NAT makes several people look identical and proxy
headers are unsafe unless controlled end-to-end. Household convenience comes from the 30-day
trusted-device session. A future explicit device-pairing feature may extend this decision, but
anonymous LAN access is not part of the first multi-user release.

## Threat model and controls

| Threat | Primary control |
|---|---|
| Forged callback or login CSRF | cryptographic `state`, PKCE S256, exact redirect allowlist |
| Stolen authorization code | 60-second one-time code bound to client, redirect and PKCE |
| Compromised TikTokHelper | no VLine cookie/database access; bridge returns minimal identity |
| Cross-workspace data access | membership check in every HTTP handler and Socket.IO command |
| Workspace enumeration | return generic `404` for inaccessible resources where appropriate |
| Session theft | random opaque token, hash at rest, host-only secure cookie, expiry/revocation |
| Secret disclosure | runtime secret files, redacted logs, no tokens/cookies/query codes in logs |
| Login flooding | rate limits by client and source, bounded outstanding codes |
| SoloBot outage | new login fails closed; existing local sessions continue until expiry |
| Update regression | separate bridge deployment and automated contract smoke test |

The bridge may call only the user-session introspection endpoint. Network policy must prevent
it from using SoloBot administrative, payment, subscription, or user-management APIs.

## Migration sequence

1. Add users, memberships and local sessions without protecting existing routes.
2. Convert gift catalogue and sound assets to shared records, preserving all existing IDs and
   files; keep workspace mappings intact.
3. Implement the bridge and test it against a non-production SoloBot session contract.
4. Add TikTokHelper login/callback/logout/session endpoints.
5. Add HTTP and Socket.IO authorization tests, including cross-workspace denial.
6. Explicitly assign the existing `primary` workspace to the selected VLine identity.
7. Enable enforcement behind a runtime flag, smoke-test, then remove unauthenticated mode.

Each database migration must have a verified pre-migration dump and a tested forward restore
or compensating migration. Do not delete current workspace columns until the migrated release
has been proven in production and another backup has been taken.

## Alternatives considered

### Modify SoloBot core

Rejected because updates replace core files and an integration defect would share the failure
domain of subscriptions, payments, and user management.

### Share the VLine cookie across parent domains

Rejected because it broadens cookie exposure to unrelated subdomains and couples both services
to SoloBot's opaque session implementation.

### Give TikTokHelper read access to the SoloBot database

Rejected because schema coupling and credential leakage would expand the impact of a
TikTokHelper compromise.

### Trust local IP addresses without login

Rejected for the initial multi-user implementation because IP does not identify which personal
workspace should be loaded.

### Deploy a full OAuth/OIDC provider now

Deferred. It is more standard but adds operational complexity for one relying application. The
bridge deliberately implements only the narrow authorization-code exchange described here and
can later be replaced by a standards-compliant provider without changing workspace ownership.

## Consequences

- SoloBot and SoloBrick updates do not overwrite integration source.
- TikTokHelper remains available to already signed-in users during short VLine outages.
- A second small service and one reverse-proxy route must be operated and monitored.
- User disablement is not instantaneous unless a future revocation/status callback is added;
  the absolute local-session lifetime bounds this delay.
- Multi-user support requires changing existing repositories that currently accept arbitrary
  workspace IDs and currently store gifts and sounds per workspace.
