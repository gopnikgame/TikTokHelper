using MediatR;
using NLog;

namespace TikTokHelper_Electron.Notify
{
    public record MarketItemCheckNotify(string ItemId, string Name, int Price, int PriceMin, int PriceMax, int Items, int Concurents) : INotification;
    public record LogNotify(LogEventInfo LogEvent, string Message) : INotification;
    public record MarketPriceNotify(string ItemId, string Name, int Price) : INotification;
    public record MarketSoldNotify(string ItemId, string Name) : INotification;
    public record MarketListenNotify(string ItemId, string Name, int Price) : INotification;
}
