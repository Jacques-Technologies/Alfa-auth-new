// index.js - Servidor principal optimizado para producción

const express = require('express');
const { BotFrameworkAdapter, MemoryStorage, ConversationState, UserState } = require('botbuilder');
const { TeamsBot } = require('./bots/teamsBot');
const { MainDialog } = require('./dialogs/mainDialog');
require('dotenv').config();

/**
 * Clase principal del servidor con manejo robusto de errores
 */
class BotServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.bot = null;
        this.adapter = null;
        
        // Configuración
        this.port = process.env.PORT || 3978;
        this.environment = process.env.NODE_ENV || 'development';
        
        // Estado de inicialización
        this.initialized = false;
        this.shutdownInProgress = false;
        
        // Métricas básicas
        this.metrics = {
            startTime: new Date(),
            requestCount: 0,
            errorCount: 0,
            lastActivity: new Date()
        };
    }

    /**
     * Inicializa el servidor completo
     */
    async initialize() {
        try {
            console.log('🚀 Inicializando Alfa Teams Bot...');
            
            // Validar configuración
            this.validateEnvironment();
            
            // Configurar Express
            this.setupExpress();
            
            // Inicializar Bot Framework
            await this.initializeBotFramework();
            
            // Configurar rutas
            this.setupRoutes();
            
            // Configurar manejo de errores
            this.setupErrorHandling();
            
            // Iniciar servidor
            await this.startServer();
            
            // Configurar shutdown graceful
            this.setupGracefulShutdown();
            
            this.initialized = true;
            console.log('✅ Alfa Teams Bot inicializado correctamente');
            console.log(`🌐 Servidor ejecutándose en puerto ${this.port}`);
            
        } catch (error) {
            console.error('❌ Error inicializando servidor:', error);
            process.exit(1);
        }
    }

    /**
     * Valida variables de entorno requeridas
     */
    validateEnvironment() {
        const required = [
            'MicrosoftAppId',
            'MicrosoftAppPassword', 
            'connectionName'
        ];
        
        const missing = required.filter(env => !process.env[env]);
        
        if (missing.length > 0) {
            throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
        }
        
        console.log('✅ Variables de entorno validadas');
    }

    /**
     * Configura Express con middleware básico
     */
    setupExpress() {
        // Middleware básico
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Headers de seguridad básicos
        this.app.use((req, res, next) => {
            res.header('X-Content-Type-Options', 'nosniff');
            res.header('X-Frame-Options', 'DENY');
            res.header('X-XSS-Protection', '1; mode=block');
            next();
        });
        
        // Middleware de métricas
        this.app.use((req, res, next) => {
            this.metrics.requestCount++;
            this.metrics.lastActivity = new Date();
            next();
        });
        
        console.log('✅ Express configurado');
    }

    /**
     * Inicializa Bot Framework y componentes
     */
    async initializeBotFramework() {
        try {
            // Crear adapter
            this.adapter = new BotFrameworkAdapter({
                appId: process.env.MicrosoftAppId,
                appPassword: process.env.MicrosoftAppPassword
            });

            // Configurar manejo de errores del adapter
            this.adapter.onTurnError = async (context, error) => {
                console.error('Bot Framework Error:', error);
                this.metrics.errorCount++;
                
                try {
                    await context.sendActivity('❌ Error interno del bot. Intenta nuevamente.');
                } catch (sendError) {
                    console.error('Error enviando mensaje de error:', sendError);
                }
            };

            // Crear storage y estados
            const memoryStorage = new MemoryStorage();
            const conversationState = new ConversationState(memoryStorage);
            const userState = new UserState(memoryStorage);

            // Crear diálogo principal
            const dialog = new MainDialog();

            // Crear bot
            this.bot = new TeamsBot(conversationState, userState, dialog);
            
            console.log('✅ Bot Framework inicializado');
            
        } catch (error) {
            throw new Error(`Error inicializando Bot Framework: ${error.message}`);
        }
    }

    /**
     * Configura rutas de la aplicación
     */
    setupRoutes() {
        // Ruta principal del bot
        this.app.post('/api/messages', async (req, res) => {
            try {
                await this.adapter.processActivity(req, res, async (context) => {
                    await this.bot.run(context);
                });
            } catch (error) {
                console.error('Error procesando actividad:', error);
                this.metrics.errorCount++;
                
                if (!res.headersSent) {
                    res.status(500).json({ 
                        error: 'Error interno',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });

        // Health check
        this.app.get('/health', (req, res) => {
            const health = {
                status: this.initialized ? 'healthy' : 'initializing',
                timestamp: new Date().toISOString(),
                uptime: Date.now() - this.metrics.startTime.getTime(),
                environment: this.environment,
                metrics: {
                    requests: this.metrics.requestCount,
                    errors: this.metrics.errorCount,
                    lastActivity: this.metrics.lastActivity
                }
            };
            
            res.json(health);
        });

        // Información del bot
        this.app.get('/info', (req, res) => {
            const info = {
                name: 'Alfa Teams Bot',
                version: '2.0.0',
                environment: this.environment,
                startTime: this.metrics.startTime,
                botStats: this.bot ? this.bot.getStats() : null
            };
            
            res.json(info);
        });

        // Métricas detalladas
        this.app.get('/metrics', (req, res) => {
            const metrics = {
                ...this.metrics,
                uptime: Date.now() - this.metrics.startTime.getTime(),
                botStats: this.bot ? this.bot.getStats() : null,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            };
            
            res.json(metrics);
        });

        // Ruta raíz
        this.app.get('/', (req, res) => {
            res.json({
                message: 'Alfa Teams Bot está ejecutándose',
                timestamp: new Date().toISOString(),
                health: '/health',
                info: '/info',
                metrics: '/metrics'
            });
        });

        console.log('✅ Rutas configuradas');
    }

    /**
     * Configura manejo centralizado de errores
     */
    setupErrorHandling() {
        // Manejo de errores de Express
        this.app.use((error, req, res, next) => {
            console.error('Express Error:', error);
            this.metrics.errorCount++;
            
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Error interno del servidor',
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Manejo de rutas no encontradas
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Ruta no encontrada',
                path: req.path,
                timestamp: new Date().toISOString()
            });
        });

        // Manejo de errores no capturados
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            this.metrics.errorCount++;
            
            if (!this.shutdownInProgress) {
                this.gracefulShutdown('uncaughtException');
            }
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.metrics.errorCount++;
        });

        console.log('✅ Manejo de errores configurado');
    }

    /**
     * Inicia el servidor HTTP
     */
    async startServer() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, (error) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`✅ Servidor HTTP iniciado en puerto ${this.port}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Configura shutdown graceful
     */
    setupGracefulShutdown() {
        const signals = ['SIGTERM', 'SIGINT'];
        
        signals.forEach(signal => {
            process.on(signal, () => {
                console.log(`Señal ${signal} recibida`);
                this.gracefulShutdown(signal);
            });
        });
    }

    /**
     * Ejecuta shutdown graceful
     */
    async gracefulShutdown(reason) {
        if (this.shutdownInProgress) {
            console.log('Shutdown ya en progreso, forzando salida...');
            process.exit(1);
        }
        
        this.shutdownInProgress = true;
        console.log(`🔄 Iniciando shutdown graceful (razón: ${reason})`);
        
        try {
            // Cerrar servidor HTTP
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(() => {
                        console.log('✅ Servidor HTTP cerrado');
                        resolve();
                    });
                });
            }
            
            // Limpiar recursos del bot
            if (this.bot && typeof this.bot.cleanup === 'function') {
                await this.bot.cleanup();
                console.log('✅ Recursos del bot limpiados');
            }
            
            // Limpiar recursos de CosmosDB si existen
            const cosmosConfig = require('./config/cosmosConfigs');
            if (cosmosConfig && typeof cosmosConfig.cleanup === 'function') {
                await cosmosConfig.cleanup();
                console.log('✅ Recursos de CosmosDB limpiados');
            }
            
            console.log('✅ Shutdown graceful completado');
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Error durante shutdown graceful:', error);
            process.exit(1);
        }
    }

    /**
     * Obtiene estado del servidor
     */
    getServerStatus() {
        return {
            initialized: this.initialized,
            shutdownInProgress: this.shutdownInProgress,
            port: this.port,
            environment: this.environment,
            metrics: this.metrics
        };
    }
}

// Función principal
async function main() {
    const server = new BotServer();
    await server.initialize();
}

// Iniciar aplicación si es el módulo principal
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error fatal al iniciar aplicación:', error);
        process.exit(1);
    });
}

module.exports = { BotServer };