// Основной скрипт приложения (дополненный звуковым менеджером)
(function () {
    'use strict';

    // ==================== Общие функции ====================
    function log(module, message, ...params) {
        console.log(`[${module}]`, message, ...params);
    }

    // ==================== Sound Manager ====================
    if (!window.soundManager) {
        window.soundManager = {
            availableSounds: [],
            soundQueue: [],
            isProcessingQueue: false,
            mappingKey: 'giftSoundMapping',
            soundDelay: localStorage.getItem('soundDelay') || 0,

            // Инициализация звукового менеджера
            init: async function () {
                log('SoundManager', 'Инициализация звукового менеджера');
                // Обновляем ссылки на элементы, если они появились после ajax-загрузки
                this.cacheDomElements();
                await this.loadAvailableSounds();
                // Инициализируем привязки с использованием серверных данных
                await this.initGiftSoundMappings();
                this.setupEventListeners();

                if (this.soundListElement) {
                    this.renderSoundBindings();
                    this.updateUI();
                }
            },

            // Кэширование DOM-элементов
            cacheDomElements: function () {
                this.slider = document.getElementById('soundQueueSlider');
                this.valueDisplay = document.getElementById('soundQueueValue');
                this.uploadForm = document.getElementById('soundUploadForm');
                this.soundFileInput = document.getElementById('soundFileInput');
                this.soundListElement = document.getElementById('soundList');
                this.loadingAlert = document.getElementById('loadingSoundsAlert');
            },

            // Загрузка списка звуков с сервера
            loadAvailableSounds: async function () {
                log('SoundManager', 'Загрузка доступных звуков');
                try {
                    const response = await fetch('/api/server/sounds');
                    if (response.ok) {
                        this.availableSounds = await response.json();
                        log('SoundManager', 'Звуки загружены:', this.availableSounds);
                        return this.availableSounds;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                } catch (error) {
                    console.error('SoundManager: Ошибка загрузки звуков:', error);
                    this.availableSounds = [];
                    return [];
                }
            },

            // Получение текущих привязок с сервера
            getGiftSoundMapping: async function () {
                try {
                    const response = await fetch('/api/server/soundmappings', {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (response.ok) {
                        const mapping = await response.json();
                        return mapping;
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                } catch (error) {
                    console.error('SoundManager: Ошибка получения привязок с сервера, используем fallback:', error);
                    const mappingJson = localStorage.getItem(this.mappingKey);
                    return mappingJson ? JSON.parse(mappingJson) : {};
                }
            },

            // Сохранение привязок на сервере
            saveGiftSoundMapping: async function (mapping) {
                try {
                    const response = await fetch('/api/server/soundmappings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mapping)
                    });
                    if (response.ok) {
                        log('SoundManager', 'Привязки звуков сохранены на сервере');
                    } else {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                } catch (error) {
                    console.error('SoundManager: Ошибка сохранения привязок на сервере, используется fallback:', error);
                    // fallback: сохраняем локально
                    localStorage.setItem(this.mappingKey, JSON.stringify(mapping));
                }
            },

            // Инициализация привязок звуков с использованием серверных данных
            initGiftSoundMappings: async function () {
                log('SoundManager', 'Инициализация привязок звуков');
                const mapping = await this.getGiftSoundMapping();
                let updated = false;

                if (window.tiktokGifts?.length && this.availableSounds.length) {
                    window.tiktokGifts.forEach(gift => {
                        const giftId = gift.id || gift.giftId;
                        if (giftId && !mapping[giftId]) {
                            const randomSound = this.availableSounds[
                                Math.floor(Math.random() * this.availableSounds.length)
                            ];
                            mapping[giftId] = randomSound;
                            updated = true;
                            log('SoundManager', `Случайная привязка для подарка ${giftId}`);
                        }
                    });
                }

                if (updated) {
                    await this.saveGiftSoundMapping(mapping);
                }
                return mapping;
            },

            // Рендеринг списка привязок
            renderSoundBindings: function () {
                if (!this.soundListElement) return;

                this.soundListElement.innerHTML = '';
                const mapping = this.getGiftSoundMappingSync();

                if (window.tiktokGifts?.length) {
                    window.tiktokGifts.forEach(gift => {
                        const giftId = gift.id || gift.giftId;
                        const giftName = gift.name || gift.giftName || `Подарок ${giftId}`;
                        const currentSound = mapping[giftId] || '';

                        // Если есть расширенная информация – пробуем получить изображение подарка
                        let giftImageHtml = '';
                        if (gift.extendedGiftInfo && gift.extendedGiftInfo.image) {
                            let imageSrc = '';
                            if (gift.extendedGiftInfo.image.image) {
                                imageSrc = `data:image/png;base64,${gift.extendedGiftInfo.image.image}`;
                            } else if (gift.extendedGiftInfo.image.url_list && gift.extendedGiftInfo.image.url_list.length > 0) {
                                imageSrc = gift.extendedGiftInfo.image.url_list[0];
                            }
                            if (imageSrc) {
                                giftImageHtml = `<img src="${imageSrc}" alt="${giftName}" class="gift-thumbnail" style="width:40px;height:40px;object-fit:contain;margin-right:10px;">`;
                            }
                        }

                        const li = document.createElement('li');
                        li.className = 'sound-item';
                        li.innerHTML = `
                <div class="sound-info">
                    <div class="sound-gift-name">${giftImageHtml}${giftName}</div>
                    <div class="sound-gift-id">ID: ${giftId}</div>
                </div>
            `;

                        const select = document.createElement('select');
                        select.className = 'form-control sound-select';
                        select.innerHTML = `<option value="">-- Без звука --</option>`;

                        this.availableSounds.forEach(sound => {
                            const option = new Option(sound, sound);
                            if (sound === currentSound) option.selected = true;
                            select.add(option);
                        });

                        select.addEventListener('change', () => {
                            mapping[giftId] = select.value;
                            // Сохраняем изменение как на сервер (если возможно) так и локально (fallback)
                            this.saveGiftSoundMapping(mapping);
                        });

                        const testBtn = document.createElement('button');
                        testBtn.className = 'btn btn-warning sound-test-btn';
                        testBtn.innerHTML = '<i class="bi bi-play-fill"></i> Тест';
                        testBtn.addEventListener('click', () => this.playTestSound(mapping[giftId]));

                        li.append(select, testBtn);
                        this.soundListElement.appendChild(li);
                    });

                    if (this.loadingAlert) {
                        this.loadingAlert.style.display = 'none';
                    }
                    this.soundListElement.style.display = 'block';
                } else {
                    if (this.loadingAlert) {
                        this.loadingAlert.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Список подарков не загружен';
                    }
                }
            },

            // Вспомогательная синхронная версия getGiftSoundMapping для рендера (fallback на localStorage)
            getGiftSoundMappingSync: function () {
                const mappingJson = localStorage.getItem(this.mappingKey);
                return mappingJson ? JSON.parse(mappingJson) : {};
            },

            // Проигрывание тестового звука
            playTestSound: function (soundFile) {
                if (!soundFile) {
                    alert('Выберите звук для теста');
                    return;
                }
                this.queueSound(soundFile);
            },

            // Добавление звука в очередь
            queueSound: function (soundFile) {
                if (!soundFile) return;
                this.soundQueue.push(soundFile);
                if (!this.isProcessingQueue) {
                    this.processSoundQueue();
                }
            },

            // Обработка очереди звуков
            processSoundQueue: async function () {
                this.isProcessingQueue = true;
                while (this.soundQueue.length > 0) {
                    const soundFile = this.soundQueue.shift();
                    this.playSoundImmediate(soundFile);
                    await new Promise(resolve => setTimeout(resolve, this.soundDelay * 10));
                }
                this.isProcessingQueue = false;
            },

            // Непосредственное проигрывание звука
            playSoundImmediate: function (soundFile) {
                if (!soundFile) return;
                const audioUrl = encodeURI(`/Assets/Sounds/${soundFile}`);
                const audio = new Audio(audioUrl);
                audio.play().catch(e => console.error('SoundManager: Ошибка воспроизведения:', e));
            },

            // Настройка обработчиков событий
            setupEventListeners: function () {
                // Обработчик ползунка задержки
                if (this.slider && this.valueDisplay) {
                    // Получаем максимальную задержку из localStorage или по умолчанию 1000мс
                    const storedMaxDelay = localStorage.getItem('soundDelayMax') || 1000;
                    // Обновляем собственно ползунок, учитывая что значение задержки = slider.value * 10
                    this.slider.max = storedMaxDelay / 10;

                    // Если на странице присутствует поле для максимальной задержки – синхронизируем его
                    const maxDelayInput = document.getElementById('soundDelayMaxInput');
                    if (maxDelayInput) {
                        maxDelayInput.value = storedMaxDelay;
                        maxDelayInput.addEventListener('change', () => {
                            const newMax = parseInt(maxDelayInput.value) || 1000;
                            localStorage.setItem('soundDelayMax', newMax);
                            if (this.slider) {
                                this.slider.max = newMax / 10;
                                // Обновляем отображение значения с учетом нового максимума
                                this.valueDisplay.textContent = this.slider.value * 10;
                            }
                        });
                    }

                    this.slider.value = localStorage.getItem('soundDelay') || 0;
                    this.valueDisplay.textContent = this.slider.value * 10;

                    this.slider.addEventListener('input', () => {
                        this.soundDelay = this.slider.value;
                        this.valueDisplay.textContent = this.soundDelay * 10;
                        localStorage.setItem('soundDelay', this.soundDelay);
                    });
                }

                // Обработчик формы загрузки
                if (this.uploadForm) {
                    this.uploadForm.addEventListener('submit', async (e) => {
                        if (this.soundFileInput.files[0]?.size > 5 * 1024 * 1024) {
                            e.preventDefault();
                            alert('Файл слишком большой (макс. 5MB)');
                        }
                    });
                }
            },

            // Обновление UI
            updateUI: function () {
                // Можно добавить дополнительные UI обновления при необходимости
            },

            // Воспроизведение звука для подарка
            playGiftSound: function (giftId) {
                const mapping = this.getGiftSoundMappingSync();
                const soundFile = mapping[giftId];
                if (soundFile) this.queueSound(soundFile);
            }
        };
    }

    // Инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', () => {
        if (window.soundManager) {
            soundManager.init();
        }

        if (!window.tiktokGifts) {
            console.warn('Список подарков не загружен');
        }
    });

    // Повторная инициализация при ajax-переходах
    document.addEventListener('ajaxPageLoaded', () => {
        if (window.soundManager) {
            soundManager.init();
        }
    });

    // Обновление привязок при получении события availableGiftsUpdate
    document.addEventListener('availableGiftsUpdate', async (e) => {
        console.log('[SoundManager] Received availableGiftsUpdate event', e.detail);
        window.tiktokGifts = e.detail;
        if (window.soundManager) {
            await window.soundManager.initGiftSoundMappings();
            if (document.getElementById('soundList')) {
                window.soundManager.renderSoundBindings();
            }
        }
    });

    // Экспортируем функцию для других скриптов
    window.playGiftSound = (giftId) => {
        if (window.soundManager) {
            soundManager.playGiftSound(giftId);
        }
    };
})();
