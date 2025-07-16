// mainDialog.js - Versión simplificada y estable

const { DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog - Versión simplificada sin complejidad de tracking
 */
class MainDialog extends LogoutDialog {
    constructor() {
        super(MAIN_DIALOG, process.env.connectionName || process.env.OAUTH_CONNECTION_NAME);

        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        console.log(`🔧 [MainDialog] Inicializando con connectionName: ${connectionName}`);
        
        if (!connectionName) {
            console.error('MainDialog: ERROR - connectionName no configurado');
            console.error('Variables de entorno disponibles:', {
                connectionName: process.env.connectionName,
                OAUTH_CONNECTION_NAME: process.env.OAUTH_CONNECTION_NAME
            });
            throw new Error('Configuración OAuth faltante');
        }

        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            title: 'Iniciar Sesión - Alfa Bot',
            timeout: 300000, // 5 minutos
            endOnInvalidMessage: true
        }));

        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;

        // Control simple de diálogos activos
        this.activeDialogs = new Set();
        
        // Registrar globalmente para acceso desde bot
        global.mainDialogInstance = this;

        console.log(`✅ [MainDialog] Inicializado correctamente con connectionName: ${connectionName}`);
    }

    /**
     * Método run simplificado
     */
    async run(context, accessor) {
        const userId = context.activity.from.id;
        const activityType = context.activity.type;
        const activityName = context.activity.name;

        console.log(`MainDialog.run [${userId}] - ${activityType}:${activityName || 'N/A'}`);

        try {
            // Verificar si ya hay autenticación para activities de message
            if (activityType === 'message') {
                const bot = context.turnState.get('bot');
                if (bot && typeof bot.isUserAuthenticated === 'function') {
                    const isAuthenticated = await bot.isUserAuthenticated(userId, context);
                    if (isAuthenticated) {
                        console.log(`[${userId}] Ya autenticado, saltando diálogo`);
                        return;
                    }
                }
            }

            // Crear DialogSet y contexto
            const dialogSet = new DialogSet(accessor);
            dialogSet.add(this);

            const dialogContext = await dialogSet.createContext(context);
            
            // Primero intentar continuar cualquier diálogo existente
            const results = await dialogContext.continueDialog();
            console.log(`[${userId}] Estado del diálogo: ${results.status}`);

            // Si no hay diálogo activo, iniciar uno nuevo
            if (results.status === DialogTurnStatus.empty) {
                // Para eventos invoke de OAuth, permitir siempre el procesamiento
                if (activityType === 'invoke' && 
                    ['signin/verifyState', 'signin/tokenExchange'].includes(activityName)) {
                    console.log(`[${userId}] Procesando evento OAuth invoke sin verificar activeDialogs`);
                    return;
                }
                
                // Verificar si ya hay un diálogo activo para evitar duplicados
                const dialogKey = `dialog-${userId}`;
                if (this.activeDialogs.has(dialogKey)) {
                    console.log(`[${userId}] Diálogo ya marcado como activo, verificando estado...`);
                    
                    // Si es un comando login explícito, limpiar y reiniciar
                    if (activityType === 'message' && context.activity.text?.toLowerCase() === 'login') {
                        console.log(`[${userId}] Comando login detectado, limpiando estado anterior`);
                        this.activeDialogs.delete(dialogKey);
                        await dialogContext.cancelAllDialogs();
                    } else {
                        return;
                    }
                }
                
                this.activeDialogs.add(dialogKey);
                console.log(`[${userId}] Iniciando nuevo diálogo OAuth`);
                await dialogContext.beginDialog(this.id);
            } else if (results.status === DialogTurnStatus.complete) {
                // Limpiar el diálogo activo cuando se complete
                const dialogKey = `dialog-${userId}`;
                this.activeDialogs.delete(dialogKey);
                console.log(`[${userId}] Diálogo completado, limpiando estado`);
            }

        } catch (error) {
            console.error(`[${userId}] Error en MainDialog.run:`, error);
            // Limpiar estado de error
            this.activeDialogs.delete(`dialog-${userId}`);
            throw error;
        }
    }

    /**
     * Paso 1: Mostrar prompt de autenticación
     */
    async promptStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        const activityType = stepContext.context.activity.type;
        const activityName = stepContext.context.activity.name;

        console.log(`[${userId}] PromptStep - ${activityType}:${activityName || 'N/A'}`);
        
        // Para invokes (signin/verifyState), no mostrar nuevo prompt
        if (activityType === 'invoke' && 
            ['signin/verifyState', 'signin/tokenExchange'].includes(activityName)) {
            console.log(`[${userId}] Es invoke ${activityName}, saltando prompt`);
            return await stepContext.next(null);
        }

        // Verificación final de autenticación para messages
        if (activityType === 'message') {
            const bot = stepContext.context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                const isAuthenticated = await bot.isUserAuthenticated(userId, stepContext.context);
                if (isAuthenticated) {
                    console.log(`[${userId}] Usuario ya autenticado, saltando prompt`);
                    return await stepContext.next(null);
                }
            }
        }

        try {
            console.log(`[${userId}] Mostrando OAuth prompt`);
            console.log(`[${userId}] connectionName: ${process.env.connectionName || process.env.OAUTH_CONNECTION_NAME}`);
            
            // FORZAR LIMPIEZA DE TOKEN ANTES DE MOSTRAR PROMPT
            await this.forceTokenCleanup(stepContext.context, userId);
            
            await stepContext.context.sendActivity(
                '🔐 **Autenticación Requerida**\n\n' +
                'Inicia sesión con tu cuenta corporativa para continuar.'
            );
            
            console.log(`[${userId}] Iniciando diálogo OAuth: ${OAUTH_PROMPT}`);
            const result = await stepContext.beginDialog(OAUTH_PROMPT);
            console.log(`[${userId}] Resultado beginDialog:`, result);
            return result;
            
        } catch (error) {
            console.error(`[${userId}] Error en promptStep:`, error);
            console.error(`[${userId}] Stack trace:`, error.stack);
            await stepContext.context.sendActivity('❌ Error iniciando autenticación. Verifica la configuración OAuth.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Paso 2: Procesar resultado de autenticación
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        const conversationId = stepContext.context.activity.conversation.id;
        const activityType = stepContext.context.activity.type;
        const activityName = stepContext.context.activity.name;

        console.log(`[${userId}] LoginStep - Token: ${!!tokenResponse?.token}, Activity: ${activityType}:${activityName || 'N/A'}`);
        
        // Para eventos invoke, intentar obtener el token del contexto si no está en result
        if (!tokenResponse && activityType === 'invoke' && 
            ['signin/verifyState', 'signin/tokenExchange'].includes(activityName)) {
            console.log(`[${userId}] Es invoke OAuth, intentando obtener token del contexto`);
            
            try {
                const adapter = stepContext.context.adapter;
                const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
                
                if (adapter.getUserToken) {
                    const tokenFromAdapter = await adapter.getUserToken(
                        stepContext.context,
                        connectionName
                    );
                    
                    if (tokenFromAdapter && tokenFromAdapter.token) {
                        console.log(`[${userId}] Token obtenido del adapter después de invoke`);
                        stepContext.result = tokenFromAdapter;
                        return await this.loginStep(stepContext); // Reintentar con el token
                    }
                }
            } catch (error) {
                console.error(`[${userId}] Error obteniendo token después de invoke:`, error);
            }
        }
        
        if (tokenResponse && tokenResponse.token) {
            try {
                // Validar token
                const isValid = await this.validateToken(tokenResponse.token);
                if (!isValid) {
                    console.error(`[${userId}] Token inválido`);
                    await stepContext.context.sendActivity(
                        '❌ **Token inválido**\n\n' +
                        'El token recibido no es válido. Intenta autenticarte nuevamente.'
                    );
                    return await stepContext.endDialog();
                }

                // Extraer información del usuario
                const userInfo = await this.extractUserInfo(tokenResponse.token);
                
                // Marcar como autenticado en el bot
                const bot = stepContext.context.turnState.get('bot');
                if (bot && typeof bot.setUserAuthenticated === 'function') {
                    console.log(`[${userId}] Estableciendo autenticación en bot`);
                    
                    const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                        email: userInfo.email,
                        name: userInfo.name,
                        token: tokenResponse.token,
                        context: stepContext.context
                    });

                    if (authSuccess) {
                        console.log(`[${userId}] Autenticación exitosa`);
                        
                        await stepContext.context.sendActivity(
                            `✅ **¡Autenticación exitosa!**\n\n` +
                            `🎉 Bienvenido, **${userInfo.name}**\n\n` +
                            `💬 Ya puedes usar todas las funciones del bot.`
                        );
                        
                        return await stepContext.next(tokenResponse);
                    } else {
                        console.error(`[${userId}] Error estableciendo autenticación`);
                        await stepContext.context.sendActivity(
                            '❌ **Error completando autenticación**\n\n' +
                            'Intenta autenticarte nuevamente.'
                        );
                        return await stepContext.endDialog();
                    }
                } else {
                    console.error(`[${userId}] Bot instance no encontrada`);
                    return await stepContext.endDialog();
                }
                
            } catch (error) {
                console.error(`[${userId}] Error en loginStep:`, error);
                await stepContext.context.sendActivity(
                    '❌ **Error durante autenticación**\n\n' +
                    'Ocurrió un error inesperado. Intenta escribir `login` nuevamente.'
                );
                return await stepContext.endDialog();
            }
        } else {
            // Para invokes sin token, continuar (puede llegar en siguiente invoke)
            if (activityType === 'invoke' && activityName === 'signin/verifyState') {
                console.log(`[${userId}] signin/verifyState sin token - esperando...`);
                return await stepContext.next(null);
            }
            
            // Para messages, significa que se canceló
            if (activityType === 'message') {
                console.warn(`[${userId}] Autenticación cancelada por usuario`);
                // No mostrar mensaje para evitar spam
            }
            
            return await stepContext.endDialog();
        }
    }

    /**
     * Paso 3: Finalizar diálogo
     */
    async finalStep(stepContext) {
        const userId = stepContext.context.activity.from.id;
        const dialogKey = `dialog-${userId}`;
        
        console.log(`[${userId}] FinalStep - Resultado: ${!!stepContext.result}`);
        
        // Limpiar estado de diálogo activo
        this.activeDialogs.delete(dialogKey);
        console.log(`[${userId}] Diálogo finalizado`);
        
        return await stepContext.endDialog(stepContext.result);
    }

    /**
     * Fuerza limpieza de token antes de mostrar OAuth prompt
     */
    async forceTokenCleanup(context, userId) {
        try {
            console.log(`[${userId}] Forzando limpieza de token antes de OAuth prompt`);
            
            const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
            
            // Intentar limpiar token del UserTokenClient
            const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey) ||
                                  context.turnState.get('UserTokenClient');
            
            if (userTokenClient && connectionName) {
                try {
                    await userTokenClient.signOutUser(userId, connectionName, context.activity.channelId);
                    console.log(`[${userId}] Token limpiado del UserTokenClient antes de OAuth prompt`);
                } catch (error) {
                    console.warn(`[${userId}] Error limpiando token del UserTokenClient:`, error.message);
                }
            } else {
                console.log(`[${userId}] UserTokenClient no disponible para limpieza`);
            }
            
        } catch (error) {
            console.error(`[${userId}] Error en forceTokenCleanup:`, error);
        }
    }

    /**
     * Valida un token OAuth
     */
    async validateToken(token) {
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

            return response.status === 200;
            
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.warn('Token inválido (401)');
                return false;
            }
            console.warn('Error validando token, asumiendo válido:', error.message);
            return true; // En caso de error de red, asumir válido
        }
    }

    /**
     * Extrae información del usuario desde el token
     */
    async extractUserInfo(token) {
        try {
            const tokenParts = token.split('.');
            if (tokenParts.length !== 3) {
                throw new Error('Token JWT inválido');
            }

            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

            return {
                name: payload.name || payload.preferred_username || 'Usuario',
                email: payload.email || payload.upn || payload.preferred_username || 'usuario@alfa.com',
                sub: payload.sub,
                oid: payload.oid
            };
            
        } catch (error) {
            console.warn('Error extrayendo info del token:', error.message);
            return {
                name: 'Usuario',
                email: 'usuario@alfa.com'
            };
        }
    }

    /**
     * Termina diálogo para un usuario específico
     */
    endUserDialog(userId) {
        const dialogKey = `dialog-${userId}`;
        const hadDialog = this.activeDialogs.has(dialogKey);
        
        if (hadDialog) {
            this.activeDialogs.delete(dialogKey);
            console.log(`[${userId}] Diálogo terminado manualmente`);
        }
        
        return hadDialog;
    }

    /**
     * Obtiene estadísticas del diálogo
     */
    getDialogStats() {
        return {
            activeDialogs: this.activeDialogs.size,
            activeDialogsList: Array.from(this.activeDialogs),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpieza forzada de todos los diálogos
     */
    forceCleanup() {
        const count = this.activeDialogs.size;
        this.activeDialogs.clear();
        
        console.warn(`MainDialog: Limpieza forzada - ${count} diálogos eliminados`);
        
        return {
            dialogsCleared: count,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpieza de emergencia para un usuario específico
     */
    emergencyUserCleanup(userId) {
        const dialogKey = `dialog-${userId}`;
        const hadDialog = this.activeDialogs.has(dialogKey);
        
        if (hadDialog) {
            this.activeDialogs.delete(dialogKey);
        }
        
        return {
            userId,
            hadActiveDialog: hadDialog,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports.MainDialog = MainDialog;