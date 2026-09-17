# Verification checklist

Report each layer separately. A unit test does not prove persistent browser caching, and a cache entry does not prove audible playback.

## Contract and unit checks

- Type checking covers content hash, byte size, MIME type, and status.
- Invalid hash, cross-origin URL, redirect, non-200/partial response, and oversized response are rejected.
- Concurrent loads of one identity produce one fetch/decode operation.
- A changed hash creates a new identity; the old response is not overwritten.
- LRU removes only entries owned by the TikTokHelper audio cache.
- Quarantine/deletion makes an existing cached sound ineligible immediately.
- Cache/decode failure exercises the existing media-element fallback.

## Browser integration checks

- First playback downloads once and becomes audible after the explicit activation gesture.
- A second playback uses the persistent response and the decoded buffer without another media download.
- Reload proves persistent cache reuse while requiring whatever audio activation the browser enforces.
- Offline simulation plays a warmed sound and fails gracefully for an unwarmed sound.
- Updating the hash downloads the new bytes and stops selecting the old identity.
- Cache progress, quota failure, and fallback state remain usable at a 320 px viewport.
- Two tabs preserve single audio ownership.
- Console, network panel, and application storage show no cached auth/workspace/chat responses.

## Required browser matrix

Automate Chromium coverage, then perform manual checks when devices are available:

- Chrome or Chromium desktop;
- Firefox desktop;
- Safari macOS;
- Safari iPhone/iPad installed and ordinary-tab modes;
- one Android Chromium-family browser;
- Yandex Browser on the user's actual platform.

Do not mark unavailable manual devices as passed. Record them as pending.

## Future PWA checks

When a service worker is introduced, add:

- first install and second load;
- update waiting/activation flow during an active LIVE;
- rollback from a bad app-shell release;
- app-shell update without losing the audio/model caches;
- Safari home-screen storage behavior;
- auth redirect and logout with the service worker active;
- proof that API and personalized responses are network-only/no-store.

