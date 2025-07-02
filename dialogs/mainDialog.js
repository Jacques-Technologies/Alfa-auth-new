const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class that extends LogoutDialog to handle the main dialog flow with enhanced authentication
 * and improved error handling for the vacation management system.
 * CORREGIDO: Elimina duplicaciones y mejora el flujo de autenticación.
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

        console.log(`MainDialog: Inicializando con connectionName: ${connectionName}`);

        // Configurar OAuth Prompt con configuración mejorada
        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            text: '🔐 **Autenticación Requerida**\n\nPara acceder a las funciones del bot, necesitas iniciar sesión con tu cuenta corporativa.',
            title: 'Iniciar Sesión - Alfa Bot',
            timeout: 300000, // 5 minutos
            // Configuración adicional para mejor experiencia
            endOnInvalidMessage: true
        }));

        // Configurar diálogo principal
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
        
        // Estado de diálogos activos para evitar duplicados
        this.activeAuthDialogs = new Set();
        
        // NUEVO: Control más estricto de procesos
        this.processingUsers = new Set();
        
        console.log('MainDialog: Inicializado correctamente');
    }

    /**
     * CORREGIDO: The run method handles the incoming activity without duplications
     * @param {TurnContext} context - The context object for the turn.
     * @param {StatePropertyAccessor} accessor - The state property accessor for the dialog state.
     */
    async run(context, accessor) {
        try {
            const userId = context.activity.from.id;
            const dialogKey = `auth-dialog-${userId}`;
            
            // NUEVO: Verificar si ya se está procesando este usuario
            if (this.processingUsers.has(userId)) {
                console.log(`MainDialog: Ya procesando autenticación para usuario ${userId}, ignorando`);
                return;
            }
            
            // NUEVO: Verificar si ya está autenticado antes de continuar
            const bot = context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                const isAuthenticated = bot.isUserAuthenticated(userId);
                if (isAuthenticated) {
                    console.log(`MainDialog: Usuario ${userId} ya está autenticado, saltando diálogo`);
                    return;
                }
            }
            
            // Evitar diálogos duplicados
            if (this.activeAuthDialogs.has(dialogKey)) {
                console.log(`MainDialog: Diálogo de autenticación ya activo para usuario ${userId}`);
                return;
            }

            this.processingUsers.add(userId);

            try {
                const dialogSet = new DialogSet(accessor);
                dialogSet.add(this);

                const dialogContext = await dialogSet.createContext(context);
                
                // Verificar si ya hay un diálogo activo
                const results = await dialogContext.continueDialog();
                
                if (results.status === DialogTurnStatus.empty) {
                    console.log(`MainDialog: Iniciando nuevo diálogo de autenticación para usuario ${userId}`);
                    this.activeAuthDialogs.add(dialogKey);
                    
                    try {
                        await dialogContext.beginDialog(this.id);
                    } finally {
                        // Limpiar después de completar o cancelar
                        this.activeAuthDialogs.delete(dialogKey);
                    }
                } else {
                    console.log(`MainDialog: Continuando diálogo existente, estado: ${results.status}`);
                    
                    // Limpiar si el diálogo ha terminado
                    if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                        this.activeAuthDialogs.delete(dialogKey);
                    }
                }
            } finally {
                this.processingUsers.delete(userId);
            }
        } catch (error) {
            console.error('MainDialog: Error en run():', error.message);
            
            // Limpiar estado de error
            const userId = context.activity.from.id;
            const dialogKey = `auth-dialog-${userId}`;
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            
            // CORREGIDO: No enviar mensaje de error aquí para evitar duplicaciones
            // El error será manejado en un nivel superior
            
            throw error;
        }
    }

    /**
     * CORREGIDO: Prompts the user to sign in without duplicate messages
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        try {
            const userId = stepContext.context.activity.from.id;
            console.log(`MainDialog: Iniciando prompt de autenticación para usuario ${userId}`);
            
            // CORREGIDO: Verificar si el usuario ya está autenticado MÁS ESTRICTAMENTE
            const bot = stepContext.context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                const isAuthenticated = bot.isUserAuthenticated(userId);
                if (isAuthenticated) {
                    console.log(`MainDialog: Usuario ${userId} ya está autenticado, saltando prompt`);
                    return await stepContext.next(null); // Saltar al siguiente paso
                }
            }

            // CORREGIDO: Verificar también el estado persistente
            const userState = stepContext.context.turnState.get('UserState');
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(stepContext.context, {});
                if (authData[userId]?.authenticated === true) {
                    console.log(`MainDialog: Usuario ${userId} ya está autenticado (persistente), saltando prompt`);
                    return await stepContext.next(null); // Saltar al siguiente paso
                }
            }

            // CORREGIDO: Enviar mensaje informativo SOLO aquí, una vez
            await stepContext.context.sendActivity('🔄 **Iniciando autenticación...**\n\nTe redirigiremos al sistema de login corporativo.');
            
            // Iniciar prompt OAuth directamente
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error('MainDialog: Error en promptStep:', error.message);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta nuevamente.');
            return await stepContext.endDialog();
        }
    }

    /**
     * CORREGIDO: Handles the login step with comprehensive error handling and user feedback
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        try {
            const tokenResponse = stepContext.result;
            const userId = stepContext.context.activity.from.id;
            const conversationId = stepContext.context.activity.conversation.id;
            
            console.log(`MainDialog: Procesando resultado de autenticación para usuario ${userId}`);
            console.log(`MainDialog: Tipo de respuesta recibida:`, typeof tokenResponse, tokenResponse);
            
            if (tokenResponse && tokenResponse.token) {
                console.log(`MainDialog: Token OAuth recibido exitosamente para usuario ${userId}`);
                
                // Validar el token antes de proceder
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`MainDialog: Token OAuth inválido para usuario ${userId}`);
                    await stepContext.context.sendActivity('❌ **Token de autenticación inválido**\n\nEl token recibido no es válido. Por favor, intenta iniciar sesión nuevamente.');
                    return await stepContext.endDialog();
                }
                
                // Intentar obtener información del usuario desde el token
                let userName = 'Usuario';
                let userEmail = 'usuario@alfa.com';
                
                try {
                    const userInfo = await this.extractUserInfoFromToken(tokenResponse.token);
                    userName = userInfo.name || userInfo.preferred_username || 'Usuario';
                    userEmail = userInfo.email || userInfo.upn || userInfo.preferred_username || 'usuario@alfa.com';
                    
                    console.log(`MainDialog: Información de usuario extraída - Nombre: ${userName}, Email: ${userEmail}`);
                } catch (extractError) {
                    console.warn('MainDialog: No se pudo extraer información del token:', extractError.message);
                    // Continuar con valores por defecto
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
                        console.log(`MainDialog: Usuario ${userId} autenticado exitosamente`);
                        
                        // CORREGIDO: Enviar un solo mensaje de bienvenida más conciso
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
            } else {
                // MEJORADO: Mensaje más específico cuando se cierra el card de autenticación
                console.warn(`MainDialog: Usuario ${userId} cerró el card de autenticación o canceló el proceso`);
                
                await stepContext.context.sendActivity('❌ **Autenticación cancelada**\n\n' +
                    '🚫 **Has cerrado la ventana de autenticación sin completar el proceso.**\n\n' +
                    '**Para usar el bot necesitas autenticarte:**\n' +
                    '• Escribe `login` para intentar nuevamente\n' +
                    '• Asegúrate de completar todo el proceso de autenticación\n' +
                    '• Si continúas teniendo problemas, contacta al administrador\n\n' +
                    '💡 **Importante**: Sin autenticación no puedes acceder a las funciones del bot.');
                
                return await stepContext.endDialog();
            }
        } catch (error) {
            console.error('MainDialog: Error crítico en loginStep:', error.message);
            console.error('MainDialog: Stack trace:', error.stack);
            
            const userId = stepContext.context.activity.from.id;
            await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\n' +
                'Ocurrió un error durante el proceso de autenticación.\n\n' +
                '**Qué puedes hacer:**\n' +
                '• Espera un momento e intenta escribir `login` nuevamente\n' +
                '• Verifica tu conexión a internet\n' +
                '• Si el problema persiste, contacta al administrador\n\n' +
                `**Código de error**: AUTH-${Date.now()}`);
            
            return await stepContext.endDialog();
        }
    }

    /**
     * CORREGIDO: Final step of the authentication dialog - más conciso
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async finalStep(stepContext) {
        try {
            const tokenResponse = stepContext.result;
            const userId = stepContext.context.activity.from.id;
            
            if (tokenResponse && tokenResponse.token) {
                console.log(`MainDialog: Autenticación completada exitosamente para usuario ${userId}`);
                
                // CORREGIDO: NO enviar mensaje adicional aquí para evitar duplicaciones
                // El mensaje de confirmación ya se envía en loginStep
            } else {
                console.log(`MainDialog: Finalizando diálogo sin autenticación para usuario ${userId}`);
            }
            
            // Finalizar el diálogo
            return await stepContext.endDialog(tokenResponse);
        } catch (error) {
            console.error('MainDialog: Error en finalStep:', error.message);
            return await stepContext.endDialog();
        }
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

            // Hacer una llamada simple para verificar el token
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
                console.log('MainDialog: Token OAuth inválido o expirado');
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

            // Intentar decodificar el token JWT
            const tokenParts = token.split('.');
            if (tokenParts.length !== 3) {
                throw new Error('Formato de token JWT inválido');
            }

            // Decodificar el payload (segunda parte del JWT)
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            
            console.log('MainDialog: Información extraída del token:', {
                name: payload.name,
                email: payload.email,
                upn: payload.upn,
                preferred_username: payload.preferred_username
            });

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

    /**
     * Gets authentication statistics for monitoring
     * @returns {Object} - Authentication statistics
     */
    getAuthenticationStats() {
        return {
            activeDialogs: this.activeAuthDialogs.size,
            activeDialogsList: Array.from(this.activeAuthDialogs),
            processingUsers: this.processingUsers.size,
            processingUsersList: Array.from(this.processingUsers),
            connectionName: this.connectionName,
            dialogId: this.id,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * MEJORADO: Clears all active authentication dialogs and processing users
     * @returns {number} - Number of items cleared
     */
    clearActiveDialogs() {
        const dialogCount = this.activeAuthDialogs.size;
        const userCount = this.processingUsers.size;
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        
        const totalCleared = dialogCount + userCount;
        console.log(`MainDialog: Limpiados ${dialogCount} diálogos activos y ${userCount} usuarios en procesamiento`);
        return totalCleared;
    }

    /**
     * Checks if a user has an active authentication dialog
     * @param {string} userId - The user ID to check
     * @returns {boolean} - Whether the user has an active dialog
     */
    hasActiveDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        return this.activeAuthDialogs.has(dialogKey) || this.processingUsers.has(userId);
    }

    /**
     * MEJORADO: Manually ends an authentication dialog for a user
     * @param {string} userId - The user ID
     * @returns {boolean} - Whether a dialog was ended
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadDialog = this.activeAuthDialogs.has(dialogKey);
        const hadProcessing = this.processingUsers.has(userId);
        
        this.activeAuthDialogs.delete(dialogKey);
        this.processingUsers.delete(userId);
        
        if (hadDialog || hadProcessing) {
            console.log(`MainDialog: Diálogo y/o procesamiento finalizado manualmente para usuario ${userId}`);
        }
        
        return hadDialog || hadProcessing;
    }

    /**
     * NUEVO: Force cleanup of stuck processes (maintenance function)
     * @returns {Object} - Cleanup results
     */
    forceCleanup() {
        const before = {
            activeDialogs: this.activeAuthDialogs.size,
            processingUsers: this.processingUsers.size
        };
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        
        const after = {
            activeDialogs: this.activeAuthDialogs.size,
            processingUsers: this.processingUsers.size
        };
        
        console.log('MainDialog: Cleanup forzado ejecutado', { before, after });
        
        return {
            before,
            after,
            totalCleared: before.activeDialogs + before.processingUsers
        };
    }
}

module.exports.MainDialog = MainDialog;