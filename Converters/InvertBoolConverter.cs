using System.Globalization;

namespace TikTokHelper_Electron.Converters
{
    public class InvertBoolConverter
    {
        public bool Convert(bool value)
        {
            return !value;
        }
    }
}
