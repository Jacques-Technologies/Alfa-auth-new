const { DialogBot } = require('./dialogBot');
const { CardFactory, ActivityTypes, TeamsInfo } = require('botbuilder');
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

/**
 * TeamsBot extendido con capacidades de OpenAI y almacenamiento en CosmosDB
 */
class TeamsBot extends DialogBot {
    /**
     * Constructor de TeamsBot
     * @param {ConversationState} conversationState - Estado de la conversación
     * @param {UserState} userState - Estado del usuario
     * @param {Dialog} dialog - Diálogo principal
     */
    constructor(conversationState, userState, dialog) {
        super(conversationState, userState, dialog);

        // Agregar manejo de miembros añadidos y mensajes
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        // Mantener referencia a los servicios
        this.openaiService = openaiService;
        this.conversationService = conversationService;
        
        // Almacenar estado de autenticación de los usuarios
        this.authenticatedUsers = new Map();
        
        // Crear un estado persistente para la autenticación
        this.authState = this.userState.createProperty('AuthState');
    }

    /**
     * Maneja miembros añadidos a la conversación
     * @param {TurnContext} context - Contexto de la conversación
     * @param {function} next - Función de siguiente middleware
     */
    async handleMembersAdded(context, next) {
        const membersAdded = context.activity.membersAdded;
        for (const member of membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                await context.sendActivity('¡Bienvenido a Alfa Bot! Por favor escribe "login" para iniciar sesión. Después de iniciar sesión, podrás consultar información y hacer preguntas.');
            }
        }
        await next();
    }

    /**
     * Sobreescribe el método de manejo de mensajes
     * @param {TurnContext} context - Contexto de la conversación
     * @param {function} next - Función de siguiente middleware
     */
    async handleMessage(context, next) {
        const userId = context.activity.from.id;
        const conversationId = context.activity.conversation.id;
        const messageText = context.activity.text || '';
        
        try {
            // Recuperar estado de autenticación desde userState
            const authData = await this.authState.get(context, {});
            const isAuthenticated = authData[userId]?.authenticated || false;
            
            console.log(`Estado de autenticación para usuario ${userId}: ${isAuthenticated ? 'Autenticado' : 'No autenticado'}`);
            
            // Si el usuario escribe "login" explícitamente o no está autenticado
            if (messageText.toLowerCase() === 'login' || !isAuthenticated) {
                console.log('Usuario no autenticado o solicitó login, iniciando flujo de autenticación...');
                
                // Pasar al flujo de diálogo para autenticación
                await this.dialog.run(context, this.dialogState);
            } else {
                // Usuario ya autenticado, procesar con OpenAI
                console.log(`Procesando mensaje autenticado de ${userId}: "${messageText}"`);
                await this.handleAuthenticatedMessage(context, messageText, userId, conversationId);
            }
        } catch (error) {
            console.error(`Error en handleMessage: ${error.message}`);
            await context.sendActivity('Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta escribir "login" para iniciar sesión nuevamente.');
        }
        
        // Asegurarse de que se llame a next() para continuar con la cadena de middleware
        await next();
    }

    /**
     * Procesa mensajes de usuarios autenticados
     * @param {TurnContext} context - Contexto de la conversación
     * @param {string} message - Mensaje del usuario
     * @param {string} userId - ID del usuario
     * @param {string} conversationId - ID de la conversación
     */
    async handleAuthenticatedMessage(context, message, userId, conversationId) {
        try {
            // Indicar al usuario que estamos procesando
            await context.sendActivity({ type: 'typing' });
            
            // Guardar el mensaje del usuario en CosmosDB
            await this.conversationService.saveMessage(
                message,
                conversationId,
                userId
            );
            
            // Obtener historial de la conversación
            const history = await this.conversationService.getConversationHistory(conversationId);
            
            // Formato adecuado para el historial
            const formattedHistory = history.map(item => ({
                type: item.userId === userId ? 'user' : 'assistant',
                message: item.message
            }));
            
            // Procesar con OpenAI
            const respuesta = await this.openaiService.procesarMensaje(message, formattedHistory);
            
            // Guardar la respuesta en CosmosDB
            await this.conversationService.saveMessage(
                respuesta,
                conversationId,
                'bot'
            );
            
            // Actualizar timestamp de la conversación
            await this.conversationService.updateLastActivity(conversationId);
            
            // Enviar respuesta al usuario
            await context.sendActivity(respuesta);
        } catch (error) {
            console.error(`Error en handleAuthenticatedMessage: ${error.message}`);
            await context.sendActivity('Lo siento, ocurrió un error al procesar tu solicitud.');
        }
    }

    /**
     * Marca a un usuario como autenticado y crea su conversación
     * @param {string} userId - ID del usuario
     * @param {string} conversationId - ID de la conversación
     * @param {Object} userData - Datos del usuario autenticado
     */
    async setUserAuthenticated(userId, conversationId, userData) {
        try {
            // Marcar como autenticado en memoria
            this.authenticatedUsers.set(userId, userData);
            
            // Actualizar en el estado persistente
            const context = userData.context; // Asumimos que el contexto se pasa en userData
            if (context) {
                const authData = await this.authState.get(context, {});
                authData[userId] = {
                    authenticated: true,
                    email: userData.email,
                    name: userData.name,
                    lastAuthenticated: new Date().toISOString()
                };
                await this.authState.set(context, authData);
            }
            
            // Crear registro de conversación en CosmosDB si no existe
            try {
                await this.conversationService.createConversation(conversationId, userId);
            } catch (error) {
                // Si ya existe, ignorar el error
                console.log(`Nota: Posible conversación ya existente: ${error.message}`);
            }
            
            console.log(`Usuario ${userId} autenticado correctamente y guardado en estado.`);
            return true;
        } catch (error) {
            console.error(`Error al establecer usuario como autenticado: ${error.message}`);
            return false;
        }
    }

    /**
     * Verifica si un usuario está autenticado
     * @param {string} userId - ID del usuario
     * @returns {boolean} - Si está autenticado o no
     */
    isUserAuthenticated(userId) {
        return this.authenticatedUsers.has(userId);
    }

    /**
     * Cierra la sesión de un usuario
     * @param {string} userId - ID del usuario
     */
    logoutUser(userId) {
        if (this.authenticatedUsers.has(userId)) {
            this.authenticatedUsers.delete(userId);
            console.log(`Usuario ${userId} ha cerrado sesión.`);
            return true;
        }
        return false;
    }

    /**
     * Sobreescribe el método onInvokeActivity para manejar actividades de Teams
     * @param {TurnContext} context - Contexto del turno
     */
    async onInvokeActivity(context) {
        console.log(`Actividad Invoke recibida: ${context.activity.name}`);
        
        // Manejar actividades de invocación de Teams para OAuth
        if (context.activity.name === 'signin/verifyState') {
            await this.dialog.run(context, this.dialogState);
            return { status: 200 };
        } else if (context.activity.name === 'signin/tokenExchange') {
            await this.dialog.run(context, this.dialogState);
            return { status: 200 };
        }
        
        // Para otras actividades de invoke, usar el handler predeterminado
        return await super.onInvokeActivity(context);
    }

    /**
     * Sobreescribe el método run para incluir manejo de errores
     * @param {TurnContext} context - Contexto de la conversación
     */
    async run(context) {
        try {
            await super.run(context);
        } catch (error) {
            console.error(`Error en TeamsBot.run: ${error.message}`);
            await context.sendActivity('Lo siento, ocurrió un error inesperado.');
        }
    }
}

module.exports.TeamsBot = TeamsBot;