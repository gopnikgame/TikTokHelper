function initSpeekMonitoring() {
    const masterToggle = document.getElementById('voiceAnnouncerMasterToggle');
    const eventsControls = document.getElementById('voiceEventsControls');

    if (!masterToggle || !eventsControls) {
        // Если элементы не найдены, выходим из функции
        return;
    }

    // Загрузка состояния
    const settings = window.voiceAnnouncerAPI?.getSettings() || {};
    if (settings.ENABLED) {
        masterToggle.checked = true;
        eventsControls.style.display = 'block';

        if (settings.EVENTS) {
            const quickToggleLikes = document.getElementById('quickToggleLikes');
            const quickToggleGifts = document.getElementById('quickToggleGifts');
            const quickToggleMessages = document.getElementById('quickToggleMessages');
            const quickToggleFollows = document.getElementById('quickToggleFollows');

            if (quickToggleLikes) {
                quickToggleLikes.checked = settings.EVENTS.likes?.enabled || false;
            }
            if (quickToggleGifts) {
                quickToggleGifts.checked = settings.EVENTS.gifts?.enabled || false;
            }
            if (quickToggleMessages) {
                quickToggleMessages.checked = settings.EVENTS.messages?.enabled || false;
            }
            if (quickToggleFollows) {
                quickToggleFollows.checked = settings.EVENTS.follows?.enabled || false;
            }
        }
    } else {
        masterToggle.checked = false;
        eventsControls.style.display = 'none';
    }

    // Удаляем ранее установленные обработчики, чтобы не вешать их повторно
    masterToggle.replaceWith(masterToggle.cloneNode(true));
    const newMasterToggle = document.getElementById('voiceAnnouncerMasterToggle');
    newMasterToggle.addEventListener('change', function () {
        window.voiceAnnouncerAPI?.updateSettings({ ENABLED: this.checked });
        eventsControls.style.display = this.checked ? 'block' : 'none';
    });

    // Переподключаем обработчики для всех переключателей внутри eventsControls
    const toggles = eventsControls.querySelectorAll('.event-toggle');
    toggles.forEach(toggle => {
        toggle.replaceWith(toggle.cloneNode(true));
    });
    document.querySelectorAll('#voiceEventsControls .event-toggle').forEach(toggle => {
        toggle.addEventListener('change', function () {
            const eventType = this.id.replace('quickToggle', '').toLowerCase();
            const newSettings = {
                EVENTS: {
                    [eventType]: {
                        enabled: this.checked
                    }
                }
            };
            window.voiceAnnouncerAPI?.updateSettings(newSettings);
        });
    });
}

document.addEventListener('DOMContentLoaded', initSpeekMonitoring);
document.addEventListener('ajaxPageLoaded', initSpeekMonitoring);
