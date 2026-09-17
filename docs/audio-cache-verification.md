# Browser audio cache verification

## Automated production check — 2026-09-17

Revision: `9a343e5`

Chromium was exercised against `https://tiktok.vpnline.online/` using the real production catalogue and local trusted access:

- enabling audio warmed exactly 17 sounds reachable from enabled gift mappings;
- Cache Storage contained only `tiktok-helper-audio-v1` with 17 versioned media entries;
- no cached key referenced `/api/`, navigation, or an unversioned media URL;
- after a page reload, the network was disabled before audio activation;
- all 17 sounds decoded from persistent Cache Storage with zero SHA-versioned network requests;
- offline **Preview sound** started through Web Audio with zero media network requests;
- the early-click race found during testing was fixed by disabling activation until workspace configuration is loaded;
- cached Web Audio activation no longer depends on successful HTMLAudio network warm-up.

The deliberate offline portion produced expected failed WebSocket and HTMLAudio fallback diagnostics. The application returned online after each scenario.

## Manual browser matrix

- [ ] Firefox desktop
- [ ] Safari macOS
- [ ] Safari iPhone/iPad, ordinary tab
- [ ] Safari iPhone/iPad, installed PWA mode (after PWA implementation)
- [ ] Android Chromium-family browser
- [ ] Yandex Browser on the user's actual platform

These checks remain pending until the corresponding devices are available. They must confirm activation, preview, gift-series overlap, reload reuse, and graceful fallback for a format the browser cannot decode.
