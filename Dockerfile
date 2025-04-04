FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app
EXPOSE 80

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY ["TikTokHelper_Electron.csproj", "."]
RUN dotnet restore "TikTokHelper_Electron.csproj"
COPY . .
WORKDIR "/src"
RUN dotnet build "TikTokHelper_Electron.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "TikTokHelper_Electron.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Создаем директорию для данных
RUN mkdir -p /app/data/logs

# По умолчанию значение переменной DataDirectory это /app/data
ENV DataDirectory=/app/data

ENTRYPOINT ["dotnet", "TikTokHelper_Electron.dll"]
