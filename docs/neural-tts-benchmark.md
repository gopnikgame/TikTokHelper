# Local neural TTS benchmark plan

This document separates verified upstream facts from measurements that still need to be made on TikTokHelper's actual browser integration.

## Source-backed comparison

| Candidate | Official browser path | Worker reference | Russian voices | Runtime license | Decision |
| --- | --- | --- | --- | --- | --- |
| Sherpa-ONNX Web | Yes, WebAssembly TTS | Yes | Piper-derived VITS voices | Apache-2.0 | Prototype |
| Piper directly | No equivalent supported browser integration found | No browser reference found | Native Piper voices | GPL-3.0 engine; model-specific voice licenses | Do not build a private port now |
| Browser `speechSynthesis` | Native browser API | Browser-owned | Platform-dependent | Browser/OS component | Keep as default fallback |

Verified release archive sizes for the Russian medium candidates:

| Voice archive | Download bytes | Approximate MiB |
| --- | ---: | ---: |
| `ru_RU-irina-medium-int8` | 21,149,417 | 20.17 |
| `ru_RU-irina-medium-fp16` | 35,868,633 | 34.21 |
| `ru_RU-irina-medium` | 67,153,308 | 64.04 |
| `ru_RU-ruslan-medium-int8` | 21,127,907 | 20.15 |
| `ru_RU-denis-medium-int8` | 21,058,905 | 20.08 |
| `ru_RU-dmitri-medium-int8` | 21,129,441 | 20.15 |
| `ru_RU-ruslan-medium-fp16` | 35,924,102 | 34.26 |
| `ru_RU-ruslan-medium` | 67,210,684 | 64.10 |
| `en_US-lessac-medium-int8` | 20,969,179 | 20.00 |
| `en_US-amy-medium-int8` | 21,028,122 | 20.05 |
| `en_US-hfc_female-medium-int8` | 21,021,379 | 20.05 |
| `en_US-hfc_male-medium-int8` | 25,491,430 | 24.31 |

These are compressed model archives, not the complete first-download size. The locally reproduced universal runtime is 15,222,938 bytes (JS + Wasm), and the shared unpacked phonemizer tree is 17,991,651 bytes. Russian and English archives contain byte-identical phonemizer trees. The current official-style Emscripten prototype preloads a complete voice into each `.data` file, so each browser package is approximately 50.45 MB and duplicates that shared tree. Deduplicating the phonemizer is a later size optimization, not a prerequisite for validating inference.

## Benchmark corpus

Use the same phrases in every browser and voice:

1. `Иван, ваше сообщение теперь будет прочитано вслух.`
2. `Спасибо за десять тысяч звёзд! Добро пожаловать в клуб дарителей.`
3. `Модератор Анна подключилась к трансляции.`
4. A mixed Russian/Latin username and one message containing numbers, punctuation and emoji.
5. A deliberately long message at the configured production character limit.

Do not use real chat history or usernames in stored benchmark reports.

## Required measurements

For a cold first run and a warm cached run, record:

- browser, operating system, device and execution mode (tab or installed PWA);
- runtime and model version plus exact content hashes;
- transferred bytes and persistent cache bytes;
- model initialization milliseconds;
- generation milliseconds, generated audio seconds and `RTF = generation seconds / audio seconds`;
- whether UI animation/input remains responsive;
- cancellation latency and bounded-queue behavior;
- whether a second page load performs another model transfer;
- any Wasm SIMD, memory, storage quota, backgrounding or audio-unlock failure;
- a simple pronunciation score and notes for each phrase.

## Safety rules for the prototype

- The experiment is visible only to administrators.
- Download starts only after an explicit click displaying its estimated size.
- Never initialize or benchmark while a LIVE is connecting, live or reconnecting.
- Use one Worker and one loaded voice per tab; terminate it on disable/logout.
- Reject unverified bytes and keep the previously verified model intact.
- Limit input length and queue depth before posting work to the Worker.
- On any failure, stop the Worker and return to browser `speechSynthesis` without affecting gift sounds or the LIVE connection.

## Chromium baseline, 18 September 2026

The official Sherpa-ONNX Worker pattern was compiled with Emscripten 4.0.23 into separate Russian and English packages and executed from localhost in Headless Chrome 153 on Windows with 12 reported logical processors. Each phrase was generated three times after one model initialization.

| Voice | Initialization | Run 1 RTF | Run 2 RTF | Run 3 RTF |
| --- | ---: | ---: | ---: | ---: |
| `ru-RU-irina-medium-int8` | 1547.1 ms | 0.358 | 0.337 | 0.327 |
| `en-US-lessac-medium-int8` | 1681.4 ms | 0.407 | 0.308 | 0.310 |

Both baseline models generated valid PCM in the Worker. The figures prove functional browser inference and faster-than-real-time generation on this desktop only. The six comparison voices are packaged and integrity-checked but do not inherit these performance measurements. None of these results prove pronunciation quality, mobile performance, Safari/Firefox compatibility, warm persistent-cache behavior or LIVE integration.

The application now knows the exact five-file package manifests, stages and verifies every file before exposing it in `tiktok-helper-tts-models-v1`, and can run a one-phrase admin benchmark through a bounded Worker client. The binary packages remain local and are not part of Git or production.
