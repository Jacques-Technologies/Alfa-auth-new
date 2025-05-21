const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');

// Importar los servicios correctamente
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

/**
 * TeamsBot class extends DialogBot to handle Teams-specific activities and OpenAI integration.
 */
class TeamsBot extends DialogBot {
    /**
     * Creates an instance of TeamsBot.
     * @param {ConversationState} conversationState - The state management object for conversation state.
     * @param {UserState} userState - The state management object for user state.
     * @param {Dialog} dialog - The dialog to be run by the bot.
     */
    constructor(conversationState, userState, dialog) {
        super(conversationState, userState, dialog);

        // Registrar la instancia globalmente para poder accederla desde otras partes
        global.botInstance = this;
        console.log('Instancia del bot registrada globalmente');

        // Agregar manejador de miembros añadidos
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        // Sobreescribir manejador de mensajes
        this.onMessage(this.handleMessageWithAuth.bind(this));
        
        // NO registrar un manejador de actividades "invoke" en el constructor
        // Esto causa el error que estabas experimentando
        
        // Servicios para OpenAI y CosmosDB - guardados como propiedades de la instancia
        this.openaiService = openaiService;
        this.conversationService = conversationService;
        
        // Verificar que el servicio OpenAI se importó correctamente
        if (!this.openaiService || typeof this.openaiService.procesarMensaje !== 'function') {
            console.error('ERROR: openaiService no se importó correctamente o no tiene el método procesarMensaje');
            // Crear un respaldo básico si no está disponible
            this.openaiService = {
                procesarMensaje: async (mensaje) => `Lo siento, el servicio de OpenAI no está disponible (Error de importación). Tu mensaje fue: "${mensaje}"`
            };
        } else {
            console.log('Servicio OpenAI importado correctamente');
        }
        
        // Verificar que el servicio de conversación se importó correctamente
        if (!this.conversationService || typeof this.conversationService.saveMessage !== 'function') {
            console.error('ERROR: conversationService no se importó correctamente o no tiene el método saveMessage');
            // Crear un respaldo básico si no está disponible
            this.conversationService = {
                saveMessage: async () => ({}),
                getConversationHistory: async () => [],
                createConversation: async () => ({}),
                updateLastActivity: async () => ({})
            };
        } else {
            console.log('Servicio de conversación importado correctamente');
        }
        
        // Estado de autenticación
        this.authenticatedUsers = new Map();
        this.authState = this.userState.createProperty('AuthState');
    }

    /**
     * Handles members being added to the conversation.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMembersAdded(context, next) {
        const membersAdded = context.activity.membersAdded;
        for (const member of membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                await context.sendActivity('Bienvenido a Alfa Bot. Escribe "login" para iniciar sesión y poder hacer preguntas.');
            }
        }
        await next();
    }

    /**
     * Handles incoming messages with authentication check.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessageWithAuth(context, next) {
        console.log('TeamsBot.handleMessageWithAuth llamado');
        
        // Asegurarse de que la instancia del bot esté disponible en el contexto
        this._ensureBotInContext(context);
        
        try {
            const userId = context.activity.from.id;
            const conversationId = context.activity.conversation.id;
            const messageText = context.activity.text || '';
            
            // Recuperar estado de autenticación
            const authData = await this.authState.get(context, {});
            const isAuthenticated = authData[userId]?.authenticated || false;
            
            console.log(`Estado de autenticación para usuario ${userId}: ${isAuthenticated ? 'Autenticado' : 'No autenticado'}`);
            
            // Si el usuario escribe "login" o no está autenticado
            if (messageText.toLowerCase() === 'login' || !isAuthenticated) {
                console.log('Usuario no autenticado o solicitó login, iniciando flujo de autenticación');
                
                // Enviar card de inicio de sesión
                if (!context.activity.value) {
                    const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
                    console.log(`Usando connectionName: ${connectionName}`);
                    
                    if (connectionName) {
                        const loginCard = CardFactory.oauthCard(
                            connectionName,
                            'Iniciar Sesión',
                            'Por favor inicia sesión para continuar'
                        );
                        
                        await context.sendActivity({ attachments: [loginCard] });
                    } else {
                        await context.sendActivity('Error: No se ha configurado el nombre de conexión OAuth.');
                    }
                }
                
                // Iniciar diálogo de autenticación
                await this.dialog.run(context, this.dialogState);
            } else {
                // Usuario autenticado, procesar con OpenAI
                console.log(`Procesando mensaje autenticado: "${messageText}"`);
                await this.processOpenAIMessage(context, messageText, userId, conversationId);
            }
        } catch (error) {
            console.error(`Error en handleMessageWithAuth: ${error.message}`);
            console.error(error.stack);
            await context.sendActivity('Ocurrió un error al procesar tu mensaje. Por favor, intenta de nuevo o escribe "login".');
        }
        
        await next();
    }
    
    /**
     * Asegura que la instancia del bot esté disponible en el contexto
     * @param {TurnContext} context - El contexto del turno actual
     * @private
     */
    _ensureBotInContext(context) {
        if (!context.turnState.get('bot')) {
            context.turnState.set('bot', this);
            console.log('Bot añadido al contexto del turno');
        }
        
        // También asegurar que los estados estén disponibles
        if (!context.turnState.get('ConversationState')) {
            context.turnState.set('ConversationState', this.conversationState);
        }
        
        if (!context.turnState.get('UserState')) {
            context.turnState.set('UserState', this.userState);
        }
    }

    /**
     * Override the onInvokeActivity method from TeamsActivityHandler.
     * This handles OAuth and other Teams invoke activities.
     * @param {TurnContext} context - The context object for the turn.
     * @returns {Object} - The response for the invoke activity.
     */
    async onInvokeActivity(context) {
        try {
            // Asegurarse de que la instancia del bot esté disponible en el contexto
            this._ensureBotInContext(context);
            
            // Verificar si tenemos una actividad válida
            if (!context || !context.activity) {
                console.error('onInvokeActivity: context o context.activity es undefined');
                return { status: 500 };
            }
            
            // Obtener el nombre de la actividad de forma segura
            const activityName = context.activity.name || 'unknown';
            console.log(`Actividad invoke recibida: ${activityName}`);
            
            // Manejar actividades específicas de OAuth
            if (activityName === 'signin/verifyState') {
                console.log('Procesando signin/verifyState');
                await this.dialog.run(context, this.dialogState);
                return { status: 200 };
            } else if (activityName === 'signin/tokenExchange') {
                console.log('Procesando signin/tokenExchange');
                await this.dialog.run(context, this.dialogState);
                return { status: 200 };
            } else if (activityName === 'signin/failure') {
                console.log('Procesando signin/failure - Error de autenticación');
                await context.sendActivity('Hubo un problema con la autenticación. Por favor, intenta nuevamente escribiendo "login".');
                return { status: 200 };
            }
            
            // Para otras actividades, usar el método de la clase padre
            console.log(`Delegando actividad ${activityName} al manejo predeterminado`);
            
            // Llamar al método de la clase padre de forma segura
            return await super.onInvokeActivity(context);
        } catch (error) {
            console.error(`Error en onInvokeActivity: ${error.message}`);
            console.error(error.stack);
            return { status: 500 };
        }
    }

    /**
     * Handles the specific invoke activities for Teams authentication.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Object} query - The query object from the invoke activity.
     */
    async handleTeamsSigninVerifyState(context, query) {
        console.log('handleTeamsSigninVerifyState llamado');
        // Asegurarse de que la instancia del bot esté disponible en el contexto
        this._ensureBotInContext(context);
        await this.dialog.run(context, this.dialogState);
    }
    
    /**
     * Handles token exchange for Teams authentication.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Object} query - The query object from the invoke activity.
     */
    async handleTeamsSigninTokenExchange(context, query) {
        console.log('handleTeamsSigninTokenExchange llamado');
        // Asegurarse de que la instancia del bot esté disponible en el contexto
        this._ensureBotInContext(context);
        await this.dialog.run(context, this.dialogState);
    }

    /**
     * Processes a message using OpenAI.
     * @param {TurnContext} context - The context object for the turn.
     * @param {string} message - The message to process.
     * @param {string} userId - The user ID.
     * @param {string} conversationId - The conversation ID.
     */
    async processOpenAIMessage(context, message, userId, conversationId) {
        try {
            // Verificar que el servicio OpenAI está disponible
            if (!this.openaiService || typeof this.openaiService.procesarMensaje !== 'function') {
                console.error('El servicio OpenAI no está disponible o no tiene el método procesarMensaje');
                await context.sendActivity('Lo siento, el servicio de OpenAI no está disponible en este momento. Por favor, contacta al administrador.');
                return;
            }
            
            // Indicar que estamos procesando
            await context.sendActivity({ type: 'typing' });
            
            // Intentar guardar el mensaje, pero continuar si falla
            try {
                await this.conversationService.saveMessage(
                    message,
                    conversationId,
                    userId
                );
            } catch (error) {
                console.error(`Error al guardar mensaje: ${error.message}`);
                // Continuar aunque falle el guardado
            }
            
            // Intentar obtener el historial, pero usar un array vacío si falla
            let history = [];
            try {
                history = await this.conversationService.getConversationHistory(conversationId);
            } catch (error) {
                console.error(`Error al obtener historial: ${error.message}`);
                // Continuar con historial vacío
            }
            
            // Formatear historial para OpenAI
            const formattedHistory = history.map(item => ({
                type: item.userId === userId ? 'user' : 'assistant',
                message: item.message
            }));
            
            // Enviar a OpenAI
            const response = await this.openaiService.procesarMensaje(message, formattedHistory);
            
            // Intentar guardar la respuesta, pero continuar si falla
            try {
                await this.conversationService.saveMessage(
                    response,
                    conversationId,
                    'bot'
                );
                
                // Actualizar timestamp
                await this.conversationService.updateLastActivity(conversationId);
            } catch (error) {
                console.error(`Error al guardar respuesta: ${error.message}`);
                // Continuar aunque falle el guardado
            }
            
            // Enviar respuesta al usuario
            await context.sendActivity(response);
        } catch (error) {
            console.error(`Error en processOpenAIMessage: ${error.message}`);
            console.error(error.stack);
            await context.sendActivity('Lo siento, ocurrió un error al procesar tu solicitud con OpenAI. Por favor, intenta nuevamente.');
        }
    }

    /**
     * Marks a user as authenticated.
     * @param {string} userId - The user ID.
     * @param {string} conversationId - The conversation ID.
     * @param {Object} userData - The user data.
     */
    async setUserAuthenticated(userId, conversationId, userData) {
        try {
            // Guardar en memoria
            this.authenticatedUsers.set(userId, userData);
            
            // Guardar en estado persistente
            const context = userData.context;
            if (context) {
                const authData = await this.authState.get(context, {});
                authData[userId] = {
                    authenticated: true,
                    email: userData.email,
                    name: userData.name,
                    lastAuthenticated: new Date().toISOString()
                };
                await this.authState.set(context, authData);
                
                // Guardar cambios
                await this.userState.saveChanges(context);
            }
            
            // Crear conversación en CosmosDB
            try {
                await this.conversationService.createConversation(conversationId, userId);
                console.log(`Conversación creada para usuario ${userId}`);
            } catch (error) {
                console.log(`Posible conversación ya existente: ${error.message}`);
            }
            
            console.log(`Usuario ${userId} autenticado correctamente.`);
            return true;
        } catch (error) {
            console.error(`Error al marcar usuario como autenticado: ${error.message}`);
            console.error(error.stack);
            return false;
        }
    }

    /**
     * Checks if a user is authenticated.
     * @param {string} userId - The user ID.
     * @returns {boolean} Whether the user is authenticated.
     */
    isUserAuthenticated(userId) {
        return this.authenticatedUsers.has(userId);
    }

    /**
     * Logs out a user.
     * @param {string} userId - The user ID.
     * @returns {boolean} Whether the logout was successful.
     */
    logoutUser(userId) {
        if (this.authenticatedUsers.has(userId)) {
            this.authenticatedUsers.delete(userId);
            console.log(`Usuario ${userId} ha cerrado sesión.`);
            return true;
        }
        return false;
    }
}

module.exports.TeamsBot = TeamsBot;