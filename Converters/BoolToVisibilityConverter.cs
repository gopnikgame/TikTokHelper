using Microsoft.AspNetCore.Mvc.Rendering;

namespace TikTokHelper_Electron.Converters
{
    public class BoolToVisibilityConverter
    {
        public string Convert(bool value)
        {
            return value ? "visible" : "hidden";
        }
    }
}
