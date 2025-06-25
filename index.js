// index.js modernizado con mejor manejo de errores y configuración

// Import required packages
const path = require('path');
const restify = require('restify');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import required bot services.
const {
    CloudAdapter,
    ConversationState,
    MemoryStorage,
    UserState,
    ConfigurationBotFrameworkAuthentication,
    CardFactory,
    TeamsInfo
} = require('botbuilder');

// Importar componentes del bot
const { TeamsBot } = require('./bots/teamsBot');
const { MainDialog } = require('./dialogs/mainDialog');

// Validar configuración crítica
console.log('🔧 Validando configuración...');

const requiredEnvVars = [
    'MicrosoftAppId',
    'MicrosoftAppPassword',
    'OAUTH_CONNECTION_NAME'
];

const missingVars = requiredEnvVars.filter(varName => {
    const value = process.env[varName] || process.env[varName.toLowerCase()];
    return !value;
});

if (missingVars.length > 0) {
    console.error('❌ ERROR: Faltan las siguientes variables de entorno:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('Por favor, configura estas variables en el archivo .env');
    process.exit(1);
}

// Configurar nombre de conexión OAuth
const connectionName = process.env.OAUTH_CONNECTION_NAME || process.env.connectionName;
console.log(`🔐 Conexión OAuth configurada: ${connectionName}`);

// Configurar autenticación de Bot Framework
const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MicrosoftAppId || process.env.MICROSOFT_APP_ID,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword || process.env.MICROSOFT_APP_PASSWORD,
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId || process.env.MICROSOFT_APP_TENANT_ID,
    MicrosoftAppType: process.env.MicrosoftAppType || process.env.MICROSOFT_APP_TYPE || 'MultiTenant',
    OAuthConnectionName: connectionName
});

// Crear adaptador
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Configurar manejo de errores mejorado
adapter.onTurnError = async (context, error) => {
    const errorMsg = error.message || 'Ocurrió un error inesperado.';
    console.error(`\n❌ [onTurnError] Error no manejado: ${error.message}`);
    console.error(`📍 Stack trace: ${error.stack}`);

    try {
        // Limpiar estado solo si es necesario
        if (error.message && error.message.includes('authentication')) {
            await conversationState.delete(context);
            console.log('🧹 Estado de conversación limpiado debido a error de autenticación');
        }
        
        // Enviar mensaje amigable al usuario
        let userMessage = '❌ Lo siento, ocurrió un error inesperado.';
        
        if (error.code === 'Unauthorized') {
            userMessage = '🔒 Error de autenticación. Por favor, escribe `login` para iniciar sesión nuevamente.';
        } else if (error.code === 'ServiceUnavailable') {
            userMessage = '🔧 El servicio no está disponible temporalmente. Por favor, intenta en unos momentos.';
        } else if (errorMsg.includes('timeout')) {
            userMessage = '⏰ La operación tardó demasiado tiempo. Por favor, intenta nuevamente.';
        }
        
        await context.sendActivity(userMessage);
        
    } catch (innerError) {
        console.error(`❌ Error adicional en onTurnError: ${innerError.message}`);
    }
};

// Definir almacenamiento de estado para el bot
const memoryStorage = new MemoryStorage();

// Crear estado de conversación y usuario con almacenamiento en memoria
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

// Crear el diálogo principal
const dialog = new MainDialog();

// Crear el bot con el diálogo
const bot = new TeamsBot(conversationState, userState, dialog);

// Configurar puerto
const port = process.env.PORT || process.env.port || 3978;

// Crear servidor HTTP
const server = restify.createServer({
    name: 'Alfa Bot Server',
    version: '1.0.0'
});

// Configurar middleware del servidor
server.use(restify.plugins.bodyParser({
    maxBodySize: 1000000, // 1MB
    mapParams: true,
    mapFiles: false,
    overrideParams: false
}));

// Configuración CORS mejorada
server.use(function corsHandler(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Manejar requests OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.send(200);
        return;
    }
    
    return next();
});

// Middleware para logging de requests
server.use(function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    
    req.on('end', () => {
        const duration = Date.now() - start;
        console.log(`📡 ${method} ${url} - ${res.statusCode} (${duration}ms)`);
    });
    
    return next();
});

// Middleware para agregar la instancia del bot al estado del turno
const addBotToTurnState = (req, res, next) => {
    // Si no existe turnState, crearlo
    if (!req.turnState) {
        req.turnState = new Map();
    }
    // Agregar la instancia del bot al estado del turno
    req.turnState.set('bot', bot);
    return next();
};

// Ruta principal para mensajes de bot
server.post('/api/messages', addBotToTurnState, async (req, res) => {
    try {
        // Logging detallado de actividades
        const body = req.body;
        if (body) {
            const activityType = body.type || 'unknown';
            const activityName = body.name || 'N/A';
            
            console.log(`📨 Actividad recibida - Tipo: ${activityType}, Nombre: ${activityName}`);
            
            // Log específico para diferentes tipos de actividad
            if (activityType === 'message') {
                const messageText = body.text ? `"${body.text.substring(0, 50)}${body.text.length > 50 ? '...' : ''}"` : 'sin texto';
                console.log(`💬 Mensaje: ${messageText}`);
            } else if (activityType === 'invoke') {
                console.log(`🔧 Invoke: "${activityName}"`);
            } else if (activityType === 'event') {
                console.log(`📅 Evento: "${activityName}"`);
            }
        }
        
        // Procesar la solicitud con el adaptador
        await adapter.process(req, res, async (context) => {
            try {
                await bot.run(context);
            } catch (botError) {
                console.error('❌ Error en bot.run():', botError.message);
                throw botError; // Re-lanzar para que lo maneje el adaptador
            }
        });
        
    } catch (error) {
        console.error('❌ Error crítico al procesar mensaje:', error.message);
        console.error(error.stack);
        
        // Enviar respuesta de error si aún no se ha enviado
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Error interno del servidor',
                message: 'No se pudo procesar la solicitud'
            });
        }
    }
});

// Rutas adicionales

// Servir archivos estáticos
server.get('/public/*', restify.plugins.serveStatic({
    directory: path.join(path.resolve(), 'public'),
    appendRequestPath: false,
    default: 'index.html'
}));

// Ruta para manejar callback de OAuth
server.get('/oauthcallback', (req, res, next) => {
    console.log('🔐 Recibida solicitud a /oauthcallback');
    
    const htmlContent = `
    <!DOCTYPE html>
    <html>
        <head>
            <title>Autenticación Completada - Alfa Bot</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .container { 
                    text-align: center; 
                    padding: 2rem;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    backdrop-filter: blur(10px);
                }
                .checkmark { 
                    font-size: 3rem; 
                    color: #4CAF50; 
                    margin-bottom: 1rem;
                }
                h1 { margin: 1rem 0; }
                p { margin: 0.5rem 0; opacity: 0.9; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✅</div>
                <h1>¡Autenticación Completada!</h1>
                <p>Ya puedes cerrar esta ventana y regresar a Microsoft Teams.</p>
                <p>El bot ya está listo para ayudarte.</p>
            </div>
            <script>
                // Cerrar automáticamente después de 3 segundos
                setTimeout(function() {
                    try {
                        window.close();
                    } catch(e) {
                        console.log('No se pudo cerrar la ventana automáticamente');
                    }
                }, 3000);
            </script>
        </body>
    </html>`;
    
    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(htmlContent),
        'Content-Type': 'text/html; charset=utf-8'
    });
    res.write(htmlContent);
    res.end();
    
    return next();
});

// Ruta de salud del servicio
server.get('/health', (req, res, next) => {
    const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        services: {
            bot: !!bot,
            openai: !!process.env.OPENAI_API_KEY,
            oauth: !!connectionName,
            cosmosdb: !!process.env.COSMOSDB_ENDPOINT
        }
    };
    
    res.json(healthStatus);
    return next();
});

// Ruta de información del bot
server.get('/info', (req, res, next) => {
    const botInfo = {
        name: 'Alfa Bot',
        version: '1.0.0',
        description: 'Bot inteligente para empleados de Alfa Corporation',
        features: [
            'Asistente de OpenAI',
            'Acciones de API SIRH',
            'Autenticación OAuth',
            'Búsqueda en documentos',
            'Integración con ServiceNow'
        ],
        endpoints: {
            messages: '/api/messages',
            health: '/health',
            oauth: '/oauthcallback'
        }
    };
    
    res.json(botInfo);
    return next();
});

// Iniciar servidor
server.listen(port, () => {
    console.log('\n🚀 ================================');
    console.log('🤖 Alfa Bot iniciado exitosamente');
    console.log('🚀 ================================');
    console.log(`📡 Servidor: ${server.name} v${server.version}`);
    console.log(`🌐 URL: ${server.url}`);
    console.log(`🔌 Puerto: ${port}`);
    console.log(`🔐 OAuth: ${connectionName}`);
    console.log('\n📚 Endpoints disponibles:');
    console.log('   POST /api/messages   - Mensajes del bot');
    console.log('   GET  /health         - Estado del servicio');
    console.log('   GET  /info           - Información del bot');
    console.log('   GET  /oauthcallback  - Callback OAuth');
    console.log('\n🔗 Enlaces útiles:');
    console.log('   Bot Framework Emulator: https://docs.microsoft.com/azure/bot-service/bot-service-debug-emulator');
    console.log('   Teams Developer Portal: https://dev.teams.microsoft.com/');
    console.log('\n✅ Bot listo para recibir mensajes\n');
});

// Manejo de señales del sistema
process.on('SIGINT', () => {
    console.log('\n🛑 Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

// Control de errores no manejados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    console.error('En la promesa:', promise);
    // No cerrar el proceso, solo registrar
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    console.error(error.stack);
    
    // Intentar cerrar el servidor gracefully
    server.close(() => {
        console.log('🛑 Servidor cerrado debido a excepción no manejada');
        process.exit(1);
    });
    
    // Si no se puede cerrar en 10 segundos, forzar el cierre
    setTimeout(() => {
        console.log('🚨 Forzando cierre del proceso');
        process.exit(1);
    }, 10000);
});

// Limpiar usuarios completados del diálogo cada hora
setInterval(() => {
    try {
        if (dialog && typeof dialog.clearCompletedUsers === 'function') {
            dialog.clearCompletedUsers();
            console.log('🧹 Lista de usuarios completados limpiada (mantenimiento programado)');
        }
    } catch (error) {
        console.warn('⚠️ Error en mantenimiento programado:', error.message);
    }
}, 60 * 60 * 1000); // 1 hora

console.log('🎯 Proceso de inicialización completado');
console.log(`🔧 Variables de entorno configuradas: ${Object.keys(process.env).filter(k => k.startsWith('MICROSOFT_APP') || k.startsWith('OAUTH') || k.startsWith('OPENAI')).length}`);
console.log('⏳ Esperando actividades...\n');