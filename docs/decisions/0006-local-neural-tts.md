# ADR-0006: Prototype local neural TTS with Sherpa-ONNX Web

## Status

Accepted as an administrator-only experimental pilot; not used by the live chat queue

## Date

2026-09-18

## Context

TikTokHelper currently uses the browser `speechSynthesis` API. It is lightweight and remains the broadest fallback, but installed voices and voice quality differ between operating systems and browsers. The desired optional replacement must generate speech in the operator's browser, avoid server inference cost, keep the live UI responsive, and survive normal PWA reloads without downloading a model again.

The first proposed estimate of a 20–40 MB total download is not a safe planning assumption. Official Russian Piper medium archives published by Sherpa-ONNX are about 67 MB in full precision, 36 MB in fp16 and 21 MB in int8 before adding the WebAssembly runtime and phonemizer data. The official Sherpa browser build documentation shows an example with an approximately 11 MB Wasm binary and a model/data bundle whose total depends on the selected voice.

## Decision

- Use Sherpa-ONNX Web as the first experimental runtime because its upstream project publishes a browser WebAssembly TTS implementation and a Worker-based reference implementation.
- Provide an opt-in comparison catalogue of Piper-derived VITS medium-int8 voices. Russian: Irina, Denis, Dmitri and Ruslan. English: Lessac, Amy, HFC Female and HFC Male. Keep separate selected defaults for Russian and English.
- Keep inference entirely inside a dedicated Web Worker. Transfer generated `Float32Array` samples back to the main thread and play them through the existing unlocked `AudioContext`.
- Keep `speechSynthesis` as the default and automatic fallback until real desktop and mobile measurements pass.
- Never download a model automatically on page load or when a LIVE starts. An administrator must explicitly opt into the experiment and confirm the first download size.
- Store immutable runtime/model assets in a separate `tiktok-helper-tts-models-v1` cache. Model metadata must contain an exact version, byte size, SHA-256 and license; partial downloads must not replace a verified cached model.
- Do not store generated speech, chat text, usernames, authorization data or API responses in the model cache.
- Do not require WebGPU. The first prototype targets Wasm SIMD; WebGPU may be evaluated later as an optional acceleration path.
- Do not publish the model/runtime in the normal application bundle until license notices, integrity verification, cancellation and memory limits are implemented.

The pinned runtime and voice archives are assembled outside the repository, hashed and deployed as an administrator-only pilot. The packages remain outside Git and are mounted read-only at runtime. Their route requires a current global-administrator session, while the browser still verifies every file before moving it from staging into the separate TTS cache. Packages are installed individually so a device need not retain the complete catalogue. The exact experimental inventory is recorded in `tools/tts/assets-manifest.json`.

## Why not Piper directly in the browser

The current Open Home Foundation Piper project is a maintained local TTS engine with Python, HTTP and C/C++ interfaces, but its official documentation does not provide an equivalent supported browser/WebAssembly integration. Building and maintaining a private browser port would add toolchain and lifecycle risk without improving the selected Piper-derived voices, which Sherpa already runs.

## Licensing

- Sherpa-ONNX code is Apache-2.0.
- The current Piper engine repository is GPL-3.0, but the experiment does not embed that engine.
- Voice licenses are independent of the runtime. The selected `rhasspy/piper-voices` repository and Russian candidate model are marked MIT; the exact model card and notice must ship with downloaded assets.

## Promotion gates

The experiment cannot become the default until all of the following are recorded:

1. Exact first-download and persistent-cache sizes.
2. Initialization time, synthesis time, audio duration and real-time factor for fixed Russian phrases.
3. Peak browser memory or the closest repeatable browser measurement available.
4. Cancellation and queue behavior while a LIVE is active.
5. Chromium desktop, Firefox desktop, Safari macOS, iPhone/iPad Safari or installed PWA, Android Chromium and Yandex Browser results.
6. Subjective comparison of pronunciation and intelligibility against each target platform's system voice.
7. Graceful fallback to `speechSynthesis` after unsupported Wasm, quota, integrity, initialization or inference failure.

## TikFinity comparison

TikFinity's public documentation confirms two voice classes: free standard voices with speed, pitch and volume controls, and premium AI voices with a credit budget. It also describes the desktop implementation as browser-based. The public docs and the developer's public repositories do not identify the underlying standard or premium TTS provider/model, so this project must not claim that TikFinity uses Piper, Sherpa-ONNX, ElevenLabs or any other specific engine without further primary evidence.

## Sources

- Sherpa-ONNX browser TTS build: https://k2-fsa.github.io/sherpa/onnx/tts/wasm/build.html
- Sherpa-ONNX Worker reference: https://github.com/k2-fsa/sherpa-onnx/blob/master/wasm/tts/sherpa-onnx-tts.worker.js
- Sherpa-ONNX Russian model catalogue: https://k2-fsa.github.io/sherpa/onnx/tts/all/Russian/vits-piper-ru_RU-irina-medium.html
- Piper project: https://github.com/OHF-Voice/piper1-gpl
- Russian Piper voices: https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU
- English Lessac voice and dataset provenance: https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD
- TikFinity public TTS guide: https://blog.tikfinity.com/tikfinity-mobile-text-to-speech/
- TikFinity public FAQ: https://github.com/zerodytrash/TikFinity-Public-Docs/blob/main/faq-en.md
