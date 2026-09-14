# TikTokHelper operator workflows

## Status

Accepted based on Ivan's description and confirmation on 2026-09-14.

## Product purpose

TikTokHelper is a browser companion for a TikTok LIVE stream that is already running on the operator's phone. It does not start the stream, publish video, send chat messages, or control the TikTok account. Its first purpose is to make live chat readable on a larger screen and play configured sounds when gifts arrive.

## Initial operating environment

- The wife starts and conducts the LIVE stream in the TikTok mobile application.
- She opens TikTokHelper in a desktop browser with access to the server hosted on Ivan's Proxmox.
- The browser is the audio output device; it must receive an explicit user gesture before sounds can autoplay.
- The backend owns the TikTok connection so a browser reload does not create a second upstream connection.
- The first release has one operator and one workspace. The data model still scopes configuration by workspace so additional users can be added later.
- The public application must have an access boundary before deployment even if full multi-user authentication is deferred.

## Required first-release workflows

### 1. Connect to an existing LIVE stream

1. The operator starts a stream in the TikTok mobile application.
2. She opens the TikTokHelper dashboard.
3. She enters her TikTok username/ID; the UI accepts a leading `@` but stores a normalized value.
4. She activates browser audio and presses **Connect**.
5. The UI shows `connecting`, then either `live` with room/channel information or a clear `offline`/`failed` result.
6. The backend keeps exactly one connection for this workspace/channel and performs bounded reconnects after transient failures.
7. **Disconnect** stops the upstream connection and cancels automatic reconnect.

The interface must not imply that TikTokHelper starts the actual TikTok stream.

### 2. Read LIVE chat on a large screen

1. After connection, new chat messages appear in a high-contrast, readable feed.
2. Each item shows the sender display name/username, message text, and arrival order. An avatar is optional and must not delay the text.
3. New messages appear without a page refresh and the feed follows the newest messages unless the operator has scrolled up.
4. A visible status distinguishes live data, reconnecting, offline, and stale/disconnected browser state.
5. A short bounded recent buffer may restore context after a page reload; complete long-term chat retention is not required by the described workflow.

### 3. Map a gift to a sound

1. The operator opens sound mappings.
2. She selects a TikTok gift and a sound from the available sound library.
3. She can preview the sound and adjust the browser playback volume.
4. Saving persists the mapping in PostgreSQL.
5. A later gift event resolves the active mapping and sends a playback command only to the browser that currently owns audio playback.
6. An unmapped or unknown gift remains visible but does not produce an error or an arbitrary sound.

### 4. Play gift series correctly

TikTok may send cumulative updates for one streak. TikTokHelper tracks a stable streak identity and the previously observed count.

For an update sequence `1 → 2 → 3`, it schedules one new playback for each increment and produces three playbacks in total, not `1 + 2 + 3 = 6`. Duplicate updates produce no additional playback. Out-of-order or restarted streaks must not reduce the stored count or replay already accounted gifts.

Every newly counted gift remains an individual playback. The default mode uses **controlled overlap**: the next playback may begin shortly before the previous copy finishes, creating a deliberate mild cacophony that encourages viewer engagement without accidentally multiplying the gift count.

Series playback is configurable per workspace:

- playback mode: controlled overlap, sequential queue, or stronger overlap;
- overlap as a percentage of the actual sound duration, rather than a fixed millisecond delay;
- maximum simultaneous sound instances as a browser-safety limit;
- queue/backlog behavior when the safety limit is reached;
- an immediate **Stop sounds / Clear queue** operator action.

The overlap percentage has the same meaning for short and long files: `0%` means strictly sequential playback, `25%` starts the next copy when the final quarter of the current sound begins, and `100%` starts copies together. The initial percentage and concurrency limit must be selected during an operator audio test with representative short and long sounds. The safety limit may delay playback but must not silently count one TikTok gift as more than one sound trigger.

## First-release interface

The first release needs one operator dashboard containing:

- TikTok username/ID field;
- audio activation control;
- connect/disconnect action;
- connection and reconnect status;
- readable live chat feed;
- compact gift/event feed;
- access to gift-to-sound mappings;
- sound preview and playback volume;
- series playback mode, overlap control, and a visible stop/clear-queue action;
- clear browser/server/TikTok error states.

Sound mapping may be a panel or a separate route, but it is part of the same workflow rather than an administrator-only subsystem.

## Deferred, not required for the first release

- Multiple users, invitations, roles, and friend access.
- Authelia/Authentik/OIDC integration beyond preserving an identity boundary.
- Text-to-speech for chat or events.
- OBS browser-source overlays.
- TikTok chat sending, moderation, account login, or stream control.
- Analytics dashboards and permanent storage of all chat/like/member events.
- Redis, multiple backend replicas, and distributed connector ownership.
- Desktop/Electron/C# application packaging.

Deferred features may be promoted only after the operator confirms a real workflow for them.

## Failure and recovery expectations

- If the account is not live, say so without treating it as a server crash.
- If TikTok or the network disconnects, show `reconnecting` and the next bounded attempt.
- Reloading the page obtains a fresh server snapshot before displaying new events.
- A second browser tab must not silently become a second audio player; audio ownership is explicit.
- If a sound cannot play, the gift remains visible and the UI reports the audio problem without breaking chat.
- A slow browser must not create an unbounded server or client queue.

## Data retained in PostgreSQL

- Workspace and future identity association.
- Normalized TikTok channel identifier.
- Gift catalogue metadata needed by mappings.
- Gift-to-sound mappings and their revisions.
- Sound asset metadata and workspace ownership.
- Minimal finalized-gift/idempotency records when needed to prevent duplicate actions.

Chat text, likes, joins, and complete raw TikTok payloads are not retained permanently by default.

## Open product decisions

1. Which tested overlap percentage and maximum concurrency produce the desired mild cacophony for the actual sound library?

## Decisions implemented in the first operator UI

- The short chat buffer survives browser reload/reconnect while the server process remains alive; persistence across application restarts is deferred.
- The existing archived WAV files are the initial sound library. Uploading new files is deferred until the operator needs it.
- Gift events appear in a separate compact column so chat remains the primary reading surface.
- Controlled overlap starts at 25% with at most four simultaneous sounds. These are safe provisional defaults, not final operator-tested values.
