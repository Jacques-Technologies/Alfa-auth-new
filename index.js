// index.js modernizado con integración de OpenAI y CosmosDB

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

// Validar configuración de OAuth
const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
if (!connectionName) {
    console.error('ERROR: Nombre de conexión OAuth no configurado. Por favor, configura la variable connectionName en el archivo .env');
    process.exit(1);
}

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

// Configurar manejo de errores
adapter.onTurnError = async (context, error) => {
    const errorMsg = error.message || 'Ocurrió un error inesperado.';
    console.error(`\n [onTurnError] Error no manejado: ${error}`);

    // Limpiar estado
    await conversationState.delete(context);
    
    // Enviar mensaje al usuario
    await context.sendActivity(`Lo siento, ocurrió un error. ${errorMsg}`);
    
    // Para depuración local
    console.error(`Stack: ${error.stack}`);
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

// Crear servidor HTTP
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Configurar puerto
const port = process.env.PORT || process.env.port || 3978;
server.listen(port, () => {
    console.log(`\n${server.name} escuchando en ${server.url}`);
    console.log('\nPara usar Bot Framework Emulator, ve a https://docs.microsoft.com/en-us/azure/bot-service/bot-service-debug-emulator');
    console.log(`\nNombre de conexión OAuth configurado: ${connectionName}`);
});

// Configuración del preflight para CORS
server.pre(restify.pre.sanitizePath());
server.use(
    function crossOrigin(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        
        return next();
    }
);

// Ruta principal para mensajes de bot
server.post('/api/messages', async (req, res) => {
    // Configurar turno de estado para acceder al bot desde los diálogos
    req.turnState = req.turnState || new Map();
    req.turnState.set('bot', bot);
    
    // Proceso de depuración - log para verificar actividades
    try {
        const body = req.body;
        if (body) {
            console.log(`Actividad recibida - Tipo: ${body.type}, Nombre: ${body.name || 'N/A'}`);
        }
    } catch (e) {
        console.log('Error al registrar actividad:', e.message);
    }
    
    // Procesar la solicitud con el adaptador
    await adapter.process(req, res, (context) => bot.run(context));
});

// Rutas adicionales
server.get(
   '/public/*',
   (req, res, next) =>
     restify.plugins.serveStatic({
       directory: path.join(path.resolve(), 'public'),
       appendRequestPath: false
     })(req, res, next)
 );

// Ruta para manejar solicitudes OAuth
server.get('/oauthcallback', (req, res, next) => {
    const htmlContent = `
    <html>
        <body>
            <p>Autenticación completada. Puedes cerrar esta ventana y volver a Teams.</p>
            <script>
                setTimeout(function() {
                    window.close();
                }, 3000);
            </script>
        </body>
    </html>`;
    
    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(htmlContent),
        'Content-Type': 'text/html'
    });
    res.write(htmlContent);
    res.end();
    
    return next();
});

// Control de errores no manejados
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
    // No cerrar el proceso, solo registrar
});

console.log(`Bot iniciado. Ejecutándose en el puerto ${port}`);
console.log(`Nombre de conexión OAuth configurado: ${connectionName}`);
console.log(`Para verificar la configuración de autenticación, revisa el archivo .env`);