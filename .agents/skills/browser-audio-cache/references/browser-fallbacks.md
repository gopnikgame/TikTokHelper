# Browser and future PWA fallbacks

## Capability order

Detect capabilities, not browser names:

1. Web Audio plus Cache Storage: managed cache and decoded buffer playback.
2. Web Audio without Cache Storage: network fetch and bounded in-memory decoded buffers.
3. Media element playback: current `<audio src>` path.
4. If playback is blocked, retain the event visually and show a recoverable audio notice.

User-agent sniffing may be used only for diagnostics, never to select the primary execution path.

## Audio formats

Uploaded WAV, MP3, OGG, and M4A files are not guaranteed to decode in every target browser. Treat successful upload validation as server safety validation, not proof of browser decode compatibility.

When `decodeAudioData()` fails:

- do not delete or quarantine the asset automatically;
- try the existing media-element fallback;
- identify the unsupported format in local diagnostics without logging user content or signed URLs;
- keep chat and stream processing operational.

## Autoplay and lifecycle

- Create or resume `AudioContext` inside the existing explicit **Enable sound** action.
- Page reload, browser restart, background suspension, and installed-PWA relaunch may require activation again.
- Keep multi-tab audio ownership. A cache hit does not grant a second tab playback ownership.
- Expect timers and workers to be throttled in background tabs; do not use them as the source of gift counts or entitlement truth.

## Storage

Cache Storage and IndexedDB can be unavailable, quota-limited, or evicted. Private browsing may behave differently. Always handle rejected cache operations and zero/unknown quota.

Do not request persistent storage automatically. If a future PWA benefits from `navigator.storage.persist()`, expose it as a user-understandable optional action after measuring actual eviction.

## Future service worker

The future PWA may adopt `tiktok-helper-audio-v1`, but its first activation must not delete or rename that cache. The service worker should:

- bypass authentication and workspace APIs;
- keep navigation/app-shell strategy independent from media;
- serve only exact canonical audio keys from the audio cache;
- understand Range requests before intercepting `<audio>` requests;
- use an explicit update-ready UI rather than silently replacing a working live-session page;
- retain network fallback for uncached media.

If playback has moved fully to `fetch` + `AudioBuffer`, do not intercept audio requests merely because Workbox supports it. Add interception only for a demonstrated requirement such as offline media-element fallback or seeking.

## Future neural TTS

- Store runtimes and voice models in `tiktok-helper-tts-models-v1`, not the audio-effects cache.
- A model is installed only after an explicit user action showing language, download size, and licence.
- Key model files by model id, release/version, and content hash.
- Keep WASM as the compatibility baseline; optional WebGPU is capability-gated.
- Generation runs outside the React/main UI path, normally in a Worker.
- Model-cache failure falls back to the configured system speech engine; it must not block gift sounds.

