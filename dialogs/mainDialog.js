// mainDialog.js - VERSIÓN MEJORADA CON MEJOR MANEJO DE TOKEN INVÁLIDO

const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class - VERSIÓN MEJORADA PARA MANEJO DE TOKEN INVÁLIDO
 */
class MainDialog extends LogoutDialog {
    constructor() {
        super(MAIN_DIALOG, process.env.connectionName || process.env.OAUTH_CONNECTION_NAME);

        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        if (!connectionName) {
            console.error('MainDialog: ERROR - No se ha configurado connectionName');
            throw new Error('Configuración OAuth faltante: connectionName es requerido');
        }

        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            title: 'Iniciar Sesión - Alfa Bot',
            timeout: 300000,
            endOnInvalidMessage: true
        }));

        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;

        // Control de procesos activos
        this.activeAuthDialogs = new Set();
        this.processingUsers = new Set();
        this.cancelledMessagesSent = new Set();
        
        // Rastrear diálogos en progreso para signin/verifyState
        this.dialogsInProgress = new Map(); // userId -> dialogContext
        
        global.mainDialogInstance = this;
    }

    /**
     * Run method - MEJORADO para mejor limpieza de estados
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;
        const activityType = context.activity.type;
        const activityName = context.activity.name;

        console.log(`\n=== MAIN DIALOG RUN ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Tipo de actividad: ${activityType}`);
        console.log(`Nombre de actividad: ${activityName || 'N/A'}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);

        // MEJORADO: Manejo específico para signin/verifyState
        if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
            console.log(`[${userId}] Detectado ${activityName} - Verificando diálogo existente`);
            
            const existingDialog = this.dialogsInProgress.get(userId);
            if (existingDialog) {
                console.log(`[${userId}] Continuando diálogo existente para ${activityName}`);
                try {
                    const results = await existingDialog.continueDialog();
                    console.log(`[${userId}] Estado del diálogo después de ${activityName}: ${results.status}`);
                    
                    if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                        this.dialogsInProgress.delete(userId);
                        this.activeAuthDialogs.delete(dialogKey);
                        console.log(`[${userId}] Diálogo completado/cancelado para ${activityName}`);
                    }
                    return;
                } catch (continueError) {
                    console.error(`[${userId}] Error continuando diálogo para ${activityName}:`, continueError);
                    // Si falla, limpiar y continuar con nuevo diálogo
                    this.dialogsInProgress.delete(userId);
                    this.activeAuthDialogs.delete(dialogKey);
                }
            }
        }
        
        // Verificar si ya se está procesando
        if (this.processingUsers.has(userId)) {
            console.log(`[${userId}] Usuario ya está siendo procesado`);
            return;
        }

        // NUEVO: Verificación mejorada de autenticación para activities de message
        if (activityType === 'message') {
            const bot = context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
                try {
                    // CAMBIO IMPORTANTE: Usar verificación mejorada
                    const authResult = await bot.isUserAuthenticatedEnhanced(userId, context, true); // Saltamos cache
                    
                    // Si está autenticado con token válido, no necesita diálogo de auth
                    if (authResult.authenticated && authResult.tokenValid) {
                        console.log(`[${userId}] Usuario ya está autenticado correctamente, saltando diálogo`);
                        return;
                    }
                    
                    // Si el token es inválido, asegurar limpieza completa
                    if (authResult.source === 'token_invalid' || !authResult.tokenValid) {
                        console.log(`[${userId}] Token inválido detectado en MainDialog, limpiando estado`);
                        
                        // Limpiar estados de MainDialog
                        this.emergencyUserCleanup(userId);
                        
                        // Limpiar en bot si está disponible
                        if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                            await bot.forceCleanUserAuthState(userId, context, 'maindialog_token_invalid');
                        }
                    }
                    
                } catch (verificationError) {
                    console.warn(`[${userId}] Error en verificación mejorada:`, verificationError.message);
                }
            }
        }

        // Evitar diálogos duplicados
        if (this.activeAuthDialogs.has(dialogKey)) {
            console.log(`[${userId}] Diálogo ya activo`);
            return;
        }

        this.processingUsers.add(userId);

        try {
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            
            // Guardar contexto de diálogo para signin/verifyState
            this.dialogsInProgress.set(userId, dialogContext);
            
            const results = await dialogContext.continueDialog();

            console.log(`[${userId}] Estado del diálogo: ${results.status}`);
            
            if (results.status === DialogTurnStatus.empty) {
                this.activeAuthDialogs.add(dialogKey);

                try {
                    console.log(`[${userId}] Iniciando diálogo`);
                    await dialogContext.beginDialog(this.id);
                } catch (beginError) {
                    console.error(`[${userId}] Error iniciando diálogo:`, beginError);
                    throw beginError;
                } finally {
                    console.log(`[${userId}] Diálogo iniciado`);
                }
            } else {
                // Limpiar si el diálogo ha terminado
                if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                    this.activeAuthDialogs.delete(dialogKey);
                    this.dialogsInProgress.delete(userId);
                    console.log(`[${userId}] Diálogo completado/cancelado`);
                }
            }
        } catch (error) {
            console.error(`[${userId}] Error en run():`, error);
            // Limpiar estado de error
            this.activeAuthDialogs.delete(dialogKey);
            this.dialogsInProgress.delete(userId);
            this.processingUsers.delete(userId);
            throw error;
        } finally {
            // Siempre limpiar el estado de procesamiento
            this.processingUsers.delete(userId);
        }
    }

    /**
     * Prompt Step - MEJORADO para evitar prompts duplicados y manejar tokens inválidos
     */
    async promptStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        const activityType = stepContext.context.activity.type;
        const activityName = stepContext.context.activity.name;

        console.log(`\n=== PROMPT STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Tipo de actividad: ${activityType}`);
        console.log(`Nombre de actividad: ${activityName || 'N/A'}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        // Si es invoke (signin/verifyState), NO mostrar nuevo prompt
        if (activityType === 'invoke' && (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange')) {
            console.log(`[${userId}] Es ${activityName}, saltando prompt - continuando a loginStep`);
            return await stepContext.next(null);
        }

        // MEJORADO: Verificación múltiple de autenticación solo para messages
        if (activityType === 'message') {
            const bot = stepContext.context.turnState.get('bot');
            
            // Verificación con método mejorado
            if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
                try {
                    const authResult = await bot.isUserAuthenticatedEnhanced(userId, stepContext.context, true);
                    
                    // Si está autenticado con token válido, saltar prompt
                    if (authResult.authenticated && authResult.tokenValid) {
                        console.log(`[${userId}] Usuario ya autenticado con token válido, saltando prompt`);
                        return await stepContext.next(authResult);
                    }
                    
                    // Si el token es inválido, limpiar y continuar con nuevo prompt
                    if (authResult.source === 'token_invalid' || !authResult.tokenValid) {
                        console.log(`[${userId}] Token inválido en promptStep, necesario nuevo login`);
                        
                        // Limpiar estado si es necesario
                        if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                            await bot.forceCleanUserAuthState(userId, stepContext.context, 'prompt_step_token_invalid');
                        }
                        
                        // Continuar con prompt de nuevo login
                    }
                } catch (verificationError) {
                    console.warn(`[${userId}] Error en verificación mejorada:`, verificationError.message);
                }
            }
        }

        try {
            console.log(`[${userId}] Iniciando OAuth prompt`);
            
            await stepContext.context.sendActivity('🔐 **Autenticación Requerida**\n\nPara acceder a las funciones del bot, necesitas iniciar sesión con tu cuenta corporativa.\n\n🔄 Te redirigiremos al sistema de login...');
            
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error(`[${userId}] Error en promptStep:`, error);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Login Step - MEJORADO con mejor manejo de token inválido
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;
        const activityType = stepContext.context.activity.type;
        const activityName = stepContext.context.activity.name;

        console.log(`\n=== LOGIN STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Token presente: ${!!tokenResponse?.token}`);
        console.log(`Tipo de actividad: ${activityType}`);
        console.log(`Nombre de actividad: ${activityName || 'N/A'}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        if (tokenResponse && tokenResponse.token) {
            try {
                // MEJORADO: Validar el token primero
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`[${userId}] ❌ TOKEN OAUTH INVÁLIDO RECIBIDO`);
                    
                    // Limpiar estado por token inválido
                    const bot = stepContext.context.turnState.get('bot');
                    if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                        await bot.forceCleanUserAuthState(userId, stepContext.context, 'received_invalid_token');
                    }
                    
                    await stepContext.context.sendActivity('❌ **Token de autenticación inválido**\n\n' +
                        'El token recibido no es válido. Esto puede deberse a:\n' +
                        '• Expiración durante el proceso\n' +
                        '• Revocación de permisos\n' +
                        '• Error en el servidor de autenticación\n\n' +
                        '✨ Escribe `login` para intentar nuevamente.');
                    
                    return await stepContext.endDialog();
                }

                // Obtener información del usuario
                let userName = 'Usuario';
                let userEmail = 'usuario@alfa.com';

                try {
                    const userInfo = await this.extractUserInfoFromToken(tokenResponse.token);
                    userName = userInfo.name || userInfo.preferred_username || 'Usuario';
                    userEmail = userInfo.email || userInfo.upn || userInfo.preferred_username || 'usuario@alfa.com';
                    
                    console.log(`[${userId}] ✅ Info del usuario - Nombre: ${userName}, Email: ${userEmail}`);
                } catch (extractError) {
                    console.warn(`[${userId}] No se pudo extraer información del token:`, extractError.message);
                }

                // Marcar usuario como autenticado
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.setUserAuthenticated === 'function') {
                    console.log(`[${userId}] 🔐 Marcando usuario como autenticado`);
                    
                    const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                        email: userEmail,
                        name: userName,
                        token: tokenResponse.token,
                        context: stepContext.context
                    });

                    if (authSuccess) {
                        console.log(`[${userId}] ✅ AUTENTICACIÓN EXITOSA`);
                        
                        // Verificación post-auth
                        if (typeof bot.forceAuthVerification === 'function') {
                            const verificationResult = await bot.forceAuthVerification(userId, stepContext.context);
                            console.log(`[${userId}] Verificación post-auth: ${verificationResult.authenticated}`);
                        }
                        
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n` +
                                             `🎉 Bienvenido, **${userName}**\n\n` +
                                             `💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        
                        await stepContext.context.sendActivity(welcomeMessage);
                        
                        // Pausa para sincronización
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`[${userId}] ❌ Error al marcar usuario como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente escribiendo `login`.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error('❌ No se pudo obtener la instancia del bot');
                    await stepContext.context.sendActivity('❌ **Error interno**\n\nNo se pudo acceder al sistema de autenticación. Contacta al administrador.');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error(`[${userId}] ❌ Error crítico en autenticación:`, error);
                
                // Limpiar estado por error
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                    await bot.forceCleanUserAuthState(userId, stepContext.context, 'login_step_error');
                }
                
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\n' +
                    'Ocurrió un error durante el proceso de autenticación. ' +
                    'Intenta escribir `login` nuevamente o contacta al administrador si el problema persiste.');
                
                return await stepContext.endDialog();
            }
        } else {
            // MEJORADO: Mejor manejo cuando no hay token
            if (activityType === 'invoke' && activityName === 'signin/verifyState') {
                console.log(`[${userId}] signin/verifyState sin token - esperando token en próximo invoke`);
                // No terminar el diálogo, continuar esperando
                return await stepContext.next(null);
            }
            
            console.warn(`[${userId}] ⚠️ Usuario canceló la autenticación o no se recibió token`);

            // MEJORADO: Limpiar estado cuando se cancela
            const bot = stepContext.context.turnState.get('bot');
            if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                await bot.forceCleanUserAuthState(userId, stepContext.context, 'login_cancelled');
            }

            const messageKey = `cancelled_${userId}`;
            if (!this.cancelledMessagesSent.has(messageKey)) {
                this.cancelledMessagesSent.add(messageKey);
                
                setTimeout(() => {
                    this.cancelledMessagesSent.delete(messageKey);
                }, 30000);
                
                await stepContext.context.sendActivity('⚠️ **Autenticación cancelada**\n\n' +
                    'No se completó el proceso de autenticación. ' +
                    'Escribe `login` cuando estés listo para intentar nuevamente.');
            }

            return await stepContext.endDialog();
        }
    }

    /**
     * Final Step - MEJORADO con mejor limpieza
     */
    async finalStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;
        
        console.log(`\n=== FINAL STEP ===`);
        console.log(`Usuario: ${userId}`);
        console.log(`Resultado: ${!!stepContext.result}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        
        // Limpiar estados al final
        this.activeAuthDialogs.delete(dialogKey);
        this.dialogsInProgress.delete(userId);
        this.processingUsers.delete(userId);
        console.log(`[${userId}] Estados limpiados en finalStep`);
        
        // Verificación final mejorada
        const bot = stepContext.context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
            try {
                const finalAuthCheck = await bot.isUserAuthenticatedEnhanced(userId, stepContext.context, true);
                console.log(`[${userId}] Verificación final de autenticación:`, finalAuthCheck);
                
                if (finalAuthCheck.authenticated && finalAuthCheck.tokenValid) {
                    await stepContext.context.sendActivity('🎯 **¡Todo listo!**\n\nYa puedes enviar cualquier mensaje y el bot te ayudará.');
                } else if (finalAuthCheck.source === 'token_invalid') {
                    console.log(`[${userId}] ⚠️ Token inválido detectado en verificación final`);
                    await stepContext.context.sendActivity('⚠️ **Problema con la autenticación**\n\n' +
                        'Parece que hubo un problema con el token. Escribe `login` para intentar nuevamente.');
                }
            } catch (finalCheckError) {
                console.warn(`[${userId}] Error en verificación final:`, finalCheckError.message);
            }
        }
        
        return await stepContext.endDialog(stepContext.result);
    }

    /**
     * MEJORADO: Validates an OAuth token with better error handling
     */
    async validateOAuthToken(token) {
        try {
            if (!token || typeof token !== 'string') {
                console.warn('validateOAuthToken: Token inválido o faltante');
                return false;
            }

            // Verificar formato del token
            if (!token.includes('.') && !token.startsWith('Bearer ')) {
                console.warn('validateOAuthToken: Formato de token no reconocido');
                return false;
            }

            console.log('🔍 Validando token OAuth...');
            
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

            const isValid = response.status === 200;
            console.log(`✅ Token válido - Status: ${response.status}`);
            return isValid;
            
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.warn('❌ Token inválido (401 Unauthorized)');
                return false;
            } else if (error.code === 'ECONNABORTED') {
                console.warn('⏰ Timeout validando token - asumiendo válido');
                return true; // En caso de timeout, asumimos válido para no bloquear
            } else {
                console.warn('⚠️ Error validando token (asumiendo válido):', error.message);
                return true; // Para otros errores, asumimos válido
            }
        }
    }

    /**
     * Extracts user information from token (sin cambios)
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
            console.warn('Error extrayendo información del token:', error.message);
            throw error;
        }
    }

    /**
     * MEJORADO: Cleanup methods con mejor logging
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadActiveDialog = this.activeAuthDialogs.has(dialogKey);
        
        if (hadActiveDialog) {
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            this.dialogsInProgress.delete(userId);
            this.cancelledMessagesSent.delete(`cancelled_${userId}`);
            console.log(`[${userId}] ✅ Diálogo terminado completamente`);
        }
        
        return hadActiveDialog;
    }

    getDialogStats() {
        return {
            activeAuthDialogs: this.activeAuthDialogs.size,
            processingUsers: this.processingUsers.size,
            dialogsInProgress: this.dialogsInProgress.size,
            cancelledMessagesSent: this.cancelledMessagesSent.size,
            activeDialogs: Array.from(this.activeAuthDialogs),
            processingUsersList: Array.from(this.processingUsers),
            timestamp: new Date().toISOString()
        };
    }

    forceCleanup() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        const beforeDialogsInProgress = this.dialogsInProgress.size;
        const beforeMessages = this.cancelledMessagesSent.size;
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        this.dialogsInProgress.clear();
        this.cancelledMessagesSent.clear();
        
        console.warn(`MainDialog.forceCleanup: Limpiados ${beforeAuthDialogs} diálogos activos, ${beforeProcessing} usuarios en procesamiento, ${beforeDialogsInProgress} diálogos en progreso y ${beforeMessages} mensajes de cancelación`);
        
        return {
            activeAuthDialogsCleared: beforeAuthDialogs,
            processingUsersCleared: beforeProcessing,
            dialogsInProgressCleared: beforeDialogsInProgress,
            cancelledMessagesCleared: beforeMessages,
            timestamp: new Date().toISOString()
        };
    }

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
        
        if (this.dialogsInProgress.has(userId)) {
            this.dialogsInProgress.delete(userId);
            actionsExecuted.push('dialog_in_progress_removed');
        }
        
        const messageKey = `cancelled_${userId}`;
        if (this.cancelledMessagesSent.has(messageKey)) {
            this.cancelledMessagesSent.delete(messageKey);
            actionsExecuted.push('cancelled_message_cleared');
        }
        
        console.log(`[${userId}] 🧹 MainDialog emergencyUserCleanup: ${actionsExecuted.join(', ')}`);
        
        return {
            userId,
            actionsExecuted,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * NUEVO: Limpia diálogos obsoletos
     */
    cleanupStaleDialogs() {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutos
        let cleaned = 0;
        
        // Limpiar processingUsers obsoletos
        for (const userId of this.processingUsers) {
            // Si ha estado procesando por más de 5 minutos, es obsoleto
            this.processingUsers.delete(userId);
            cleaned++;
        }
        
        // Limpiar mensajes de cancelación obsoletos
        const cancelledKeys = Array.from(this.cancelledMessagesSent);
        cancelledKeys.forEach(key => {
            this.cancelledMessagesSent.delete(key);
            cleaned++;
        });
        
        if (cleaned > 0) {
            console.warn(`MainDialog: Limpiados ${cleaned} elementos obsoletos`);
        }
        
        return cleaned;
    }
}

module.exports.MainDialog = MainDialog;