# Deterministic browser workflow harness

The browser harness exercises the operator UI without a TikTok account or network connection to TikTok. It is a development-only composition in `apps/server/test/browser-harness.ts` and uses `ScriptedConnector` from the test tree.

## Safety boundary

- The harness is outside `apps/server/src` and is excluded from the production TypeScript build.
- Production startup imports only `createTikTokConnector`; there is no environment variable, HTTP endpoint or UI control that selects the scripted source.
- The harness binds to `127.0.0.1:4177` by default and uses sanitized deterministic fixtures.
- The harness contains no production credentials, cookies, database connection or uploaded media.

## Run

Build the browser application, then start the local harness:

```powershell
pnpm --filter @tiktok-helper/web run build
pnpm --filter @tiktok-helper/server run browser:harness
```

Open `http://127.0.0.1:4177` with Playwright CLI in another terminal:

```powershell
npx --yes --package @playwright/cli playwright-cli --session tiktok-fixture open http://127.0.0.1:4177
npx --yes --package @playwright/cli playwright-cli --session tiktok-fixture snapshot
```

Use the current snapshot refs to enable audio and connect the fixture stream. Re-snapshot after the scripted reconnect, then reload and take another snapshot. Refs are deliberately not recorded here because Playwright regenerates them for every page state.

## Scripted scenario

The first connector instance emits:

1. a Russian moderator chat message containing a TikTok-style emote image;
2. a cumulative Rose streak with counts `1 → 3 → final 3`;
3. a duplicate final gift event;
4. a message from an entitled gift giver;
5. a controlled disconnect.

The second connector emits a unique recovery message after the normal one-second reconnect delay. The expected UI contains two gift increments (`×1` and `×2`), not cumulative duplicates, and three chat messages including the recovery message.

## Verified Chromium behavior — 2026-09-17

- workspace fixtures and local session loaded;
- audio gesture unlocked Web Audio and prepared one SHA-256-addressed sound;
- emote image and chat text rendered together;
- cumulative gift streak rendered as increments `1` and `2`;
- duplicate final gift was suppressed;
- reconnect returned to `В эфире` and rendered the recovery message;
- page reload restored five recent chat/gift events from the server snapshot;
- reload did not create another connector in the server integration test;
- enabling audio in a second same-origin tab disabled audio in the first tab;
- the 390 × 844 viewport had a usable single-column layout;
- the browser console contained no errors or warnings during the completed scenario.

Audible output and platform voice quality are not asserted by this harness. Those remain part of the deferred real-device matrix in [project-status.md](project-status.md).
