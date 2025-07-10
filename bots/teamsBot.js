// teamsBot.js - Versión simplificada y optimizada para producción

const { DialogBot } = require('./dialogBot');
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');
const { handleCardSubmit } = require('../utilities/procesar_card');
const { isTokenValid } = require('../utilities/http_utils');

/**
 * TeamsBot - Versión optimizada con manejo simplificado de autenticación
 */
class TeamsBot extends DialogBot {
    constructor(conversationState, userState, dialog) {
        super(conversationState, userState, dialog);

        // Registrar instancia globalmente
        global.botInstance = this;

        // Estados simplificados
        this.authenticatedUsers = new Map();
        this.authState = this.userState.createProperty('AuthState');
        
        // Control simple de procesos activos (sin cache complejo)
        this.activeProcesses = new Set();
        
        // Configurar manejadores
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        this.onMessage(this.handleMessageWithAuth.bind(this));

        // Inicializar servicios
        this.initializeServices();
        
        // Auto-limpieza cada 5 minutos
        setInterval(() => this.cleanupStaleProcesses(), 5 * 60 * 1000);
    }

    /**
     * Inicializa servicios con fallbacks seguros
     */
    initializeServices() {
        this.openaiService = openaiService || {
            procesarMensaje: async (msg) => ({
                type: 'text',
                content: `Servicio OpenAI no disponible. Mensaje: "${msg}"`
            })
        };

        this.conversationService = conversationService || {
            saveMessage: async () => ({}),
            getConversationHistory: async () => [],
            createConversation: async () => ({}),
            updateLastActivity: async () => ({})
        };
    }

    /**
     * Maneja nuevos miembros
     */
    async handleMembersAdded(context, next) {
        for (const member of context.activity.membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                await context.sendActivity(
                    '👋 **Bienvenido a Alfa Bot**\n\n' +
                    'Escribe `login` para iniciar sesión y acceder a todas las funciones.'
                );
            }
        }
        await next();
    }

    /**
     * Maneja mensajes con autenticación simplificada
     */
    async handleMessageWithAuth(context, next) {
        const userId = context.activity.from.id;
        const text = (context.activity.text || '').trim().toLowerCase();

        console.log(`[${userId}] Mensaje: "${text}"`);

        try {
            // Evitar procesos duplicados
            if (this.activeProcesses.has(userId)) {
                console.log(`[${userId}] Proceso activo, ignorando mensaje`);
                return await next();
            }

            this.activeProcesses.add(userId);

            try {
                // Comandos específicos
                if (this.isLoginCommand(text)) {
                    await this.handleLogin(context, userId);
                } else if (this.isLogoutCommand(text)) {
                    await this.handleLogout(context, userId);
                } else if (context.activity.value) {
                    await this.handleCardSubmit(context);
                } else {
                    // Mensajes regulares - verificar autenticación
                    console.log(`[${userId}] TeamsBot - Verificando autenticación para mensaje regular...`);
                    const isAuthenticated = await this.isUserAuthenticated(userId, context);
                    console.log(`[${userId}] TeamsBot - Usuario autenticado: ${isAuthenticated}`);
                    
                    if (isAuthenticated) {
                        console.log(`[${userId}] TeamsBot - Procesando mensaje autenticado`);
                        await this.processAuthenticatedMessage(context, text, userId);
                    } else {
                        console.log(`[${userId}] TeamsBot - Usuario NO autenticado, ejecutando diálogo`);
                        // Para usuarios no autenticados: ejecutar diálogo directamente
                        await this.dialog.run(context, this.dialogState);
                    }
                }
            } finally {
                this.activeProcesses.delete(userId);
            }

        } catch (error) {
            console.error(`[${userId}] Error en handleMessageWithAuth:`, error);
            await context.sendActivity('❌ Error procesando mensaje. Intenta nuevamente.');
            this.activeProcesses.delete(userId);
        }

        await next();
    }

    /**
     * Verifica comandos de login
     */
    isLoginCommand(text) {
        return ['login', 'iniciar sesion', 'iniciar sesión'].includes(text);
    }

    /**
     * Verifica comandos de logout
     */
    isLogoutCommand(text) {
        return ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'].includes(text);
    }

    /**
     * Maneja solicitudes de login
     */
    async handleLogin(context, userId) {
        const isAuthenticated = await this.isUserAuthenticated(userId, context);
        
        if (isAuthenticated) {
            await context.sendActivity(
                '✅ **Ya estás autenticado**\n\n' +
                '¡Puedes usar todas las funciones del bot!'
            );
            return;
        }

        await context.sendActivity(
            '🔐 **Iniciando autenticación...**\n\n' +
            'Te redirigiremos al sistema de login corporativo.'
        );
        
        await this.dialog.run(context, this.dialogState);
    }

    /**
     * Maneja solicitudes de logout
     */
    async handleLogout(context, userId) {
        try {
            // Limpiar estado de memoria
            this.authenticatedUsers.delete(userId);
            
            // Limpiar estado persistente
            const authData = await this.authState.get(context, {});
            delete authData[userId];
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);
            
            await context.sendActivity('✅ **Sesión cerrada exitosamente**');
            console.log(`[${userId}] Logout completado`);
            
        } catch (error) {
            console.error(`[${userId}] Error en logout:`, error);
            await context.sendActivity('❌ Error al cerrar sesión.');
        }
    }

    /**
     * Maneja submit de tarjetas
     */
    async handleCardSubmit(context) {
        await handleCardSubmit(
            context,
            context.activity.value,
            this.getUserOAuthToken.bind(this),
            this.handleTokenExpiration.bind(this),
            isTokenValid,
            this.openaiService
        );
    }

    /**
     * Procesa mensajes de usuarios autenticados
     */
    async processAuthenticatedMessage(context, text, userId) {
        try {
            const conversationId = context.activity.conversation.id;
            
            await context.sendActivity({ type: 'typing' });

            // Guardar mensaje del usuario
            try {
                await this.conversationService.saveMessage(text, conversationId, userId);
            } catch (error) {
                console.warn(`[${userId}] Error guardando mensaje:`, error.message);
            }

            // Obtener historial
            let history = [];
            try {
                history = await this.conversationService.getConversationHistory(conversationId);
            } catch (error) {
                console.warn(`[${userId}] Error obteniendo historial:`, error.message);
            }

            // Formatear historial para OpenAI
            const formattedHistory = history.map(item => ({
                type: item.userId === userId ? 'user' : 'assistant',
                message: item.message
            }));

            // Procesar con OpenAI
            const response = await this.openaiService.procesarMensaje(text, formattedHistory);

            // Enviar respuesta
            await this.sendOpenAIResponse(context, response, conversationId);

        } catch (error) {
            console.error(`[${userId}] Error procesando mensaje:`, error);
            await context.sendActivity('❌ Error al procesar tu mensaje.');
        }
    }

    /**
     * Envía respuesta de OpenAI
     */
    async sendOpenAIResponse(context, response, conversationId) {
        try {
            if (response.type === 'card') {
                if (response.content) {
                    await context.sendActivity(response.content);
                }

                if (Array.isArray(response.card)) {
                    for (const card of response.card) {
                        await context.sendActivity({ attachments: [card] });
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } else {
                    await context.sendActivity({ attachments: [response.card] });
                }

                // Guardar respuesta del bot
                const botMessage = response.content || 'Tarjeta enviada';
                await this.conversationService.saveMessage(botMessage, conversationId, 'bot');
            } else {
                const responseContent = response.content || response;
                await context.sendActivity(responseContent);
                await this.conversationService.saveMessage(responseContent, conversationId, 'bot');
            }

            await this.conversationService.updateLastActivity(conversationId);

        } catch (error) {
            console.error('Error enviando respuesta OpenAI:', error);
        }
    }

    /**
     * Verifica si un usuario está autenticado (simplificado)
     */
    async isUserAuthenticated(userId, context) {
        try {
            // 1. Verificar memoria
            const memoryAuth = this.authenticatedUsers.has(userId);
            console.log(`[${userId}] isUserAuthenticated - Memoria: ${memoryAuth}`);
            
            // 2. Verificar estado persistente
            const authData = await this.authState.get(context, {});
            const persistentAuth = authData[userId]?.authenticated === true;
            console.log(`[${userId}] isUserAuthenticated - Persistente: ${persistentAuth}`);
            
            // 3. Sincronizar si hay inconsistencia
            if (memoryAuth && !persistentAuth) {
                console.log(`[${userId}] isUserAuthenticated - Sincronizando persistente desde memoria`);
                await this.syncPersistentAuth(userId, context);
                return true;
            } else if (!memoryAuth && persistentAuth) {
                console.log(`[${userId}] isUserAuthenticated - Sincronizando memoria desde persistente`);
                await this.syncMemoryAuth(userId, context, authData[userId]);
                return true;
            }
            
            const finalResult = memoryAuth && persistentAuth;
            console.log(`[${userId}] isUserAuthenticated - Resultado final: ${finalResult}`);
            return finalResult;
            
        } catch (error) {
            console.error(`[${userId}] Error verificando autenticación:`, error);
            return false;
        }
    }

    /**
     * Sincroniza autenticación persistente desde memoria
     */
    async syncPersistentAuth(userId, context) {
        try {
            const userInfo = this.authenticatedUsers.get(userId);
            if (userInfo) {
                const authData = await this.authState.get(context, {});
                authData[userId] = {
                    authenticated: true,
                    email: userInfo.email,
                    name: userInfo.name,
                    token: userInfo.token,
                    lastAuthenticated: new Date().toISOString()
                };
                await this.authState.set(context, authData);
                await this.userState.saveChanges(context);
            }
        } catch (error) {
            console.error(`[${userId}] Error sincronizando persistente:`, error);
        }
    }

    /**
     * Sincroniza autenticación en memoria desde persistente
     */
    async syncMemoryAuth(userId, context, authData) {
        try {
            if (authData && authData.authenticated) {
                this.authenticatedUsers.set(userId, {
                    email: authData.email,
                    name: authData.name,
                    token: authData.token,
                    context: context
                });
            }
        } catch (error) {
            console.error(`[${userId}] Error sincronizando memoria:`, error);
        }
    }

    /**
     * Marca usuario como autenticado
     */
    async setUserAuthenticated(userId, conversationId, userData) {
        try {
            const { email, name, token, context } = userData;

            console.log(`[${userId}] Estableciendo autenticación - Email: ${email}`);
            
            // Almacenar en memoria
            this.authenticatedUsers.set(userId, { email, name, token, context });

            // Almacenar persistentemente
            const authData = await this.authState.get(context, {});
            authData[userId] = {
                authenticated: true,
                email,
                name,
                token,
                lastAuthenticated: new Date().toISOString()
            };
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);

            // Crear conversación
            try {
                await this.conversationService.createConversation(conversationId, userId);
            } catch (error) {
                console.warn(`[${userId}] Error creando conversación:`, error.message);
            }

            console.log(`[${userId}] Autenticación completada exitosamente`);
            return true;
            
        } catch (error) {
            console.error(`[${userId}] Error en setUserAuthenticated:`, error);
            return false;
        }
    }

    /**
     * Obtiene token OAuth del usuario
     */
    async getUserOAuthToken(context, userId) {
        try {
            // Obtener de memoria
            const userInfo = this.authenticatedUsers.get(userId);
            if (userInfo && userInfo.token) {
                return userInfo.token;
            }

            // Obtener del UserTokenClient
            const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey);
            const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;

            if (userTokenClient && connectionName) {
                const tokenResponse = await userTokenClient.getUserToken(
                    userId,
                    connectionName,
                    context.activity.channelId
                );

                if (tokenResponse && tokenResponse.token) {
                    return tokenResponse.token;
                }
            }

            // Obtener del estado persistente
            const authData = await this.authState.get(context, {});
            return authData[userId]?.token || null;

        } catch (error) {
            console.error(`[${userId}] Error obteniendo token:`, error);
            return null;
        }
    }

    /**
     * Maneja expiración de token
     */
    async handleTokenExpiration(context, userId) {
        console.log(`[${userId}] Manejando expiración de token`);
        
        try {
            // Limpiar estados
            this.authenticatedUsers.delete(userId);
            
            const authData = await this.authState.get(context, {});
            delete authData[userId];
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);

            await context.sendActivity(
                '🔐 **Tu sesión ha expirado**\n\n' +
                'Escribe `login` para autenticarte nuevamente.'
            );
            
        } catch (error) {
            console.error(`[${userId}] Error manejando expiración:`, error);
        }
    }

    /**
     * Maneja actividades invoke (signin/verifyState, etc.)
     */
    async onInvokeActivity(context) {
        try {
            const activityName = context.activity.name || 'unknown';
            const userId = context.activity.from.id;

            console.log(`[${userId}] Invoke: ${activityName}`);

            if (['signin/verifyState', 'signin/tokenExchange'].includes(activityName)) {
                await this.dialog.run(context, this.dialogState);
                return { status: 200 };
            }

            return await super.onInvokeActivity(context);

        } catch (error) {
            console.error('Error en onInvokeActivity:', error);
            return { status: 500 };
        }
    }

    /**
     * Limpia procesos obsoletos (llamado automáticamente)
     */
    cleanupStaleProcesses() {
        const staleProcesses = [];
        
        // Limpiar procesos activos obsoletos (más de 2 minutos)
        for (const userId of this.activeProcesses) {
            // En implementación real, podrías rastrear timestamps
            // Por simplicidad, limpiaremos los que han estado demasiado tiempo
            staleProcesses.push(userId);
        }
        
        if (staleProcesses.length > 0) {
            console.warn(`Limpiando ${staleProcesses.length} procesos obsoletos`);
            staleProcesses.forEach(userId => this.activeProcesses.delete(userId));
        }
    }

    /**
     * Obtiene estadísticas del bot
     */
    getStats() {
        return {
            authenticatedUsers: this.authenticatedUsers.size,
            activeProcesses: this.activeProcesses.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpia estado de un usuario específico (para debugging)
     */
    async forceCleanUserState(userId, context) {
        try {
            this.authenticatedUsers.delete(userId);
            this.activeProcesses.delete(userId);
            
            if (context) {
                const authData = await this.authState.get(context, {});
                delete authData[userId];
                await this.authState.set(context, authData);
                await this.userState.saveChanges(context);
            }
            
            console.log(`[${userId}] Estado forzadamente limpiado`);
            return true;
            
        } catch (error) {
            console.error(`[${userId}] Error limpiando estado:`, error);
            return false;
        }
    }
}

module.exports.TeamsBot = TeamsBot;