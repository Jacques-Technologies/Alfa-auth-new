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
     * The run method handles the incoming activity - VERSIÓN CORREGIDA CON PRIORIDAD PARA LOGOUT
     * @param {TurnContext} context - The context object for the turn.
     * @param {StatePropertyAccessor} accessor - The state property accessor for the dialog state.
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const dialogKey = `auth-dialog-${userId}`;
        const activityType = context.activity.type;
        const text = (context.activity.text || '').trim().toLowerCase();
        
        console.log(`[${userId}] MainDialog.run - Tipo actividad: ${activityType}, Texto: "${text}"`);
        
        // CORRECCIÓN: Solo procesar para actividades de mensaje y invoke
        if (activityType !== 'message' && activityType !== 'invoke') {
            console.log(`[${userId}] MainDialog: Ignorando actividad tipo ${activityType}`);
            return;
        }
        
        // CORRECCIÓN: Para actividades invoke, no verificar autenticación
        if (activityType === 'invoke') {
            console.log(`[${userId}] MainDialog: Procesando actividad invoke directamente`);
            
            try {
                const dialogSet = new DialogSet(accessor);
                dialogSet.add(this);
                const dialogContext = await dialogSet.createContext(context);
                await dialogContext.continueDialog();
                return;
            } catch (error) {
                console.error(`[${userId}] MainDialog: Error procesando invoke:`, error);
                return;
            }
        }
        
        // 🚨 CORRECCIÓN CRÍTICA: Comandos de emergencia tienen prioridad absoluta
        const emergencyCommands = ['logout', 'cerrar sesion', 'cerrar sesión', 'salir', 'exit', 'reset'];
        const isEmergencyCommand = emergencyCommands.includes(text);
        
        if (isEmergencyCommand) {
            console.log(`[${userId}] MainDialog: Comando de emergencia detectado: "${text}"`);
            
            // Limpiar TODOS los estados activos para este usuario
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            
            console.log(`[${userId}] MainDialog: Estados limpiados por comando de emergencia`);
            
            // No procesar el diálogo OAuth para comandos de emergencia
            return;
        }
        
        // CORRECCIÓN: Verificar timeout de diálogos activos
        if (this.activeAuthDialogs.has(dialogKey)) {
            // Verificar si el diálogo lleva mucho tiempo activo
            const dialogStartTime = this.dialogStartTimes?.get(dialogKey);
            if (dialogStartTime) {
                const timeElapsed = Date.now() - dialogStartTime;
                if (timeElapsed > 5 * 60 * 1000) { // 5 minutos
                    console.warn(`[${userId}] MainDialog: Diálogo activo por ${timeElapsed}ms, limpiando automáticamente`);
                    this.activeAuthDialogs.delete(dialogKey);
                    this.processingUsers.delete(userId);
                    this.dialogStartTimes?.delete(dialogKey);
                    
                    // Notificar al usuario
                    try {
                        await context.sendActivity('⏰ **Sesión de autenticación expirada**\n\n' +
                            'El proceso de autenticación ha sido reiniciado automáticamente. ' +
                            'Escribe `login` para intentar nuevamente.');
                    } catch (error) {
                        console.error(`[${userId}] Error enviando mensaje de expiración:`, error);
                    }
                } else {
                    console.log(`[${userId}] MainDialog: Diálogo activo hace ${timeElapsed}ms, continuando`);
                    return;
                }
            } else {
                console.log(`[${userId}] MainDialog: Diálogo activo sin timestamp, continuando`);
                return;
            }
        }
        
        // CORRECCIÓN: Verificar si ya se está procesando este usuario
        if (this.processingUsers.has(userId)) {
            console.log(`[${userId}] MainDialog: Usuario ya está siendo procesado`);
            return;
        }
        
        // CORRECCIÓN: Verificar si ya está autenticado antes de iniciar diálogo
        const bot = context.turnState.get('bot');
        if (bot && typeof bot.isUserAuthenticated === 'function') {
            const isAuthenticated = bot.isUserAuthenticated(userId);
            if (isAuthenticated) {
                console.log(`[${userId}] MainDialog: Usuario ya está autenticado, saltando diálogo`);
                return;
            }
        }
        
        // CORRECCIÓN: Verificar estado persistente también
        const userState = context.turnState.get('UserState');
        if (userState) {
            try {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(context, {});
                if (authData[userId]?.authenticated === true) {
                    console.log(`[${userId}] MainDialog: Usuario autenticado en estado persistente`);
                    return;
                }
            } catch (error) {
                console.warn(`[${userId}] MainDialog: Error verificando estado persistente:`, error);
            }
        }

        // CORRECCIÓN: Marcar como procesando
        this.processingUsers.add(userId);
        console.log(`[${userId}] MainDialog: Marcando como procesando`);

        try {
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            const results = await dialogContext.continueDialog();
            
            console.log(`[${userId}] MainDialog: Estado del diálogo: ${results.status}`);
            
            if (results.status === DialogTurnStatus.empty) {
                console.log(`[${userId}] MainDialog: Iniciando nuevo diálogo`);
                
                // CORRECCIÓN: Marcar diálogo como activo antes de iniciar
                this.activeAuthDialogs.add(dialogKey);
                
                // Inicializar timestamp para tracking
                if (!this.dialogStartTimes) {
                    this.dialogStartTimes = new Map();
                }
                this.dialogStartTimes.set(dialogKey, Date.now());
                
                try {
                    await dialogContext.beginDialog(this.id);
                    console.log(`[${userId}] MainDialog: Diálogo iniciado exitosamente`);
                } catch (beginError) {
                    console.error(`[${userId}] MainDialog: Error iniciando diálogo:`, beginError);
                    this.activeAuthDialogs.delete(dialogKey);
                    this.dialogStartTimes?.delete(dialogKey);
                    throw beginError;
                }
            } else {
                // CORRECCIÓN: Limpiar si el diálogo ha terminado
                if (results.status === DialogTurnStatus.complete || results.status === DialogTurnStatus.cancelled) {
                    console.log(`[${userId}] MainDialog: Diálogo terminado (${results.status})`);
                    this.activeAuthDialogs.delete(dialogKey);
                    this.dialogStartTimes?.delete(dialogKey);
                }
            }
        } catch (error) {
            console.error(`[${userId}] MainDialog: Error en run():`, error);
            
            // CORRECCIÓN: Limpiar estado de error
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            this.dialogStartTimes?.delete(dialogKey);
            
            throw error;
        } finally {
            // CORRECCIÓN: Siempre limpiar el estado de procesamiento
            this.processingUsers.delete(userId);
            console.log(`[${userId}] MainDialog: Procesamiento finalizado`);
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
     * Handles the login step - VERSIÓN CORREGIDA Y MEJORADA
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;
        
        console.log(`[${userId}] MainDialog.loginStep - Token presente: ${!!tokenResponse?.token}, Resultado: ${JSON.stringify(tokenResponse)}`);
        
        // CORRECCIÓN: Verificar diferentes tipos de respuesta
        if (tokenResponse && tokenResponse.token) {
            console.log(`[${userId}] Token válido recibido, procesando autenticación`);
            
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
                        console.log(`[${userId}] Autenticación exitosa`);
                        
                        const welcomeMessage = `✅ **¡Autenticación exitosa!**\n\n🎉 Bienvenido, **${userName}**\n\n💬 Ya puedes usar todas las funciones del bot. ¡Pregúntame lo que necesites!`;
                        await stepContext.context.sendActivity(welcomeMessage);
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`[${userId}] Error al marcar usuario como autenticado`);
                        await stepContext.context.sendActivity('❌ **Error al completar autenticación**\n\nPor favor, intenta autenticarte nuevamente.');
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error(`[${userId}] No se pudo obtener la instancia del bot`);
                    await stepContext.context.sendActivity('❌ **Error interno**\n\nNo se pudo completar la autenticación. Contacta al administrador.');
                    return await stepContext.endDialog();
                }
            } catch (error) {
                console.error(`[${userId}] Error en autenticación:`, error);
                await stepContext.context.sendActivity('❌ **Error inesperado en autenticación**\n\nOcurrió un error durante el proceso de autenticación. Intenta escribir `login` nuevamente.');
                return await stepContext.endDialog();
            }
        } 
        // CORRECCIÓN: Verificar si es null debido a que el proceso aún está en curso
        else if (tokenResponse === null || tokenResponse === undefined) {
            console.log(`[${userId}] No se recibió token - el proceso puede estar en curso o fue cancelado`);
            
            // CORRECCIÓN: No marcar automáticamente como cancelado
            // Esto puede ser normal durante el flujo OAuth
            console.log(`[${userId}] Proceso OAuth en curso, esperando token...`);
            
            // Verificar si el usuario ya está autenticado por otro medio
            const bot = stepContext.context.turnState.get('bot');
            if (bot && bot.isUserAuthenticated && bot.isUserAuthenticated(userId)) {
                console.log(`[${userId}] Usuario ya autenticado por otro medio`);
                await stepContext.context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot!');
                return await stepContext.next(null);
            }
            
            // Solo mostrar cancelación si estamos seguros de que fue cancelado
            const activity = stepContext.context.activity;
            if (activity && activity.name === 'signin/failure') {
                console.log(`[${userId}] Confirmación de cancelación recibida`);
                await stepContext.context.sendActivity('❌ **Autenticación cancelada**\n\n' +
                    '🚫 **Has cerrado la ventana de autenticación sin completar el proceso.**\n\n' +
                    '**Para usar el bot necesitas autenticarte:**\n' +
                    '• Escribe `login` para intentar nuevamente\n' +
                    '• Asegúrate de completar todo el proceso de autenticación\n' +
                    '• Si continúas teniendo problemas, contacta al administrador\n\n' +
                    '💡 **Importante**: Sin autenticación no puedes acceder a las funciones del bot.');
            } else {
                console.log(`[${userId}] No se recibió token, pero no hay confirmación de cancelación`);
                await stepContext.context.sendActivity('⏳ **Esperando autenticación...**\n\n' +
                    'Por favor, completa el proceso de autenticación en la ventana del navegador.\n\n' +
                    'Si cerraste la ventana por error, escribe `login` para intentar nuevamente.');
            }
            
            return await stepContext.endDialog();
        }
        else {
            console.warn(`[${userId}] Respuesta inesperada del token:`, tokenResponse);
            await stepContext.context.sendActivity('⚠️ **Respuesta inesperada**\n\nOcurrió algo inesperado durante la autenticación. Intenta escribir `login` nuevamente.');
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
     * NUEVA FUNCIÓN: Termina el diálogo de un usuario específico - VERSIÓN MEJORADA
     * @param {string} userId - ID del usuario
     * @returns {boolean} - Si había un diálogo activo
     */
    endUserDialog(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const hadActiveDialog = this.activeAuthDialogs.has(dialogKey);
        const wasProcessing = this.processingUsers.has(userId);
        
        if (hadActiveDialog || wasProcessing) {
            this.activeAuthDialogs.delete(dialogKey);
            this.processingUsers.delete(userId);
            this.dialogStartTimes?.delete(dialogKey);
            
            console.log(`[${userId}] MainDialog.endUserDialog: Diálogo y procesamiento terminados (activo: ${hadActiveDialog}, procesando: ${wasProcessing})`);
        }
        
        return hadActiveDialog || wasProcessing;
    }

    /**
     * NUEVA FUNCIÓN: Limpia diálogos obsoletos automáticamente
     * @returns {number} - Número de diálogos limpiados
     */
    cleanupStaleDialogs() {
        const now = Date.now();
        const staleTimeout = 5 * 60 * 1000; // 5 minutos
        let cleanedCount = 0;
        
        // Limpiar diálogos activos obsoletos
        const staleDialogs = [];
        for (const dialogKey of this.activeAuthDialogs) {
            const startTime = this.dialogStartTimes?.get(dialogKey);
            if (startTime && (now - startTime) > staleTimeout) {
                staleDialogs.push(dialogKey);
            }
        }
        
        staleDialogs.forEach(dialogKey => {
            this.activeAuthDialogs.delete(dialogKey);
            this.dialogStartTimes?.delete(dialogKey);
            cleanedCount++;
            
            // Extraer userId del dialogKey
            const userId = dialogKey.replace('auth-dialog-', '');
            this.processingUsers.delete(userId);
            
            console.log(`MainDialog.cleanupStaleDialogs: Limpiado diálogo obsoleto para usuario ${userId}`);
        });
        
        return cleanedCount;
    }

    /**
     * NUEVA FUNCIÓN: Fuerza limpieza de todos los estados - VERSIÓN MEJORADA
     * @returns {Object} - Estadísticas de limpieza
     */
    forceCleanup() {
        const beforeAuthDialogs = this.activeAuthDialogs.size;
        const beforeProcessing = this.processingUsers.size;
        const beforeStartTimes = this.dialogStartTimes?.size || 0;
        
        this.activeAuthDialogs.clear();
        this.processingUsers.clear();
        
        if (this.dialogStartTimes) {
            this.dialogStartTimes.clear();
        }
        
        console.warn(`MainDialog.forceCleanup: Limpiados ${beforeAuthDialogs} diálogos activos, ${beforeProcessing} usuarios en procesamiento, ${beforeStartTimes} timestamps`);
        
        return {
            activeAuthDialogsCleared: beforeAuthDialogs,
            processingUsersCleared: beforeProcessing,
            timestampsCleared: beforeStartTimes,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * NUEVA FUNCIÓN: Comando de emergencia para un usuario específico
     * @param {string} userId - ID del usuario
     * @returns {Object} - Resultado de la limpieza
     */
    emergencyUserCleanup(userId) {
        const dialogKey = `auth-dialog-${userId}`;
        const result = {
            userId,
            actionsExecuted: [],
            timestamp: new Date().toISOString()
        };
        
        // Limpiar diálogo activo
        if (this.activeAuthDialogs.has(dialogKey)) {
            this.activeAuthDialogs.delete(dialogKey);
            result.actionsExecuted.push('dialog_cleared');
        }
        
        // Limpiar procesamiento
        if (this.processingUsers.has(userId)) {
            this.processingUsers.delete(userId);
            result.actionsExecuted.push('processing_cleared');
        }
        
        // Limpiar timestamp
        if (this.dialogStartTimes?.has(dialogKey)) {
            this.dialogStartTimes.delete(dialogKey);
            result.actionsExecuted.push('timestamp_cleared');
        }
        
        console.warn(`MainDialog.emergencyUserCleanup: Limpieza de emergencia para usuario ${userId} - ${result.actionsExecuted.join(', ')}`);
        
        return result;
    }
}

module.exports.MainDialog = MainDialog;