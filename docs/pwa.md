# Installable PWA and update policy

TikTokHelper is installable from supporting browsers, but it remains an online control surface. Authentication, workspace configuration, chat, LIVE events and Socket.IO recovery always come from the server.

## Cache boundaries

The Service Worker owns only `tiktok-helper-app-shell-v1`:

- a static offline explanation page;
- the web app manifest and icons;
- same-origin hashed JavaScript/CSS/font assets after they are requested.

It explicitly bypasses `/api/*`, `/socket.io/*`, navigation HTML while online, audio responses, uploaded media and cross-origin resources. The existing `tiktok-helper-audio-v1` cache remains owned by the browser audio module. The future `tiktok-helper-tts-models-v1` namespace remains reserved and untouched.

Offline navigation returns a static page explaining that connection is required. It does not display stale authenticated UI or pretend that LIVE control works offline.

## Installation

The manifest provides 192 px, 512 px and maskable icons, standalone display mode, Russian metadata and stable root scope. Chromium-family browsers can expose the in-app **Установить** action through `beforeinstallprompt`. When that event is unavailable, the same action shows browser-neutral instructions for the browser menu. Installed/standalone mode hides the action.

Safari installation remains a manual **Add to Home Screen** action. The manifest and Apple touch icon are both declared. Actual Safari/iPhone installation and audio behavior remain in the manual device matrix.

## Safe updates

Every production build emits a byte-distinct `sw.js` containing the deployed source revision. A new worker installs in the background and remains waiting:

1. It never calls `skipWaiting()` from the install event.
2. The page shows **Доступна новая версия**.
3. While the TikTok connection is `connecting`, `live` or `reconnecting`, the update action is disabled.
4. After the operator stops the LIVE, **Обновить сейчас** sends an explicit `SKIP_WAITING` message.
5. The page reloads only after the new worker becomes the controller.

Closing every controlled page still permits the browser's normal worker activation. Returning later starts the new version without interrupting an open LIVE page.

## Automated verification

The production build and Chromium check verify:

- manifest and icon availability;
- Service Worker registration and control;
- a distinct app-shell cache with no API response in it;
- static offline fallback at a 390 × 844 viewport;
- a waiting update that does not reload the page;
- explicit update activation and reload;
- unit policy that blocks updates during active/reconnecting LIVE states.

The mocked local API intentionally does not represent a real authenticated session or LIVE. Real-device installation remains pending for Safari/iPhone, Android Chromium, Firefox and Yandex Browser.

## Primary platform references

- [MDN: Service Worker API and lifecycle](https://developer.mozilla.org/docs/Web/API/Service_Worker_API)
- [web.dev: PWA update UX](https://web.dev/learn/pwa/update)
- [web.dev: installation prompt and fallbacks](https://web.dev/learn/pwa/installation-prompt)
- [Apple: manifest icons and Home Screen web apps](https://developer.apple.com/videos/play/wwdc2022/10048/)
- [Vite 8: emitting build assets from a plugin](https://v8.vite.dev/guide/api-plugin)
