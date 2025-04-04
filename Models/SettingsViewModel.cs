using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using TikTokHelper_Electron.Services;

namespace TikTokHelper_Electron.Models
{
    public partial class SettingsViewModel : ObservableObject
    {
        [ObservableProperty]
        private string speechVoice = string.Empty; // Инициализация значением по умолчанию
        [ObservableProperty]
        private int speechRate = 4;
        [ObservableProperty]
        private int notifyDelay = 200;
        [ObservableProperty]
        private string joinText = "@name подключился к стирмчику";
        [ObservableProperty]
        private string likeText = "@name активно лайкает";
        [ObservableProperty]
        private string background = "/Assets/splashscreen.png"; // Изменено на локальный файл
        [ObservableProperty]
        private string fontFamily = "Arial"; // Добавлено свойство FontFamily

        public ReadOnlyObservableCollection<string> VoiceList { get; }
        public ReadOnlyObservableCollection<string> Fonts { get; }

        public SettingsViewModel(SpeechService speechService)
        {
            if (speechService == null) throw new ArgumentNullException(nameof(speechService));

            var voices = speechService.VoiceList().Result;
            VoiceList = new ReadOnlyObservableCollection<string>(new ObservableCollection<string>(voices));
            Fonts = new ReadOnlyObservableCollection<string>(new ObservableCollection<string> { "Arial", "Verdana", "Tahoma" });
        }

        partial void OnNotifyDelayChanged(int value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.NotifyDelay = value;
            // Settings.Default.Save();
        }

        partial void OnSpeechVoiceChanged(string value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.SpeechVoice = value;
            // Settings.Default.Save();
        }

        partial void OnSpeechRateChanged(int value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.SpeechRate = value;
            // Settings.Default.Save();
        }

        partial void OnLikeTextChanged(string value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.LikeText = value;
            // Settings.Default.Save();
        }

        partial void OnJoinTextChanged(string value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.JoinText = value;
            // Settings.Default.Save();
        }

        partial void OnBackgroundChanged(string value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.Background = value;
            // Settings.Default.Save();
        }

        partial void OnFontFamilyChanged(string value)
        {
            // Сохранение значения в настройках
            // Пример: Settings.Default.FontFamily = value;
            // Settings.Default.Save();
        }
    }
}
