process.stdin.setEncoding('utf8');
process.stdout.setEncoding('utf8');

// Enhanced error handling
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

const { WebcastPushConnection } = require('tiktok-live-connector');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// Получаем хост и порт из переменных окружения или используем значения по умолчанию
const HOST = process.env.HOST || 'localhost';
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// Configuration
const MAX_CONNECTIONS = 50;
const CONNECTION_TIMEOUT = 50000; // 50 seconds

// Enhanced logging with timestamps
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, data || '');
}

class TikTokConnectionManager {
    constructor() {
        this.connections = new Map();
        this.connectionStats = {
            total: 0,
            active: 0,
            errors: 0
        };
    }

    async connect(username, socket) {
        const connectionId = `${username}_${socket.id}`;

        // Cleanup existing connection
        if (this.connections.has(connectionId)) {
            this.disconnect(connectionId);
        }

        log(`Connecting to @${username} for socket ${socket.id}`);

        try {
            const tiktokConnection = new WebcastPushConnection(username, {
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                clientParams: {
                    "app_language": "en-US",
                    "device_platform": "web"
                },
                // Добавлены прокси-опции для обхода блокировок в разных регионах
                requestOptions: {
                    timeout: 10000, // Увеличиваем таймаут для запросов в Docker
                    retries: 3,      // Добавляем повторные попытки при сетевых ошибках
                }
            });

            // Store connection
            this.connections.set(connectionId, {
                tiktokConnection,
                socket,
                connectedAt: new Date()
            });
            this.connectionStats.total++;

            // Setup event forwarding
            this.setupEventHandlers(tiktokConnection, socket, username);

            // Connect with timeout
            await Promise.race([
                tiktokConnection.connect(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT)
                )
            ]);

            this.connectionStats.active++;
            return tiktokConnection;
        } catch (err) {
            this.connectionStats.errors++;
            log(`Connection failed to @${username}`, err);
            throw err;
        }
    }

    setupEventHandlers(connection, socket, username) {
        const events = [
            'connected', 'disconnected', 'streamEnd',
            'member', 'chat', 'gift', 'roomUser',
            'like', 'social', 'emote', 'envelope',
            'questionNew', 'linkMicBattle', 'linkMicArmies',
            'liveIntro', 'subscribe', 'follow', 'share', 'error'
        ];

        // Debug all incoming events
        connection.on('rawData', (data) => {
            log(`Raw data from @${username}`, { type: data?.type });
        });

        events.forEach(event => {
            connection.on(event, (data) => {
                try {
                    log(`Event ${event} from @${username}`);

                    // Special handling for connection status
                    if (event === 'connected') {
                        socket.emit('connectionStatus', {
                            connected: true,
                            roomId: data.roomId,
                            username
                        });
                        return;
                    }

                    // Transform data for client
                    const clientData = this.transformEventData(event, data);
                    socket.emit(event, clientData);

                } catch (err) {
                    log(`Error processing ${event} event`, err);
                }
            });
        });

        // Error handling
        connection.on('error', (err) => {
            log(`Connection error with @${username}`, err);
            socket.emit('connectionStatus', {
                connected: false,
                error: err.message
            });
        });
    }

    transformEventData(event, data) {
        const baseData = {
            event,
            timestamp: new Date().toISOString(),
            serverReceivedAt: Date.now()
        };

        switch (event) {
            case 'chat':
                return {
                    ...baseData,
                    uniqueId: data.uniqueId,
                    userId: data.userId,
                    comment: data.comment,
                    profilePictureUrl: data.profilePictureUrl
                };

            case 'gift':
                return {
                    ...baseData,
                    uniqueId: data.uniqueId,
                    giftId: data.giftId,
                    giftName: data.giftName || `Подарок ${data.giftId}`,
                    diamondCount: data.diamondCount,
                    repeatCount: data.repeatCount || 1,
                    profilePictureUrl: data.profilePictureUrl,
                    extendedGiftInfo: data.extendedGiftInfo // Включаем всю расширенную информацию для удобства
                };

            default:
                return { ...baseData, ...data };
        }
    }

    disconnect(connectionId) {
        if (this.connections.has(connectionId)) {
            const { tiktokConnection, socket } = this.connections.get(connectionId);
            log(`Disconnecting ${connectionId}`);

            try {
                tiktokConnection.disconnect();
                // Не отключаем сокет здесь, чтобы клиент мог переподключиться
                // socket.disconnect(true);
            } catch (err) {
                log(`Error disconnecting ${connectionId}`, err);
            }

            this.connections.delete(connectionId);
            this.connectionStats.active--;
        }
    }

    getStats() {
        return {
            ...this.connectionStats,
            activeConnections: this.connections.size,
            environment: NODE_ENV,
            serverHost: HOST,
            serverPort: PORT
        };
    }
}

function setupExpress() {
    const app = express();

    // Enhanced CORS configuration с учетом домена
    app.use(cors({
        origin: ['http://localhost:3000', "https://monitoring.tik-talk.ru", "http://monitoring.tik-talk.ru", '*'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    }));

    app.use(express.json({ limit: '10kb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    // Health endpoints
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            env: NODE_ENV,
            host: HOST,
            port: PORT
        });
    });

    app.get('/stats', (req, res) => {
        res.status(200).json(connectionManager.getStats());
    });

    return app;
}

// Initialize
const app = setupExpress();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        // Добавлены разрешенные домены
        origin: ["http://localhost:3000", "https://monitoring.tik-talk.ru", "http://monitoring.tik-talk.ru", "*"],
        methods: ["GET", "POST"],
        credentials: true
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 30000,
        skipMiddlewares: true
    },
    // Настройки для надежного соединения за прокси
    pingInterval: 25000,  // Увеличиваем для более стабильной работы за NGINX
    pingTimeout: 10000,   // Увеличиваем таймаут пинга
    maxHttpBufferSize: 1e6, // 1MB

    // Поддержка проксирования через nginx
    path: '/socket.io', // Явно указываем путь для WebSocket
    allowEIO3: true,    // Для совместимости со старыми клиентами
    transports: ['websocket', 'polling'] // Поддерживаем оба транспорта
});

const connectionManager = new TikTokConnectionManager();

// Socket.IO connection handling
io.on('connection', (socket) => {
    log(`New client connected: ${socket.id} from ${socket.handshake.headers.origin || 'unknown origin'}`);

    // Join TikTok live room
    socket.on('join', async (username, options, callback) => {
        try {
            if (!username || typeof username !== 'string') {
                throw new Error('Invalid username');
            }

            // Чистим имя пользователя
            username = username.replace('@', '').trim();

            log(`Join request for @${username} from ${socket.id}`);
            // Получаем объект подключения (WebcastPushConnection)
            const tiktokConnection = await connectionManager.connect(username, socket);

            // Запрашиваем список доступных подарков
            if (tiktokConnection.getAvailableGifts) {
                tiktokConnection.getAvailableGifts().then(giftList => {
                    socket.emit('availableGifts', giftList);
                }).catch(err => {
                    log(`Error fetching available gifts for @${username}`, err);
                });
            }

            if (typeof callback === 'function') {
                callback({
                    success: true,
                    message: `Connected to @${username}`
                });
            } else {
                log(`No valid callback provided for join event at socket ${socket.id}`);
            }
        } catch (err) {
            log(`Join failed for ${socket.id}`, err);
            if (typeof callback === 'function') {
                callback({
                    success: false,
                    message: err.message || 'Connection failed'
                });
            }
        }
    });


    // Disconnect handling
    socket.on('disconnect', (reason) => {
        log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
        // Очистка всех подключений для данного сокета
        for (const [id, conn] of connectionManager.connections) {
            if (conn.socket.id === socket.id) {
                connectionManager.disconnect(id);
            }
        }
    });

    // Error handling
    socket.on('error', (err) => {
        log(`Socket error (${socket.id})`, err);
    });

    // Добавляем обработчик пинга для диагностики
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({
                time: Date.now(),
                status: 'ok'
            });
        }
    });
});


// Start server with better error handling for port conflicts
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        log(`Port ${PORT} is already in use. Please close the other application or use a different port.`);
        console.error(`Port ${PORT} is already in use. Exiting.`);
        process.exit(1);
    } else {
        log(`Server error: ${error.message}`);
        console.error('Server error:', error);
    }
});

// Используем HOST и PORT из переменных окружения
server.listen(PORT, HOST, () => {
    log(`Сервер запущен на ${HOST}:${PORT} в режиме ${NODE_ENV}`);
    log(`WebSocket endpoint: ${HOST === '0.0.0.0' ? 'ws://localhost' : `ws://${HOST}`}:${PORT}`);
    log(`Health endpoint: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
});

// Improve shutdown function to properly handle cleanup
const shutdown = () => {
    log('Shutting down server...');
    let cleanupCompleted = false;

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
        if (!cleanupCompleted) {
            log('Forcing shutdown after timeout');
            process.exit(1);
        }
    }, 10000); // Увеличиваем время ожидания до 10 секунд для Docker

    try {
        // Close all TikTok connections
        for (const id of connectionManager.connections.keys()) {
            try {
                connectionManager.disconnect(id);
            } catch (err) {
                log(`Error disconnecting ${id}: ${err.message}`);
            }
        }

        // Close HTTP server
        server.close(() => {
            log('HTTP server closed successfully');
            cleanupCompleted = true;
            clearTimeout(forceExitTimeout);
            process.exit(0);
        });
    } catch (err) {
        log(`Error during shutdown: ${err.message}`);
        process.exit(1);
    }
};

// Обработка сигналов завершения для корректного завершения в Docker
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// Add SIGBREAK handler for Windows
process.on('SIGBREAK', shutdown);
process.on('SIGHUP', shutdown);

// Добавляем обработчик для диагностики необработанных исключений
process.on('uncaughtException', (err) => {
    log(`Uncaught Exception: ${err.message}`, err);
    console.error('Uncaught Exception:', err);
    // Не завершаем процесс немедленно в production режиме
    if (NODE_ENV !== 'production') {
        process.exit(1);
    }
});

// Сообщение о готовности сервера (для проверки Node.js service)
log('Server initialization complete and ready to accept connections');
