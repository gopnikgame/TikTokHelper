using MediatR;

namespace TikTokHelper_Electron.CommandQueries
{
    public record Command() : IRequest;

    internal class CommandHandler : IRequestHandler<Command>
    {
        public Task Handle(Command request, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
