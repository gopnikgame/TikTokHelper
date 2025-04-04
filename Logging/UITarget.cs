using MediatR;
using NLog;
using NLog.Targets;
using TikTokHelper_Electron.Notify;

namespace TikTokHelper_Electron.Logging
{
    [Target("UITarget")]
    public sealed class UITarget : TargetWithLayout  //or inherit from Target
    {
        private readonly IServiceProvider _serviceProvider;

        public UITarget(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
        }

        protected override async void Write(LogEventInfo logEvent)
        {
            var msg = Layout.Render(logEvent);
            var mediator = _serviceProvider.GetService<IMediator>(); // Используем IServiceProvider для получения IMediator
            if (mediator != null)
            {
                await mediator.Publish(new LogNotify(logEvent, msg));
            }
        }
    }
}

