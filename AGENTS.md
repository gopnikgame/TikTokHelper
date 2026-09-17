# TikTokHelper project instructions

## Product and architecture

- The target product is a browser application hosted in a dedicated VM on Ivan's Proxmox. Do not introduce a desktop runtime.
- Target stack: TypeScript, Fastify, React, Vite, Socket.IO, PostgreSQL, Drizzle ORM, and Docker Compose.
- Production uses one application instance and one PostgreSQL instance behind the existing external Caddy reverse proxy.
- Do not add NestJS, Next.js, Redis, Kubernetes, a managed cloud database, or a second reverse proxy without a concrete requirement and explicit agreement.
- Preserve the legacy ASP.NET history. Build the rewrite on a separate branch after the plan is approved; do not destructively rewrite `master` or Git history.
- Keep the application source and exact deployed revision available in the public GitHub repository under the accepted AGPL path. Treat the private Forgejo repository on Proxmox as a backup mirror.

## Dependency and contract rules

- Before using a library API, inspect `package.json`, the lockfile, installed exports/types, and version-matched primary documentation.
- Do not upgrade dependencies merely to match an example from a skill. Do not adopt beta or RC versions without a separate decision.
- TikTok integration exists only in the backend behind a project-owned adapter. The UI consumes normalized project event contracts.
- Validate inbound HTTP and Socket.IO data at runtime. Authentication and workspace/room authorization are separate checks.
- Design for a future external identity provider, but do not expose an unauthenticated production control panel.

## Data and privacy

- PostgreSQL stores configuration, users/workspaces, channel settings, rules, and minimal idempotency/audit data.
- Do not persist every raw LIVE event by default. Chat text and raw TikTok payloads must not appear in ordinary logs.
- Never commit `.env`, database dumps, passwords, tokens, cookies, signing keys, or connection strings. Keep only redacted examples.
- Public source does not authorize access to the VPS, Proxmox, PostgreSQL, logs, backups, uploaded media, or runtime configuration; all remain private.
- Destructive migrations, database resets, volume deletion, and `docker compose down -v` require explicit authorization.

## Browser behavior

- Speech and sound playback occur in the browser that owns the output device. Account for the browser's required user gesture before autoplay.
- Treat browser voice availability and selected audio output as client-specific state.
- Reconnect must restore a server snapshot before applying live deltas; do not claim Socket.IO automatically restores missed history.
- A full installable PWA is a future product requirement. Keep app-shell, audio, and TTS-model caches separate so media caching can evolve without caching authenticated API responses or silently replacing an active LIVE page.
- For browser audio caching work, follow `.agents/skills/browser-audio-cache/SKILL.md` and its versioned content-identity contract.

## Verification and deployment

- Keep type checking, unit tests, integration tests, builds, Compose validation, and a browser smoke test as separate evidence.
- Use sanitized fixtures for ordinary TikTok tests. A real LIVE session is a separate, explicitly identified integration check.
- Before production deployment, inspect live VM/Caddy state, back up affected configuration and PostgreSQL data, validate the resolved Compose model, apply the smallest change, and verify health, logs, WebSocket flow, browser audio, and the public route.
- Never print a fully rendered configuration when it could expose secrets; prefer `docker compose config --quiet` and targeted inspection.
