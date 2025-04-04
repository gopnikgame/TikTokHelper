using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NLog.Extensions.Logging;
using TikTokHelper_Electron.Models;
using TikTokHelper_Electron.Services;
using TikTokHelper_Electron.Data;
using Microsoft.EntityFrameworkCore;
using System.Reflection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using System.Net;


var builder = WebApplication.CreateBuilder(args);

// Получаем информацию из конфигурации и переменных окружения
var appConfig = builder.Configuration.GetSection("AppConfig");
var baseDomain = Environment.GetEnvironmentVariable("DOMAIN") ??
                 appConfig["BaseDomain"] ??
                 "monitoring.tik-talk.ru";
var enableHttps = bool.Parse(Environment.GetEnvironmentVariable("ENABLE_HTTPS") ??
                            appConfig["EnableHTTPS"] ??
                            "true");
var adminEmail = Environment.GetEnvironmentVariable("ADMIN_EMAIL") ??
                appConfig["DefaultAdminEmail"] ??
                "info@vpnline.online";
var adminPassword = Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "VjLSzaO9uFJ0qS4";

// Конфигурация путей к данным
string dataDirectory = Environment.GetEnvironmentVariable("DATA_DIRECTORY") ??
                      Path.Combine(builder.Environment.ContentRootPath, appConfig["DataDirectory"] ?? "data");
Directory.CreateDirectory(dataDirectory); // Создаем директорию, если не существует
Directory.CreateDirectory(Path.Combine(dataDirectory, "logs")); // Создаем директорию для логов

Console.WriteLine($"Используется директория данных: {dataDirectory}");
Console.WriteLine($"Домен: {baseDomain}, HTTPS: {enableHttps}");

// Расширенная настройка для работы за прокси (NGINX)
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // Включаем обработку всех заголовков проксирования
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost;

    // Очищаем сети и прокси для доверия всем внешним источникам
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();

    // Увеличиваем лимит заголовков для работы с несколькими прокси
    options.ForwardLimit = 2;

    // Разрешаем все хосты для случаев, когда Host заголовок изменен прокси
    options.AllowedHosts.Add(baseDomain);
    options.AllowedHosts.Add("*");
});

// Настройка CORS для WebSocket соединений
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder
            .AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader();
    });

    options.AddPolicy("AllowSpecificOrigin", builder =>
    {
        var allowedOrigins = new[] {
            $"https://{baseDomain}",
            $"http://{baseDomain}",
            $"wss://{baseDomain}",
            $"ws://{baseDomain}",
            "https://localhost:5001",
            "http://localhost:5000",
            "http://localhost:3000",
            "ws://localhost:3000"
        };

        builder
            .WithOrigins(allowedOrigins)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

// Добавляем контекст базы данных и Identity
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?.Replace("{DataDirectory}", dataDirectory)
    ?? $"Data Source={Path.Combine(dataDirectory, "tiktokhelper.db")}";

Console.WriteLine($"Строка подключения к БД: {connectionString}");

builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    options.UseSqlite(connectionString);
    // Добавляем детальное логирование в dev-режиме
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
});

// Настройка Identity из appsettings.json
var identityConfig = builder.Configuration.GetSection("Identity");

// Добавляем Identity с поддержкой ролей
builder.Services.AddDefaultIdentity<ApplicationUser>(options =>
{
    options.SignIn.RequireConfirmedAccount = bool.Parse(identityConfig["RequireConfirmedAccount"] ?? "false");
    options.User.RequireUniqueEmail = bool.Parse(identityConfig["RequireUniqueEmail"] ?? "true");
    options.SignIn.RequireConfirmedEmail = bool.Parse(identityConfig["RequireConfirmedEmail"] ?? "false");
    options.User.AllowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._@+";

    // Настройки пароля из конфигурации
    var passwordConfig = identityConfig.GetSection("Password");
    options.Password.RequireDigit = bool.Parse(passwordConfig["RequireDigit"] ?? "true");
    options.Password.RequiredLength = int.Parse(passwordConfig["RequiredLength"] ?? "8");
    options.Password.RequireNonAlphanumeric = bool.Parse(passwordConfig["RequireNonAlphanumeric"] ?? "true");
    options.Password.RequireUppercase = bool.Parse(passwordConfig["RequireUppercase"] ?? "true");
    options.Password.RequireLowercase = bool.Parse(passwordConfig["RequireLowercase"] ?? "true");
})
.AddRoles<IdentityRole>() // Добавляем поддержку ролей
.AddEntityFrameworkStores<ApplicationDbContext>();

// Настройка для блокировки страницы регистрации
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("DisableRegistration", policy =>
        policy.RequireAssertion(context => false)); // Всегда возвращает false - запрещает доступ всем

    // Добавляем политику для администраторов
    options.AddPolicy("RequireAdministratorRole", policy =>
        policy.RequireRole("Administrator"));
});

// Настройка cookie для перенаправления на страницу доступа запрещен
builder.Services.ConfigureApplicationCookie(options =>
{
    options.LoginPath = "/Identity/Account/Login";
    options.AccessDeniedPath = "/Identity/Account/AccessDenied";
    options.Cookie.SecurePolicy = enableHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.HttpOnly = true;

    // Установка домена для куки в production
    if (!builder.Environment.IsDevelopment() && !string.IsNullOrEmpty(baseDomain))
    {
        options.Cookie.Domain = baseDomain;
    }
});

// Настройка Razor Pages с глобальными конвенциями
builder.Services.AddRazorPages(options =>
{
    // Блокируем доступ к странице регистрации
    options.Conventions.AuthorizePage("/Identity/Account/Register", "DisableRegistration");

    // Если не в режиме разработки, требуем авторизацию для всех страниц
    if (!builder.Environment.IsDevelopment())
    {
        // Защита всех страниц, кроме явно разрешенных
        options.Conventions.AuthorizeFolder("/");
        options.Conventions.AllowAnonymousToPage("/Index"); // Главная страница доступна без авторизации
        options.Conventions.AllowAnonymousToPage("/Identity/Account/Login");
    }

    // Добавляем защиту для административных страниц
    options.Conventions.AuthorizeFolder("/Admin", "RequireAdministratorRole");
});

// Настройка HTTPS
builder.Services.AddHsts(options =>
{
    options.Preload = true;
    options.IncludeSubDomains = true;
    options.MaxAge = TimeSpan.FromDays(365);
});

// Усиленная защита заголовков безопасности для Production
if (!builder.Environment.IsDevelopment())
{
    builder.Services.AddResponseCompression(options =>
    {
        options.EnableForHttps = true;
    });

    builder.Services.AddAntiforgery(options =>
    {
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.SuppressXFrameOptionsHeader = false;
    });
}

builder.Services.AddControllersWithViews();
builder.Services.AddHostedService<NodeJsService>();

// Настройка MediatR
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(Assembly.GetExecutingAssembly()));

// Настройка логирования
builder.Services.AddLogging(logging =>
{
    logging.ClearProviders();
    logging.AddConsole();
    logging.AddDebug();

    try
    {
        logging.AddNLog(builder.Configuration);
        Console.WriteLine("NLog успешно настроен");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Ошибка настройки NLog: {ex.Message}");
    }
});

// Настройка путей WebSocket
builder.Services.Configure<NodeJsServiceOptions>(options =>
{
    // В контейнере Node.js сервис доступен по имени сервиса
    var nodeJsHost = Environment.GetEnvironmentVariable("NODEJS_HOST") ??
                    (builder.Environment.IsDevelopment() ? "localhost" : "nodejs");
    var nodeJsPort = int.Parse(Environment.GetEnvironmentVariable("NODEJS_PORT") ?? "3000");

    options.WebSocketServerHost = nodeJsHost;
    options.WebSocketServerPort = nodeJsPort;

    Console.WriteLine($"NodeJS сервис настроен на {nodeJsHost}:{nodeJsPort}");
});

var app = builder.Build();

// Применяем заголовки проксирования раньше всего в пайплайне
app.UseForwardedHeaders();

// Настройка конвейера запросов HTTP
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler("/Error");

    // Добавляем заголовки безопасности
    app.Use(async (context, next) =>
    {
        // Установка заголовков безопасности
        context.Response.Headers.Append("X-Content-Type-Options", "nosniff");
        context.Response.Headers.Append("X-Frame-Options", "DENY");
        context.Response.Headers.Append("X-XSS-Protection", "1; mode=block");
        context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");

        // Добавляем Content-Security-Policy для HTTPS
        if (context.Request.IsHttps || context.Request.Headers["X-Forwarded-Proto"] == "https")
        {
            // Расширенная CSP политика с поддержкой TikTok
            context.Response.Headers.Append(
                "Content-Security-Policy",
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https: *.tiktok.com *.tiktokcdn.com; " +
                "font-src 'self'; " +
                "media-src 'self' blob:; " +
                "connect-src 'self' wss://*.tik-talk.ru ws://localhost:* http://localhost:* https://*.tik-talk.ru ws://nodejs:3000;"
            );
        }

        await next();
    });

    app.UseHsts();

    // В production окружении перенаправление на HTTPS делает nginx
    if (enableHttps && builder.Environment.IsEnvironment("Staging"))
    {
        app.UseHttpsRedirection();
    }

    // Включаем сжатие ответов
    app.UseResponseCompression();
}

// Включаем CORS для определенной политики
app.UseCors("AllowSpecificOrigin");

// Настройка провайдера MIME-типов для статических файлов, включая аудио форматы
var provider = new FileExtensionContentTypeProvider();
if (!provider.Mappings.ContainsKey(".wav"))
{
    provider.Mappings[".wav"] = "audio/wav";
}
if (!provider.Mappings.ContainsKey(".mp3"))
{
    provider.Mappings[".mp3"] = "audio/mpeg";
}
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider
});

app.UseRouting();

// Добавляем middleware для аутентификации
app.UseAuthentication();
app.UseAuthorization();

app.MapRazorPages();
app.MapControllers();

// Применение миграций базы данных при запуске
try
{
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        db.Database.Migrate();
        Console.WriteLine("Миграции базы данных успешно применены");
    }
}
catch (Exception ex)
{
    Console.WriteLine($"Ошибка при применении миграций: {ex.Message}");
}

// Заполнение базы начальными данными
try
{
    await SeedData(app.Services);
}
catch (Exception ex)
{
    Console.WriteLine($"Ошибка при заполнении данных: {ex.Message}");
}

await app.StartAsync();
app.WaitForShutdown();


// Метод заполнения базы данных (seeding) для создания пользователя по умолчанию и роли администратора
async Task SeedData(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
    var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    try
    {
        // Создаем роль администратора, если ее еще нет
        if (!await roleManager.RoleExistsAsync("Administrator"))
        {
            await roleManager.CreateAsync(new IdentityRole("Administrator"));
            logger.LogInformation("Роль 'Administrator' успешно создана.");
        }

        // Проверяем наличие пользователя по email
        var adminUser = await userManager.FindByEmailAsync(adminEmail);
        if (adminUser == null)
        {
            adminUser = new ApplicationUser
            {
                UserName = adminEmail, // Используем email в качестве UserName
                Email = adminEmail
            };

            var result = await userManager.CreateAsync(adminUser, adminPassword);
            if (result.Succeeded)
            {
                // Добавляем пользователя в роль администратора
                await userManager.AddToRoleAsync(adminUser, "Administrator");
                logger.LogInformation($"Пользователь '{adminEmail}' успешно создан и назначен администратором.");
            }
            else
            {
                logger.LogError($"Ошибка создания пользователя: {string.Join("; ", result.Errors.Select(e => e.Description))}");
            }
        }
        else
        {
            // Обновляем имя пользователя, если оно не совпадает с email
            if (adminUser.UserName != adminEmail)
            {
                adminUser.UserName = adminEmail;
                await userManager.UpdateAsync(adminUser);
                logger.LogInformation($"UserName пользователя обновлён на '{adminEmail}'");
            }

            // Если пользователь существует, но не в роли администратора - добавляем его в роль
            if (!await userManager.IsInRoleAsync(adminUser, "Administrator"))
            {
                await userManager.AddToRoleAsync(adminUser, "Administrator");
                logger.LogInformation($"Пользователь '{adminEmail}' назначен администратором.");
            }
        }
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Ошибка при заполнении базы данных");
        throw;
    }
}
