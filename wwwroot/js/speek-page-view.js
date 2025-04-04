(function () {
    function initSettingsPage() {
        try {
            // Если основной элемент отсутствует – выходим
            if (!document.getElementById('voiceLanguage')) {
                console.warn('[Debug] Элемент voiceLanguage не найден.');
                return;
            }

            // Загрузка настроек
            const settings = window.voiceAnnouncerAPI?.getSettings() || {};

            // Заполнение основных настроек голоса
            const voiceLanguage = document.getElementById('voiceLanguage');
            if (voiceLanguage) {
                voiceLanguage.value = settings.VOICE_LANGUAGE || 'ru-RU';
            }

            const voiceRate = document.getElementById('voiceRate');
            if (voiceRate) {
                voiceRate.value = settings.VOICE_RATE || 1.0;
            }
            const voiceRateValue = document.getElementById('voiceRateValue');
            if (voiceRateValue) {
                voiceRateValue.textContent = settings.VOICE_RATE || 1.0;
            }

            const voicePitch = document.getElementById('voicePitch');
            if (voicePitch) {
                voicePitch.value = settings.VOICE_PITCH || 1.0;
            }
            const voicePitchValue = document.getElementById('voicePitchValue');
            if (voicePitchValue) {
                voicePitchValue.textContent = settings.VOICE_PITCH || 1.0;
            }

            const voiceVolume = document.getElementById('voiceVolume');
            if (voiceVolume) {
                voiceVolume.value = settings.VOICE_VOLUME || 1.0;
            }
            const voiceVolumeValue = document.getElementById('voiceVolumeValue');
            if (voiceVolumeValue) {
                voiceVolumeValue.textContent = settings.VOICE_VOLUME || 1.0;
            }

            // Дополнительные настройки сообщений
            const eventCooldown = document.getElementById('eventCooldown');
            if (eventCooldown) {
                eventCooldown.value = settings.EVENT_COOLDOWN || 3000;
            }
            const maxQueueSize = document.getElementById('maxQueueSize');
            if (maxQueueSize) {
                maxQueueSize.value = settings.MAX_QUEUE_SIZE || 5;
            }

            // Функция для заполнения списка голосов
            function populateVoiceSelect(voices) {
                const voiceSelect = document.getElementById('voiceName');
                if (!voiceSelect) return;
                voiceSelect.innerHTML = '<option value="">Системный по умолчанию</option>';
                console.log('[Debug] Всего голосов для заполнения:', voices.length);
                voices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.name;
                    option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' - по умолчанию' : ''}`;
                    if (voice.name === (window.voiceAnnouncerAPI?.getSettings().VOICE_NAME || '')) {
                        option.selected = true;
                    }
                    voiceSelect.appendChild(option);
                });
            }

            // Получаем голоса и заполняем select
            let voices = window.voiceAnnouncerAPI?.getVoices() || [];
            populateVoiceSelect(voices);

            // Добавляем обработчик изменения голосов
            if (window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = function () {
                    voices = window.voiceAnnouncerAPI?.getVoices() || [];
                    populateVoiceSelect(voices);
                };
            }

            // Заполнение настроек событий
            if (settings.EVENTS) {
                for (const eventType in settings.EVENTS) {
                    if (!settings.EVENTS.hasOwnProperty(eventType)) continue;
                    const eventConfig = settings.EVENTS[eventType];
                    const toggle = document.querySelector(`#event${capitalizeFirstLetter(eventType)}Enabled`);
                    if (toggle) {
                        toggle.checked = eventConfig.enabled || false;
                    }
                    for (const setting in eventConfig) {
                        if (!eventConfig.hasOwnProperty(setting)) continue;
                        const input = document.querySelector(`[data-event="${eventType}"][data-setting="${setting}"]`);
                        if (input) {
                            if (input.type === 'checkbox') {
                                input.checked = eventConfig[setting];
                            } else if (input.type === 'text' && input.value && input.value.includes(',')) {
                                input.value = Array.isArray(eventConfig[setting])
                                    ? eventConfig[setting].join(', ')
                                    : eventConfig[setting];
                            } else {
                                input.value = eventConfig[setting] || '';
                            }
                        }
                    }
                }
            }

            // Обработчики изменения ползунков
            document.getElementById('voiceRate')?.addEventListener('input', function () {
                document.getElementById('voiceRateValue').textContent = this.value;
            });
            document.getElementById('voicePitch')?.addEventListener('input', function () {
                document.getElementById('voicePitchValue').textContent = this.value;
            });
            document.getElementById('voiceVolume')?.addEventListener('input', function () {
                document.getElementById('voiceVolumeValue').textContent = this.value;
            });

            // Тестирование голоса
            document.getElementById('testVoiceBtn')?.addEventListener('click', function () {
                try {
                    if (window.voiceAnnouncerAPI) {
                        window.voiceAnnouncerAPI.testVoice();
                    }
                } catch (ex) {
                    console.error('[Debug] Ошибка при тестировании голоса:', ex);
                    showAlert('Ошибка тестирования голоса', 'danger');
                }
            });

            // Сохранение настроек
            document.getElementById('saveSettingsBtn')?.addEventListener('click', function () {
                try {
                    const newSettings = {
                        VOICE_LANGUAGE: document.getElementById('voiceLanguage')?.value,
                        VOICE_NAME: document.getElementById('voiceName')?.value,
                        VOICE_RATE: parseFloat(document.getElementById('voiceRate')?.value),
                        VOICE_PITCH: parseFloat(document.getElementById('voicePitch')?.value),
                        VOICE_VOLUME: parseFloat(document.getElementById('voiceVolume')?.value),
                        EVENT_COOLDOWN: parseInt(document.getElementById('eventCooldown')?.value) || 3000,
                        MAX_QUEUE_SIZE: parseInt(document.getElementById('maxQueueSize')?.value) || 5,
                        EVENTS: {
                            likes: getEventSettings('likes'),
                            gifts: getEventSettings('gifts'),
                            messages: getEventSettings('messages'),
                            joins: getEventSettings('joins'),
                            follows: getEventSettings('follows')
                        }
                    };

                    if (window.voiceAnnouncerAPI?.updateSettings(newSettings)) {
                        showAlert('Настройки успешно сохранены!', 'success');
                    } else {
                        showAlert('Ошибка при сохранении настроек', 'danger');
                    }
                } catch (ex) {
                    console.error('[Debug] Ошибка при сохранении настроек:', ex);
                    showAlert('Ошибка при сохранении настроек', 'danger');
                }
            });

            // Сброс настроек
            document.getElementById('resetSettingsBtn')?.addEventListener('click', function () {
                try {
                    if (confirm('Вы действительно хотите сбросить все настройки озвучки?')) {
                        if (window.voiceAnnouncerAPI?.resetSettings()) {
                            location.reload();
                        }
                    }
                } catch (ex) {
                    console.error('[Debug] Ошибка при сбросе настроек:', ex);
                    showAlert('Ошибка при сбросе настроек', 'danger');
                }
            });
        } catch (error) {
            console.error('[Debug] Ошибка инициализации страницы настройки:', error);
            showAlert('Ошибка инициализации страницы', 'danger');
        }
    }

    function getEventSettings(eventType) {
        try {
            const toggle = document.querySelector(`#event${capitalizeFirstLetter(eventType)}Enabled`);
            const settings = { enabled: toggle ? toggle.checked : false };
            const additionalInputs = document.querySelectorAll(`[data-event="${eventType}"]`);
            additionalInputs.forEach(input => {
                if (input.id.includes('Enabled')) return;
                const setting = input.dataset.setting;
                if (input.type === 'checkbox') {
                    settings[setting] = input.checked;
                } else if (input.type === 'text' && input.value.includes(',')) {
                    settings[setting] = input.value.split(',').map(s => s.trim()).filter(Boolean);
                } else {
                    settings[setting] = isNaN(input.value) ? input.value : Number(input.value);
                }
            });
            return settings;
        } catch (error) {
            console.error('[Debug] Ошибка получения настроек события:', error);
            return {};
        }
    }

    function capitalizeFirstLetter(string) {
        try {
            return string.charAt(0).toUpperCase() + string.slice(1);
        } catch (error) {
            console.error('[Debug] Ошибка преобразования строки:', error);
            return string;
        }
    }

    function showAlert(message, type) {
        try {
            const alert = document.createElement('div');
            alert.className = `alert alert-${type} position-fixed top-0 end-0 m-3`;
            alert.style.zIndex = '2000';
            alert.textContent = message;
            document.body.appendChild(alert);
            setTimeout(() => alert.remove(), 3000);
        } catch (error) {
            console.error('[Debug] Ошибка отображения alert:', error);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('voiceLanguage')) {
            initSettingsPage();
        }
    });
    document.addEventListener('ajaxPageLoaded', () => {
        if (document.getElementById('voiceLanguage')) {
            initSettingsPage();
        }
    });
})();
