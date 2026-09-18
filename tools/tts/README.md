# Experimental local TTS assets

The files in this directory describe a reproducible, unpublished browser TTS experiment. Large runtime/model binaries are deliberately not committed to Git and are not part of the production image.

## Pinned inputs

- Sherpa-ONNX tag `v1.13.8`, commit `11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf`.
- Emscripten `4.0.23`, as required by the upstream build script.
- Russian `vits-piper-ru_RU-irina-medium-int8` voice archive.
- English `vits-piper-en_US-lessac-medium-int8` voice archive.

Exact sizes and hashes are in `assets-manifest.json`. Treat a mismatch as a failed build/download; never update a hash merely to make a failing check pass.

## Runtime build

Follow upstream `build-wasm-simd-web.sh` with the pinned source and toolchain. It produces one model-independent runtime:

```text
sherpa-onnx-wasm-web.js
sherpa-onnx-wasm-web.wasm
```

Sherpa-ONNX v1.13.8 has a Windows-only quoting incompatibility in `wasm/web/CMakeLists.txt`. When reproducing the recorded Windows build, change only:

```cmake
string(APPEND MY_FLAGS " -s 'EXPORT_NAME=\"SherpaOnnx\"' ")
```

to:

```cmake
string(APPEND MY_FLAGS " -sEXPORT_NAME=SherpaOnnx ")
```

Do not carry this compatibility patch into application code. Linux builds using the unmodified upstream script remain preferred.

## Packaging boundary

The two official archives contain identical 355-file `espeak-ng-data` trees. Publish/cache that tree once, then keep each ONNX model and token file separate. The expected unpacked payload before HTTP compression is approximately:

- 15.22 MB runtime JS + Wasm;
- 17.99 MB shared phonemizer data;
- 18.58 MB Russian model plus metadata;
- 18.59 MB English model plus metadata.

The administrator-only browser loader and same-origin `/tts-assets/voices/` packages are deployed as an experimental pilot. Both the panel and the package route require a global administrator; unauthenticated and ordinary-user requests are rejected by the server. Download starts only after an explicit click, is refused during an active live session, stages all five files, verifies their recorded byte sizes and SHA-256 values, and only then writes them to the separate `tiktok-helper-tts-models-v1` cache. Authorization responses, chat, workspace data and user audio are never stored there.

Local browser-ready packages were built with upstream's `--preload-file assets@.` layout and benchmarked through the upstream Worker protocol. Exact outputs and desktop measurements are recorded in `assets-manifest.json` and `docs/neural-tts-benchmark.md`. The existing browser `speechSynthesis` path remains the production default until real-device quality checks pass.

## Licenses

- Sherpa-ONNX runtime: Apache-2.0.
- Voice repository metadata is marked MIT, while each voice model card also records its training dataset provenance and license. Preserve both model cards and the applicable notices when assets are published.
