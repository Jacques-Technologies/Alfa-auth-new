const { ConfirmPrompt, DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { CardFactory } = require('botbuilder');
const { LogoutDialog } = require('./logoutDialog');

const CONFIRM_PROMPT = 'ConfirmPrompt';
const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * Diálogo principal extendido para manejar autenticación y OpenAI
 */
class MainDialog extends LogoutDialog {
    /**
     * Constructor del diálogo principal
     */
    constructor() {
        // Obtener el nombre de conexión de las variables de entorno
        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        
        // Validar que existe un nombre de conexión
        if (!connectionName) {
            console.warn('ADVERTENCIA: Nombre de conexión OAuth no configurado. Configurar la variable connectionName en el archivo .env');
        }
        
        super(MAIN_DIALOG, connectionName);

        // Crear prompts y diálogos necesarios
        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            text: 'Por favor inicia sesión para acceder a los servicios de Alfa Bot',
            title: 'Iniciar sesión',
            timeout: 300000
        }));
        
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));
        
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.welcomeStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
    }

    /**
     * Ejecuta el diálogo principal
     * @param {TurnContext} context - Contexto de la conversación
     * @param {StatePropertyAccessor} accessor - Acceso al estado del diálogo
     */
    async run(context, accessor) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(context);
        const results = await dialogContext.continueDialog();
        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    /**
     * Paso inicial de autenticación
     * @param {WaterfallStepContext} stepContext - Contexto del paso
     */
    async promptStep(stepContext) {
        // Verificar si el usuario ya está autenticado
        const userId = stepContext.context.activity.from.id;
        
        // Acceder al bot para verificar autenticación
        const bot = stepContext.context.turnState.get('bot');
        if (bot && bot.isUserAuthenticated && bot.isUserAuthenticated(userId)) {
            console.log(`Usuario ${userId} ya autenticado, saltando prompt de autenticación`);
            return await stepContext.endDialog();
        }
        
        // Enviar mensaje claro al usuario sobre la autenticación
        await stepContext.context.sendActivity('Para poder usar todas las funcionalidades de Alfa Bot, necesitas iniciar sesión.');
        
        // Crear tarjeta OAuth compatible con Teams
        const signInCard = CardFactory.oauthCard(
            this.connectionName,
            'Acceder a Alfa Bot',
            'Iniciar sesión'
        );
        
        await stepContext.context.sendActivity({ attachments: [signInCard] });
        
        // Iniciar el diálogo OAuth
        return await stepContext.beginDialog(OAUTH_PROMPT);
    }

    /**
     * Maneja resultado de autenticación
     * @param {WaterfallStepContext} stepContext - Contexto del paso
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        
        if (tokenResponse) {
            // Obtener contexto e ID del usuario
            const context = stepContext.context;
            const userId = context.activity.from.id;
            const conversationId = context.activity.conversation.id;
            
            // Usuario autenticado correctamente
            const userData = {
                token: tokenResponse.token,
                email: tokenResponse.email || tokenResponse.upn || 'usuario@alfa.com',
                name: tokenResponse.name || 'Usuario Alfa',
                context: context // Guardar el contexto para actualizar el estado
            };
            
            // Mostrar información de depuración sobre el token
            console.log(`Token obtenido para usuario ${userId}. Token info:`, JSON.stringify({
                email: userData.email,
                name: userData.name,
                tokenLength: tokenResponse.token ? tokenResponse.token.length : 0
            }));
            
            // Acceder al bot para marcarlo como autenticado
            const bot = context.turnState.get('bot');
            if (bot && bot.setUserAuthenticated) {
                await bot.setUserAuthenticated(userId, conversationId, userData);
            }
            
            await context.sendActivity('¡Has iniciado sesión correctamente! 🎉');
            return await stepContext.next(userData);
        }
        
        // Autenticación fallida
        await stepContext.context.sendActivity('No se pudo iniciar sesión. Por favor, intenta escribiendo "login" nuevamente.');
        return await stepContext.endDialog();
    }

    /**
     * Mensaje de bienvenida después del login exitoso
     * @param {WaterfallStepContext} stepContext - Contexto del paso
     */
    async welcomeStep(stepContext) {
        const userData = stepContext.result;
        
        if (userData) {
            await stepContext.context.sendActivity(`Bienvenido a Alfa, ${userData.name}. Ahora puedes interactuar con nuestros servicios.`);
            await stepContext.context.sendActivity('Puedes preguntar sobre el menú del comedor, buscar en el directorio, consultar incidentes o buscar información en nuestros documentos internos.');
            
            // Asegurarse de que el estado se guarde correctamente
            const context = stepContext.context;
            const userId = context.activity.from.id;
            const conversationId = context.activity.conversation.id;
            
            // Intentar procesar el primer mensaje si existe
            const message = stepContext.context.activity.text;
            if (message && message.toLowerCase() !== 'login') {
                console.log(`Procesando mensaje inicial: "${message}"`);
                
                // Obtener el bot
                const bot = context.turnState.get('bot');
                if (bot && bot.handleAuthenticatedMessage) {
                    // Procesar el mensaje inicial después de la autenticación
                    await bot.handleAuthenticatedMessage(context, message, userId, conversationId);
                }
            }
        }
        
        return await stepContext.endDialog();
    }
}

module.exports.MainDialog = MainDialog;