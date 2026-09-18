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
| `ru_RU-ruslan-medium-fp16` | 35,924,102 | 34.26 |
| `ru_RU-ruslan-medium` | 67,210,684 | 64.10 |

These are compressed model archives, not the complete first-download size. The final figure must include the Wasm runtime, tokens, espeak-ng data and HTTP compression behavior.

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

## Current result

Runtime selection and asset boundaries are decided. Performance and quality are deliberately **not yet claimed**: no official prebuilt Russian browser bundle is published as a directly embeddable package, so the pinned Wasm/runtime assets and Russian model bundle must be assembled and hashed before the first repeatable Chromium benchmark.
