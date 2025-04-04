using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace TikTokHelper_Electron.Services
{
    /// <summary>
    /// Опции конфигурации для сервиса Node.js
    /// </summary>
    public class NodeJsServiceOptions
    {
        /// <summary>
        /// Хост, на котором будет работать WebSocket сервер Node.js
        /// В production среде обычно это "0.0.0.0", чтобы сервер принимал соединения со всех интерфейсов
        /// </summary>
        public string WebSocketServerHost { get; set; } = "localhost";

        /// <summary>
        /// Порт, на котором будет работать WebSocket сервер Node.js
        /// </summary>
        public int WebSocketServerPort { get; set; } = 3000;
    }

    public class NodeJsService : IHostedService, IAsyncDisposable
    {
        private readonly ILogger<NodeJsService> _logger;
        private readonly NodeJsServiceOptions _options;
        private Process? _nodeProcess;
        private bool _disposed;
        private readonly string _serverJsPath;
        private readonly string _nodeExePath;
        private readonly int _maxRetryAttempts = 3;
        private int _currentRetryAttempt;

        // Используем порт из опций вместо константы
        private int ServerPort => _options.WebSocketServerPort;
        private static readonly string[] NodePaths = GetNodePaths();
        private static readonly string[] RequiredPackages =
        {
            "socket.io",
            "express",
            "tiktok-live-connector",
            "cors"
        };

        // Определения для повышения производительности логирования
        private static readonly Action<ILogger, string, Exception?> _logNodeExecutable =
            LoggerMessage.Define<string>(LogLevel.Information, new EventId(1, nameof(NodeJsService)), "Node.js executable: {Path}");
        private static readonly Action<ILogger, string, Exception?> _logServerJsPath =
            LoggerMessage.Define<string>(LogLevel.Information, new EventId(2, nameof(NodeJsService)), "Server script path: {Path}");
        private static readonly Action<ILogger, int, Exception?> _logPortReleased =
            LoggerMessage.Define<int>(LogLevel.Information, new EventId(3, nameof(NodeJsService)), "Port {Port} successfully released.");
        private static readonly Action<ILogger, int, int, Exception?> _logPortInUse =
            LoggerMessage.Define<int, int>(LogLevel.Warning, new EventId(4, nameof(NodeJsService)), "Port {Port} is in use, attempt {Attempt}.");
        private static readonly Action<ILogger, int?, Exception?> _logPreviousServer =
            LoggerMessage.Define<int?>(LogLevel.Warning, new EventId(5, nameof(NodeJsService)), "Previous Node.js server process detected (PID: {PID}). Attempting to stop it for a restart.");
        private static readonly Action<ILogger, Exception?> _logStoppingServer =
            LoggerMessage.Define(LogLevel.Information, new EventId(6, nameof(NodeJsService)), "Stopping Node.js server...");
        private static readonly Action<ILogger, int, Exception?> _logGracefulStop =
            LoggerMessage.Define<int>(LogLevel.Information, new EventId(7, nameof(NodeJsService)), "Attempting to gracefully stop Node.js process (PID: {PID})");
        private static readonly Action<ILogger, Exception?> _logForcedTermination =
            LoggerMessage.Define(LogLevel.Warning, new EventId(8, nameof(NodeJsService)), "Process did not exit gracefully, forcing termination");
        private static readonly Action<ILogger, int, Exception?> _logPortStillInUse =
            LoggerMessage.Define<int>(LogLevel.Error, new EventId(9, nameof(NodeJsService)), "Port {Port} is still in use after aggressive cleanup.");
        private static readonly Action<ILogger, int, Exception?> _logAggressivePortRelease =
            LoggerMessage.Define<int>(LogLevel.Warning, new EventId(10, nameof(NodeJsService)), "Attempting aggressive port release for port {Port}");
        private static readonly Action<ILogger, string, Exception?> _logPortReleaseOutput =
            LoggerMessage.Define<string>(LogLevel.Information, new EventId(11, nameof(NodeJsService)), "Port release command output: {Output}");
        private static readonly Action<ILogger, string, Exception?> _logPortReleaseError =
            LoggerMessage.Define<string>(LogLevel.Warning, new EventId(12, nameof(NodeJsService)), "Port release command error: {Error}");
        private static readonly Action<ILogger, string, Exception?> _logPathError =
            LoggerMessage.Define<string>(LogLevel.Debug, new EventId(13, nameof(NodeJsService)), "Error while checking node path: {Path}");
        private static readonly Action<ILogger, string, Exception?> _logWhichError =
            LoggerMessage.Define<string>(LogLevel.Debug, new EventId(14, nameof(NodeJsService)), "Error while executing which/where command: {Message}");
        private static readonly Action<ILogger, string, Exception?> _logInstallingPackage =
            LoggerMessage.Define<string>(LogLevel.Information, new EventId(15, nameof(NodeJsService)), "Installing missing package: {Package}");
        private static readonly Action<ILogger, string, Exception?> _logInstallOutput =
            LoggerMessage.Define<string>(LogLevel.Information, new EventId(16, nameof(NodeJsService)), "Install output: {Output}");
        private static readonly Action<ILogger, string, Exception?> _logInstallError =
            LoggerMessage.Define<string>(LogLevel.Warning, new EventId(17, nameof(NodeJsService)), "Install error: {Error}");
        private static readonly Action<ILogger, Exception?> _logServerReady =
            LoggerMessage.Define(LogLevel.Information, new EventId(18, nameof(NodeJsService)), "Node.js server is ready");
        private static readonly Action<ILogger, string, Exception?> _logServerNotReady =
            LoggerMessage.Define<string>(LogLevel.Debug, new EventId(19, nameof(NodeJsService)), "Server not ready yet: {Message}");
        private static readonly Action<ILogger, int, Exception?> _logStartError =
            LoggerMessage.Define<int>(LogLevel.Error, new EventId(20, nameof(NodeJsService)), "Attempt {Attempt} to start Node.js server failed");
        private static readonly Action<ILogger, Exception, string, Exception?> _logStopError =
            LoggerMessage.Define<Exception, string>(LogLevel.Error, new EventId(21, nameof(NodeJsService)), "{Exception}{Message}");
        private static readonly Action<ILogger, Exception, string, Exception?> _logPortReleaseFailure =
            LoggerMessage.Define<Exception, string>(LogLevel.Error, new EventId(22, nameof(NodeJsService)), "{Exception}{Message}");
        private static readonly Action<ILogger, string, string, int, Exception?> _logServerConfig =
            LoggerMessage.Define<string, string, int>(LogLevel.Information, new EventId(23, nameof(NodeJsService)), "Starting Node.js server in {Environment} mode on {Host}:{Port}");

        public NodeJsService(ILogger<NodeJsService> logger, IOptions<NodeJsServiceOptions> options)
        {
            _logger = logger;
            _options = options.Value;
            _serverJsPath = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "js", "server.js"));
            _nodeExePath = FindNodeExecutable();
            _logNodeExecutable(_logger, _nodeExePath, null);
            _logServerJsPath(_logger, _serverJsPath, null);
            _logServerConfig(_logger, Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production",
                _options.WebSocketServerHost, _options.WebSocketServerPort, null);
        }

        public bool IsRunning => _nodeProcess != null && !_nodeProcess.HasExited;
        public int? ProcessId => _nodeProcess?.Id;

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            if (IsRunning)
            {
                _logPreviousServer(_logger, ProcessId, null);
                await StopAsync(cancellationToken);
            }

            await EnsurePortAvailableAsync(cancellationToken);

            _currentRetryAttempt = 0;
            bool started = false;
            Exception? lastException = null;

            while (!started && _currentRetryAttempt < _maxRetryAttempts && !cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await EnsureDependenciesInstalledAsync(cancellationToken);
                    StartNodeJsProcess();
                    await VerifyServerReadyAsync(cancellationToken);
                    _currentRetryAttempt = 0;
                    started = true;
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    lastException = ex;
                    _logStartError(_logger, _currentRetryAttempt + 1, ex);
                    _currentRetryAttempt++;
                    await Task.Delay(2000, cancellationToken);
                }
            }

            if (!started && !cancellationToken.IsCancellationRequested)
            {
                throw lastException ?? new InvalidOperationException("Failed to start Node.js server");
            }
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            _logStoppingServer(_logger, null);

            if (_nodeProcess == null) return;

            try
            {
                if (!_nodeProcess.HasExited)
                {
                    _logGracefulStop(_logger, _nodeProcess.Id, null);

                    if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                    {
                        _nodeProcess.Kill(true);
                    }
                    else
                    {
                        Process.Start("kill", $"-TERM {_nodeProcess.Id}");
                    }

                    var sw = Stopwatch.StartNew();
                    while (!_nodeProcess.HasExited && sw.Elapsed < TimeSpan.FromSeconds(10) && !cancellationToken.IsCancellationRequested)
                    {
                        await Task.Delay(500, cancellationToken);
                    }

                    if (!_nodeProcess.HasExited)
                    {
                        _logForcedTermination(_logger, null);
                        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                        {
                            _nodeProcess.Kill();
                        }
                        else
                        {
                            Process.Start("kill", $"-KILL {_nodeProcess.Id}");
                        }
                    }
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logStopError(_logger, ex, "Failed to stop Node.js process gracefully", null);
            }
            finally
            {
                _nodeProcess?.Dispose();
                _nodeProcess = null;
                if (!cancellationToken.IsCancellationRequested)
                {
                    await EnsurePortAvailableAsync(cancellationToken);
                }
            }
        }

        private async Task EnsurePortAvailableAsync(CancellationToken cancellationToken)
        {
            const int maxAttempts = 3;
            int attempts = 0;

            while (IsPortInUse(ServerPort))
            {
                if (attempts >= maxAttempts || cancellationToken.IsCancellationRequested)
                {
                    _logPortStillInUse(_logger, ServerPort, null);
                    throw new InvalidOperationException($"Port {ServerPort} is still in use after aggressive cleanup.");
                }

                _logPortInUse(_logger, ServerPort, attempts + 1, null);
                await KillProcessOnPortAsync(ServerPort, cancellationToken);
                await Task.Delay(2000, cancellationToken);
                attempts++;
            }

            _logPortReleased(_logger, ServerPort, null);
        }

        private async Task KillProcessOnPortAsync(int port, CancellationToken cancellationToken)
        {
            try
            {
                _logAggressivePortRelease(_logger, port, null);

                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var processResult = await KillWindowsProcessOnPortAsync(port, cancellationToken);
                    _logPortReleaseOutput(_logger, processResult.Output, null);
                    if (!string.IsNullOrEmpty(processResult.Error))
                    {
                        _logPortReleaseError(_logger, processResult.Error, null);
                    }
                }
                else
                {
                    var processResult = await KillLinuxProcessOnPortAsync(port, cancellationToken);
                    _logPortReleaseOutput(_logger, processResult.Output, null);
                    if (!string.IsNullOrEmpty(processResult.Error))
                    {
                        _logPortReleaseError(_logger, processResult.Error, null);
                    }
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logPortReleaseFailure(_logger, ex, "Failed to execute aggressive port release", null);
            }
        }

        private static async Task<(string Output, string Error)> KillWindowsProcessOnPortAsync(int port, CancellationToken cancellationToken)
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c \"for /f \"tokens=5\" %%%%a in ('netstat -aon ^| find \":{port}\"') do taskkill /F /PID %%%%a\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            var outputBuilder = new StringBuilder();
            var errorBuilder = new StringBuilder();

            process.OutputDataReceived += (sender, args) => {
                if (args.Data != null)
                    outputBuilder.AppendLine(args.Data);
            };
            process.ErrorDataReceived += (sender, args) => {
                if (args.Data != null)
                    errorBuilder.AppendLine(args.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync(cancellationToken);

            var output = outputBuilder.ToString();
            var error = errorBuilder.ToString();

            await Task.Delay(2000, cancellationToken);

            return (output, error);
        }

        private static async Task<(string Output, string Error)> KillLinuxProcessOnPortAsync(int port, CancellationToken cancellationToken)
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "/bin/bash",
                    Arguments = $"-c \"sudo ss -tulnp | grep ':{port}' | awk '{{print $7}}' | cut -d'\"' -f2 | xargs -r kill\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            var outputBuilder = new StringBuilder();
            var errorBuilder = new StringBuilder();

            process.OutputDataReceived += (sender, args) => {
                if (args.Data != null)
                    outputBuilder.AppendLine(args.Data);
            };
            process.ErrorDataReceived += (sender, args) => {
                if (args.Data != null)
                    errorBuilder.AppendLine(args.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync(cancellationToken);

            var output = outputBuilder.ToString();
            var error = errorBuilder.ToString();

            await Task.Delay(2000, cancellationToken);

            return (output, error);
        }

        private static bool IsPortInUse(int port)
        {
            try
            {
                using var listener = new TcpListener(IPAddress.Any, port);
                listener.Start();
                listener.Stop();
                return false;
            }
            catch (SocketException)
            {
                return true;
            }
        }

        private static string[] GetNodePaths()
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return new string[]
                {
                    @"C:\Program Files\nodejs\node.exe",
                    @"C:\Program Files (x86)\nodejs\node.exe",
                    @"C:\nodejs\node.exe",
                    @"%APPDATA%\npm\node.exe"
                };
            }
            else
            {
                return new string[]
                {
                    "/usr/bin/node",
                    "/usr/local/bin/node",
                    "/opt/homebrew/bin/node",
                    "/bin/node",
                    Environment.ExpandEnvironmentVariables("$HOME/.nvm/versions/node/$(nvm version default)/bin/node"),
                    Environment.ExpandEnvironmentVariables("$HOME/.nvm/versions/node/$(node -v)/bin/node")
                };
            }
        }

        private string FindNodeExecutable()
        {
            foreach (var path in NodePaths)
            {
                try
                {
                    var expandedPath = Environment.ExpandEnvironmentVariables(path);

                    if (expandedPath.Contains("$("))
                    {
                        expandedPath = ExecuteBashCommand($"echo {expandedPath}").Trim();
                    }

                    if (File.Exists(expandedPath))
                    {
                        return expandedPath;
                    }
                }
                catch (Exception ex)
                {
                    _logPathError(_logger, path, ex);
                }
            }

            try
            {
                var whichCommand = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "where node" : "which node";
                var nodePath = ExecuteCommand(whichCommand);
                if (!string.IsNullOrEmpty(nodePath) && File.Exists(nodePath.Trim()))
                {
                    return nodePath.Trim();
                }
            }
            catch (Exception ex)
            {
                _logWhichError(_logger, ex.Message, ex);
            }

            // Для Docker и некоторых Linux-дистрибутивов можно добавить проверку дополнительных путей
            string[] additionalPaths = {
                "/usr/local/bin/nodejs",
                "/usr/bin/nodejs"
            };

            foreach (var path in additionalPaths)
            {
                if (File.Exists(path))
                {
                    return path;
                }
            }

            throw new FileNotFoundException("Node.js executable not found. Please install Node.js.");
        }

        private static string ExecuteCommand(string command)
        {
            var escapedCommand = command.Replace("\"", "\\\"");
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "cmd.exe" : "/bin/bash",
                    Arguments = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? $"/c \"{escapedCommand}\"" : $"-c \"{escapedCommand}\"",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }
            };

            process.Start();
            string result = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return result;
        }

        private static string ExecuteBashCommand(string command)
        {
            var escapedCommand = command.Replace("\"", "\\\"");
            var process = new Process()
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "/bin/bash",
                    Arguments = $"-c \"{escapedCommand}\"",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }
            };
            process.Start();
            string result = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return result;
        }

        private async Task EnsureDependenciesInstalledAsync(CancellationToken cancellationToken)
        {
            foreach (var package in RequiredPackages)
            {
                if (cancellationToken.IsCancellationRequested) return;

                using var checkProcess = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = _nodeExePath,
                        Arguments = $"npm list {package}",
                        WorkingDirectory = Path.GetDirectoryName(_serverJsPath),
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }
                };

                checkProcess.Start();
                await checkProcess.WaitForExitAsync(cancellationToken);
                var output = await checkProcess.StandardOutput.ReadToEndAsync(cancellationToken);

                if (output.Contains("missing") || output.Contains("empty"))
                {
                    _logInstallingPackage(_logger, package, null);

                    using var installProcess = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = _nodeExePath,
                            Arguments = $"npm install {package}",
                            WorkingDirectory = Path.GetDirectoryName(_serverJsPath),
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        }
                    };

                    installProcess.Start();
                    await installProcess.WaitForExitAsync(cancellationToken);
                    var installOutput = await installProcess.StandardOutput.ReadToEndAsync(cancellationToken);
                    var installError = await installProcess.StandardError.ReadToEndAsync(cancellationToken);

                    _logInstallOutput(_logger, installOutput, null);
                    if (!string.IsNullOrEmpty(installError))
                    {
                        _logInstallError(_logger, installError, null);
                    }
                }
            }
        }

        private void StartNodeJsProcess()
        {
            _nodeProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = _nodeExePath,
                    Arguments = _serverJsPath,
                    WorkingDirectory = Path.GetDirectoryName(_serverJsPath),
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                    Environment =
                    {
                        ["NODE_ENV"] = "production",
                        ["HOST"] = _options.WebSocketServerHost,
                        ["PORT"] = _options.WebSocketServerPort.ToString(),
                        ["HOSTNAME"] = _options.WebSocketServerHost // Дополнительная переменная для некоторых Node.js приложений
                    }
                }
            };

            // Определяем для обработчиков событий статические переменные на уровне класса,
            // чтобы они не создавались каждый раз при запуске процесса
            var logInfo = LoggerMessage.Define<string>(LogLevel.Information, new EventId(100, "NodeJsOutput"), "{Message}");
            var logError = LoggerMessage.Define<string>(LogLevel.Error, new EventId(101, "NodeJsError"), "{Message}");

            _nodeProcess.OutputDataReceived += (sender, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                {
                    logInfo(_logger, args.Data, null);
                }
            };

            _nodeProcess.ErrorDataReceived += (sender, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                {
                    logError(_logger, args.Data, null);
                }
            };

            _nodeProcess.Start();
            _nodeProcess.BeginOutputReadLine();
            _nodeProcess.BeginErrorReadLine();
        }

        private async Task VerifyServerReadyAsync(CancellationToken cancellationToken)
        {
            // Для проверки всегда используем localhost, даже если сервер слушает на 0.0.0.0,
            // так как проверка выполняется локально внутри приложения
            string healthCheckHost = "localhost";

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) }; // Увеличиваем таймаут для Docker
            var retries = 0;
            const int maxRetries = 15; // Увеличиваем количество попыток для работы в Docker

            while (retries < maxRetries && !cancellationToken.IsCancellationRequested)
            {
                try
                {
                    // Проверяем доступность сервера через эндпоинт /health
                    var response = await client.GetAsync($"http://{healthCheckHost}:{ServerPort}/health", cancellationToken);
                    if (response.IsSuccessStatusCode)
                    {
                        _logServerReady(_logger, null);
                        return;
                    }
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
                {
                    _logServerNotReady(_logger, ex.Message, ex);
                }

                // Увеличиваем интервал между повторами
                await Task.Delay(Math.Min(1000 * (retries + 1), 5000), cancellationToken);
                retries++;
            }

            if (!cancellationToken.IsCancellationRequested)
            {
                throw new InvalidOperationException($"Node.js server did not become ready in time after {maxRetries} attempts");
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (_disposed) return;
            _disposed = true;

            await StopAsync(CancellationToken.None);
            _nodeProcess?.Dispose();
            GC.SuppressFinalize(this);
        }
    }
}
