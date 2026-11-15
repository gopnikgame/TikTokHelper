# TikTokHelper rewrite tasks

> Актуальный снимок реализованного, автоматических доказательств и отложенных ручных проверок: [docs/project-status.md](../docs/project-status.md). Старые критерии ниже сохранены как история поэтапной разработки; незакрытая галочка означает отсутствие именно указанного доказательства, а не обязательно отсутствие функции в production.

## Task 1: Resolve connector license and replacement boundary

**Description:** Determine whether the selected TikTok connector can be used in the intended privately hosted service and document acceptable alternatives without committing the rest of the product to one library.

**Acceptance criteria:**
- [x] Exact dependency version and license text are recorded.
- [x] Private household use and possible future sharing are evaluated separately.
- [x] A clear go, conditional-go, or replace decision is approved.

**Verification:**
- [x] Findings link to the versioned primary license and package sources.
- [x] The adapter contract remains implementable by at least one alternative.

**Dependencies:** None

**Files likely touched:** `docs/decisions/`, `packages/contracts/`

**Estimated scope:** Small

## Task 2: Inventory the real operator workflow

**Description:** Turn the legacy implementation and the wife's actual usage into a prioritized behavior specification before selecting UI screens.

**Acceptance criteria:**
- [x] Required, optional, and rejected legacy functions are listed.
- [x] Speech, sounds, gifts, connection control, and OBS needs have concrete scenarios.
- [x] Initial access and device/browser assumptions are recorded.

**Verification:**
- [x] Ivan and the operator review the workflow list.
- [x] Every phase-one screen maps to an accepted scenario.

**Dependencies:** None

**Files likely touched:** `docs/product/workflows.md`

**Estimated scope:** Small

## Checkpoint: approve scope

- [x] Tasks 1 and 2 are complete.
- [x] Stack, first-release scope, identity boundary, and connector choice are approved before implementation.

## Task 3: Bootstrap the TypeScript workspace

**Description:** Preserve the archive and create the minimal Fastify, React/Vite, and shared-contract workspace with pinned tooling.

**Acceptance criteria:**
- [x] Rewrite branch and legacy tag are reviewed before creation.
- [x] Server, web, and contracts packages build from a clean checkout.
- [x] Standard typecheck, test, lint, and build commands are documented.

**Verification:**
- [x] Clean install succeeds from the lockfile.
- [x] Typecheck, tests, lint, and production build exit successfully.

**Dependencies:** Scope checkpoint

**Files likely touched:** `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`

**Estimated scope:** Medium

## Task 4: Define contracts and Fastify foundation

**Description:** Establish runtime-validated HTTP/event contracts, application construction, health/readiness, and redacted structured logging.

**Acceptance criteria:**
- [x] App construction is separate from process startup.
- [x] Inbound API and Socket.IO payloads have shared runtime schemas.
- [x] Health, readiness, error shape, and log-redaction behavior are tested.

**Verification:**
- [x] `fastify.inject()` tests pass without opening a network port.
- [x] Representative secrets and chat text do not appear in captured logs.

**Dependencies:** Task 3

**Files likely touched:** `apps/server/src/`, `packages/contracts/src/`

**Estimated scope:** Medium

## Task 5: Add PostgreSQL persistence and settings slice

**Description:** Introduce Drizzle, the initial schema and migration, then deliver settings persistence from database through API to browser.

**Acceptance criteria:**
- [x] Workspace-scoped schema covers channels, rules, sounds, preferences, and minimal idempotency records.
- [x] Migration SQL is generated and reviewed rather than using destructive schema push.
- [x] Settings survive browser and application restart.

**Verification:**
- [x] Integration tests pass against an isolated PostgreSQL database.
- [x] Empty-database migration and backup/restore procedure are verified.
- [x] Cross-workspace repository tests reject leakage.

**Dependencies:** Task 4

**Files likely touched:** `apps/server/src/db/`, `apps/server/drizzle/`, `apps/web/src/features/settings/`

**Estimated scope:** Medium

## Checkpoint: persisted foundation

- [x] Tasks 3-5 pass all focused and full checks.
- [x] Settings work end to end before adding a live external dependency.

## Task 6: Implement the TikTok adapter

**Description:** Add the isolated connector, lifecycle state machine, normalization, gift handling, reconnect, and cleanup using sanitized fixtures.

**Acceptance criteria:**
- [x] Only project-owned event contracts leave the adapter.
- [x] One connector exists per workspace/channel and manual stop cancels reconnect.
- [x] Gift streaks and state-changing events are idempotent.

**Verification:**
- [x] Fixture tests cover normal, malformed, duplicate, offline, reconnect, and shutdown paths.
- [x] A separately approved real LIVE smoke test confirms current connector compatibility.

**Dependencies:** Tasks 1, 4, 5

**Files likely touched:** `apps/server/src/tiktok/`, `packages/contracts/src/events/`, `tests/fixtures/`

**Estimated scope:** Medium

## Task 7: Implement realtime recovery

**Description:** Connect backend state to browsers with typed Socket.IO rooms, snapshot-first recovery, bounded buffers, acknowledgements, and authorization boundaries.

**Acceptance criteria:**
- [x] Room membership is derived and authorized server-side.
- [x] Reconnect sends a snapshot before live deltas and rejects stale generations.
- [x] High-rate low-value updates are coalesced rather than queued without bounds.

**Verification:**
- [x] Integration tests cover unauthorized rooms, sequence gaps, duplicate commands, reconnect, and slow clients.
- [x] Repeated page reconnects do not duplicate server listeners or TikTok connectors.

**Dependencies:** Tasks 4 and 6

**Files likely touched:** `apps/server/src/realtime/`, `apps/web/src/realtime/`, `packages/contracts/src/socket/`

**Estimated scope:** Medium

## Task 8: Build the browser operator workflow

**Description:** Deliver the first usable React interface for connection control, status, event feed, mappings, sound playback, and speech.

**Acceptance criteria:**
- [x] Audio activation and unavailable output states are explicit; text-to-speech remains deferred by the accepted workflow.
- [x] Connection, offline, reconnecting, failed, and stopped states are understandable.
- [x] Settings and mappings are usable on desktop and the agreed mobile sizes.

**Verification:**
- [x] Component tests cover queues and error states.
- [x] Playwright covers initial load, activation, events, reload/reconnect, and responsive layout with a fake source.
- [ ] A manual browser check confirms actual speech and sound output.

**Dependencies:** Tasks 5 and 7

**Files likely touched:** `apps/web/src/`, `packages/contracts/src/`

**Estimated scope:** Medium

## Checkpoint: local product

- [ ] Tasks 6-8 pass automated checks and an operator walkthrough.
- [ ] The browser can recover without creating a second live connection.

## Task 9: Package the production application

**Description:** Create a hardened application image and Compose model for the app, PostgreSQL, persistent media, and explicit migrations.

**Acceptance criteria:**
- [x] Database and media use named persistent storage and are not publicly exposed.
- [x] App and database have meaningful healthchecks and graceful shutdown.
- [x] Secrets remain outside images, Git, and rendered diagnostic output.

**Verification:**
- [x] Image builds from the reviewed checkout and the production image has been deployed.
- [x] `docker compose config --quiet` passes.
- [ ] Fresh install, restart, migration failure, persistence, and isolated restore scenarios are all exercised and recorded.

**Dependencies:** Tasks 5 and 8

**Files likely touched:** `Dockerfile`, `compose.yaml`, `deploy/`

**Estimated scope:** Medium

## Task 10: Deploy through Proxmox and Caddy

**Description:** Provision or select the dedicated VM, deploy the reviewed release, establish access control, and verify the real browser workflow through the public endpoint.

**Acceptance criteria:**
- [x] Live VM, storage, DNS, Caddy, resource, and backup state are inventoried before mutation.
- [x] A verified backup and rollback procedure exist before deployment.
- [x] Public access requires the agreed identity boundary and PostgreSQL is internal only.

**Verification:**
- [x] Services and healthchecks pass; fresh logs contain no secret or chat leakage.
- [ ] HTTPS, WebSocket, persistence, speech, sounds, reconnect, and operator workflow pass across the deferred real-device browser matrix.
- [x] PostgreSQL/media restore is tested in isolated disposable resources; the current media volume is empty, so non-empty upload verification remains a documented follow-up.

**Dependencies:** Tasks 1, 2, and 9

**Files likely touched:** `deploy/`, project operations documentation, reviewed Caddy fragment on the target

**Estimated scope:** Medium

## Checkpoint: production handoff

- [ ] All acceptance criteria and verification commands, including deferred browsers and restore, are recorded with fresh results.
- [x] Known TikTok reliability/licensing limitations and rollback instructions are documented.
- [ ] Ivan and the operator accept the real browser flow.

## Task 11: Define configurable speech and reaction contracts

**Description:** Define additive runtime-validated contracts for support levels, speech policy, event reactions, template variables, and browser actions.

**Acceptance criteria:**
- [x] Every rule belongs to one workspace and is disabled/silent until explicitly configured.
- [x] Templates accept only documented variables and bounded text.
- [x] Moderator speech is an explicit workspace option with its own cooldown.

**Verification:**
- [x] Contract tests accept representative rules and reject unknown variables, oversized templates, invalid thresholds, and additional fields.
- [x] Existing gift, sound, and settings contracts remain backward compatible.

**Dependencies:** Tasks 5, 7, and 8

**Files likely touched:** `packages/contracts/src/automation.ts`, `packages/contracts/src/index.ts`

**Estimated scope:** Small

## Task 12: Persist workspace speech configuration

**Description:** Add reviewed Drizzle migrations, repository methods, and authenticated REST routes for levels, event reactions, and speech policy.

**Acceptance criteria:**
- [x] Levels, reactions, and policy survive restart and remain workspace-scoped.
- [x] Sound references use the shared library and cannot reference quarantined or missing sounds.
- [x] Empty workspaces receive no enabled speech or event reactions.

**Verification:**
- [x] Production migration, pre-deploy backup gates, and the isolated restore rehearsal pass; non-empty uploaded-media verification remains tracked in project status.
- [x] API tests cover CRUD, ordering, validation, and cross-workspace isolation.

**Dependencies:** Task 11

**Files likely touched:** `apps/server/drizzle/`, `apps/server/src/db/schema.ts`, `apps/server/src/automation/`

**Estimated scope:** Medium

## Task 13: Track supporters and grant privileges

**Description:** Identify gift senders, aggregate support points, and create idempotent level achievements without retaining raw events.

**Acceptance criteria:**
- [x] Gift series increment totals exactly once.
- [x] Crossing a threshold grants its configured privilege once.
- [x] Current-stream and lifetime totals are distinguishable.

**Verification:**
- [x] Tests cover duplicate events, series, multiple crossed levels, username changes, and concurrent updates.

**Dependencies:** Task 12

**Files likely touched:** `apps/server/src/tiktok/`, `apps/server/src/supporters/`, `packages/contracts/src/socket.ts`

**Estimated scope:** Medium

## Task 14: Execute bounded browser speech and event sounds

**Description:** Evaluate moderator and earned privileges server-side, then send typed speech/sound actions for browser playback.

**Acceptance criteria:**
- [x] No configured action means silence.
- [x] Speech respects language, cooldown, maximum length, duplicate suppression, and bounded queue policy.
- [x] Event sounds and gift sounds share browser audio ownership without uncontrolled overlap.

**Verification:**
- [x] Unit tests cover template rendering and policy decisions.
- [ ] Browser tests cover audio activation, voice fallback, queue overflow, and stop/clear.

**Dependencies:** Task 13

**Files likely touched:** `apps/server/src/automation/`, `apps/web/src/speech/`, `apps/web/src/audio/`

**Estimated scope:** Medium

## Task 15: Build the mobile rule editor

**Description:** Add a dedicated progressive-disclosure settings surface for levels, moderator speech, event reactions, templates, sounds, and test playback.

**Acceptance criteria:**
- [x] Users edit rules using human labels, not JSON or internal event names.
- [x] Available variables are shown next to each template and can be inserted by tapping.
- [x] Create, edit, reorder, disable, test, and delete flows work on mobile.

**Verification:**
- [x] Component and Playwright tests cover empty, loading, error, long-name, and compact-width states.
- [ ] Manual iPhone check confirms editing and test speech after one audio-unlock gesture.

**Dependencies:** Tasks 12 and 14

**Files likely touched:** `apps/web/src/`, `apps/web/src/styles.css`

**Estimated scope:** Medium

## Task 16: Add a versioned browser audio cache

**Description:** Cache only enabled gift/reaction/support-level sound bytes in the browser, reuse decoded buffers, and preserve a clean migration path to a future installable PWA.

**Acceptance criteria:**
- [x] Every cacheable sound exposes a server-derived SHA-256, byte size, MIME type, status, and same-origin URL.
- [x] The browser persistently caches only sounds reachable from enabled rules and uses a bounded decoded `AudioBuffer` store.
- [x] Cache keys and namespaces follow `.agents/skills/browser-audio-cache/references/cache-contract.md`.
- [x] Authentication, workspace JSON, chat, TikTok events, and navigation responses never enter audio/model caches.
- [x] Cache, quota, or decode failure falls back to the existing media-element playback without breaking the live UI.
- [x] Cache names remain adoptable by a future Service Worker without migrating user data.

**Verification:**
- [x] Unit tests cover exact-version lookup, in-flight deduplication, changed hashes, bounded eviction, quarantine, and fallback.
- [x] Chromium browser tests prove first-download and persistent reuse without a second media transfer.
- [ ] Manual Firefox, Safari macOS/iPhone, Android Chromium, and Yandex checks are recorded separately when devices are available.

**Dependencies:** Tasks 8 and 14

**Files likely touched:** `packages/contracts/src/sounds.ts`, `apps/server/src/sounds/`, `apps/web/src/audio/`

**Estimated scope:** Medium

## Checkpoint: speech privileges

- [x] Tasks 11-15 pass `pnpm run verify`.
- [x] Production backup, migration, deploy, rollback procedure checks, and isolated restore rehearsal pass; non-empty uploaded-media verification remains open.
- [ ] Real LIVE verifies one moderator message, one threshold crossing, one announcement, and one event sound.

## Task 17: Add a deterministic browser workflow source

**Description:** Exercise the complete browser workflow with sanitized scripted TikTok events without connecting to TikTok or adding a production-accessible simulation endpoint.

**Acceptance criteria:**
- [x] The session manager accepts an injected connector factory while production composition always selects the real adapter.
- [x] A test-only scripted source emits normalized connection, chat, emoji, gift streak, duplicate, reconnect, moderator, and supporter events.
- [x] Browser workflow checks cover snapshot recovery, rendering, audio/speech behavior, stop/clear, single-tab ownership, and representative responsive sizes.

**Verification:**
- [x] Focused server and browser tests pass with no live account or network dependency.
- [x] `pnpm run verify` passes.
- [x] Production bundles and startup configuration contain no public switch or route that enables the fake source.

**Dependencies:** Tasks 7, 8, 14, and 16

**Files likely touched:** `apps/server/src/tiktok/`, `apps/server/test/`, `apps/web/src/`, test harness files

**Estimated scope:** Medium, implemented as separate connector-injection and browser-workflow slices

## Checkpoint: deterministic operator workflow

- [x] Scripted events traverse the same normalized contracts and Socket.IO path as real events.
- [x] Reloading a browser does not create a second scripted connector.
- [x] The automated suite remains isolated from production runtime configuration.

## Task 18: Verify transactional supporter accounting

**Description:** Verify supporter totals and level grants against an isolated real PostgreSQL database under duplicate and concurrent gift processing.

**Acceptance criteria:**
- [x] Concurrent copies of one event increment stream and lifetime totals exactly once.
- [x] Concurrent distinct events lose no points and multiple crossed levels are granted once each.
- [x] Stable identity preserves lifetime totals across username changes while stream totals remain separate.

**Verification:**
- [x] PostgreSQL integration tests pass with `TEST_DATABASE_URL` against a disposable database.
- [x] Ordinary `pnpm run verify` remains independent of a running database.
- [x] No production database or volume is used by the integration run.

**Dependencies:** Tasks 12 and 13

**Files likely touched:** `apps/server/test/supporter-points.integration.test.ts`, supporter task documentation

**Estimated scope:** Small

## Task 19: Add a conservative installable PWA shell

**Description:** Make the browser application installable without caching authenticated state or silently replacing an active LIVE page.

**Acceptance criteria:**
- [x] The manifest has stable scope, Russian metadata, 192 px, 512 px and maskable icons.
- [x] The Service Worker keeps app-shell, audio and future TTS-model caches separate.
- [x] API, Socket.IO, chat, user data, uploaded media and online navigation HTML are never stored in the app-shell cache.
- [x] Offline navigation shows a static connection-required page rather than stale operator state.
- [x] A new worker waits for explicit approval and its update action is disabled during connecting, live and reconnecting states.

**Verification:**
- [x] Unit tests cover the active-LIVE update gate and Service Worker privacy boundaries.
- [x] Chromium verifies registration, cache contents, mobile offline fallback, waiting update and explicit activation/reload.
- [ ] Safari/iPhone, Android Chromium, Firefox and Yandex installation are recorded when devices are available.

**Dependencies:** Tasks 10 and 16

**Files likely touched:** `apps/web/public/`, `apps/web/src/pwa/`, `apps/web/vite.config.ts`, PWA documentation

**Estimated scope:** Medium

## Task 20: Prototype and benchmark local neural TTS

**Description:** Evaluate browser-local neural speech without adding server inference or replacing the current cross-browser fallback prematurely.

**Acceptance criteria:**
- [x] Compare Sherpa-ONNX Web, direct Piper browser integration and browser `speechSynthesis` from primary sources.
- [x] Select a runtime, initial Russian candidates, cache boundary and explicit opt-in policy in an ADR.
- [x] Record exact upstream archive sizes and a repeatable sanitized benchmark corpus.
- [x] Assemble pinned Sherpa-ONNX Wasm plus Russian and English int8 assets with licenses and SHA-256 metadata outside production.
- [ ] Add an administrator-only opt-in experiment with a dedicated Worker and `tiktok-helper-tts-models-v1` cache.
- [ ] Fall back to `speechSynthesis` after unsupported Wasm, quota, integrity, initialization, cancellation or inference failure.

**Verification:**
- [ ] Chromium cold/warm runs record download bytes, initialization, generation duration, audio duration and RTF.
- [ ] A second load performs no model transfer and no API/chat/user data enters the model cache.
- [ ] Queue cancellation and failure do not interrupt gift audio, the UI or the LIVE connection.
- [ ] Firefox, Safari macOS/iPhone, Android Chromium and Yandex results are recorded when devices are available.

**Dependencies:** Tasks 14, 16, 17, and 19

**Files likely touched:** `apps/web/src/speech/`, `apps/web/src/audio/`, `apps/web/public/tts/`, TTS documentation

**Estimated scope:** Large, staged behind an administrator-only experiment

## Задача 21. Проверка звука на подарки

**Приёмка**

- [x] Администратор открывает проверку рядом с текущей привязкой и видит подарок, сохранённый звук и настройки серии.
- [x] В обычной очереди воспроизведения проходят 1, 3 и 100 повторов с выбранной громкостью и перекрытием. Остановка и закрытие сразу прерывают проверку.
- [x] Окно объясняет отсутствие привязки и ошибки воспроизведения. Запуск во время активного подключения недоступен.

**Проверка** — тесты очереди и локальные Chromium и WebKit на 320×568, 390×844, 844×390 и 1440×960. В обоих браузерах прошли один подарок, серия из 3, прерывание серии из 100, уход звука в другую вкладку и карантин. Проверено воспроизведение через Web Audio в Chromium и через HTML Audio в локальном WebKit.

- [ ] На реальном iPhone проверить слышимость и поведение с коротким и длинным файлом.

## Задача 22. Проверка реакции на появление дарителя

**Приёмка**

- [x] Можно сравнить первое и повторное появление тестового дарителя. В окне видно, какие сохранённые правила дадут звук или речь.
- [x] Речь использует голос, скорость и громкость браузера. Отказ, отмена и недоступность голоса читаются рядом с результатом.
- [x] При проверке отсутствуют команды LIVE и записи баллов, привязок и статистики.

**Проверка** — тесты очереди и синтетическая сессия администратора в Chromium и WebKit. Заглушка системного голоса проверяет выбор фразы и обработку завершения или ошибки. Сетевой сценарий подтверждает отсутствие HTTP-записей и команд LIVE. После имитации нового эфира проверены обычные реакции на первый подарок и первое появление дарителя.

- [ ] На реальном устройстве проверить слышимость системного голоса.

**Зависимость** — задача 21.

## Задача 23. Режим «Только эфир»

- [x] Чат, подарки, состояние и остановка звука помещаются на втором экране. Возврат к настройкам сохраняет подключение, звук и черновики.
- [x] Модераторы видны в чате. Локальное закрепление сохраняется при новых сообщениях и доступно с клавиатуры.
- [x] На телефоне доступны переключатели чата и подарков. При чтении истории положение сохраняется при переключении лент и возврате в пульт.

**Проверка** — локальный эфир в Chromium и WebKit, семь размеров от 320×568 до 1440×900, включая 844×390. Проверены фокус, длинные тексты, удержание закрепа при вытеснении сообщения из истории, переподключение и остановка длинной очереди звука при активном эфире.

## Задача 24. Проверить учёт подарков и серий

- [x] Повторы, параллельные серии и поздние пакеты дают ожидаемые приросты. При подтверждённом TikTok room ID PostgreSQL сохраняет прогресс для той же комнаты.
- [x] Начальные и восстановленные пакеты не запускают новые эффекты повторно. При восстановлении пульт показывает недавние подарки и чат, а новые события продолжают звучать.
- [x] Миграция `0010` добавляет счётчик серии. Тесты PostgreSQL покрывают параллельную запись, старый журнал, сброс статистики и восстановление счётчика после перезапуска.
- [ ] Подтвердить одну серию в реальном эфире и сверить прирост статистики с фактическим количеством подарков.

**Проверка** — обезличенные фикстуры, отдельный PostgreSQL 18.1 и локальный сценарий потери сокета в Chromium и WebKit. Серии без `groupId` учитываются по дарителю и подарку. Неоднозначный финал может быть пропущен.

## Задача 25. Настраиваемые реакции на подарок и серию

- [x] Администратор может выбрать подарок или весь каталог, минимальную суммарную стоимость, паузу, звук и шаблон благодарности. Новое правило выключено.
- [x] Первое подходящее правило срабатывает один раз на одиночный подарок или финал серии. Сохранённая привязка звука воспроизводится по приростам серии.
- [x] Карточка правила открывает проверку перед эфиром. В ней видны стоимость серии, действие и причина пропуска, в том числе для выключенного правила.
- [ ] Сверить реакцию на одиночный подарок, серию и её стоимость в живом эфире. Проверить слышимость фраз на iPhone.

**Проверка** — сценарии порога, паузы, изоляции рабочих мест, прав, карантина и перестановки. Миграция `0011` проверена на временной PostgreSQL 18.1. В Chromium и WebKit тестовая серия `1 → 3 → финал 3 → повтор финала` даёт три запуска обычного звука и одну команду благодарности. После обновления страницы восстанавливается лента без запуска звука.

**Зависимости** — задачи 21, 22 и 24.

## Задача 26. Цель и статистика подарков

- [x] Администратор выбирает подарок, количество и звук достижения. В полном пульте и «Только эфир» видны прогресс, последний даритель и топ по баллам.
- [x] Снимок восстанавливает прогресс после перезагрузки страницы. Пересечение порога даёт один живой сигнал, повтор финала и восстановленный снимок проходят без звука.
- [x] Новое подключение начинает отсчёт заново. Автоматическое восстановление того же подключения сохраняет статистику. Рабочие места изолированы.
- [ ] Проверить достижение цели на живом эфире и слышимость выбранного звука на iPhone.

**Проверка** — миграция `0012` на временной PostgreSQL 18.1, HTTP и Socket.IO для двух рабочих мест. Chromium и WebKit при цели в два подарка показывают `3 из 2`, один запуск звука достижения, три запуска привязки подарка и тихое восстановление после перезагрузки.

**Зависимости** — задачи 24 и 25.

## Задача 27. Зрители и социальные события

- [x] В двух живых эфирах получены сообщения о зрителях и лайках. В первом пришли репосты, во втором подписки на автора. «Зрители TikTok» показаны отдельно от онлайна пульта.
- [x] Цель считает рост общего счётчика комнаты. Дубли и меньшие значения не меняют прогресс. Автоматическое переподключение сохраняет базу, новая комната начинает с первой полученной отметки.
- [x] Администратор может менять или выключать цель и раскрывать последние подписки и репосты. В «Только эфир» видны счётчики и прогресс.

**Проверка** — два чтения живого эфира, фикстуры декодирования v3, проверка изоляции рабочих мест и браузерные сценарии с разрывом связи, перезагрузкой и сменой комнаты. Настройку цели хранит PostgreSQL после миграции `0013`.

## Задача 28. Подготовка каталога перед эфиром

- [x] Проверен запрос списка для нескольких активных комнат на коннекторе 2.5.0. После получения `roomId` в трёх комнатах запрос завершился ошибкой подписи `SignatureMissingTokensError`. На сервере в Латвии два LIVE-подключения работали, а запрос списка после подключения по-прежнему останавливался на подписи.
- [x] В региональных списках получены 747 уникальных ID для Кореи, 788 для США и 878 для Латвии. У всех позиций есть ссылки на изображения. Подарок из корейского эфира совпал с каталогом по ID и стоимости, выборочная загрузка изображения дала HTTP 200. [API Euler Stream](https://www.eulerstream.com/docs/api/tiktok-live-gifts#retrieve-webcast-gifts)
- [x] Общий каталог полученных в эфире подарков открывается до подключения. Подарок можно найти по ID и сохранить привязку к звуку. Карточка показывает 🎁, если CDN не загрузил картинку.

**Проверка** — Chromium и мобильный WebKit на локальных фикстурах, включая ответ CDN `403`, сохранение привязки и её отображение после перезагрузки. HTTP-маршруты каталога и привязок проверены тестами.

**Источник каталога** — LIVE-события. Запрос списка конкретной комнаты требует отдельной подписи. Прямой API Euler Stream для комнаты без ключа вернул `401`. [Подпись запросов](https://www.eulerstream.com/docs/api/tiktok-signing#sign-tiktok-url)

Региональный список подходит для предварительного поиска. Для точного состава меню нужен список конкретной комнаты. [Подключение к API Euler Stream](https://www.eulerstream.com/docs/api/quickstart)

- [x] Временная PostgreSQL после миграции `0014` приняла пять региональных списков. США — 788, Канада — 749, ОАЭ — 809, Германия — 894, Беларусь — 769 уникальных ID. У всех загруженных позиций есть ссылки на изображения.
- [x] Администратор ищет и настраивает региональный подарок до эфира. При открытии списка старше суток пульт обновляет его. При `429` и сбоях доступен последний успешный снимок. После обновления привязки сохраняются. Первое реальное событие даёт подарку дату наблюдения в общем каталоге.

**Проверка регионального поиска** — живая загрузка через адаптер приложения, чтение из PostgreSQL после пересоздания сервиса, сохранение через HTTP, отказ чужому рабочему месту, смоделированное появление нового подарка и повторная проверка старой привязки. Мобильный WebKit и Chromium прошли сценарий на фикстурах. Публикация версии на сервере сайта — отдельный этап.

## Задача 29. Профили, голосование и виджеты

- [x] Выбран первый сценарий с профилями звука «Обычный» и «Тихий».
- [x] Администратор переключает профиль в пульте и в режиме «Только эфир». Текущий эфир продолжается. Звук останавливается, очередь предыдущего профиля очищается.
- [x] В «Тихом» звуки подарков идут по очереди с потолком громкости 25% по умолчанию. Автоматическое озвучивание можно включить отдельно. При потолке 0% замолкают подарки и речь. Выбор восстанавливается при перезагрузке вкладки, параметры хранятся в этом браузере по рабочим местам.
- [x] Chromium подтвердил смену профиля посреди серии, уровни громкости, отключение и возврат речи, сохранение параметров, отсутствие повторного подключения и отказ от звука без контроля громкости. Мобильный WebKit подтвердил управление с клавиатуры, работу чата при переключении и компоновку от 320 до 660 px. У обычного пользователя новые элементы скрыты.

**Проверка** — `pnpm run verify`, 310 тестов с временной PostgreSQL и `docker compose config --quiet --no-interpolate --no-env-resolution`. Реальное звучание в Safari на iPhone проверяется отдельно в живом эфире.

- [x] Администратор создаёт голосование с 2–4 вариантами в текущем эфире. Команды зрителей `!1`–`!4` принимаются из чата. При подсчёте учитывается первый голос, а исторические сообщения и команды с лишним текстом пропускаются. В «Только эфир» видны результаты, опрос можно завершить.
- [x] Текущий опрос и итоги хранятся в памяти сервера отдельно для рабочего места и эфира. При перезагрузке вкладки и восстановлении той же комнаты пульт получает текущий подсчёт с сервера. Завершение сохраняет итог до нового опроса или подключения.
- [x] Проверено, что обычный пользователь и администратор другого рабочего места не получают состояние опроса. При смене рабочего места с недоступным новым соединением прежний опрос сразу исчезает.

**Проверка голосования** — `pnpm run verify`, 319 тестов с временной PostgreSQL. Chromium проверил создание, подсчёт, повторный голос, восстановление, завершение и раздельные итоги. Мобильный WebKit проверил клавиатуру и компоновку на ширинах 320–660 px. Проверка на живом TikTok LIVE выполняется отдельно.

- [x] В «Виджетах для OBS и LIVE Studio» администратор создаёт, копирует и отзывает ссылку своего рабочего места. У каждого вида отдельная ссылка. Она действует до отзыва или перезапуска сервера.
- [x] Браузерный источник показывает одну карточку с названием подарка и прогрессом включённой цели. Отзыв скрывает её при следующей проверке, завершение эфира очищает экран, а новый эфир начинает счёт заново.
- [x] Проверены просмотр без сессии кабинета, изоляция рабочих мест, отсутствие прав на управление по ссылке и обновление карточки через прокси с префиксом `/tiktokhelper/`.

**Проверка цели по подаркам** — `pnpm run verify`, 324 теста с временной PostgreSQL. Chromium проверил дубликат подарка, перезагрузку источника, новую трансляцию и отзыв при повторном раскрытии панели. Карточка помещается в источник от 320 × 200 px в проверенных размерах.

- [x] Добавлены три источника. Последний подарок показывается 8 секунд после одиночного подарка или завершения серии. Цель по лайкам считает прогресс с первой полученной отметки. Голосование показывает команды, подсчёт и итоги. Ссылки дают только просмотр выбранного виджета.

**Проверка новых виджетов** — `pnpm run verify`, 314 тестов прошли, 13 интеграционных тестов пропущены без PostgreSQL. Проверены отдельный доступ и отзыв, срок показа подарка, прогресс лайков и отсечение данных предыдущего эфира.

**Отложенная приёмка** — проверить все четыре источника в OBS и LIVE Studio на живом эфире.

## Выпуск инструментов для участников рабочих мест

- [x] Обычные участники управляют целями, реакциями на подарки, голосованием и ссылками своего рабочего места. «Только эфир» и звуковые профили доступны в том же пульте.
- [x] HTTP проверяет право на рабочее место и origin кабинета. Socket.IO доставляет события разрешённого рабочего места. Диагностика участников чата доступна администратору.
- [x] `pnpm run verify` с временной PostgreSQL, 333 теста. В том числе доступ обычного участника, отказ гостю и чужому рабочему месту, независимый отзыв ссылок и восстановление снимка.
