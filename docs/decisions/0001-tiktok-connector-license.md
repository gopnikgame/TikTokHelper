# ADR-001: License boundary for the TikTok LIVE connector

## Status

Accepted.

## Date

2026-09-14

## Context

The archived application uses `tiktok-live-connector` 1.2.3. That release is MIT-licensed, but it implements an old connector API and protocol behavior and is not a suitable basis for a new maintained service without a successful live compatibility proof.

The current upstream TypeScript line identifies itself as version 2.4.4 and `AGPL-3.0-only`. Its license adds integration permissions in section 18, including examples such as overlays, games, and bots, but withdraws that exception in section 19 for commercial, closed-source, or hosted SaaS/network services when complete server-side source is not made available under AGPL-3.0. Section 20 states that non-compliant use falls back to the core AGPL terms.

TikTok's public developer product catalogue does not currently document a public official API that supplies the required realtime LIVE chat, gift, like, follow, and viewer event stream. The connector therefore remains an unofficial, reverse-engineered and operationally fragile dependency.

## Decision

Use a **conditional-go** decision for the current connector:

1. Development may target the current pinned connector behind a project-owned adapter.
2. Do not deploy it as a closed-source network service.
3. Before deployment, license the complete server-side source that integrates the connector under AGPL-3.0, preserve the connector's license and notices, and provide every remote application user a clear `Source` link to the exact corresponding source for the deployed revision.
4. Keep secrets, environment files, database contents, logs, uploaded sounds, and operator data outside the published source.
5. Record the deployed connector version and source revision; do not silently upgrade it.
6. If the service must remain closed-source or becomes a paid hosted offering, stop and obtain written permission/commercial terms from the copyright holder or replace the connector before deployment.

The public GitHub repository is the source-publication location. The private Forgejo repository on Ivan's Proxmox is a backup mirror, not the source offer presented to application users.

This is a conservative engineering decision, not a substitute for jurisdiction-specific legal advice.

## Implementation boundary

- The connector is imported only by `apps/server/src/tiktok/live-connector.ts`.
- `packages/contracts` contains only TikTokHelper-owned normalized contracts and no copied upstream schemas or generated bindings.
- Browser clients never receive connector-native objects.
- Deterministic tests use minimal sanitized fixtures created for this project, not copied upstream test suites.
- Third-party notices and the exact dependency license ship with the deployment/source offer.
- The product exposes its build revision and an exact-source link without exposing runtime configuration.

## Alternatives considered

### Keep version 1.2.3 under MIT

Rejected as the primary plan. Its license is permissive, but the implementation is from the older API generation and would require a real LIVE compatibility proof. Repairing it by copying modern upstream code would import the modern license obligations and defeat the purpose.

### Use the current connector in a private closed repository without a source offer

Rejected. The license text specifically addresses hosted network services and makes this interpretation unnecessarily risky even for a small private deployment.

### Reimplement the TikTok protocol

Rejected. It creates a permanent reverse-engineering and protocol-maintenance burden and does not create an official or stable integration.

### Use another unofficial language port

Not selected. The actively maintained Python alternative also identifies itself as modified AGPL, while less active permissive forks would need separate protocol, maintenance, security, and license validation. Changing language does not remove the underlying unofficial-protocol risk.

### Use an official TikTok API

Preferred if TikTok later offers and approves a product that supplies the required realtime LIVE events. The currently documented public products and webhooks do not establish that capability.

### Use a managed third-party LIVE WebSocket API

Viable future replacement if its price, data handling, Russian-customer eligibility, terms, event coverage, and reliability are acceptable. The project adapter must keep this option open.

## Consequences

- The server integration can use the maintained API while the project remains legally transparent to its users.
- The deployed server source cannot remain proprietary under this path.
- Public or user-accessible source must never contain operational secrets or personal data.
- Adding friends does not require an architectural rewrite, but each user must retain access to the source offer.
- A future commercial closed-source service requires a new decision before launch.
- Connector failures and protocol drift remain operational risks regardless of license compliance.

## Evidence reviewed

- [Upstream `ts-rewrite/package.json`](https://raw.githubusercontent.com/zerodytrash/TikTok-Live-Connector/ts-rewrite/package.json), version 2.4.4, Node.js 20+, license metadata `AGPL-3.0-only`.
- [Upstream `ts-rewrite/LICENSE`](https://raw.githubusercontent.com/zerodytrash/TikTok-Live-Connector/ts-rewrite/LICENSE), especially AGPL section 13 and additional sections 18–21.
- [Upstream tag `v1.2.3/LICENSE`](https://raw.githubusercontent.com/zerodytrash/TikTok-Live-Connector/v1.2.3/LICENSE), MIT.
- Current [TikTok for Developers product catalogue](https://developers.tiktok.com/doc/overview) and [webhook documentation](https://developers.tiktok.com/docs/en/webhooks-events); no documented realtime public LIVE event product matching this application was found.
