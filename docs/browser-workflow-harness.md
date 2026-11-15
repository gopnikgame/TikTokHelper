# Deterministic browser workflow harness

The browser harness exercises the operator UI without a TikTok account or network connection to TikTok. It is a development-only composition in `apps/server/test/browser-harness.ts` and uses `ScriptedConnector` from the test tree.

## Safety boundary

- The harness is outside `apps/server/src` and is excluded from the production TypeScript build.
- Production startup imports only `createTikTokConnector`; there is no environment variable, HTTP endpoint or UI control that selects the scripted source.
- The harness binds to `127.0.0.1:4177` by default and uses sanitized deterministic fixtures.
- The harness contains no production credentials, cookies, database connection or uploaded media.
- `POST /fixture/expire-access` changes only in-memory fixture state. An active LIVE session remains
  connected, `/api/auth/access` reports `subscription_expired`, and the next `live:connect` is denied.
  Reload after the transition to exercise the same initial check used by the ten-minute browser poll.

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

## Gift streaks and recovery

Set `BROWSER_HARNESS_GIFT_REPLAY=1` before starting the local harness. The script sends a historical gift at count 3, two interleaved series from the same sender, a late lower count and a duplicate final packet. The next connection to the same room sends historical updates and two further gifts. Expect five gift rows of `Rose ×1`. With the browser transport interrupted after the first three rows, the fourth gift returns in the snapshot silently. The fifth gift plays once after the snapshot. Reload the page and enable sound to check that the five visible rows and the recovered chat remain silent.

## Reactions on gift completion

Start the harness with `BROWSER_HARNESS_GIFT_RULES=1` to use a fixture administrator and an enabled Rose rule at 300 points. Each Rose is worth 100 points. In «Озвучивание чата и реакции» open «Проверить правило» on «Спасибо за розы». Two gifts show a skipped reaction. Three give one thank-you. Checking «Правило только что сработало» at the same quantity shows the cooldown. A rule set to «Любой подарок» can also use the demo gift before the catalog has entries.

Connect the fixture stream after enabling sound. The ordinary saved mapping receives increments `1` and `2`. The final packet sends one live-only completion at count `3` and the repeat sends none. The buffer restored after a browser reload contains the gift increments. To test audible output, perform the same check on the actual device and selected output.

## Gift goal and donor statistics

Start the local harness with `BROWSER_HARNESS_GIFT_GOAL=1`. Open «Настроить цель», select Rose, set the target to 2, choose a sound and enable the goal. The scripted stream adds 1 and then 2 Roses. The card shows `3 из 2` and one goal achievement. The last donor sent the increment of 2 and ranks first with 300 points. The ordinary mapping launches three separate sounds. The achievement adds one more sound.

Reload while the scripted stream is connected. The status snapshot restores the count and the ranking silently. Automatic upstream reconnect to the same connection preserves the numbers. Stopping keeps the result visible and starting again opens a fresh count. The separate HTTP and Socket.IO tests exercise workspace isolation. The fixture stores configuration only in its own process. Production saves configuration in PostgreSQL and keeps the current connection's progress and ranking in server memory.

## LIVE activity and like goal

Start the harness with `BROWSER_HARNESS_LIVE_ACTIVITY=1`, then set a goal of 25 new likes. The first live room total is 120 and the card shows `0 из 25`. TikTokHelper's own online counter is separate from the 81 viewers in the fixture room. The next total of 157 gives `37 из 25`. A delayed total of 149 and another packet at 157 have no effect. In «Подписки и репосты», the duplicate share appears once.

During the first room's scripted reconnect, the viewer counter is unavailable. The like total and goal baseline stay visible. The recovered connection gives 73 viewers and 176 likes, so the progress is `56 из 25`. Reload restores those numbers. Changing the target in the current LIVE starts from 176. After stopping and starting the next room, 50 becomes the new baseline and recent social actions are cleared. «Только эфир» keeps the metrics and goal visible above the chat.

The installed `tiktok-live-connector` 2.5.0 decoded the viewer and like aggregates as `total` on distinct v3 message types in two public read-only probes. In about 90 seconds each, the two streams produced 41 and 46 room-statistic packets and 61 and 38 like packets. The first produced 4 shares and the second produced 9 follows. Some like totals arrived lower than the preceding packet. The goal therefore keeps the highest received room total, while the viewer counter uses the latest reading. Source packets can be incomplete. The probes retained counts and field presence only. [Connector v2.5.0 events](https://github.com/zerodytrash/TikTok-Live-Connector/blob/v2.5.0/README.md#roomuser)

## Audio profiles

Start the harness with `BROWSER_HARNESS_AUDIO_PROFILES=1`, enable sound and connect the fixture stream. The fixture waits for you to send each event.

```powershell
$eventUrl = 'http://127.0.0.1:4177/fixture/audio-profile-event'
Invoke-RestMethod -Uri $eventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"gift"}'
Invoke-RestMethod -Uri $eventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"chat"}'
```

Each gift request sends a new series of three Roses. Each chat request sends a new moderator message. Switch between «Обычный» and «Тихий» during the stream. Responses should keep the same connection ID, generation and connector number. The fixture WAV is silent. The browser test checks Web Audio gain and the parameters passed to speech synthesis. Audible output needs a device check.

## Live chat polls

Start the harness with `BROWSER_HARNESS_LIVE_POLLS=1`. Connect the fixture stream from «Тестовый эфир» and start a poll with two or more options.

```powershell
$pollEventUrl = 'http://127.0.0.1:4177/fixture/live-poll-event'
Invoke-RestMethod -Uri $pollEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"chat","viewer":1,"message":"!1"}'
Invoke-RestMethod -Uri $pollEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"chat","viewer":1,"message":"!2"}'
Invoke-RestMethod -Uri $pollEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"chat","viewer":2,"message":"!2"}'
Invoke-RestMethod -Uri $pollEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"reconnect"}'
```

The first two options should have one vote each. Reconnecting to the same room and reloading the browser should restore both counts. The client recovers counts from the current server snapshot. [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)

Finish the poll in «Только эфир» and confirm that the last result stays visible. A new poll can accept votes from the same two viewers again. Switch to «Другое тестовое рабочее место» and confirm that the first workspace's poll disappears even if the new socket is unavailable. The fixture uses only synthetic messages.

## Stream widgets

Start the harness with `BROWSER_HARNESS_GIFT_GOAL_OVERLAY=1`. In «Виджеты для OBS и LIVE Studio», select «Вид виджета», create its link, and copy it into a separate browser context. Each widget has its own link. The page stays transparent until the fixture stream is connected and the widget has data.

For «Цель по подаркам», enable a goal of three Roses in the dashboard and send these fixture events.

```powershell
$overlayEventUrl = 'http://127.0.0.1:4177/fixture/gift-goal-overlay-event'
Invoke-RestMethod -Uri $overlayEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"gift","count":2}'
Invoke-RestMethod -Uri $overlayEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"duplicate"}'
Invoke-RestMethod -Uri $overlayEventUrl -Method Post -ContentType 'application/json' -Body '{"kind":"gift","count":1}'
```

Expect one card and progress from zero to two, then three. The duplicate leaves the count at two. Reload keeps the current result. Stopping the stream hides the card and the next stream starts at zero. Revoke the link and confirm that the already open source becomes transparent on its next check. Reissuing a link requires updating the source URL.

For «Последний подарок», open its link and send a fresh gift with `{"kind":"gift","count":2}`. The card shows `×2` and disappears eight seconds after the completed gift. Repeat with `{"kind":"duplicate"}` during that interval to check that the duplicate does not extend it.

For «Цель по лайкам», save a goal of 100 before sending `{"kind":"likes","count":120}` and then `{"kind":"likes","count":180}` to `$overlayEventUrl`. The first total establishes the baseline, and the next shows 60 out of 100.

For «Голосование», create a poll in the dashboard. Send `{"kind":"chat","viewer":1,"message":"!1"}` to `/fixture/live-poll-event`, then close the poll. The public card shows the vote and keeps the results for the current stream. Revoke one link and confirm the other widgets remain accessible.

For an OBS preview, paste each link into a Browser Source. A 480 × 220 source fits the gift goal card. Increase the source height for polls with more answers. [OBS Browser Source](https://obsproject.com/kb/browser-source)

## Workspace member access

With `BROWSER_HARNESS_WORKSPACE_MEMBERS=1`, use separate browser contexts with the fixture cookie `fixture-member=one` or `fixture-member=two`. Both accounts are ordinary users and own separate workspaces. The gift, like and poll fixtures above are available to exercise the first workspace. The audio-profile fixture can emit a moderator chat message for the «Только эфир» view.

Check that each user can configure their own goals and create widget links. Open a poll for the first user, cast a fixture vote and confirm the second user's panel still offers to start a poll. Request the first user's workspace routes with the second user's cookie and expect HTTP 403. Use a context with no fixture cookie for a read-only widget and expect HTTP 401 on operator routes.
