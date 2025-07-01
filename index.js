// index.js corregido con mejor manejo de tarjetas adaptativas

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

// CORREGIDO: Middleware mejorado para logging de requests
server.use(function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    
    // Log de request entrante
    console.log(`📡 [${new Date().toISOString()}] ${method} ${url} - Iniciando`);
    
    // Log adicional para requests POST (típicamente mensajes del bot)
    if (method === 'POST' && url === '/api/messages') {
        if (req.body) {
            const activityType = req.body.type || 'unknown';
            const activityName = req.body.name || 'N/A';
            console.log(`📨 Actividad: ${activityType} (${activityName})`);
            
            // Log especial para submits de tarjetas adaptativas
            if (req.body.value && Object.keys(req.body.value).length > 0) {
                console.log('🎯 Submit de tarjeta adaptativa detectado');
                console.log('📋 Datos del submit:', JSON.stringify(req.body.value, null, 2));
            }
        }
    }
    
    // Interceptar el final del request para logging
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const duration = Date.now() - start;
        console.log(`📡 [${new Date().toISOString()}] ${method} ${url} - ${res.statusCode} (${duration}ms)`);
        originalEnd.call(res, chunk, encoding);
    };
    
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

// CORREGIDO: Ruta principal para mensajes de bot con mejor manejo de tarjetas adaptativas
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
                
                // CORREGIDO: Mejor detección de submits de tarjetas adaptativas
                if (body.value && typeof body.value === 'object' && Object.keys(body.value).length > 0) {
                    console.log('🎯 Submit de tarjeta adaptativa confirmado');
                    console.log('📋 Datos completos del submit:', JSON.stringify(body.value, null, 2));
                    
                    // Validar que tenemos los campos mínimos necesarios
                    const { action, method, url } = body.value;
                    if (action && method && url) {
                        console.log(`✅ Submit válido para acción: ${action} (${method})`);
                    } else {
                        console.warn('⚠️ Submit con datos incompletos:', { action, method, url });
                    }
                }
            } else if (activityType === 'invoke') {
                console.log(`🔧 Invoke: "${activityName}"`);
            } else if (activityType === 'event') {
                console.log(`📅 Evento: "${activityName}"`);
            }
        }
        
        // Procesar la solicitud con el adaptador
        await adapter.process(req, res, async (context) => {
            try {
                // CORREGIDO: Asegurar que el contexto tenga toda la información necesaria
                console.log('🔄 Procesando con adaptador...');
                console.log('📊 Contexto - Actividad tipo:', context.activity.type);
                console.log('📊 Contexto - Canal:', context.activity.channelId);
                
                // Ejecutar la lógica del bot
                await bot.run(context);
                
                console.log('✅ Procesamiento completado exitosamente');
            } catch (botError) {
                console.error('❌ Error en bot.run():', botError.message);
                console.error('📍 Stack trace:', botError.stack);
                throw botError; // Re-lanzar para que lo maneje el adaptador
            }
        });
        
    } catch (error) {
        console.error('❌ Error crítico al procesar mensaje:', error.message);
        console.error('📍 Stack trace completo:', error.stack);
        
        // Enviar respuesta de error si aún no se ha enviado
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Error interno del servidor',
                message: 'No se pudo procesar la solicitud',
                timestamp: new Date().toISOString()
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

// CORREGIDO: Ruta para manejar callback de OAuth con mejor HTML
server.get('/oauthcallback', (req, res, next) => {
    console.log('🔐 Recibida solicitud a /oauthcallback');
    console.log('🔐 Query params:', req.query);
    
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
                    border-radius: 15px;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
                    border: 1px solid rgba(255, 255, 255, 0.18);
                    max-width: 400px;
                }
                .checkmark { 
                    font-size: 4rem; 
                    color: #4CAF50; 
                    margin-bottom: 1rem;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                h1 { 
                    margin: 1rem 0; 
                    font-size: 1.5rem;
                }
                p { 
                    margin: 0.8rem 0; 
                    opacity: 0.9; 
                    line-height: 1.4;
                }
                .countdown {
                    font-weight: bold;
                    color: #4CAF50;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✅</div>
                <h1>¡Autenticación Completada!</h1>
                <p>Ya puedes cerrar esta ventana y regresar a Microsoft Teams o Web Chat.</p>
                <p>El bot ya está listo para ayudarte.</p>
                <p class="countdown">Esta ventana se cerrará en <span id="timer">5</span> segundos...</p>
            </div>
            <script>
                let countdown = 5;
                const timer = document.getElementById('timer');
                
                const interval = setInterval(function() {
                    countdown--;
                    timer.textContent = countdown;
                    
                    if (countdown <= 0) {
                        clearInterval(interval);
                        try {
                            window.close();
                        } catch(e) {
                            console.log('No se pudo cerrar la ventana automáticamente');
                            document.querySelector('.countdown').innerHTML = 'Puedes cerrar esta ventana manualmente.';
                        }
                    }
                }, 1000);
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

// CORREGIDO: Ruta de salud del servicio con más información
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
            cosmosdb: !!process.env.COSMOSDB_ENDPOINT,
            azure_search: !!process.env.SERVICE_ENDPOINT,
            bubble_api: !!process.env.TOKEN_BUBBLE,
            snow_api: !!process.env.TOKEN_API
        },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        process: {
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version
        }
    };
    
    res.json(healthStatus);
    return next();
});

// CORREGIDO: Ruta de información del bot más detallada
server.get('/info', (req, res, next) => {
    const botInfo = {
        name: 'Alfa Bot',
        version: '1.0.0',
        description: 'Bot inteligente para empleados de Alfa Corporation',
        features: [
            'Asistente de OpenAI con herramientas',
            'Acciones de API SIRH dinámicas',
            'Autenticación OAuth segura',
            'Búsqueda en documentos (Azure Search)',
            'Integración con ServiceNow',
            'Consulta de menú del comedor',
            'Directorio de empleados',
            'Compatible con Teams y Web Chat'
        ],
        endpoints: {
            messages: '/api/messages',
            health: '/health',
            oauth: '/oauthcallback',
            info: '/info'
        },
        supportedChannels: [
            'Microsoft Teams',
            'Web Chat',
            'Bot Framework Emulator'
        ],
        apis: {
            sirh: process.env.SIRH_API_URL || 'https://botapiqas-alfacorp.msappproxy.net',
            openai: !!process.env.OPENAI_API_KEY,
            azure_search: !!process.env.SERVICE_ENDPOINT,
            bubble: !!process.env.TOKEN_BUBBLE,
            servicenow: !!process.env.TOKEN_API
        }
    };
    
    res.json(botInfo);
    return next();
});

// NUEVO: Ruta de debug para desarrolladores
server.get('/debug', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Debug endpoint not available in production' });
        return next();
    }
    
    const debugInfo = {
        environment: process.env.NODE_ENV || 'development',
        botInstance: !!bot,
        dialogInstance: !!dialog,
        envVars: {
            microsoftAppId: !!process.env.MicrosoftAppId,
            microsoftAppPassword: !!process.env.MicrosoftAppPassword,
            oauthConnection: !!connectionName,
            openaiApiKey: !!process.env.OPENAI_API_KEY,
            cosmosdbEndpoint: !!process.env.COSMOSDB_ENDPOINT,
            azureSearchEndpoint: !!process.env.SERVICE_ENDPOINT
        },
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        versions: process.versions
    };
    
    res.json(debugInfo);
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
    console.log('   GET  /debug          - Debug (solo desarrollo)');
    console.log('   GET  /oauthcallback  - Callback OAuth');
    console.log('\n🔗 Enlaces útiles:');
    console.log('   Bot Framework Emulator: https://docs.microsoft.com/azure/bot-service/bot-service-debug-emulator');
    console.log('   Teams Developer Portal: https://dev.teams.microsoft.com/');
    console.log('\n✅ Bot listo para recibir mensajes');
    console.log('🎯 Tarjetas adaptativas habilitadas y optimizadas');
    console.log('🔧 Compatible con Web Chat y Microsoft Teams\n');
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