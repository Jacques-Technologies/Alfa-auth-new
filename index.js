// index.js - Servidor principal completo con manejo estricto de vacaciones y optimizaciones avanzadas

// Import required packages
const path = require('path');
const restify = require('restify');
const fs = require('fs');
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

// Importar servicios
const conversationService = require('./services/conversationService');
const openaiService = require('./services/openaiService');

// ======================
// VALIDACIÓN DE CONFIGURACIÓN
// ======================

console.log('🔧 Iniciando validación de configuración...');

const requiredEnvVars = [
    'MicrosoftAppId',
    'MicrosoftAppPassword',
    'OAUTH_CONNECTION_NAME'
];

const optionalEnvVars = [
    'OPENAI_API_KEY',
    'SERVICE_ENDPOINT',
    'API_KEY',
    'TOKEN_BUBBLE',
    'TOKEN_API',
    'COSMOSDB_ENDPOINT',
    'COSMOSDB_KEY'
];

// Validar variables requeridas
const missingVars = requiredEnvVars.filter(varName => {
    const value = process.env[varName] || process.env[varName.toLowerCase()];
    return !value;
});

if (missingVars.length > 0) {
    console.error('❌ ERROR: Faltan las siguientes variables de entorno REQUERIDAS:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('Por favor, configura estas variables en el archivo .env');
    process.exit(1);
}

// Reportar variables opcionales
console.log('📋 Estado de servicios opcionales:');
optionalEnvVars.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅ Configurado' : '⚠️ No configurado';
    console.log(`   ${varName}: ${status}`);
});

// Configurar nombre de conexión OAuth
const connectionName = process.env.OAUTH_CONNECTION_NAME || process.env.connectionName;
console.log(`🔐 Conexión OAuth configurada: ${connectionName}`);

// ======================
// CONFIGURACIÓN DE AUTENTICACIÓN
// ======================

console.log('🔑 Configurando autenticación Bot Framework...');

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MicrosoftAppId || process.env.MICROSOFT_APP_ID,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword || process.env.MICROSOFT_APP_PASSWORD,
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId || process.env.MICROSOFT_APP_TENANT_ID,
    MicrosoftAppType: process.env.MicrosoftAppType || process.env.MICROSOFT_APP_TYPE || 'MultiTenant',
    OAuthConnectionName: connectionName
});

// ======================
// CONFIGURACIÓN DEL ADAPTADOR
// ======================

console.log('🔌 Configurando adaptador de bot...');

const adapter = new CloudAdapter(botFrameworkAuthentication);

// Configurar manejo de errores mejorado y específico para vacaciones
adapter.onTurnError = async (context, error) => {
    const errorMsg = error.message || 'Ocurrió un error inesperado.';
    const userId = context.activity?.from?.id || 'unknown';
    const activityType = context.activity?.type || 'unknown';
    
    console.error(`\n❌ [onTurnError] Error no manejado:`);
    console.error(`   📍 Usuario: ${userId}`);
    console.error(`   📍 Tipo de actividad: ${activityType}`);
    console.error(`   📍 Error: ${error.message}`);
    console.error(`   📍 Stack trace: ${error.stack}`);

    try {
        // Análisis específico del error
        let userMessage = '❌ Lo siento, ocurrió un error inesperado.';
        let shouldClearState = false;
        
        // Errores de autenticación
        if (error.code === 'Unauthorized' || errorMsg.includes('authentication') || errorMsg.includes('token')) {
            userMessage = '🔒 **Error de autenticación**\n\nTu sesión ha expirado o hay un problema de autenticación. Por favor, escribe `login` para iniciar sesión nuevamente.';
            shouldClearState = true;
        }
        // Errores de servicio
        else if (error.code === 'ServiceUnavailable' || errorMsg.includes('service')) {
            userMessage = '🔧 **Servicio temporalmente no disponible**\n\nAlgunos servicios están experimentando problemas temporales. Por favor, intenta en unos momentos.';
        }
        // Errores de timeout
        else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
            userMessage = '⏰ **Tiempo de espera agotado**\n\nLa operación tardó demasiado tiempo. Por favor, intenta nuevamente.';
        }
        // Errores específicos de vacaciones
        else if (errorMsg.includes('vacation') || errorMsg.includes('vacaciones')) {
            userMessage = '🏖️ **Error en sistema de vacaciones**\n\nHubo un problema procesando tu solicitud de vacaciones. Por favor, intenta nuevamente o contacta a Recursos Humanos.';
        }
        // Errores de API externa
        else if (errorMsg.includes('SIRH') || errorMsg.includes('botapiqas')) {
            userMessage = '🔗 **Error de sistema externo**\n\nHay un problema temporal con los sistemas de Recursos Humanos. Intenta más tarde o contacta al administrador.';
        }
        // Errores de OpenAI
        else if (errorMsg.includes('openai') || errorMsg.includes('gpt')) {
            userMessage = '🤖 **Error del asistente inteligente**\n\nEl asistente de IA está experimentando problemas. Aún puedes usar los comandos básicos como `login`, `ayuda` o `logout`.';
        }
        // Errores de almacenamiento
        else if (errorMsg.includes('storage') || errorMsg.includes('cosmosdb')) {
            userMessage = '💾 **Error de almacenamiento**\n\nHay un problema temporal con el almacenamiento de datos. Tu información está segura, pero algunas funciones pueden estar limitadas.';
        }
        
        // Limpiar estado si es necesario
        if (shouldClearState && conversationState) {
            try {
                await conversationState.delete(context);
                console.log('🧹 Estado de conversación limpiado debido a error de autenticación');
            } catch (cleanupError) {
                console.error('Error limpiando estado:', cleanupError.message);
            }
        }
        
        // Enviar mensaje específico al usuario
        await context.sendActivity(userMessage);
        
        // Ofrecer ayuda adicional para errores recurrentes
        if (error.isRecurring || (error.count && error.count > 3)) {
            await context.sendActivity('💡 **Ayuda adicional**:\n\n• Escribe `ayuda` para ver comandos disponibles\n• Escribe `estado` para verificar tu autenticación\n• Si el problema persiste, contacta al soporte técnico');
        }
        
    } catch (innerError) {
        console.error(`❌ Error adicional en onTurnError: ${innerError.message}`);
        
        // Último recurso: mensaje básico
        try {
            await context.sendActivity('❌ Error crítico del sistema. Por favor, reinicia la aplicación y contacta al soporte técnico si el problema persiste.');
        } catch (finalError) {
            console.error(`❌ Error crítico enviando mensaje final: ${finalError.message}`);
        }
    }
};

// ======================
// CONFIGURACIÓN DE ALMACENAMIENTO Y ESTADO
// ======================

console.log('💾 Configurando almacenamiento y estado...');

// Usar MemoryStorage con límites y limpieza automática
const memoryStorage = new MemoryStorage();

// Crear estado de conversación y usuario
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

// ======================
// CONFIGURACIÓN DE DIÁLOGOS Y BOT
// ======================

console.log('🤖 Inicializando diálogos y bot...');

// Crear el diálogo principal
const dialog = new MainDialog();

// Registrar instancia globalmente para mantenimiento
global.mainDialogInstance = dialog;

// Crear el bot con configuración avanzada
const bot = new TeamsBot(conversationState, userState, dialog);

// Verificar que el bot se inicializó correctamente
if (!bot.isInitialized()) {
    console.error('❌ ERROR: El bot no se inicializó correctamente');
    process.exit(1);
}

console.log('✅ Bot inicializado exitosamente');
console.log('📊 Información del bot:', bot.getBotInfo());

// ======================
// CONFIGURACIÓN DEL SERVIDOR
// ======================

console.log('🌐 Configurando servidor HTTP...');

const port = process.env.PORT || process.env.port || 3978;

// Crear servidor HTTP con configuración optimizada
const server = restify.createServer({
    name: 'Alfa Bot Server',
    version: '2.0.0',
    // Configuración adicional para mejor rendimiento
    acceptable: ['application/json', 'text/html', 'text/plain'],
    handleUncaughtExceptions: false, // Manejamos nosotros las excepciones
    handleUpgrades: false,
    httpsServerOptions: null,
    ignoreTrailingSlash: true,
    maxParamLength: 100,
    noWritableContinue: false,
    router: {
        ignoreTrailingSlash: true,
        strictNext: false
    }
});

// ======================
// MIDDLEWARE DEL SERVIDOR
// ======================

console.log('🔧 Configurando middleware...');

// Middleware de parsing de body
server.use(restify.plugins.bodyParser({
    maxBodySize: 1000000, // 1MB
    mapParams: true,
    mapFiles: false,
    overrideParams: false,
    uploadDir: os.tmpdir()
}));

// Middleware de query parser
server.use(restify.plugins.queryParser({
    mapParams: true
}));

// Configuración CORS mejorada
server.use(function corsHandler(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Max-Age', '86400'); // 24 horas
    
    // Manejar requests OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.send(204);
        return;
    }
    
    return next();
});

// Middleware de seguridad básica
server.use(function securityHeaders(req, res, next) {
    res.header('X-Frame-Options', 'DENY');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return next();
});

// Middleware de logging avanzado
server.use(function requestLogger(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    
    // Log de request entrante
    console.log(`📡 [${new Date().toISOString()}] ${method} ${url} - IP: ${clientIP}`);
    
    // Log adicional para requests del bot
    if (method === 'POST' && url === '/api/messages') {
        if (req.body) {
            const activityType = req.body.type || 'unknown';
            const activityName = req.body.name || 'N/A';
            const fromId = req.body.from?.id || 'Unknown';
            const channelId = req.body.channelId || 'Unknown';
            
            console.log(`📨 Actividad: ${activityType} (${activityName}) - Usuario: ${fromId} - Canal: ${channelId}`);
            
            // Log especial para submits de tarjetas adaptativas
            if (req.body.value && Object.keys(req.body.value).length > 0) {
                console.log('🎯 Submit de tarjeta adaptativa detectado');
                console.log('📋 Datos del submit:', JSON.stringify(req.body.value, null, 2));
                
                // Log específico para vacaciones
                if (req.body.value.vacation_type) {
                    console.log(`🏖️ Tipo de vacación seleccionado: ${req.body.value.vacation_type}`);
                }
            }
            
            // Log para mensajes de texto
            if (req.body.text) {
                const messagePreview = req.body.text.length > 100 
                    ? req.body.text.substring(0, 100) + '...' 
                    : req.body.text;
                console.log(`💬 Mensaje: "${messagePreview}"`);
            }
        }
    }
    
    // Interceptar el final del request para logging de performance
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const duration = Date.now() - start;
        const statusCode = res.statusCode;
        const statusEmoji = statusCode >= 400 ? '❌' : statusCode >= 300 ? '⚠️' : '✅';
        
        console.log(`📡 [${new Date().toISOString()}] ${method} ${url} - ${statusEmoji} ${statusCode} (${duration}ms)`);
        
        // Log de advertencia para requests lentos
        if (duration > 5000) {
            console.warn(`⏰ Request lento detectado: ${method} ${url} - ${duration}ms`);
        }
        
        originalEnd.call(res, chunk, encoding);
    };
    
    return next();
});

// Middleware para agregar la instancia del bot al estado del turno
const addBotToTurnState = (req, res, next) => {
    if (!req.turnState) {
        req.turnState = new Map();
    }
    req.turnState.set('bot', bot);
    req.turnState.set('ConversationState', conversationState);
    req.turnState.set('UserState', userState);
    return next();
};

// Middleware de rate limiting básico (en memoria)
const rateLimitMap = new Map();
const rateLimit = (req, res, next) => {
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60000; // 1 minuto
    const maxRequests = 100; // máximo 100 requests por minuto por IP
    
    if (!rateLimitMap.has(clientIP)) {
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    const rateLimitInfo = rateLimitMap.get(clientIP);
    
    if (now > rateLimitInfo.resetTime) {
        // Reset del contador
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    if (rateLimitInfo.count >= maxRequests) {
        res.status(429);
        res.json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((rateLimitInfo.resetTime - now) / 1000)
        });
        return;
    }
    
    rateLimitInfo.count++;
    return next();
};

server.use(rateLimit);

// ======================
// RUTAS DEL SERVIDOR
// ======================

console.log('🛣️ Configurando rutas del servidor...');

// Ruta principal para mensajes del bot con manejo avanzado
server.post('/api/messages', addBotToTurnState, async (req, res) => {
    try {
        // Logging detallado de actividades
        const body = req.body;
        if (body) {
            const activityType = body.type || 'unknown';
            const activityName = body.name || 'N/A';
            
            console.log(`📨 Procesando actividad - Tipo: ${activityType}, Nombre: ${activityName}`);
            
            // Validación básica de la actividad
            if (!body.from || !body.conversation) {
                console.warn('⚠️ Actividad con datos incompletos:', {
                    hasFrom: !!body.from,
                    hasConversation: !!body.conversation,
                    type: activityType
                });
            }
            
            // Log específico para diferentes tipos de actividad
            if (activityType === 'message') {
                const messageText = body.text ? `"${body.text.substring(0, 50)}${body.text.length > 50 ? '...' : ''}"` : 'sin texto';
                console.log(`💬 Mensaje: ${messageText}`);
                
                // Detección mejorada de submits de tarjetas adaptativas
                if (body.value && typeof body.value === 'object' && Object.keys(body.value).length > 0) {
                    console.log('🎯 Submit de tarjeta adaptativa confirmado');
                    console.log('📋 Datos completos del submit:', JSON.stringify(body.value, null, 2));
                    
                    // Validación específica para diferentes tipos de submit
                    const { action, method, url, vacation_type } = body.value;
                    
                    if (vacation_type) {
                        console.log(`🏖️ Submit de guía de vacaciones - Tipo: ${vacation_type}`);
                    } else if (action && method && url) {
                        console.log(`✅ Submit de acción API válido: ${action} (${method})`);
                    } else {
                        console.warn('⚠️ Submit con datos incompletos:', { action, method, url, vacation_type });
                    }
                }
            } else if (activityType === 'invoke') {
                console.log(`🔧 Invoke: "${activityName}"`);
                
                // Log especial para actividades OAuth
                if (activityName && activityName.includes('signin')) {
                    console.log('🔐 Actividad OAuth detectada');
                }
            } else if (activityType === 'event') {
                console.log(`📅 Evento: "${activityName}"`);
            } else if (activityType === 'membersAdded') {
                console.log('👋 Nuevos miembros añadidos a la conversación');
            }
        }
        
        // Procesar la solicitud con el adaptador
        await adapter.process(req, res, async (context) => {
            try {
                console.log('🔄 Procesando con adaptador...');
                console.log('📊 Contexto - Actividad tipo:', context.activity.type);
                console.log('📊 Contexto - Canal:', context.activity.channelId);
                console.log('📊 Contexto - Usuario:', context.activity.from?.id || 'Unknown');
                
                // Verificar límites de recursos antes de procesar
                const memUsage = process.memoryUsage();
                const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                
                if (heapUsedMB > 500) { // Más de 500MB
                    console.warn(`⚠️ Uso alto de memoria: ${heapUsedMB}MB`);
                    
                    // Forzar garbage collection si está disponible
                    if (global.gc) {
                        global.gc();
                        console.log('🧹 Garbage collection ejecutado');
                    }
                }
                
                // Ejecutar la lógica del bot
                await bot.run(context);
                
                console.log('✅ Procesamiento completado exitosamente');
            } catch (botError) {
                console.error('❌ Error en bot.run():', botError.message);
                console.error('📍 Stack trace:', botError.stack);
                
                // Manejo específico de errores del bot
                if (botError.message.includes('authentication')) {
                    console.log('🔒 Error de autenticación detectado en bot.run()');
                } else if (botError.message.includes('timeout')) {
                    console.log('⏰ Timeout detectado en bot.run()');
                } else if (botError.message.includes('vacation')) {
                    console.log('🏖️ Error del sistema de vacaciones en bot.run()');
                }
                
                throw botError; // Re-lanzar para que lo maneje el adaptador
            }
        });
        
    } catch (error) {
        console.error('❌ Error crítico al procesar mensaje:', error.message);
        console.error('📍 Stack trace completo:', error.stack);
        
        // Análizar tipo de error para estadísticas
        if (error.message.includes('authentication')) {
            console.log('📊 Categoría de error: Autenticación');
        } else if (error.message.includes('network') || error.message.includes('timeout')) {
            console.log('📊 Categoría de error: Red/Conectividad');
        } else if (error.message.includes('vacation')) {
            console.log('📊 Categoría de error: Sistema de vacaciones');
        } else {
            console.log('📊 Categoría de error: Desconocido');
        }
        
        // Enviar respuesta de error si aún no se ha enviado
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Error interno del servidor',
                message: 'No se pudo procesar la solicitud del bot',
                timestamp: new Date().toISOString(),
                requestId: req.getId ? req.getId() : Date.now()
            });
        }
    }
});

// Servir archivos estáticos con cache headers
server.get('/public/*', restify.plugins.serveStatic({
    directory: path.join(path.resolve(), 'public'),
    appendRequestPath: false,
    default: 'index.html',
    maxAge: 86400 // Cache por 24 horas
}));

// Ruta mejorada para callback de OAuth
server.get('/oauthcallback', (req, res, next) => {
    console.log('🔐 Recibida solicitud a /oauthcallback');
    console.log('🔐 Query params:', req.query);
    console.log('🔐 Headers relevantes:', {
        'user-agent': req.headers['user-agent'],
        'referer': req.headers['referer']
    });
    
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
        <head>
            <title>Autenticación Completada - Alfa Bot</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex, nofollow">
            <style>
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }
                
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    line-height: 1.6;
                }
                
                .container { 
                    text-align: center; 
                    padding: 2rem;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 20px;
                    backdrop-filter: blur(15px);
                    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
                    border: 1px solid rgba(255, 255, 255, 0.18);
                    max-width: 450px;
                    width: 90%;
                    margin: 1rem;
                }
                
                .checkmark { 
                    font-size: 4rem; 
                    color: #4CAF50; 
                    margin-bottom: 1rem;
                    animation: pulse 2s infinite;
                    filter: drop-shadow(0 0 10px rgba(76, 175, 80, 0.3));
                }
                
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                
                h1 { 
                    margin: 1rem 0; 
                    font-size: 1.8rem;
                    font-weight: 600;
                }
                
                p { 
                    margin: 0.8rem 0; 
                    opacity: 0.9; 
                    line-height: 1.5;
                    font-size: 1rem;
                }
                
                .countdown {
                    font-weight: bold;
                    color: #4CAF50;
                    padding: 1rem;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    margin-top: 1rem;
                }
                
                .instructions {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 1rem;
                    border-radius: 10px;
                    margin: 1rem 0;
                    font-size: 0.9rem;
                }
                
                .close-button {
                    background: linear-gradient(45deg, #4CAF50, #45a049);
                    color: white;
                    border: none;
                    padding: 0.8rem 2rem;
                    border-radius: 25px;
                    font-size: 1rem;
                    cursor: pointer;
                    margin-top: 1rem;
                    transition: all 0.3s ease;
                }
                
                .close-button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
                }
                
                @media (max-width: 480px) {
                    .container {
                        padding: 1.5rem;
                    }
                    
                    h1 {
                        font-size: 1.5rem;
                    }
                    
                    .checkmark {
                        font-size: 3rem;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✅</div>
                <h1>¡Autenticación Completada!</h1>
                
                <div class="instructions">
                    <p><strong>🎉 ¡Perfecto!</strong> Te has autenticado exitosamente en Alfa Bot.</p>
                    <p>🔄 Regresa a Microsoft Teams o Web Chat para continuar.</p>
                    <p>🤖 El bot ya está listo para ayudarte con vacaciones, consultas y más.</p>
                </div>
                
                <div class="countdown">
                    <p>Esta ventana se cerrará automáticamente en <span id="timer">10</span> segundos</p>
                </div>
                
                <button class="close-button" onclick="closeWindow()">
                    🚪 Cerrar Ventana
                </button>
            </div>
            
            <script>
                let countdown = 10;
                const timer = document.getElementById('timer');
                const button = document.querySelector('.close-button');
                
                function closeWindow() {
                    try {
                        // Intentar diferentes métodos de cierre
                        if (window.opener) {
                            window.close();
                        } else if (window.parent !== window) {
                            window.parent.postMessage('oauth_complete', '*');
                        } else {
                            window.close();
                        }
                    } catch(e) {
                        console.log('No se pudo cerrar la ventana automáticamente');
                        alert('Por favor, cierra esta ventana manualmente y regresa a la aplicación.');
                    }
                }
                
                const interval = setInterval(function() {
                    countdown--;
                    timer.textContent = countdown;
                    
                    if (countdown <= 0) {
                        clearInterval(interval);
                        closeWindow();
                    }
                }, 1000);
                
                // Permitir cierre inmediato con tecla Escape
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        closeWindow();
                    }
                });
                
                // Manejar visibilidad de la página
                document.addEventListener('visibilitychange', function() {
                    if (document.hidden) {
                        // Pausar countdown si la página no es visible
                        clearInterval(interval);
                    }
                });
            </script>
        </body>
    </html>`;
    
    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(htmlContent),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.write(htmlContent);
    res.end();
    
    return next();
});

// Ruta de salud del servicio con información detallada
server.get('/health', (req, res, next) => {
    try {
        const memUsage = process.memoryUsage();
        const healthStatus = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '2.0.0',
            
            // Estado de servicios
            services: {
                bot: !!bot && bot.isInitialized(),
                openai: !!process.env.OPENAI_API_KEY,
                oauth: !!connectionName,
                cosmosdb: !!process.env.COSMOSDB_ENDPOINT,
                azure_search: !!process.env.SERVICE_ENDPOINT,
                bubble_api: !!process.env.TOKEN_BUBBLE,
                snow_api: !!process.env.TOKEN_API
            },
            
            // Memoria y rendimiento
            memory: {
                used: Math.round(memUsage.heapUsed / 1024 / 1024),
                total: Math.round(memUsage.heapTotal / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024)
            },
            
            // Información del proceso
            process: {
                pid: process.pid,
                platform: process.platform,
                nodeVersion: process.version,
                arch: process.arch
            },
            
            // Estadísticas del bot
            botStats: bot ? bot.getBotInfo() : null,
            
            // Estado de servicios de conversación
            conversationService: conversationService ? conversationService.getServiceStats() : null,
            
            // Estadísticas de diálogos
            dialogStats: dialog ? dialog.getAuthenticationStats() : null
        };
        
        // Determinar estado general
        const criticalServices = ['bot', 'oauth'];
        const criticalServicesFailing = criticalServices.filter(service => !healthStatus.services[service]);
        
        if (criticalServicesFailing.length > 0) {
            healthStatus.status = 'degraded';
            healthStatus.issues = [`Servicios críticos fallando: ${criticalServicesFailing.join(', ')}`];
        }
        
        if (healthStatus.memory.used > 400) {
            healthStatus.status = healthStatus.status === 'healthy' ? 'warning' : 'critical';
            healthStatus.issues = healthStatus.issues || [];
            healthStatus.issues.push('Uso alto de memoria');
        }
        
        res.json(healthStatus);
    } catch (error) {
        console.error('Error en endpoint /health:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Error obteniendo estado de salud',
            timestamp: new Date().toISOString()
        });
    }
    
    return next();
});

// Ruta de información del bot más detallada
server.get('/info', (req, res, next) => {
    const botInfo = {
        name: 'Alfa Bot',
        version: '2.0.0',
        description: 'Bot inteligente para empleados de Alfa Corporation con sistema estricto de gestión de vacaciones',
        
        features: [
            'Asistente de OpenAI con herramientas especializadas',
            'Sistema estricto de gestión de vacaciones',
            'Acciones de API SIRH dinámicas',
            'Autenticación OAuth segura',
            'Búsqueda vectorial en documentos (Azure Search)',
            'Integración con ServiceNow',
            'Consulta de menú del comedor',
            'Directorio de empleados',
            'Compatible con Teams y Web Chat',
            'Tarjetas adaptativas dinámicas'
        ],
        
        vacationSystem: {
            version: '2.0.0',
            type: 'Strict Guided Process',
            features: [
                'Detección automática de intención',
                'Proceso guiado para solicitudes ambiguas',
                'Validación de tipos de vacaciones',
                'Tarjetas dinámicas contextuales',
                'Manejo específico por tipo (Regular, Matrimonio, Nacimiento)'
            ]
        },
        
        endpoints: {
            messages: '/api/messages',
            health: '/health',
            oauth: '/oauthcallback',
            info: '/info',
            debug: '/debug (solo desarrollo)',
            metrics: '/metrics'
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
        },
        
        authentication: {
            type: 'OAuth 2.0',
            connection: connectionName,
            provider: 'Azure Active Directory'
        },
        
        statistics: {
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: process.platform,
            timestamp: new Date().toISOString()
        }
    };
    
    res.json(botInfo);
    return next();
});

// Ruta de métricas para monitoreo
server.get('/metrics', (req, res, next) => {
    try {
        const memUsage = process.memoryUsage();
        const metrics = {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            
            // Métricas de memoria
            memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                rss: memUsage.rss
            },
            
            // Métricas del bot
            bot: bot ? {
                initialized: bot.isInitialized(),
                authenticatedUsers: bot.authenticatedUsers ? bot.authenticatedUsers.size : 0
            } : null,
            
            // Métricas de conversación
            conversation: conversationService ? conversationService.getServiceStats() : null,
            
            // Métricas de diálogos
            dialog: dialog ? {
                authStats: dialog.getAuthenticationStats(),
                logoutStats: dialog.getLogoutStats ? dialog.getLogoutStats() : null
            } : null,
            
            // Métricas del sistema
            system: {
                loadAverage: require('os').loadavg(),
                freeMemory: require('os').freemem(),
                totalMemory: require('os').totalmem(),
                cpus: require('os').cpus().length
            }
        };
        
        res.json(metrics);
    } catch (error) {
        console.error('Error en endpoint /metrics:', error.message);
        res.status(500).json({
            error: 'Error obteniendo métricas',
            timestamp: new Date().toISOString()
        });
    }
    
    return next();
});

// Ruta de debug para desarrolladores (solo en desarrollo)
server.get('/debug', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ 
            error: 'Debug endpoint not available in production',
            suggestion: 'Use /health or /metrics for production monitoring'
        });
        return next();
    }
    
    const debugInfo = {
        environment: process.env.NODE_ENV || 'development',
        
        // Estado de instancias
        instances: {
            bot: !!bot,
            dialog: !!dialog,
            conversationService: !!conversationService,
            openaiService: !!openaiService
        },
        
        // Variables de entorno (sin valores sensibles)
        envVars: {
            microsoftAppId: !!process.env.MicrosoftAppId,
            microsoftAppPassword: !!process.env.MicrosoftAppPassword,
            oauthConnection: !!connectionName,
            openaiApiKey: !!process.env.OPENAI_API_KEY,
            cosmosdbEndpoint: !!process.env.COSMOSDB_ENDPOINT,
            azureSearchEndpoint: !!process.env.SERVICE_ENDPOINT,
            bubbleToken: !!process.env.TOKEN_BUBBLE,
            snowToken: !!process.env.TOKEN_API
        },
        
        // Estado detallado del bot
        botDebug: bot ? {
            initialized: bot.isInitialized(),
            info: bot.getBotInfo(),
            authenticatedUsersCount: bot.authenticatedUsers ? bot.authenticatedUsers.size : 0,
            activeDialogs: bot.activeDialogs ? bot.activeDialogs.size : 0
        } : null,
        
        // Estado de servicios
        services: {
            conversation: conversationService ? conversationService.getHealthStatus() : null,
            openai: {
                available: !!openaiService,
                toolsCount: openaiService && openaiService.tools ? openaiService.tools.length : 0
            }
        },
        
        // Información del sistema
        system: {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            versions: process.versions,
            argv: process.argv,
            cwd: process.cwd()
        }
    };
    
    res.json(debugInfo);
    return next();
});

// Ruta de administración para limpiezas manuales (solo desarrollo)
server.post('/admin/cleanup', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Admin endpoint not available in production' });
        return next();
    }
    
    try {
        const results = {
            timestamp: new Date().toISOString(),
            actions: []
        };
        
        // Limpiar conversaciones antiguas
        if (conversationService && typeof conversationService.cleanupOldMessages === 'function') {
            const cleanedMessages = conversationService.cleanupOldMessages();
            results.actions.push(`Mensajes limpiados: ${cleanedMessages}`);
        }
        
        // Limpiar diálogos activos
        if (dialog && typeof dialog.clearActiveDialogs === 'function') {
            const clearedDialogs = dialog.clearActiveDialogs();
            results.actions.push(`Diálogos limpiados: ${clearedDialogs}`);
        }
        
        // Forzar garbage collection
        if (global.gc) {
            global.gc();
            results.actions.push('Garbage collection ejecutado');
        }
        
        // Limpiar rate limit cache
        rateLimitMap.clear();
        results.actions.push('Cache de rate limit limpiado');
        
        console.log('🧹 Limpieza manual ejecutada:', results.actions);
        
        res.json({
            success: true,
            message: 'Limpieza ejecutada correctamente',
            results
        });
        
    } catch (error) {
        console.error('Error en limpieza manual:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error ejecutando limpieza',
            message: error.message
        });
    }
    
    return next();
});

// ======================
// INICIALIZACIÓN DEL SERVIDOR
// ======================

server.listen(port, () => {
    console.log('\n🚀 ================================');
    console.log('🤖 Alfa Bot iniciado exitosamente');
    console.log('🚀 ================================');
    console.log(`📡 Servidor: ${server.name} v${server.version}`);
    console.log(`🌐 URL: ${server.url}`);
    console.log(`🔌 Puerto: ${port}`);
    console.log(`🔐 OAuth: ${connectionName}`);
    console.log('\n📚 Endpoints disponibles:');
    console.log('   POST /api/messages     - Mensajes del bot');
    console.log('   GET  /health          - Estado del servicio');
    console.log('   GET  /info            - Información del bot');
    console.log('   GET  /metrics         - Métricas de rendimiento');
    console.log('   GET  /debug           - Debug (solo desarrollo)');
    console.log('   GET  /oauthcallback   - Callback OAuth');
    console.log('   POST /admin/cleanup   - Limpieza manual (solo desarrollo)');
    console.log('\n🔗 Enlaces útiles:');
    console.log('   Bot Framework Emulator: https://docs.microsoft.com/azure/bot-service/bot-service-debug-emulator');
    console.log('   Teams Developer Portal: https://dev.teams.microsoft.com/');
    console.log('\n✅ Funcionalidades habilitadas:');
    console.log('   🏖️ Sistema estricto de gestión de vacaciones');
    console.log('   🎯 Tarjetas adaptativas dinámicas');
    console.log('   🤖 Asistente OpenAI con herramientas');
    console.log('   🔒 Autenticación OAuth segura');
    console.log('   💾 Almacenamiento optimizado');
    console.log('   📊 Monitoreo y métricas');
    console.log('\n🎯 Bot listo para recibir mensajes');
    console.log('🔧 Compatible con Web Chat y Microsoft Teams\n');
});

// ======================
// MANEJO DE SEÑALES DEL SISTEMA
// ======================

// Función de limpieza antes del cierre
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Recibida señal ${signal}, iniciando cierre graceful...`);
    
    try {
        // Estadísticas finales
        if (conversationService) {
            const stats = conversationService.getServiceStats();
            console.log('📊 Estadísticas finales del servicio de conversación:', stats);
        }
        
        if (dialog) {
            const authStats = dialog.getAuthenticationStats();
            console.log('📊 Estadísticas finales de autenticación:', authStats);
        }
        
        // Cerrar servidor
        console.log('🔌 Cerrando servidor HTTP...');
        server.close(() => {
            console.log('✅ Servidor HTTP cerrado correctamente');
            
            // Limpiar recursos
            console.log('🧹 Limpiando recursos...');
            rateLimitMap.clear();
            
            if (global.mainDialogInstance) {
                global.mainDialogInstance = null;
            }
            
            console.log('✅ Recursos limpiados');
            console.log('👋 Alfa Bot desconectado correctamente');
            process.exit(0);
        });
        
        // Timeout de seguridad
        setTimeout(() => {
            console.log('⚠️ Timeout alcanzado, forzando cierre');
            process.exit(1);
        }, 10000);
        
    } catch (error) {
        console.error('❌ Error durante cierre graceful:', error.message);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Control de errores no manejados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    console.error('📍 En la promesa:', promise);
    
    // Log adicional para debugging
    if (reason && reason.stack) {
        console.error('📍 Stack trace:', reason.stack);
    }
    
    // No cerrar el proceso automáticamente, solo registrar
    console.log('⚠️ Continuando ejecución después de Promise Rejection');
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    console.error('📍 Stack trace:', error.stack);
    
    // Intentar cerrar el servidor gracefully
    console.log('🛑 Iniciando cierre de emergencia...');
    
    try {
        server.close(() => {
            console.log('🛑 Servidor cerrado debido a excepción no manejada');
            process.exit(1);
        });
    } catch (closeError) {
        console.error('❌ Error cerrando servidor en emergencia:', closeError.message);
    }
    
    // Si no se puede cerrar en 5 segundos, forzar el cierre
    setTimeout(() => {
        console.log('🚨 Forzando cierre del proceso');
        process.exit(1);
    }, 5000);
});

// ======================
// TAREAS DE MANTENIMIENTO
// ======================

// Limpiar usuarios completados del diálogo cada hora
setInterval(() => {
    try {
        if (dialog && typeof dialog.clearActiveDialogs === 'function') {
            const cleared = dialog.clearActiveDialogs();
            if (cleared > 0) {
                console.log(`🧹 Mantenimiento: ${cleared} diálogos activos limpiados`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Error en mantenimiento de diálogos:', error.message);
    }
}, 60 * 60 * 1000); // 1 hora

// Limpiar cache de rate limiting cada 30 minutos
setInterval(() => {
    try {
        const now = Date.now();
        let cleared = 0;
        
        for (const [ip, data] of rateLimitMap.entries()) {
            if (now > data.resetTime) {
                rateLimitMap.delete(ip);
                cleared++;
            }
        }
        
        if (cleared > 0) {
            console.log(`🧹 Mantenimiento: ${cleared} entradas de rate limit limpiadas`);
        }
    } catch (error) {
        console.warn('⚠️ Error en mantenimiento de rate limit:', error.message);
    }
}, 30 * 60 * 1000); // 30 minutos

// Reporte de estadísticas cada 6 horas
setInterval(() => {
    try {
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        console.log('\n📊 ====== REPORTE DE ESTADÍSTICAS ======');
        console.log(`⏱️ Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`);
        console.log(`💾 Memoria: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        
        if (bot && bot.authenticatedUsers) {
            console.log(`👥 Usuarios autenticados: ${bot.authenticatedUsers.size}`);
        }
        
        if (conversationService) {
            const stats = conversationService.getServiceStats();
            console.log(`💬 Mensajes totales: ${stats.totalMessages}`);
            console.log(`🗣️ Conversaciones: ${stats.totalConversations}`);
        }
        
        console.log('📊 =====================================\n');
    } catch (error) {
        console.warn('⚠️ Error generando reporte de estadísticas:', error.message);
    }
}, 6 * 60 * 60 * 1000); // 6 horas

// Log de inicialización completada
console.log('🎯 Proceso de inicialización completado');
console.log(`🔧 Variables de entorno configuradas: ${[...requiredEnvVars, ...optionalEnvVars].filter(v => !!process.env[v]).length}/${requiredEnvVars.length + optionalEnvVars.length}`);
console.log('⏳ Esperando actividades...\n');

// Habilitar garbage collection si está disponible
if (global.gc) {
    console.log('♻️ Garbage collection habilitado');
} else {
    console.log('⚠️ Garbage collection no disponible (ejecutar con --expose-gc para habilitarlo)');
}