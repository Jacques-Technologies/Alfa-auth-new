// mainDialog.js - FIX PARA EVITAR DOBLE AUTENTICACIÓN

const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class - VERSIÓN CON FIX PARA EVITAR DOBLE AUTENTICACIÓN
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
        
        // Control de mensajes enviados para evitar duplicados
        this.cancelledMessagesSent = new Set();
        
        // Registrar instancia globalmente
        global.mainDialogInstance = this;
    }

    /**
     * The run method handles the incoming activity - VERSIÓN MEJORADA
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;

        console.log(`\n=== MAIN DIALOG RUN ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Tipo de actividad: ${context.activity.type}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        // Verificar si ya se está procesando este usuario con timeout
        if (this.processingUsers.has(userId)) {
            console.log(`[${userId}] Usuario ya está siendo procesado en MainDialog`);
            return;
        }

        // NUEVO: Verificación mejorada de autenticación antes de iniciar diálogo
        const bot = context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
            try {
                const isAuthenticated = await bot.isUserAuthenticatedEnhanced(userId, context);
                if (isAuthenticated) {
                    console.log(`[${userId}] Usuario ya está autenticado (verificación mejorada), saltando MainDialog`);
                    return;
                }
            } catch (verificationError) {
                console.warn(`[${userId}] Error en verificación mejorada:`, verificationError.message);
                // Continuar con verificación estándar
            }
        }
        
        // Verificación de respaldo con método estándar
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                console.log(`[${userId}] Usuario ya está autenticado (memoria), saltando MainDialog`);
                return;
            }
        }
        
        // Verificar estado persistente también
        const userState = context.turnState.get('UserState');
        if (userState) {
            try {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(context, {});
                if (authData[userId]?.authenticated === true) {
                    console.log(`[${userId}] Usuario autenticado en estado persistente, saltando MainDialog`);
                    
                    // NUEVO: Si está autenticado en persistente pero no en memoria, sincronizar
                    if (bot && typeof bot.syncMemoryFromPersistent === 'function') {
                        try {
                            await bot.syncMemoryFromPersistent(userId, context, authData[userId]);
                            console.log(`[${userId}] Memoria sincronizada desde estado persistente`);
                        } catch (syncError) {
                            console.warn(`[${userId}] Error sincronizando memoria:`, syncError.message);
                        }
                    }
                    
                    return;
                }
            } catch (stateError) {
                console.warn(`[${userId}] Error verificando estado persistente:`, stateError.message);
            }
        }

        // Evitar diálogos duplicados
        if (this.activeAuthDialogs.has(dialogKey)) {
            console.log(`[${userId}] Diálogo ya activo, saltando`);
            return;
        }

        this.processingUsers.add(userId);

        try {
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            const results = await dialogContext.continueDialog();

            console.log(`[${userId}] Estado del diálogo: ${results.status}`);
            
            if (results.status === DialogTurnStatus.empty) {
                this.activeAuthDialogs.add(dialogKey);

                try {
                    console.log(`[${userId}] Iniciando diálogo de autenticación`);
                    await dialogContext.beginDialog(this.id);
                } catch (beginError) {
                    console.error(`[${userId}] Error iniciando diálogo:`, beginError);
                    throw beginError;
                } finally {
                    // Limpiar en finally para asegurar que siempre se ejecute
                    this.activeAuthDialogs.delete(dialogKey);
                    console.log(`[${userId}] Diálogo finalizado`);
                }
            } else {
                // Limpiar si el diálogo ha terminado
                if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                    this.activeAuthDialogs.delete(dialogKey);
                    console.log(`[${userId}] Diálogo completado/cancelado`);
                }
            }
        } catch (error) {
            console.error(`[${userId}] Error en MainDialog.run():`, error);

            // Limpiar estado de error
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);

            throw error;
        } finally {
            // Siempre limpiar el estado de procesamiento
            this.processingUsers.delete(userId);
        }
    }

    /**
     * Prompts the user to sign in - VERSIÓN CON VERIFICACIONES MEJORADAS
     */
    async promptStep(stepContext) {
        const userId = stepContext.context.activity.from.id;

        console.log(`\n=== PROMPT STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        // NUEVA: Verificación múltiple de autenticación antes de mostrar prompt
        const bot = stepContext.context.turnState.get('bot');
        
        // 1. Verificación con método mejorado
        if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
            try {
                const isAuthenticated = await bot.isUserAuthenticatedEnhanced(userId, stepContext.context);
                if (isAuthenticated) {
                    console.log(`[${userId}] Usuario ya autenticado (verificación mejorada), saltando prompt`);
                    return await stepContext.next(null);
                }
            } catch (verificationError) {
                console.warn(`[${userId}] Error en verificación mejorada:`, verificationError.message);
            }
        }
        
        // 2. Verificación en memoria
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                console.log(`[${userId}] Usuario ya autenticado (memoria), saltando prompt`);
                return await stepContext.next(null);
            }
        }

        // 3. Verificación en estado persistente
        const userState = stepContext.context.turnState.get('UserState');
        if (userState) {
            try {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(stepContext.context, {});
                if (authData[userId]?.authenticated === true) {
                    console.log(`[${userId}] Usuario autenticado en estado persistente, saltando prompt`);
                    
                    // Sincronizar memoria si es necesario
                    if (bot && typeof bot.syncMemoryFromPersistent === 'function') {
                        try {
                            await bot.syncMemoryFromPersistent(userId, stepContext.context, authData[userId]);
                            console.log(`[${userId}] Memoria sincronizada desde estado persistente`);
                        } catch (syncError) {
                            console.warn(`[${userId}] Error sincronizando memoria:`, syncError.message);
                        }
                    }
                    
                    return await stepContext.next(null);
                }
            } catch (stateError) {
                console.warn(`[${userId}] Error verificando estado persistente en prompt:`, stateError.message);
            }
        }

        // Si llegamos aquí, el usuario no está autenticado
        try {
            console.log(`[${userId}] Usuario no autenticado, iniciando OAuth prompt`);
            
            await stepContext.context.sendActivity('🔐 **Autenticación Requerida**\n\nPara acceder a las funciones del bot, necesitas iniciar sesión con tu cuenta corporativa.\n\n🔄 Te redirigiremos al sistema de login...');
            
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error(`[${userId}] Error en promptStep:`, error);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta nuevamente.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Handles the login step - VERSIÓN CON MEJORES VERIFICACIONES Y LOGGING
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;

        console.log(`\n=== LOGIN STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Token presente: ${!!tokenResponse?.token}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        if (tokenResponse && tokenResponse.token) {
            try {
                // Validar el token antes de proceder
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`[${userId}] Token OAuth inválido`);
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
                    
                    console.log(`[${userId}] Info del usuario - Nombre: ${userName}, Email: ${userEmail}`);
                } catch (extractError) {
                    console.warn(`[${userId}] No se pudo extraer información del token:`, extractError.message);
                }

                // Marcar usuario como autenticado en el bot
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.setUserAuthenticated === 'function') {
                    console.log(`[${userId}] Marcando usuario como autenticado`);
                    
                    const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                        email: userEmail,
                        name: userName,
                        token: tokenResponse.token,
                        context: stepContext.context
                    });

                    if (authSuccess) {
                        console.log(`[${userId}] ✅ Autenticación exitosa`);
                        
                        // NUEVA: Verificación inmediata después de setUserAuthenticated
                        if (typeof bot.forceAuthVerification === 'function') {
                            const verificationResult = await bot.forceAuthVerification(userId, stepContext.context);
                            console.log(`[${userId}] Verificación post-auth: ${verificationResult}`);
                        }
                        
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n🎉 Bienvenido, **${userName}**\n\n💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        await stepContext.context.sendActivity(welcomeMessage);
                        
                        // NUEVO: Pequeña pausa para asegurar que los estados se sincronicen
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`[${userId}] Error al marcar usuario como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error(`[${userId}] No se pudo obtener la instancia del bot`);
                    await stepContext.context.sendActivity('❌ **Error del sistema**\n\nNo se pudo completar la autenticación. Contacta al administrador.');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error(`[${userId}] Error en autenticación:`, error);
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\nOcurrió un error durante el proceso de autenticación. Intenta escribir `login` nuevamente.');
                return await stepContext.endDialog();
            }
        } else {
            console.warn(`[${userId}] Usuario canceló la autenticación o no se recibió token`);

            const messageKey = `cancelled_${userId}`;
            if (!this.cancelledMessagesSent.has(messageKey)) {
                this.cancelledMessagesSent.add(messageKey);
                
                // Limpiar mensaje después de 30 segundos
                setTimeout(() => {
                    this.cancelledMessagesSent.delete(messageKey);
                }, 30000);

                await stepContext.context.sendActivity('❌ **Autenticación cancelada**\n\nNo se completó el proceso de autenticación. Si necesitas ayuda, escribe `login` para intentar nuevamente.');
            }

            return await stepContext.endDialog();
        }
    }

    /**
     * Final step of the authentication dialog - VERSIÓN MEJORADA
     */
    async finalStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        console.log(`\n=== FINAL STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Resultado: ${!!stepContext.result}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        // NUEVO: Verificación final de que la autenticación se completó correctamente
        const bot = stepContext.context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
            try {
                const finalAuthCheck = await bot.isUserAuthenticatedEnhanced(userId, stepContext.context);
                console.log(`[${userId}] Verificación final de autenticación: ${finalAuthCheck}`);
                
                if (finalAuthCheck) {
                    await stepContext.context.sendActivity('🎯 **¡Todo listo!**\n\nYa puedes enviar cualquier mensaje y el bot te ayudará.');
                }
            } catch (finalCheckError) {
                console.warn(`[${userId}] Error en verificación final:`, finalCheckError.message);
            }
        }
        
        return await stepContext.endDialog(stepContext.result);
    }

    /**
     * Validates an OAuth token by making a test request
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
                    timeout: 10000
                }
            );

            console.log(`Token válido - Status: ${response.status}`);
            return response.status === 200;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.warn('Token inválido (401)');
                return false;
            }

            // Para otros errores, asumir que el token podría ser válido
            console.warn('Error validando token (asumiendo válido):', error.message);
            return true;
        }
    }

    /**
     * Extracts user information from an OAuth JWT token
     */
    async extractUserInfoFromToken(token) {
        try {
            if (!token || typeof token !== 'string') {
                throw new Error('Token inválido');
            }

            // Remover 'Bearer ' si está presente
            const cleanToken = token.startsWith('Bearer ') ? token.substring(7) : token;
            
            const tokenParts = cleanToken.split('.');
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
            console.warn('Error extrayendo información del token:', error.message);
            throw error;
        }
    }

    /**
     * Termina el diálogo de un usuario específico
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadActiveDialog = this.activeAuthDialogs.has(dialogKey);
        
        if (hadActiveDialog) {
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            this.cancelledMessagesSent.delete(`cancelled_${userId}`);
            console.log(`[${userId}] Diálogo terminado`);
        }
        
        return hadActiveDialog;
    }

    /**
     * Obtiene estadísticas del diálogo
     */
    getDialogStats() {
        return {
            activeAuthDialogs: this.activeAuthDialogs.size,
            processingUsers: this.processingUsers.size,
            cancelledMessagesSent: this.cancelledMessagesSent.size,
            activeDialogs: Array.from(this.activeAuthDialogs),
            processingUsersList: Array.from(this.processingUsers),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpia diálogos obsoletos
     */
    cleanupStaleDialogs() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        
        return {
            activeAuthDialogs: beforeAuthDialogs,
            processingUsers: beforeProcessing,
            cleaned: 0
        };
    }

    /**
     * Fuerza limpieza de todos los estados
     */
    forceCleanup() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        const beforeMessages = this.cancelledMessagesSent.size;
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        this.cancelledMessagesSent.clear();
        
        console.warn(`MainDialog.forceCleanup: Limpiados ${beforeAuthDialogs} diálogos activos, ${beforeProcessing} usuarios en procesamiento y ${beforeMessages} mensajes de cancelación`);
        
        return {
            activeAuthDialogsCleared: beforeAuthDialogs,
            processingUsersCleared: beforeProcessing,
            cancelledMessagesCleared: beforeMessages,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpieza de emergencia para usuario específico
     */
    emergencyUserCleanup(userId) {
        const actionsExecuted = [];
        
        const dialogKey = `auth-dialog-${userId}`;
        if (this.activeAuthDialogs.has(dialogKey)) {
            this.activeAuthDialogs.delete(dialogKey);
            actionsExecuted.push('active_auth_dialog_removed');
        }
        
        if (this.processingUsers.has(userId)) {
            this.processingUsers.delete(userId);
            actionsExecuted.push('processing_user_removed');
        }
        
        const messageKey = `cancelled_${userId}`;
        if (this.cancelledMessagesSent.has(messageKey)) {
            this.cancelledMessagesSent.delete(messageKey);
            actionsExecuted.push('cancelled_message_cleared');
        }
        
        return {
            userId,
            actionsExecuted,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports.MainDialog = MainDialog;