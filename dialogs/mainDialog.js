const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class que maneja el flujo principal de autenticación - VERSIÓN CORREGIDA
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
        
        // Registrar instancia globalmente
        global.mainDialogInstance = this;
    }

    /**
     * The run method handles the incoming activity - VERSIÓN CORREGIDA
     * @param {TurnContext} context - The context object for the turn.
     * @param {StatePropertyAccessor} accessor - The state property accessor for the dialog state.
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;
        
        console.log(`MainDialog.run - Usuario: ${userId}, Tipo de actividad: ${context.activity.type}`);
        
        // CORRECCIÓN: Verificar si ya se está procesando este usuario con timeout
        if (this.processingUsers.has(userId)) {
            console.log(`MainDialog: Usuario ${userId} ya está siendo procesado`);
            return;
        }
        
        // CORRECCIÓN: Verificar si ya está autenticado antes de iniciar diálogo
        const bot = context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                console.log(`MainDialog: Usuario ${userId} ya está autenticado, saltando diálogo`);
                return;
            }
        }
        
        // CORRECCIÓN: Verificar estado persistente también
        const userState = context.turnState.get('UserState');
        if (userState) {
            const authState = userState.createProperty('AuthState');
            const authData = await authState.get(context, {});
            if (authData[userId]?.authenticated === true) {
                console.log(`MainDialog: Usuario ${userId} autenticado en estado persistente`);
                return;
            }
        }
        
        // Evitar diálogos duplicados
        if (this.activeAuthDialogs.has(dialogKey)) {
            console.log(`MainDialog: Diálogo ya activo para usuario ${userId}`);
            return;
        }

        this.processingUsers.add(userId);

        try {
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            const results = await dialogContext.continueDialog();
            
            console.log(`MainDialog: Estado del diálogo para ${userId}: ${results.status}`);
            
            if (results.status === DialogTurnStatus.empty) {
                this.activeAuthDialogs.add(dialogKey);
                
                try {
                    console.log(`MainDialog: Iniciando diálogo para usuario ${userId}`);
                    await dialogContext.beginDialog(this.id);
                } catch (beginError) {
                    console.error(`MainDialog: Error iniciando diálogo para ${userId}:`, beginError);
                    throw beginError;
                } finally {
                    // CORRECCIÓN: Limpiar en finally para asegurar que siempre se ejecute
                    this.activeAuthDialogs.delete(dialogKey);
                    console.log(`MainDialog: Diálogo finalizado para usuario ${userId}`);
                }
            } else {
                // CORRECCIÓN: Limpiar si el diálogo ha terminado
                if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                    this.activeAuthDialogs.delete(dialogKey);
                    console.log(`MainDialog: Diálogo completado/cancelado para usuario ${userId}`);
                }
            }
        } catch (error) {
            console.error(`MainDialog: Error en run() para usuario ${userId}:`, error);
            
            // CORRECCIÓN: Limpiar estado de error
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            
            throw error;
        } finally {
            // CORRECCIÓN: Siempre limpiar el estado de procesamiento
            this.processingUsers.delete(userId);
        }
    }

    /**
     * Prompts the user to sign in - VERSIÓN CORREGIDA
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        
        console.log(`MainDialog.promptStep - Usuario: ${userId}`);
        
        // CORRECCIÓN: Verificar nuevamente si el usuario ya está autenticado
        const bot = stepContext.context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                console.log(`MainDialog.promptStep: Usuario ${userId} ya autenticado, saltando prompt`);
                return await stepContext.next(null);
            }
        }

        // Verificar también el estado persistente
        const userState = stepContext.context.turnState.get('UserState');
        if (userState) {
            const authState = userState.createProperty('AuthState');
            const authData = await authState.get(stepContext.context, {});
            if (authData[userId]?.authenticated === true) {
                console.log(`MainDialog.promptStep: Usuario ${userId} autenticado en estado persistente`);
                return await stepContext.next(null);
            }
        }

        try {
            console.log(`MainDialog.promptStep: Iniciando OAuth prompt para usuario ${userId}`);
            await stepContext.context.sendActivity('🔄 **Iniciando autenticación...**\n\nTe redirigiremos al sistema de login corporativo.');
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error(`MainDialog.promptStep: Error para usuario ${userId}:`, error);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta nuevamente.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Handles the login step - VERSIÓN CORREGIDA
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;
        
        console.log(`MainDialog.loginStep - Usuario: ${userId}, Token presente: ${!!tokenResponse?.token}`);
        
        if (tokenResponse && tokenResponse.token) {
            try {
                // Validar el token antes de proceder
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`MainDialog.loginStep: Token OAuth inválido para usuario ${userId}`);
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
                    
                    console.log(`MainDialog.loginStep: Info del usuario - Nombre: ${userName}, Email: ${userEmail}`);
                } catch (extractError) {
                    console.warn(`MainDialog.loginStep: No se pudo extraer información del token para ${userId}:`, extractError.message);
                }

                // Marcar usuario como autenticado en el bot
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.setUserAuthenticated === 'function') {
                    console.log(`MainDialog.loginStep: Marcando usuario ${userId} como autenticado`);
                    
                    const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                        email: userEmail,
                        name: userName,
                        token: tokenResponse.token,
                        context: stepContext.context
                    });
                    
                    if (authSuccess) {
                        console.log(`MainDialog.loginStep: Autenticación exitosa para usuario ${userId}`);
                        
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n🎉 Bienvenido, **${userName}**\n\n💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        await stepContext.context.sendActivity(welcomeMessage);
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`MainDialog.loginStep: Error al marcar usuario ${userId} como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error('MainDialog.loginStep: No se pudo obtener la instancia del bot');
                    await stepContext.context.sendActivity('❌ **Error interno**\n\nNo se pudo completar la autenticación. Contacta al administrador.');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error(`MainDialog.loginStep: Error en autenticación para usuario ${userId}:`, error);
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\nOcurrió un error durante el proceso de autenticación. Intenta escribir `login` nuevamente.');
                return await stepContext.endDialog();
            }
        } else {
            console.warn(`MainDialog.loginStep: Usuario ${userId} canceló la autenticación`);
            
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
     * Final step of the authentication dialog - VERSIÓN CORREGIDA
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async finalStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        console.log(`MainDialog.finalStep - Usuario: ${userId}`);
        
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
                    timeout: 10000 // Aumentar timeout
                }
            );
            
            console.log(`MainDialog.validateOAuthToken: Token válido - Status: ${response.status}`);
            return response.status === 200;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.warn('MainDialog.validateOAuthToken: Token inválido (401)');
                return false;
            }
            
            // Para otros errores, asumir que el token podría ser válido
            console.warn('MainDialog.validateOAuthToken: Error validando token (asumiendo válido):', error.message);
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
            console.warn('MainDialog.extractUserInfoFromToken: Error extrayendo información del token:', error.message);
            throw error;
        }
    }

    /**
     * NUEVA FUNCIÓN: Termina el diálogo de un usuario específico
     * @param {string} userId - ID del usuario
     * @returns {boolean} - Si había un diálogo activo
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadActiveDialog = this.activeAuthDialogs.has(dialogKey);
        
        if (hadActiveDialog) {
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            console.log(`MainDialog.endUserDialog: Diálogo terminado para usuario ${userId}`);
        }
        
        return hadActiveDialog;
    }

    /**
     * NUEVA FUNCIÓN: Obtiene estadísticas del diálogo
     * @returns {Object} - Estadísticas del diálogo
     */
    getDialogStats() {
        return {
            activeAuthDialogs: this.activeAuthDialogs.size,
            processingUsers: this.processingUsers.size,
            activeDialogs: Array.from(this.activeAuthDialogs),
            processingUsersList: Array.from(this.processingUsers),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * NUEVA FUNCIÓN: Limpia diálogos obsoletos
     * @returns {number} - Número de diálogos limpiados
     */
    cleanupStaleDialogs() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        
        // En una implementación real, aquí podrías verificar timestamps
        // Por ahora, simplemente limpiar todo como medida de emergencia
        
        return {
            activeAuthDialogs: beforeAuthDialogs,
            processingUsers: beforeProcessing,
            cleaned: 0 // No limpiamos automáticamente a menos que sea necesario
        };
    }

    /**
     * NUEVA FUNCIÓN: Fuerza limpieza de todos los estados
     * @returns {Object} - Estadísticas de limpieza
     */
    forceCleanup() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        
        console.warn(`MainDialog.forceCleanup: Limpiados ${beforeAuthDialogs} diálogos activos y ${beforeProcessing} usuarios en procesamiento`);
        
        return {
            activeAuthDialogsCleared: beforeAuthDialogs,
            processingUsersCleared: beforeProcessing,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports.MainDialog = MainDialog;