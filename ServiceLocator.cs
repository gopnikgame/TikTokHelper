using Microsoft.Extensions.DependencyInjection;

namespace TikTokHelper_Electron
{
    public static class ServiceLocator
    {
        public static IServiceProvider ServiceProvider { get; set; } = default!;
    }
}
