document.addEventListener('DOMContentLoaded', function () {
    var refreshButton = document.getElementById('refreshGiftsButton');
    if (refreshButton) {
        refreshButton.addEventListener('click', function () {
            console.log('Обновление списка подарков вручную...');
            if (window.soundManager && typeof window.soundManager.initGiftSoundMappings === 'function') {
                // Повторная инициализация привязок подарков
                window.soundManager.initGiftSoundMappings();
                // Перерисовка списка, если элемент с id "soundList" присутствует
                if (document.getElementById('soundList')) {
                    window.soundManager.renderSoundBindings();
                }
                alert('Список подарков обновлён');
            } else {
                alert('SoundManager не инициализирован');
            }
        });
    }
});
