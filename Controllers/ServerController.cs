using System;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Hosting;

namespace TikTokHelper_Electron.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ServerController : ControllerBase
    {
        private readonly ILogger<ServerController> _logger;
        private readonly IWebHostEnvironment _env;

        // Определение делегатов для LoggerMessage
        private static readonly Action<ILogger, string, Exception?> _logDirectoryNotFound =
            LoggerMessage.Define<string>(
                LogLevel.Warning,
                new EventId(1, nameof(ServerController)),
                "Directory not found: {SoundDir}");

        private static readonly Action<ILogger, Exception?> _logErrorRetrievingSounds =
            LoggerMessage.Define(
                LogLevel.Error,
                new EventId(2, nameof(ServerController)),
                "Error retrieving sound files");

        public ServerController(ILogger<ServerController> logger, IWebHostEnvironment env)
        {
            _logger = logger;
            _env = env;
        }

        [HttpGet("sounds")]
        public IActionResult GetSounds()
        {
            try
            {
                // Путь к папке со звуками: wwwroot/Assets/Sounds
                string soundDir = Path.Combine(_env.WebRootPath, "Assets", "Sounds");
                if (!Directory.Exists(soundDir))
                {
                    _logDirectoryNotFound(_logger, soundDir, null);
                    return NotFound("Directory not found");
                }

                // Получаем список файлов с нужными расширениями
                var files = Directory.EnumerateFiles(soundDir)
                    .Where(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase)
                             || f.EndsWith(".wav", StringComparison.OrdinalIgnoreCase)
                             || f.EndsWith(".ogg", StringComparison.OrdinalIgnoreCase))
                    .Select(Path.GetFileName)
                    .ToList();

                return Ok(files);
            }
            catch (Exception ex)
            {
                _logErrorRetrievingSounds(_logger, ex);
                return StatusCode(500, "Internal server error.");
            }
        }
    }
}
