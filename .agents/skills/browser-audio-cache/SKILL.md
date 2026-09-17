---
name: browser-audio-cache
description: Design, implement, or review TikTokHelper browser caching and playback of gift sounds, reaction sounds, and future on-device TTS models. Use for Cache API, AudioBuffer reuse, media preloading, cache invalidation, storage quotas, or the future PWA service worker; do not use for ordinary server/database caching.
---

# TikTokHelper browser audio cache

Keep the server authoritative for the sound catalogue, ownership, quarantine state, mappings, and automation rules. The browser cache is disposable acceleration for public media bytes, never a source of business truth.

## Required workflow

1. Inspect the installed browser stack and the current sound contracts, URLs, response headers, playback queue, and `sound-library:changed` event before changing code.
2. Read [references/cache-contract.md](references/cache-contract.md) before changing cache keys, API fields, cache names, or invalidation.
3. Read [references/browser-fallbacks.md](references/browser-fallbacks.md) when changing audio decoding, storage behavior, Safari support, service workers, or future neural TTS assets.
4. Read [references/verification.md](references/verification.md) before declaring an audio-cache change complete.
5. Prefer a small additive phase. Do not turn TikTokHelper into an offline-first data application merely to cache immutable media.

## Invariants

- Cache only explicitly selected same-origin media assets. Never cache authentication, session, workspace API, chat, TikTok events, HTML navigation responses, or personalized JSON in the audio/model caches.
- Version persistent entries by content identity, not display name. The target identity is `asset id + SHA-256`; a changed hash is a new version.
- Keep persistent Cache Storage separate from the in-memory decoded `AudioBuffer` store. Cache Storage avoids downloads; the decoded store avoids repeated decoding.
- Warm only sounds reachable from enabled gift mappings, support levels, and event reactions. Do not download the full shared library automatically.
- Start optional warming only after the user enables audio. Preserve the required user gesture for `AudioContext.resume()`.
- Treat caching as best effort. Quota pressure, private browsing, or browser eviction must fall back to the network without breaking chat or gift display.
- Use bounded concurrency and storage. Do not start an unbounded download for every mapping or retain every decoded sound indefinitely.
- A quarantine or deletion event must prevent new playback immediately. Cached bytes may be removed asynchronously, but must not remain addressable by active rules.
- Do not register a service worker only to implement the first audio-cache phase. The first phase may use `window.caches`; preserve cache names and keys so a future PWA service worker can adopt them.
- When a service worker is introduced, keep app-shell, audio, and TTS-model caches separate and use an explicit update flow. Do not let a media cache control document navigation.
- Preserve the existing `<audio>` network fallback for formats or browsers that cannot decode a cached response with Web Audio.

## Preferred component boundary

- `asset-cache`: persistent full-response storage and exact-version lookup.
- `buffer-store`: bounded in-memory decoded buffers keyed by asset id and hash.
- `preloader`: resolves enabled assets and warms them with limited concurrency.
- `playback`: consumes a decoded buffer when available and falls back to the existing media-element path.
- `compatibility`: capability and quota checks without user-agent sniffing.

Do not merge these responsibilities into React components. React should observe status and issue user actions; cache and playback modules own browser APIs.

## Primary references

- Workbox cached media guidance: https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video
- MDN Cache API: https://developer.mozilla.org/docs/Web/API/Cache
- MDN storage quotas and eviction: https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- ONNX Runtime Web deployment and model caching: https://onnxruntime.ai/docs/tutorials/web/deploy.html

