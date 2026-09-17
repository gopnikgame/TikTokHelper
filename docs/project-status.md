# Project status and next steps

Status date: 2026-09-17
Current application branch: `rewrite/typescript`

This document distinguishes shipped behavior from automated evidence and checks that still require a real device or TikTok LIVE. A checked implementation item does not automatically mean that every browser has been manually verified.

## Shipped foundation

- TypeScript workspace with Fastify, React/Vite, shared runtime contracts, PostgreSQL/Drizzle and Docker Compose.
- Isolated `tiktok-live-connector` adapter, normalized project events, bounded reconnect and one upstream connection per workspace.
- Socket.IO snapshot-first recovery, authorized workspace rooms and bounded recent event buffers.
- VLine Auth Bridge login with workspace isolation and trusted local-network access.
- Shared sound library, user uploads, administrator quarantine/deletion and personal gift mappings.
- Gift catalogue discovery with image metadata, gift-series accounting and configurable percentage-based sound overlap.
- Browser-owned playback, single-tab audio ownership and persistent SHA-256-addressed caching of enabled sounds.
- Configurable supporter levels, moderator speech, event reactions, templates, cooldowns and bounded browser speech queues.
- Responsive operator interface and a public source link resolved to the exact deployed Git revision.

## Current automated evidence

The repository verification command covers linting, TypeScript, unit/integration tests and production builds:

```bash
pnpm run verify
```

The latest responsive release passed 110 repository tests and was inspected at representative viewport sizes from 280 px to 2560 px wide. Production Chromium previously verified persistent reuse of all enabled mapped sounds with the network disabled; details and the deliberately deferred browser matrix are in [audio-cache-verification.md](audio-cache-verification.md).

Automated coverage currently includes:

- HTTP and Socket.IO validation, authorization, replay/reconnect and duplicate-command behavior;
- TikTok session lifecycle and normalized chat/gift fixtures;
- sound permissions, upload validation, quarantine rules and workspace mappings;
- automation CRUD, template validation, speech policy and bounded playback queues;
- audio-cache identity, integrity, eviction, in-flight deduplication and playback fallback;
- responsive layout inspection and exact-revision source-link construction.

## Open work that does not require a real LIVE

### 1. Deterministic browser event source

Add a test-only fake source behind an explicit non-production boundary. It must emit sanitized chat, emoji, gift, streak, reconnect, moderator and supporter-level events through the same normalized contracts as the real adapter. It must never be enabled by a public runtime flag in production.

Use it for Playwright scenarios covering:

- initial load and audio activation;
- snapshot followed by live deltas;
- reload/reconnect without a second connector;
- chat emoji and gift rendering;
- single gifts, cumulative streaks and duplicate suppression;
- supporter threshold announcements and moderator speech;
- speech cooldown, queue limits and stop/clear;
- sound overlap, fallback and single-tab ownership;
- the responsive viewport matrix.

### 2. Supporter-accounting edge cases

Complete deterministic tests for duplicate events, concurrent updates, one streak crossing multiple levels, username changes with stable identity, and separation of current-stream and lifetime totals.

### 3. Restore rehearsal

Restore a production-format PostgreSQL dump and media backup into an isolated Compose project. Verify users, workspaces, mappings, rules, uploaded media and application startup without touching the running production volumes.

### 4. First installable-PWA phase

Add a manifest, icons and a conservative service worker only after update behavior is specified. Keep app-shell, audio and future TTS-model caches separate. Never cache authenticated API responses, navigation containing user state, chat, participant data or live events. Do not force-refresh an active LIVE page; offer an explicit update action instead.

### 5. Local neural TTS investigation

Benchmark Piper and Sherpa-ONNX Web in a Worker before selecting either. Record model licenses, first-download size, memory use, start latency and real-time factor on representative desktop and mobile hardware. Keep browser `speechSynthesis` as a fallback until the local model path is proven.

## Explicitly deferred manual checks

These checks require Ivan or the operator to have the corresponding device and a real LIVE available:

- Firefox desktop;
- Safari on macOS;
- Safari on iPhone/iPad in an ordinary tab;
- Safari installed-PWA mode after PWA implementation;
- Android Chromium-family browser;
- Yandex Browser on the actual target platform;
- one moderator message, one newly reached supporter level, one announcement and one event sound;
- short and long gift streaks with the desired overlap setting;
- backgrounding, screen locking and returning to the LIVE page.

For each browser, confirm audio unlock, preview, speech voice selection/fallback, series playback, reload cache reuse and graceful failure for an unsupported media format. Until these checks happen, documentation must not claim complete cross-browser speech or audio compatibility.

## Recommended order

1. Deterministic fake source and Playwright workflow suite.
2. Supporter-accounting concurrency and identity tests.
3. Isolated database/media restore rehearsal.
4. Conservative PWA shell and update UX.
5. Neural TTS benchmark and architecture decision.
6. Deferred real-device and real-LIVE acceptance matrix.
