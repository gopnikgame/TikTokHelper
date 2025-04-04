using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NLog.Extensions.Logging;
using TikTokHelper_Electron.Models;
using TikTokHelper_Electron.Services;

namespace TikTokHelper_Electron.Extensions
{
    public static class ServiceCollectionExt
    {
        public static IServiceCollection AddAppServices(this IServiceCollection services)
        {
            services.AddSingleton<SettingsViewModel>();
            services.AddLogging(b =>
            {
                b.ClearProviders();
                b.AddNLog();
            });

            return services;
        }
    }
}

