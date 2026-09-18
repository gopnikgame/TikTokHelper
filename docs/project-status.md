# Project status and next steps

Status date: 2026-09-18
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

The current branch passes 112 database-independent repository tests plus 3 PostgreSQL integration tests when `TEST_DATABASE_URL` is provided. The latest responsive release was inspected at representative viewport sizes from 280 px to 2560 px wide. Production Chromium previously verified persistent reuse of all enabled mapped sounds with the network disabled; details and the deliberately deferred browser matrix are in [audio-cache-verification.md](audio-cache-verification.md).

Automated coverage currently includes:

- HTTP and Socket.IO validation, authorization, replay/reconnect and duplicate-command behavior;
- TikTok session lifecycle and normalized chat/gift fixtures;
- sound permissions, upload validation, quarantine rules and workspace mappings;
- automation CRUD, template validation, speech policy and bounded playback queues;
- audio-cache identity, integrity, eviction, in-flight deduplication and playback fallback;
- responsive layout inspection and exact-revision source-link construction.

## Open work that does not require a real LIVE

### 1. Deterministic browser event source — implemented

The test-only scripted source is isolated behind the connector-factory boundary and has no production runtime switch. It emits sanitized chat, emoji, gift, streak, reconnect, moderator and supporter-level events through the same normalizer, session manager and Socket.IO contracts as the real adapter. The repeatable workflow and current Chromium evidence are documented in [browser-workflow-harness.md](browser-workflow-harness.md).

The current harness and focused integration tests cover:

- initial load and audio activation;
- snapshot followed by live deltas;
- reload/reconnect without a second connector;
- chat emoji and gift rendering;
- single gifts, cumulative streaks and duplicate suppression;
- supporter threshold announcements and moderator speech;
- speech cooldown, queue limits and stop/clear;
- sound overlap, fallback and single-tab ownership;
- a representative mobile viewport; the broader responsive matrix remains covered by the separate responsive inspection.

### 2. Supporter-accounting edge cases — implemented

PostgreSQL integration tests now cover duplicate events, concurrent updates, multiple crossed levels, username changes with stable identity, and separation of current-stream and lifetime totals. The database-backed suite is explicitly enabled with `TEST_DATABASE_URL`; ordinary verification remains independent of a running database. The first complete run used a disposable PostgreSQL 18.1 container bound only to VM loopback and removed immediately afterwards.

### 3. Restore rehearsal — implemented

A production-format PostgreSQL dump and media archive were restored into disposable volumes on an internal Docker network with no published ports. Aggregate users, workspaces, memberships, mappings, automation rules and supporter-state counts matched production; the restored application started from the deployed image and passed readiness. Temporary resources were removed and the production containers remained healthy. Evidence and the deliberately retained empty-media limitation are documented in [restore-rehearsal.md](restore-rehearsal.md).

### 4. First installable-PWA phase — implemented

The application now has a manifest, install icons, a static offline explanation and a conservative Service Worker. App-shell, audio and future TTS-model caches remain separate; authenticated APIs, navigation state, chat, participants and live events are network-only. New versions remain waiting and require an explicit operator action, which is disabled while a LIVE is connecting, active or reconnecting. Architecture and Chromium evidence are recorded in [pwa.md](pwa.md); the real-device install matrix remains deferred.

### 5. Local neural TTS experiment — administrator-only pilot deployed

The source review selected Sherpa-ONNX Web for an administrator-only experiment: upstream provides browser Wasm TTS and a Worker reference, while the maintained Piper project does not document an equivalent supported browser integration. Four Russian voices (Irina, Denis, Dmitri and Ruslan) and four English voices (Lessac, Amy, HFC Female and HFC Male) can be installed individually and selected per language. The binary packages are mounted outside Git and their HTTP route requires a current global-administrator session. Only the Irina and Lessac baselines have desktop Chromium measurements; browser `speechSynthesis` remains the production default and fallback. Real-device quality and compatibility checks remain pending; see [ADR-0006](decisions/0006-local-neural-tts.md) and [the benchmark plan](neural-tts-benchmark.md).

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
3. Isolated database/media restore rehearsal (completed; repeat media verification after the first real upload).
4. Conservative PWA shell and update UX (implemented; real-device installation remains pending).
5. Add the verified Russian/English asset loader and run the first desktop Chromium benchmark.
6. Deferred real-device and real-LIVE acceptance matrix.
