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

The administrator-only browser loader is implemented, but its same-origin `/tts-assets/voices/` packages are not published yet. It downloads only after an explicit click, refuses to run during an active live session, verifies the recorded byte size and SHA-256, and writes only verified bytes to the separate `tiktok-helper-tts-models-v1` cache. Authorization responses, chat, workspace data and user audio are never stored there.

The current loader uses the pinned upstream archives as a transport/integrity checkpoint. It is not yet an inference engine: unpacking into the Sherpa virtual filesystem, the shared phonemizer/runtime package and Worker benchmark remain the next stage. Until that stage passes, the existing browser `speechSynthesis` path remains unchanged.

## Licenses

- Sherpa-ONNX runtime: Apache-2.0.
- Voice repository metadata is marked MIT, while each voice model card also records its training dataset provenance and license. Preserve both model cards and the applicable notices when assets are published.
