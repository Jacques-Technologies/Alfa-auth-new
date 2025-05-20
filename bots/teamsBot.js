const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');
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

        // Registrar manejadores para eventos de Teams de inicio de sesión
        // Corregido: en lugar de usar métodos que no existen, usamos el método onDialog
        this.onDialog(async (context, next) => {
            // Verificar si es una actividad de tipo 'invoke' con nombre 'signin/verifyState'
            if (context.activity.type === 'invoke' && context.activity.name === 'signin/verifyState') {
                await this.handleTeamsSigninVerifyState(context, context.activity.value);
            }
            // Verificar si es una actividad de tipo 'invoke' con nombre 'signin/tokenExchange'
            else if (context.activity.type === 'invoke' && context.activity.name === 'signin/tokenExchange') {
                await this.handleTeamsSigninTokenExchange(context, context.activity.value);
            }
            
            await next();
        });
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
        const messageText = context.activity.text;
        
        try {
            // Verificar si ya está autenticado o necesita autenticarse
            const isAuthenticated = this.authenticatedUsers.get(userId);
            
            // Si el usuario escribe "login" explícitamente, iniciar flujo de autenticación
            if (messageText.toLowerCase() === 'login' || !isAuthenticated) {
                console.log('Usuario no autenticado, iniciando flujo de autenticación...');
                
                // Pasar al flujo de diálogo para autenticación
                await this.dialog.run(context, this.dialogState);
            } else {
                // Usuario ya autenticado, procesar con OpenAI
                await this.handleAuthenticatedMessage(context, messageText, userId, conversationId);
            }
        } catch (error) {
            console.error(`Error en handleMessage: ${error.message}`);
            await context.sendActivity('Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta escribir "login" para iniciar sesión nuevamente.');
        }
        
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
            
            // Procesar con OpenAI
            const respuesta = await this.openaiService.procesarMensaje(message, history);
            
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
            // Marcar como autenticado
            this.authenticatedUsers.set(userId, userData);
            
            // Crear registro de conversación en CosmosDB
            await this.conversationService.createConversation(conversationId, userId);
            
            console.log(`Usuario ${userId} autenticado correctamente.`);
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
     * Recibe actividades de verificación de estado para signin
     * @param {TurnContext} context - Contexto de la conversación
     * @param {Object} state - Estado de verificación
     */
    async handleTeamsSigninVerifyState(context, state) {
        console.log('Running dialog with signin/verifyState from an Invoke Activity.');
        await this.dialog.run(context, this.dialogState);
    }

    /**
     * Recibe actividades de intercambio de token para signin
     * @param {TurnContext} context - Contexto de la conversación
     * @param {Object} state - Estado de intercambio
     */
    async handleTeamsSigninTokenExchange(context, state) {
        console.log('Running dialog with signin/tokenExchange from an Invoke Activity.');
        await this.dialog.run(context, this.dialogState);
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