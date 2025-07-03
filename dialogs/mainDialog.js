const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class that extends LogoutDialog to handle the main dialog flow with enhanced authentication
 * and improved error handling for the vacation management system.
 */
class MainDialog extends LogoutDialog {
    /**
     * Creates an instance of MainDialog.
     */
    constructor() {
        super(MAIN_DIALOG, process.env.connectionName || process.env.OAUTH_CONNECTION_NAME);

        // Validar configuración OAuth
        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        if (!connectionName) {
            console.error('MainDialog: ERROR - No se ha configurado connectionName en las variables de entorno');
            throw new Error('Configuración OAuth faltante: connectionName es requerido');
        }

        // Configurar OAuth Prompt
        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            text: '🔐 **Autenticación Requerida**\n\nPara acceder a las funciones del bot, necesitas iniciar sesión con tu cuenta corporativa.',
            title: 'Iniciar Sesión - Alfa Bot',
            timeout: 300000, // 5 minutos
            endOnInvalidMessage: true
        }));

        // Configurar diálogo principal
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
        
        // Control de procesos activos
        this.activeAuthDialogs = new Set();
        this.processingUsers = new Set();
    }

    /**
     * The run method handles the incoming activity without duplications
     * @param {TurnContext} context - The context object for the turn.
     * @param {StatePropertyAccessor} accessor - The state property accessor for the dialog state.
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;
        
        // Verificar si ya se está procesando este usuario
        if (this.processingUsers.has(userId)) {
            return;
        }
        
        // Verificar si ya está autenticado
        const bot = context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                return;
            }
        }
        
        // Evitar diálogos duplicados
        if (this.activeAuthDialogs.has(dialogKey)) {
            return;
        }

        this.processingUsers.add(userId);

        try {
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            const results = await dialogContext.continueDialog();
            
            if (results.status === DialogTurnStatus.empty) {
                this.activeAuthDialogs.add(dialogKey);
                
                try {
                    await dialogContext.beginDialog(this.id);
                } finally {
                    this.activeAuthDialogs.delete(dialogKey);
                }
            } else {
                // Limpiar si el diálogo ha terminado
                if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                    this.activeAuthDialogs.delete(dialogKey);
                }
            }
        } catch (error) {
            console.error('MainDialog: Error en run():', error.message);
            
            // Limpiar estado de error
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            
            throw error;
        } finally {
            this.processingUsers.delete(userId);
        }
    }

    /**
     * Prompts the user to sign in without duplicate messages
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        
        // Verificar si el usuario ya está autenticado
        const bot = stepContext.context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                return await stepContext.next(null);
            }
        }

        // Verificar también el estado persistente
        const userState = stepContext.context.turnState.get('UserState');
        if (userState) {
            const authState = userState.createProperty('AuthState');
            const authData = await authState.get(stepContext.context, {});
            if (authData[userId]?.authenticated === true) {
                return await stepContext.next(null);
            }
        }

        try {
            await stepContext.context.sendActivity('🔄 **Iniciando autenticación...**\n\nTe redirigiremos al sistema de login corporativo.');
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error('MainDialog: Error en promptStep:', error.message);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta nuevamente.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Handles the login step with comprehensive error handling and user feedback
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;
        
        if (tokenResponse && tokenResponse.token) {
            try {
                // Validar el token antes de proceder
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`MainDialog: Token OAuth inválido para usuario ${userId}`);
                    await stepContext.context.sendActivity('❌ **Token de autenticación inválido**\n\nEl token recibido no es válido. Por favor, intenta iniciar sesión nuevamente.');
                    return await stepContext.endDialog();
                }
                
                // Obtener información del usuario desde el token
                let userName = 'Usuario';
                let userEmail = 'usuario@alfa.com';
                
                try {
                    const userInfo = await this.extractUserInfoFromToken(tokenResponse.token);
                    userName = userInfo.name || userInfo.preferred_username || 'Usuario';
                    userEmail = userInfo.email || userInfo.upn || userInfo.preferred_username || 'usuario@alfa.com';
                } catch (extractError) {
                    console.warn('MainDialog: No se pudo extraer información del token:', extractError.message);
                }

                // Marcar usuario como autenticado en el bot
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.setUserAuthenticated === 'function') {
                    const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                        email: userEmail,
                        name: userName,
                        token: tokenResponse.token,
                        context: stepContext.context
                    });
                    
                    if (authSuccess) {
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n🎉 Bienvenido, **${userName}**\n\n💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        await stepContext.context.sendActivity(welcomeMessage);
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`MainDialog: Error al marcar usuario ${userId} como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error('MainDialog: No se pudo obtener la instancia del bot');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error('MainDialog: Error en autenticación:', error.message);
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\nOcurrió un error durante el proceso de autenticación. Intenta escribir `login` nuevamente.');
                return await stepContext.endDialog();
            }
        } else {
            console.warn(`MainDialog: Usuario ${userId} canceló la autenticación`);
            
            await stepContext.context.sendActivity('❌ **Autenticación cancelada**\n\n' +
                '🚫 **Has cerrado la ventana de autenticación sin completar el proceso.**\n\n' +
                '**Para usar el bot necesitas autenticarte:**\n' +
                '• Escribe `login` para intentar nuevamente\n' +
                '• Asegúrate de completar todo el proceso de autenticación\n' +
                '• Si continúas teniendo problemas, contacta al administrador\n\n' +
                '💡 **Importante**: Sin autenticación no puedes acceder a las funciones del bot.');
            
            return await stepContext.endDialog();
        }
    }

    /**
     * Final step of the authentication dialog
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async finalStep(stepContext) {
        return await stepContext.endDialog(stepContext.result);
    }

    /**
     * Validates an OAuth token by making a test request
     * @param {string} token - The OAuth token to validate
     * @returns {boolean} - Whether the token is valid
     * @private
     */
    async validateOAuthToken(token) {
        try {
            if (!token || typeof token !== 'string') {
                return false;
            }

            const axios = require('axios');
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
                {
                    headers: {
                        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
                    },
                    timeout: 5000
                }
            );
            
            return response.status === 200;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                return false;
            }
            
            // Para otros errores, asumir que el token podría ser válido
            console.warn('MainDialog: Error validando token (asumiendo válido):', error.message);
            return true;
        }
    }

    /**
     * Extracts user information from an OAuth JWT token
     * @param {string} token - The OAuth JWT token
     * @returns {Object} - User information extracted from token
     * @private
     */
    async extractUserInfoFromToken(token) {
        try {
            if (!token || typeof token !== 'string') {
                throw new Error('Token inválido');
            }

            const tokenParts = token.split('.');
            if (tokenParts.length !== 3) {
                throw new Error('Formato de token JWT inválido');
            }

            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            
            return {
                name: payload.name,
                email: payload.email,
                upn: payload.upn,
                preferred_username: payload.preferred_username,
                sub: payload.sub,
                oid: payload.oid
            };
        } catch (error) {
            console.warn('MainDialog: Error extrayendo información del token:', error.message);
            throw error;
        }
    }
}

module.exports.MainDialog = MainDialog;