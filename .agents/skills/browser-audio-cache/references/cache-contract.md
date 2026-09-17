# Audio cache contract

## Scope

This contract covers gift sounds, event-reaction sounds, support-level sounds, and future downloadable TTS runtime/model assets. It does not make live streams or workspace configuration available offline.

## Catalogue fields

Before persistent application-managed caching is enabled, every cacheable sound returned to the browser must expose:

```ts
interface CacheableSoundAsset {
  id: string;
  url: string;
  contentSha256: string;
  byteSize: number;
  mimeType: string;
  status: 'active' | 'quarantined';
}
```

`contentSha256` is lowercase hexadecimal over the served bytes. `byteSize` is the served representation size. Both are server-derived and must not be trusted from upload metadata supplied by a browser.

Built-in and uploaded sounds follow the same contract. Do not enable managed caching while active legacy rows still lack content identity; backfill hashes and sizes first.

## Namespaces

Use stable purpose-specific names:

```text
tiktok-helper-audio-v1
tiktok-helper-tts-models-v1
tiktok-helper-app-shell-v1   # reserved for the future PWA
```

Changing a cache schema increments only that cache's suffix. Never call `caches.keys()` and delete unrelated origin caches.

## Cache key

The canonical key is a same-origin GET URL containing immutable content identity:

```text
<asset-url>?sha256=<64-lowercase-hex>
```

If the URL already has a query string, append the parameter without removing existing parameters. Reject non-HTTPS/non-localhost and cross-origin URLs from managed caching.

The network request and `cache.put()` must use the same canonical request. Store only complete successful responses (`200`), never partial `206` responses, redirects, opaque responses, or error bodies.

## Warm set

The warm set is the union of active sounds referenced by:

- enabled gift mappings;
- enabled support levels;
- enabled event reactions.

Deduplicate by `id + contentSha256`. Warm only after audio has been enabled by a user gesture. Use a small configurable concurrency limit and expose progress without blocking connection to a TikTok LIVE.

## Read behavior

1. Check the in-memory decoded store by `id + contentSha256`.
2. Check `tiktok-helper-audio-v1` for the canonical request.
3. Fetch the canonical request from the network if absent.
4. Validate status, content length when available, configured maximum size, and optionally the downloaded SHA-256 before storing.
5. Decode a cloned response with `AudioContext.decodeAudioData()`.
6. On cache or decode failure, fall back to the existing `<audio src>` path and report a non-fatal diagnostic state.

Concurrent requests for the same identity share one in-flight promise.

## Invalidation

`sound-library:changed` is a hint to refresh the sound catalogue, not sufficient proof of a new asset version.

After refresh:

- a new hash creates a new canonical key;
- quarantined/deleted/unreferenced assets stop being eligible for playback immediately;
- stale persistent entries can be pruned in the background;
- decoded entries for the old identity are removed when no active playback owns them.

Never replace an existing response under the same hash. A hash collision or server mismatch is an integrity failure and must not silently overwrite content.

## Limits and eviction

The cache is an optimization. Use `navigator.storage.estimate()` when available and enforce an application budget below reported quota. Maintain lightweight last-used metadata; evict least-recently-used unreferenced assets first.

Do not claim offline permanence. Browsers may evict Cache Storage. A missing entry is a normal cache miss.

## Privacy boundary

Allowed:

- same-origin public sound bytes;
- public WASM/runtime assets;
- explicitly selected distributable TTS model bytes;
- non-sensitive cache metadata such as hash, size, and last-used time.

Forbidden:

- `/api/auth/*`;
- `/api/workspaces/*` JSON;
- cookies, authorization headers, user/profile data;
- chat messages or TikTok participant data;
- live-event payloads;
- HTML navigation responses in audio/model caches.

