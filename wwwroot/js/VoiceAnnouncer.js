// VoiceAnnouncer.js - Полная версия с настройками для каждого типа событий
(function () {
    'use strict';

    // Конфигурация по умолчанию
    const DEFAULT_CONFIG = {
        ENABLED: false,
        VOICE_LANGUAGE: 'ru-RU',
        VOICE_NAME: '',
        VOICE_RATE: 1.0,
        VOICE_PITCH: 1.0,
        VOICE_VOLUME: 1.0,
        MAX_QUEUE_SIZE: 5,
        EVENT_COOLDOWN: 3000,

        // Индивидуальные настройки для каждого типа событий
        EVENTS: {
            likes: {
                enabled: true,
                minCount: 10,
                template: (data) => `${data.uniqueId || 'Кто-то'} поставил ${data.likeCount} лайков`
            },
            gifts: {
                enabled: true,
                template: (data) => {
                    const giftName = data.giftName || `Подарок ${data.giftId}`;
                    return `${data.uniqueId || 'Кто-то'} отправил ${giftName}`;
                },
                streakTemplate: (data, count) => {
                    const giftName = data.giftName || `Подарок ${data.giftId}`;
                    return `${data.uniqueId || 'Кто-то'} отправил серию ${count} ${giftName}!`;
                }
            },
            messages: {
                enabled: false,
                minLength: 30,
                keywords: ['спасибо', 'благодарю', 'thanks', 'thank you'],
                template: (data) => `${data.uniqueId || 'Кто-то'} пишет: ${truncateText(data.comment, 50)}`
            },
            joins: {
                enabled: false,
                template: (data) => `${data.uniqueId || 'Новый зритель'} присоединился`
            },
            follows: {
                enabled: true,
                template: (data) => `${data.uniqueId || 'Кто-то'} подписался на канал!`
            }
        }
    };

    // Состояние системы
    const state = {
        config: { ...DEFAULT_CONFIG },
        speechSynthesis: window.speechSynthesis,
        voices: [],
        currentVoice: null,
        eventQueue: [],
        isSpeaking: false,
        lastEventTime: 0,
        streakGifts: {},
        isConnected: false
    };

    // Функция нормализации типа эвента
    function normalizeEventType(originalType) {
        switch (originalType) {
            case 'chat':
                return 'messages';
            case 'like':
                return 'likes';
            case 'gift':
                return 'gifts';
            case 'member':
                return 'joins';
            case 'follow':
                return 'follows';
            default:
                return originalType;
        }
    }

    // Инициализация модуля
    function init() {
        console.log('[VoiceAnnouncer] Инициализация...');
        loadSettings();
        setupEventListeners();
        checkConnectionStatus();

        if (!state.speechSynthesis) {
            console.warn('[VoiceAnnouncer] Web Speech API не поддерживается');
            return;
        }

        loadVoices();
    }

    // Загрузка сохраненных настроек
    function loadSettings() {
        const savedSettings = localStorage.getItem('voiceAnnouncerSettings');
        if (savedSettings) {
            try {
                state.config = deepMerge(DEFAULT_CONFIG, JSON.parse(savedSettings));
                console.log('[VoiceAnnouncer] Настройки загружены');
            } catch (e) {
                console.error('[VoiceAnnouncer] Ошибка загрузки настроек:', e);
                resetSettings();
            }
        } else {
            resetSettings();
        }
    }

    // Сохранение текущих настроек
    function saveSettings() {
        localStorage.setItem('voiceAnnouncerSettings', JSON.stringify(state.config));
        console.log('[VoiceAnnouncer] Настройки сохранены');
    }

    // Сброс настроек к значениям по умолчанию
    function resetSettings() {
        state.config = { ...DEFAULT_CONFIG };
        saveSettings();
        return true;
    }

    // Глубокая merge объектов
    function deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] instanceof Object && key in target) {
                result[key] = deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    // Загрузка доступных голосов
    function loadVoices() {
        console.log('[VoiceAnnouncer] Попытка загрузить голоса...');
        state.voices = state.speechSynthesis.getVoices();

        if (state.voices.length === 0) {
            console.warn('[VoiceAnnouncer] Список голосов пуст, повторная попытка через 500 мс');
            state.speechSynthesis.onvoiceschanged = loadVoices;
            setTimeout(loadVoices, 500);
            return;
        }

        if (state.config.VOICE_NAME) {
            state.currentVoice = state.voices.find(v => v.name === state.config.VOICE_NAME) ||
                state.voices.find(v => v.lang === state.config.VOICE_LANGUAGE) ||
                state.voices[0];
        } else {
            state.currentVoice = state.voices.find(v => v.lang === state.config.VOICE_LANGUAGE) ||
                state.voices[0];
        }

        console.log('[VoiceAnnouncer] Доступные голоса:', state.voices);
        console.log('[VoiceAnnouncer] Выбранный голос:', state.currentVoice);
    }

    // Настройка обработчиков событий
    function setupEventListeners() {
        document.addEventListener('tiktokEvent', handleGlobalEvent);
        document.addEventListener('voiceSettingsUpdated', handleSettingsUpdate);
    }

    // Обработчик обновления настроек
    function handleSettingsUpdate(e) {
        if (e.detail) {
            state.config = deepMerge(state.config, e.detail);
            saveSettings();

            if (e.detail.VOICE_LANGUAGE || e.detail.VOICE_NAME) {
                loadVoices();
            }

            console.log('[VoiceAnnouncer] Настройки обновлены:', e.detail);
        }
    }

    // Проверка состояния подключения
    function checkConnectionStatus() {
        if (window.tiktokDebug?.getState) {
            const tiktokState = window.tiktokDebug.getState();
            state.isConnected = tiktokState.isConnected;
            console.log('[VoiceAnnouncer] Статус подключения:', state.isConnected ? 'connected' : 'disconnected');
        }
    }

    // Основной обработчик событий TikTok с нормализацией типа
    function handleGlobalEvent(e) {
        if (!state.config.ENABLED || !state.isConnected) return;

        const now = Date.now();
        if (now - state.lastEventTime < state.config.EVENT_COOLDOWN) return;

        // Нормализуем тип события
        const originalType = e.detail.type;
        const normalizedType = normalizeEventType(originalType);

        const event = e.detail;
        const eventConfig = state.config.EVENTS[normalizedType];
        if (!eventConfig || !eventConfig.enabled) return;

        state.lastEventTime = now;
        switch (normalizedType) {
            case 'likes':
                handleLikeEvent(event, eventConfig);
                break;
            case 'gifts':
                handleGiftEvent(event, eventConfig);
                break;
            case 'messages':
                handleMessageEvent(event, eventConfig);
                break;
            case 'joins':
            case 'follows':
                addToQueue(eventConfig.template(event));
                break;
        }
    }

    // Обработчик событий лайков
    function handleLikeEvent(data, config) {
        const likeCount = parseInt(data.likeCount) || 1;
        if (likeCount >= (config.minCount || 1)) {
            const text = typeof config.template === 'function'
                ? config.template(data)
                : `${data.uniqueId || 'Кто-то'} поставил ${likeCount} лайков`;
            addToQueue(text);
        }
    }

    // Обработчик событий подарков
    function handleGiftEvent(data, config) {
        const giftId = data.giftId;
        const isStreak = data.giftType === 1 && !data.repeatEnd;

        if (isStreak) {
            handleStreakGift(data, giftId);
            return;
        }

        if (state.streakGifts[giftId]) {
            announceStreakGift(data, giftId, config);
            return;
        }

        announceSingleGift(data, config);
    }

    // Обработчик серийных подарков
    function handleStreakGift(data, giftId) {
        if (!state.streakGifts[giftId]) {
            state.streakGifts[giftId] = {
                user: data.uniqueId,
                count: data.repeatCount || 1,
                giftName: data.giftName || `Подарок ${giftId}`
            };
        } else {
            state.streakGifts[giftId].count += data.repeatCount || 1;
        }
    }

    // Озвучка серии подарков
    function announceStreakGift(data, giftId, config) {
        const streak = state.streakGifts[giftId];
        const text = typeof config.streakTemplate === 'function'
            ? config.streakTemplate(data, streak.count)
            : `${streak.user || 'Кто-то'} отправил серию ${streak.count} ${streak.giftName}!`;
        addToQueue(text);
        delete state.streakGifts[giftId];
    }

    // Озвучка одиночного подарка
    function announceSingleGift(data, config) {
        const text = typeof config.template === 'function'
            ? config.template(data)
            : `${data.uniqueId || 'Кто-то'} отправил ${data.giftName || `Подарок ${data.giftId}`}`;
        addToQueue(text);
    }

    // Обработчик сообщений чата
    function handleMessageEvent(data, config) {
        const message = data.comment || '';
        const meetsLength = message.length >= (config.minLength || 0);
        const hasKeywords = containsKeywords(message, config.keywords);

        if (meetsLength || hasKeywords) {
            const text = typeof config.template === 'function'
                ? config.template(data)
                : `${data.uniqueId || 'Кто-то'} пишет: ${truncateText(message, 50)}`;
            addToQueue(text);
        }
    }

    // Добавление сообщения в очередь
    function addToQueue(text) {
        if (!text || state.eventQueue.length >= state.config.MAX_QUEUE_SIZE) {
            return;
        }

        state.eventQueue.push(text);
        state.lastEventTime = Date.now();

        if (!state.isSpeaking) {
            processQueue();
        }
    }

    // Обработка очереди сообщений
    function processQueue() {
        if (state.eventQueue.length === 0 || !state.currentVoice) {
            state.isSpeaking = false;
            return;
        }

        state.isSpeaking = true;
        const text = state.eventQueue.shift();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = state.currentVoice;
        utterance.rate = state.config.VOICE_RATE;
        utterance.pitch = state.config.VOICE_PITCH;
        utterance.volume = state.config.VOICE_VOLUME;
        utterance.lang = state.config.VOICE_LANGUAGE;

        utterance.onend = () => {
            setTimeout(processQueue, 500);
        };

        utterance.onerror = (e) => {
            console.error('[VoiceAnnouncer] Ошибка воспроизведения:', e);
            state.isSpeaking = false;
        };

        state.speechSynthesis.speak(utterance);
    }

    // Вспомогательные функции
    function truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    function containsKeywords(text, keywords) {
        if (!keywords || !keywords.length) return false;
        const lowerText = text.toLowerCase();
        return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
    }

    // Публичное API для взаимодействия с другими модулями
    window.voiceAnnouncerAPI = {
        getSettings: function () {
            return { ...state.config };
        },

        updateSettings: function (newSettings) {
            state.config = deepMerge(state.config, newSettings);
            saveSettings();
            document.dispatchEvent(new CustomEvent('voiceSettingsUpdated', { detail: newSettings }));
            return true;
        },

        resetSettings: function () {
            return resetSettings();
        },

        getVoices: function () {
            return state.voices.map(voice => ({
                name: voice.name,
                lang: voice.lang,
                localService: voice.localService,
                default: voice.default
            }));
        },

        testVoice: function (text) {
            console.log('[VoiceAnnouncer] Вызов тестирования голоса, текст:', text);
            if (!state.currentVoice) {
                console.warn('[VoiceAnnouncer] Тест не выполнен, выбранный голос отсутствует!');
                return false;
            }

            const testText = text || (state.config.VOICE_LANGUAGE.startsWith('ru')
                ? 'Проверка голосового сопровождения'
                : 'Voice announcer test');
            console.log('[VoiceAnnouncer] Текст для озвучки теста:', testText);
            addToQueue(testText);
            return true;
        },

        getState: function () {
            return {
                isEnabled: state.config.ENABLED,
                isConnected: state.isConnected,
                isSpeaking: state.isSpeaking,
                queueSize: state.eventQueue.length,
                currentVoice: state.currentVoice?.name,
                streakGifts: { ...state.streakGifts }
            };
        }
    };

    // Инициализация при загрузке страницы
    if (document.readyState === 'complete') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    // Повторная инициализация при AJAX-переходах
    document.addEventListener('ajaxPageLoaded', init);
})();
