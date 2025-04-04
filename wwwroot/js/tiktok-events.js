if (!window.__tiktokEventsScriptLoaded) {
    window.__tiktokEventsScriptLoaded = true;

    (function () {
        'use strict';

        console.log('[TikTokEvents] Script loaded');

        // Конфигурация
        const CONFIG = {
            RECONNECT_DELAY: 5000,
            MAX_RECONNECT_ATTEMPTS: 5,
            CONNECTION_TIMEOUT: 15000,
            maxNotifications: 50,
            notificationTimeout: 5000,
            maxMessages: 200,
            maxGifts: 100,
            reconnectDelay: 3000,
            debug: true
        };

        // Состояние приложения
        const state = {
            isConnected: false,
            isConnecting: false,
            currentUsername: null,
            reconnectAttempts: 0,
            autoConnect: false,
            socket: null,
            connectionTimer: null,
            stats: {
                likes: 0,
                gifts: 0,
                messages: 0,
                viewers: 0,
                diamonds: 0
            },
            lastEventTime: null,
            manualDisconnect: false,
            showMessages: true,
            showEvents: true,
            showGifts: true,
            showFollows: true,
            showJoins: true
        };

        // DOM-элементы
        const elements = {
            connectButton: document.getElementById('tiktokConnectButton'),
            usernameInput: document.getElementById('tiktokUsernameInput'),
            statusElement: document.getElementById('tiktokConnectionStatus'),
            autoConnectCheckbox: document.getElementById('tiktokAutoConnectCheckbox'),
            showMessagesCheckbox: document.getElementById('showMessagesCheckbox'),
            showEventsCheckbox: document.getElementById('showEventsCheckbox'),
            showGiftsCheckbox: document.getElementById('showGiftsCheckbox'),
            showFollowsCheckbox: document.getElementById('showFollowsCheckbox'),
            showJoinsCheckbox: document.getElementById('showJoinsCheckbox')
        };

        // Инициализация
        function init() {
            console.log('[TikTokEvents] Initializing...');
            if (!checkDomElements()) {
                console.error('[TikTokEvents] Initialization failed: Missing DOM elements');
                return;
            }

            setupEventListeners();
            restoreSettings();
            updateUI();
        }

        // Обновление DOM-элементов при ajax-переходе
        function reinit() {
            console.log('[TikTokEvents] Reinitializing on AJAX load...');
            elements.connectButton = document.getElementById('tiktokConnectButton');
            elements.usernameInput = document.getElementById('tiktokUsernameInput');
            elements.statusElement = document.getElementById('tiktokConnectionStatus');
            elements.autoConnectCheckbox = document.getElementById('tiktokAutoConnectCheckbox');
            elements.showMessagesCheckbox = document.getElementById('showMessagesCheckbox');
            elements.showEventsCheckbox = document.getElementById('showEventsCheckbox');
            elements.showGiftsCheckbox = document.getElementById('showGiftsCheckbox');
            elements.showFollowsCheckbox = document.getElementById('showFollowsCheckbox');
            elements.showJoinsCheckbox = document.getElementById('showJoinsCheckbox');

            // Если какие-то элементы отсутствуют на новой странице – это не ошибка
            setupEventListeners();
            restoreSettings();
            updateUI();
        }

        // Проверка DOM-элементов
        function checkDomElements() {
            let missing = false;
            ['connectButton', 'usernameInput', 'statusElement', 'autoConnectCheckbox'].forEach(key => {
                if (!elements[key]) {
                    console.error(`Element ${key} not found`);
                    missing = true;
                }
            });
            return !missing;
        }

        // Восстановление настроек из sessionStorage/localStorage
        function restoreSettings() {
            const savedUsername = sessionStorage.getItem('tiktokUsername');
            if (savedUsername && elements.usernameInput) {
                elements.usernameInput.value = savedUsername;
            }
            const autoConnect = localStorage.getItem('tiktokAutoConnect');
            if (autoConnect !== null && elements.autoConnectCheckbox) {
                elements.autoConnectCheckbox.checked = autoConnect === 'true';
                state.autoConnect = autoConnect === 'true';
            }
        }

        // Функция обработки клика по кнопке подключения/отключения
        function handleConnectionClick() {
            if (state.isConnected) {
                disconnect();
            } else {
                connect();
            }
        }

        // Настройка обработчиков событий
        function setupEventListeners() {
            if (elements.connectButton) {
                elements.connectButton.removeEventListener('click', handleConnectionClick);
                elements.connectButton.addEventListener('click', handleConnectionClick);
            }

            if (elements.autoConnectCheckbox) {
                elements.autoConnectCheckbox.removeEventListener('change', toggleAutoConnect);
                elements.autoConnectCheckbox.addEventListener('change', toggleAutoConnect);
            }

            // Обработчики чекбоксов
            const toggleSetting = (key) => (e) => {
                state[key] = e.target.checked;
                localStorage.setItem(`tiktok${key.charAt(0).toUpperCase() + key.slice(1)}`, e.target.checked);
            };

            if (elements.showMessagesCheckbox) {
                elements.showMessagesCheckbox.removeEventListener('change', toggleSetting('showMessages'));
                elements.showMessagesCheckbox.addEventListener('change', toggleSetting('showMessages'));
            }

            if (elements.showEventsCheckbox) {
                elements.showEventsCheckbox.removeEventListener('change', toggleSetting('showEvents'));
                elements.showEventsCheckbox.addEventListener('change', toggleSetting('showEvents'));
            }

            if (elements.showGiftsCheckbox) {
                elements.showGiftsCheckbox.removeEventListener('change', toggleSetting('showGifts'));
                elements.showGiftsCheckbox.addEventListener('change', toggleSetting('showGifts'));
            }

            if (elements.showFollowsCheckbox) {
                elements.showFollowsCheckbox.removeEventListener('change', toggleSetting('showFollows'));
                elements.showFollowsCheckbox.addEventListener('change', toggleSetting('showFollows'));
            }

            if (elements.showJoinsCheckbox) {
                elements.showJoinsCheckbox.removeEventListener('change', toggleSetting('showJoins'));
                elements.showJoinsCheckbox.addEventListener('change', toggleSetting('showJoins'));
            }

            window.removeEventListener('beforeunload', cleanup);
            window.addEventListener('beforeunload', cleanup);
        }

        // Подключение к серверу
        async function connect() {
            if (state.isConnecting) return;

            const username = getCleanUsername();
            if (!username) {
                showMessage('error', 'Введите username стримера');
                return;
            }

            state.manualDisconnect = false;
            startConnectionTimer();
            state.isConnecting = true;
            updateUI();

            try {
                await setupSocketConnection(username);
                saveUsername(username);
                showMessage('success', `Подключено к @${username}`);
            } catch (error) {
                console.error('[TikTokEvents] Ошибка при подключении:', error);
                handleConnectionError(error);
            } finally {
                clearConnectionTimer();
                state.isConnecting = false;
                updateUI();
            }
        }

        // Функция отключения
        function disconnect() {
            if (!state.socket) return;
            state.manualDisconnect = true;
            state.socket.disconnect();
            state.isConnected = false;
            state.currentUsername = null;
            updateUI();
            showMessage('info', 'Отключено');
        }

        // Настройка WebSocket соединения
        async function setupSocketConnection(username) {
            if (state.socket) return Promise.resolve();

            state.socket = io(getServerUrl(), {
                reconnection: true,
                reconnectionAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS,
                reconnectionDelay: CONFIG.RECONNECT_DELAY,
                timeout: CONFIG.CONNECTION_TIMEOUT,
                transports: ['websocket', 'polling']
            });

            return new Promise((resolve, reject) => {
                state.socket.on('connect', () => {
                    console.log('[TikTokEvents] WebSocket connected');
                    clearConnectionTimer();

                    state.socket.emit('join', username, { enableExtendedGiftInfo: true }, (response) => {
                        if (!response.success) {
                            reject(new Error(response.message || 'Ошибка подключения'));
                        } else {
                            setupSocketEventHandlers();
                            state.isConnected = true;
                            state.currentUsername = username;
                            resetStats();
                            resolve();
                        }
                    });
                });

                state.socket.on('connect_error', (error) => {
                    reject(error);
                });

                state.socket.on('disconnect', (reason) => {
                    handleDisconnect(reason);
                });
            });
        }

        // Функция обработки отключения
        function handleDisconnect(reason) {
            state.isConnected = false;
            updateUI();
            showMessage('warning', `Соединение разорвано: ${reason || 'неизвестная причина'}`);
        }

        // Настройка обработчиков событий WebSocket
        function setupSocketEventHandlers() {
            if (!state.socket) return;

            // Удаляем старые обработчики
            state.socket.off('chat');
            state.socket.off('like');
            state.socket.off('gift');
            state.socket.off('member');
            state.socket.off('social');
            state.socket.off('roomUser');

            // Устанавливаем новые обработчики
            state.socket.on('chat', handleChat);
            state.socket.on('like', handleLike);
            state.socket.on('gift', handleGift);
            state.socket.on('member', handleMember);
            state.socket.on('social', handleSocial);
            state.socket.on('roomUser', handleRoomUser);
            state.socket.on('error', handleError);

            state.socket.on('availableGifts', (giftList) => {
                console.log('[TikTokEvents] Available Gifts received:', giftList);
                // Сохраняем в локальном состоянии
                state.giftList = giftList;
                // Делаем глобально доступными для других скриптов:
                window.tiktokGifts = giftList;
                // Опубликовываем обновление подарков через пользовательское событие
                window.dispatchEvent(new CustomEvent('availableGiftsUpdate', { detail: giftList }));
            });

            state.socket.on('error', handleError);
        }

        // Обработчики событий
        function handleChat(data) {
            if (!data || !data.comment) {
                console.warn('Invalid chat data:', data);
                return;
            }

            state.stats.messages++;
            updateCounter('message', state.stats.messages);

            // Обновляем счетчик в заголовке чата
            const chatCounter = document.getElementById('chat-counter');
            if (chatCounter) {
                chatCounter.textContent = state.stats.messages;
            }

            if (state.showMessages) {
                addChatItem(data, data.comment);
            }

            // Диспетчинг события "chat"
            document.dispatchEvent(new CustomEvent('tiktokEvent', {
                detail: {
                    type: 'chat',
                    ...data
                }
            }));
        }

        function handleLike(data) {
            const count = parseInt(data.likeCount) || 1;
            state.stats.likes += count;
            updateCounter('like', state.stats.likes);

            if (state.showEvents) {
                showNotification('like', data.uniqueId || 'Anonymous', `${count} ❤️`);
                addChatItem(data, `${count} лайков`, true); // Временное сообщение
            }

            // Диспетчинг события "like"
            document.dispatchEvent(new CustomEvent('tiktokEvent', {
                detail: {
                    type: 'like',
                    ...data
                }
            }));
        }

        // Новая функция для вывода сообщений с изображением подарка
        function addGiftChatItem(data, text, imageSrc, isTemporary = false) {
            const container = document.getElementById('tiktok-chat-container');
            if (!container) return;

            // Очистка старых сообщений, если их слишком много
            if (container.children.length > CONFIG.maxMessages) {
                container.removeChild(container.firstChild);
            }

            const messageEl = document.createElement('div');
            messageEl.className = `chat-message ${isTemporary ? 'temporary' : ''}`;

            // Если указан источник изображения, добавляем элемент <img>
            if (imageSrc) {
                const img = document.createElement('img');
                img.className = 'gift-image';
                img.src = imageSrc;
                img.alt = text;
                // Можно настроить размеры через CSS (например, width: 40px;)
                messageEl.appendChild(img);
            }

            // Создаем элемент с текстом сообщения
            const textEl = document.createElement('span');
            textEl.className = 'gift-text';
            textEl.textContent = text;
            messageEl.appendChild(textEl);

            container.appendChild(messageEl);
            // Прокрутка контейнера вниз
            container.scrollTop = container.scrollHeight;
        }

        // Изменяем обработчик события 'gift'
        function handleGift(data) {
            if (!data || !data.giftId) return;

            state.stats.gifts++;
            const diamondValue = (data.diamondCount || 0) * (data.repeatCount || 1);
            state.stats.diamonds += diamondValue;
            updateCounter('gift', state.stats.gifts);

            if (state.showGifts) {
                const giftName = data.giftName || `Подарок ${data.giftId}`;
                const diamonds = diamondValue > 0 ? ` (${diamondValue}💎)` : '';
                const baseMessage = `${giftName} x${data.repeatCount}${diamonds}`;
                let imageSrc = null;

                // Если доступна расширенная информация о подарке – получаем изображение
                if (data.extendedGiftInfo && data.extendedGiftInfo.image) {
                    if (data.extendedGiftInfo.image.image) {
                        imageSrc = `data:image/png;base64,${data.extendedGiftInfo.image.image}`;
                    } else if (data.extendedGiftInfo.image.url_list && data.extendedGiftInfo.image.url_list.length > 0) {
                        imageSrc = data.extendedGiftInfo.image.url_list[0];
                    }
                }

                if (data.giftType === 1 && !data.repeatEnd) {
                    showNotification('gift', data.uniqueId || 'Anonymous', `${baseMessage} (streak in progress)`);
                } else {
                    showNotification('gift', data.uniqueId || 'Anonymous', baseMessage);
                    // Выводим в чат сообщение с изображением, если оно доступно. 
                    // Если изображения нет – можно вызвать стандартное добавление текста (или проигнорировать)
                    if (imageSrc) {
                        addGiftChatItem(data, `Отправил(а) ${baseMessage}`, imageSrc);
                    } else if (diamondValue > 10) {
                        addChatItem(data, `Отправил(а) ${baseMessage}`);
                    }
                    // Проигрывание звука
                    if (typeof window.playGiftSound === 'function') {
                        window.playGiftSound(data.giftId);
                    }
                }
            }

            // Диспетчинг события "gift"
            document.dispatchEvent(new CustomEvent('tiktokEvent', {
                detail: {
                    type: 'gift',
                    ...data
                }
            }));
        }

        function handleMember(data) {
            if (state.showJoins) {
                showNotification('member', data.uniqueId || 'Anonymous', 'присоединился');
                addChatItem(data, 'присоединился', true); // Временное сообщение
            }

            // Диспетчинг события "member"
            document.dispatchEvent(new CustomEvent('tiktokEvent', {
                detail: {
                    type: 'member',
                    ...data
                }
            }));
        }

        function handleSocial(data) {
            if (data.displayType.includes('follow') && state.showFollows) {
                showNotification('follow', data.uniqueId || 'Anonymous', 'подписался');
                addChatItem(data, 'подписался', true); // Временное сообщение

                // Диспетчинг события "follow"
                document.dispatchEvent(new CustomEvent('tiktokEvent', {
                    detail: {
                        type: 'follow',
                        ...data
                    }
                }));
            }
        }

        function handleRoomUser(data) {
            if (typeof data.viewerCount === 'number') {
                state.stats.viewers = data.viewerCount;
                updateCounter('viewer', state.stats.viewers);
            }
        }

        function handleError(error) {
            console.error('[TikTokEvents] Error:', error);
            showMessage('error', `Ошибка: ${error.message || 'Неизвестная ошибка'}`);
        }

        // Добавление сообщения в чат
        function addChatItem(data, text, isTemporary = false) {
            const container = document.getElementById('tiktok-chat-container');
            if (!container) return;

            // Очистка старых сообщений
            if (container.children.length > CONFIG.maxMessages) {
                container.removeChild(container.firstChild);
            }

            const messageEl = document.createElement('div');
            messageEl.className = `chat-message ${isTemporary ? 'temporary' : ''}`;

            // Аватарка
            if (data.profilePictureUrl) {
                const img = document.createElement('img');
                img.className = 'chat-avatar';
                img.src = data.profilePictureUrl;
                img.onerror = () => img.style.display = 'none';
                messageEl.appendChild(img);
            }

            // Имя пользователя со ссылкой
            const userLink = document.createElement('a');
            userLink.className = 'chat-username';
            userLink.href = `https://www.tiktok.com/@${data.uniqueId}`;
            userLink.target = '_blank';
            userLink.textContent = `${data.uniqueId || 'Anonymous'}: `;

            // Текст сообщения
            const textSpan = document.createElement('span');
            textSpan.className = 'chat-text';
            textSpan.innerHTML = sanitizeText(text);

            messageEl.append(userLink, textSpan);
            container.appendChild(messageEl);

            // Прокрутка вниз
            container.scrollTop = container.scrollHeight;
        }

        // Уведомления
        function showNotification(type, username, message) {
            const container = document.getElementById('tiktok-notifications-container');
            if (!container) return;

            const icons = {
                gift: '🎁',
                like: '❤️',
                member: '👋',
                follow: '⭐',
                error: '❌',
                warning: '⚠️',
                info: 'ℹ️',
                success: '✅'
            };

            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.innerHTML = `
                <div class="icon">${icons[type] || '💬'}</div>
                <div class="content">
                    <div class="username">${sanitizeText(username)}</div>
                    <div class="message">${sanitizeText(message)}</div>
                </div>
            `;

            container.appendChild(notification);

            if (container.children.length > CONFIG.maxNotifications) {
                container.removeChild(container.firstChild);
            }

            setTimeout(() => {
                notification.classList.add('fade-out');
                setTimeout(() => notification.remove(), 500);
            }, CONFIG.notificationTimeout);
        }

        // Системные сообщения
        function showMessage(type, text) {
            console.log(`[${type}] ${text}`);
            showNotification(type, 'System', text);
        }

        // Вспомогательные функции
        function sanitizeText(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function updateCounter(type, value) {
            const counter = document.getElementById(`tiktok-${type}-counter`);
            if (counter) {
                counter.textContent = value.toLocaleString();
            }
        }

        function resetStats() {
            state.stats = {
                likes: 0,
                gifts: 0,
                messages: 0,
                viewers: 0,
                diamonds: 0
            };
            updateCounter('like', 0);
            updateCounter('gift', 0);
            updateCounter('message', 0);
            updateCounter('viewer', 0);

            const chatCounter = document.getElementById('chat-counter');
            if (chatCounter) chatCounter.textContent = '0';
        }

        // Функции для таймера подключения, очистки и получения значений
        function startConnectionTimer() {
            clearConnectionTimer();
            state.connectionTimer = setTimeout(() => {
                if (state.isConnecting) {
                    handleConnectionError(new Error('Таймаут подключения'));
                }
            }, CONFIG.CONNECTION_TIMEOUT);
        }

        function clearConnectionTimer() {
            if (state.connectionTimer) {
                clearTimeout(state.connectionTimer);
                state.connectionTimer = null;
            }
        }

        function handleConnectionError(error) {
            showMessage('error', error.message);
            state.reconnectAttempts++;
            if (state.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
                const delay = Math.min(CONFIG.RECONNECT_DELAY * state.reconnectAttempts, 30000);
                showMessage('info', `Повторная попытка через ${delay / 1000} сек...`);
                setTimeout(() => connect(), delay);
            }
        }

        function getCleanUsername() {
            const username = elements.usernameInput?.value.trim();
            return username
                ? username.replace('@', '').replace('https://www.tiktok.com/', '').replace('/live', '').trim()
                : '';
        }

        function saveUsername(username) {
            sessionStorage.setItem('tiktokUsername', username);
        }

        function toggleAutoConnect(e) {
            state.autoConnect = e.target.checked;
            localStorage.setItem('tiktokAutoConnect', e.target.checked);
        }

        // В файле tiktok-events.js изменить функцию getServerUrl()
        function getServerUrl() {
            const baseDomain = window.location.hostname;
            // Используем безопасное соединение для production
            const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            return baseDomain === 'localhost'
                ? 'ws://localhost:3000'
                : `${protocol}${baseDomain}/socket.io`;
        }


        function updateUI() {
            if (!elements.connectButton || !elements.statusElement) return;
            elements.connectButton.disabled = state.isConnecting;
            elements.statusElement.className = `connection-status ${state.isConnected ? 'connected' : state.isConnecting ? 'connecting' : 'disconnected'}`;
            if (state.isConnecting) {
                elements.connectButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Подключение...';
                elements.statusElement.textContent = 'Подключение...';
            } else if (state.isConnected) {
                elements.connectButton.textContent = 'Отключиться';
                elements.statusElement.textContent = `Подключено к @${state.currentUsername}`;
            } else {
                elements.connectButton.textContent = 'Подключиться';
                elements.statusElement.textContent = 'Не подключено';
            }
        }

        function cleanup() {
            clearConnectionTimer();
            if (state.socket) {
                state.socket.disconnect();
            }
        }

        // Отладочные функции
        window.tiktokDebug = {
            getState: () => ({ ...state }),
            getConfig: () => ({ ...CONFIG }),
            testEvent: (type) => {
                const testEvents = {
                    chat: {
                        uniqueId: 'test_user',
                        comment: 'Тестовое сообщение',
                        profilePictureUrl: 'https://placekitten.com/50/50'
                    },
                    gift: {
                        uniqueId: 'test_gifter',
                        giftId: 123,
                        giftName: 'Тестовый подарок',
                        diamondCount: 50,
                        repeatCount: 1,
                        profilePictureUrl: 'https://placekitten.com/50/50'
                    },
                    like: {
                        uniqueId: 'test_liker',
                        likeCount: 5,
                        profilePictureUrl: 'https://placekitten.com/50/50'
                    },
                    member: {
                        uniqueId: 'test_viewer',
                        profilePictureUrl: 'https://placekitten.com/50/50'
                    },
                    follow: {
                        uniqueId: 'test_follower',
                        displayType: 'follow',
                        profilePictureUrl: 'https://placekitten.com/50/50'
                    }
                };

                const handler = {
                    chat: handleChat,
                    gift: handleGift,
                    like: handleLike,
                    member: handleMember,
                    follow: handleSocial
                }[type];

                if (handler && testEvents[type]) {
                    console.log(`[DEBUG] Triggering test event: ${type}`);
                    handler(testEvents[type]);
                }
            },
            reconnect: () => connect()
        };

        // Начальная инициализация при загрузке страницы
        document.addEventListener('DOMContentLoaded', init);

        // Повторная инициализация при ajax-переходе (ожидается, что такой event будет вызван при смене контента)
        document.addEventListener('ajaxPageLoaded', reinit);

    })();
}
