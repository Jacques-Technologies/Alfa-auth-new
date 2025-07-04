// mainDialog.js - FIX ESPECÍFICO PARA signin/verifyState

const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class - FIX PARA signin/verifyState
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
        
        // NUEVO: Rastrear diálogos en progreso para signin/verifyState
        this.dialogsInProgress = new Map(); // userId -> dialogContext
        
        global.mainDialogInstance = this;
    }

    /**
     * Run method - FIX PARA EVITAR DIÁLOGOS DUPLICADOS EN signin/verifyState
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

        // NUEVO: Si es signin/verifyState y ya hay un diálogo en progreso, continuar en lugar de crear nuevo
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

        // Verificación de autenticación mejorada - SOLO para activities de message
        if (activityType === 'message') {
            const bot = context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
                try {
                    const isAuthenticated = await bot.isUserAuthenticatedEnhanced(userId, context);
                    if (isAuthenticated) {
                        console.log(`[${userId}] Usuario ya está autenticado, saltando diálogo`);
                        return;
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
            
            // NUEVO: Guardar contexto de diálogo para signin/verifyState
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
                    // NO eliminar aquí - esperar a que termine el flujo completo
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
     * Prompt Step - VERSIÓN MEJORADA PARA EVITAR DOBLES
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
        
        // NUEVO: Si es invoke (signin/verifyState), NO mostrar nuevo prompt
        if (activityType === 'invoke' && (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange')) {
            console.log(`[${userId}] Es ${activityName}, saltando prompt - continuando a loginStep`);
            return await stepContext.next(null);
        }

        // Verificación múltiple de autenticación solo para messages
        if (activityType === 'message') {
            const bot = stepContext.context.turnState.get('bot');
            
            // Verificación con método mejorado
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
     * Login Step - VERSIÓN MEJORADA
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
                // Validar el token
                const isTokenValid = await this.validateOAuthToken(tokenResponse.token);
                if (!isTokenValid) {
                    console.error(`[${userId}] Token OAuth inválido`);
                    await stepContext.context.sendActivity('❌ **Token de autenticación inválido**\n\nEl token recibido no es válido. Por favor, intenta iniciar sesión nuevamente.');
                    return await stepContext.endDialog();
                }

                // Obtener información del usuario
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

                // Marcar usuario como autenticado
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
                        console.log(`[${userId}] Autenticación exitosa`);
                        
                        // Verificación post-auth
                        if (typeof bot.forceAuthVerification === 'function') {
                            const verificationResult = await bot.forceAuthVerification(userId, stepContext.context);
                            console.log(`[${userId}] Verificación post-auth: ${verificationResult}`);
                        }
                        
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n🎉 Bienvenido, **${userName}**\n\n💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        await stepContext.context.sendActivity(welcomeMessage);
                        
                        // Pausa para sincronización
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`[${userId}] Error al marcar usuario como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error('No se pudo obtener la instancia del bot');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error(`[${userId}] Error en autenticación:`, error);
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\nOcurrió un error durante el proceso de autenticación. Intenta escribir `login` nuevamente.');
                return await stepContext.endDialog();
            }
        } else {
            // IMPORTANTE: No mostrar mensaje de cancelación si es signin/verifyState
            if (activityType === 'invoke' && activityName === 'signin/verifyState') {
                console.log(`[${userId}] signin/verifyState sin token - esperando token en próximo invoke`);
                // No terminar el diálogo, continuar esperando
                return await stepContext.next(null);
            }
            
            console.warn(`[${userId}] Usuario canceló la autenticación`);

            const messageKey = `cancelled_${userId}`;
            if (!this.cancelledMessagesSent.has(messageKey)) {
                this.cancelledMessagesSent.add(messageKey);
                
                setTimeout(() => {
                    this.cancelledMessagesSent.delete(messageKey);
                }, 30000);
            }

            return await stepContext.endDialog();
        }
    }

    /**
     * Final Step - VERSIÓN MEJORADA
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
        
        // Verificación final
        const bot = stepContext.context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticatedEnhanced === 'function') {
            try {
                const finalAuthCheck = await bot.isUserAuthenticatedEnhanced(userId, stepContext.context);
                console.log(`[${userId}] Verificación final de autenticación: ${finalAuthCheck}`);

            } catch (finalCheckError) {
                console.warn(`[${userId}] Error en verificación final:`, finalCheckError.message);
            }
        }
        
        return await stepContext.endDialog(stepContext.result);
    }

    /**
     * Validates an OAuth token
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
            console.warn('Error validando token (asumiendo válido):', error.message);
            return true;
        }
    }

    /**
     * Extracts user information from token
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
     * Cleanup methods
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadActiveDialog = this.activeAuthDialogs.has(dialogKey);
        
        if (hadActiveDialog) {
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            this.dialogsInProgress.delete(userId);
            this.cancelledMessagesSent.delete(`cancelled_${userId}`);
            console.log(`[${userId}] Diálogo terminado completamente`);
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
        
        return {
            userId,
            actionsExecuted,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports.MainDialog = MainDialog;