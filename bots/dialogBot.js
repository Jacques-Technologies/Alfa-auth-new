// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { TeamsActivityHandler } = require('botbuilder');

/**
 * DialogBot class extends TeamsActivityHandler to handle Teams activities with improved error handling.
 */
class DialogBot extends TeamsActivityHandler {
    /**
     * Creates an instance of DialogBot.
     * @param {ConversationState} conversationState - The state management object for conversation state.
     * @param {UserState} userState - The state management object for user state.
     * @param {Dialog} dialog - The dialog to be run by the bot.
     */
    constructor(conversationState, userState, dialog) {
        super();

        // Validar parámetros requeridos
        if (!conversationState) {
            throw new Error('[DialogBot]: Missing parameter. conversationState is required');
        }
        if (!userState) {
            throw new Error('[DialogBot]: Missing parameter. userState is required');
        }
        if (!dialog) {
            throw new Error('[DialogBot]: Missing parameter. dialog is required');
        }

        this.conversationState = conversationState;
        this.userState = userState;
        this.dialog = dialog;
        this.dialogState = this.conversationState.createProperty('DialogState');

        // Configurar manejadores de eventos
        this.onMessage(this.handleMessage.bind(this));
        
        // Agregar manejador para miembros añadidos
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        console.log('DialogBot: Inicializado correctamente');
    }

    /**
     * Handles incoming message activities with enhanced error handling.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessage(context, next) {
        try {
            console.log('DialogBot: Procesando actividad de mensaje');

            // Verificar que el contexto y la actividad sean válidos
            if (!context || !context.activity) {
                console.warn('DialogBot: Contexto o actividad inválidos');
                return await next();
            }

            // Ejecutar el diálogo con la nueva actividad de mensaje
            await this.dialog.run(context, this.dialogState);

        } catch (error) {
            console.error('DialogBot: Error en handleMessage:', error.message);
            
            // Intentar enviar un mensaje de error al usuario si es posible
            try {
                await context.sendActivity('❌ Ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.');
            } catch (sendError) {
                console.error('DialogBot: Error al enviar mensaje de error:', sendError.message);
            }
            
            // Re-lanzar el error para que lo maneje el manejador global
            throw error;
        }

        await next();
    }

    /**
     * Handles members added events
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMembersAdded(context, next) {
        try {
            console.log('DialogBot: Procesando evento de miembros añadidos');
            
            // Este método será sobrescrito por las clases hijas si es necesario
            // Por defecto, no hace nada especial
            
        } catch (error) {
            console.error('DialogBot: Error en handleMembersAdded:', error.message);
        }
        
        await next();
    }

    /**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     * @param {TurnContext} context - The context object for the turn.
     */
    async run(context) {
        try {
            // Verificar que el contexto sea válido
            if (!context) {
                throw new Error('Context is null or undefined');
            }

            // Ejecutar la lógica del bot padre
            await super.run(context);

            // Guardar cambios de estado de manera segura
            await this.saveStates(context);

        } catch (error) {
            console.error('DialogBot: Error en run():', error.message);
            
            // Intentar limpiar estados corruptos
            try {
                await this.handleStateError(context, error);
            } catch (cleanupError) {
                console.error('DialogBot: Error durante limpieza de estado:', cleanupError.message);
            }
            
            throw error;
        }
    }

    /**
     * Saves conversation and user states safely
     * @param {TurnContext} context - The context object for the turn.
     * @private
     */
    async saveStates(context) {
        try {
            // Intentar guardar estado de conversación
            if (this.conversationState) {
                await this.conversationState.saveChanges(context, false);
                console.log('DialogBot: Estado de conversación guardado');
            }
        } catch (error) {
            console.error('DialogBot: Error al guardar estado de conversación:', error.message);
            // No re-lanzar el error para permitir que se guarde el estado de usuario
        }

        try {
            // Intentar guardar estado de usuario
            if (this.userState) {
                await this.userState.saveChanges(context, false);
                console.log('DialogBot: Estado de usuario guardado');
            }
        } catch (error) {
            console.error('DialogBot: Error al guardar estado de usuario:', error.message);
            // No re-lanzar el error aquí tampoco
        }
    }

    /**
     * Handles state-related errors
     * @param {TurnContext} context - The context object for the turn.
     * @param {Error} error - The error that occurred.
     * @private
     */
    async handleStateError(context, error) {
        console.log('DialogBot: Manejando error de estado');
        
        // Si el error está relacionado con el estado, intentar limpiar
        if (error.message && (
            error.message.includes('state') || 
            error.message.includes('storage') ||
            error.message.includes('serialize')
        )) {
            console.log('DialogBot: Limpiando estados corruptos');
            
            try {
                // Limpiar estado de conversación
                if (this.conversationState) {
                    await this.conversationState.delete(context);
                }
                
                // No limpiar estado de usuario automáticamente ya que contiene autenticación
                console.log('DialogBot: Estados limpiados exitosamente');
            } catch (cleanupError) {
                console.error('DialogBot: Error durante limpieza:', cleanupError.message);
            }
        }
    }

    /**
     * Gets the current dialog state
     * @param {TurnContext} context - The context object for the turn.
     * @returns {Object} - Current dialog state
     */
    async getDialogState(context) {
        try {
            return await this.dialogState.get(context, {});
        } catch (error) {
            console.error('DialogBot: Error al obtener estado del diálogo:', error.message);
            return {};
        }
    }

    /**
     * Clears the dialog state
     * @param {TurnContext} context - The context object for the turn.
     */
    async clearDialogState(context) {
        try {
            await this.dialogState.delete(context);
            console.log('DialogBot: Estado del diálogo limpiado');
        } catch (error) {
            console.error('DialogBot: Error al limpiar estado del diálogo:', error.message);
        }
    }

    /**
     * Checks if the bot is properly initialized
     * @returns {boolean} - True if properly initialized
     */
    isInitialized() {
        return !!(this.conversationState && this.userState && this.dialog && this.dialogState);
    }

    /**
     * Gets bot information for debugging
     * @returns {Object} - Bot information
     */
    getBotInfo() {
        return {
            hasConversationState: !!this.conversationState,
            hasUserState: !!this.userState,
            hasDialog: !!this.dialog,
            hasDialogState: !!this.dialogState,
            className: this.constructor.name
        };
    }
}

module.exports.DialogBot = DialogBot;