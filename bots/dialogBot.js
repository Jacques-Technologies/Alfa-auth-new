const { TeamsActivityHandler } = require('botbuilder');

/**
 * DialogBot class extends TeamsActivityHandler to handle Teams activities with essential error handling
 * and state management for the vacation system using Cosmos DB.
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
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        // Configurar manejo de errores
        this.onError = async (context, error) => {
            console.error('DialogBot Error:', error.message);
            await this.handleActivityError(context, error);
        };
    }

    /**
     * Handles incoming message activities with error handling.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessage(context, next) {
        try {
            // Verificar que el contexto y la actividad sean válidos
            if (!context || !context.activity) {
                console.warn('DialogBot: Invalid context or activity');
                return await next();
            }

            // Validar actividad
            if (!this.isValidActivity(context.activity)) {
                console.warn('DialogBot: Invalid activity, ignoring');
                return await next();
            }

            // Ejecutar el diálogo
            await this.dialog.run(context, this.dialogState);

        } catch (error) {
            console.error('DialogBot handleMessage error:', error.message);
            await this.handleMessageError(context, error);
            throw error;
        }

        await next();
    }

    /**
     * Valida si una actividad es válida para procesamiento
     * @param {Activity} activity - La actividad a validar
     * @returns {boolean} - Si la actividad es válida
     * @private
     */
    isValidActivity(activity) {
        // Verificar propiedades esenciales
        if (!activity.type || !activity.from || !activity.conversation) {
            return false;
        }

        // Verificar tipos de actividad soportados
        const supportedTypes = ['message', 'invoke', 'event'];
        if (!supportedTypes.includes(activity.type)) {
            return false;
        }

        // Validar estructura de mensaje
        if (activity.type === 'message') {
            // Verificar que tenga contenido válido
            if (!activity.text && !activity.value && !activity.attachments?.length) {
                return false;
            }

            // Verificar límites de longitud
            if (activity.text && activity.text.length > 4000) {
                console.warn('DialogBot: Message exceeds character limit');
                return false;
            }
        }

        return true;
    }

    /**
     * Maneja errores específicos de mensajes
     * @param {TurnContext} context - Contexto del turno
     * @param {Error} error - Error ocurrido
     * @private
     */
    async handleMessageError(context, error) {
        let userMessage = '❌ Ocurrió un error al procesar tu mensaje.';
        
        // Mensajes específicos según el tipo de error
        if (error.message.includes('authentication')) {
            userMessage = '🔒 **Error en autenticación.** \n\nPor favor, intenta autenticarte nuevamente.';
        } else if (error.message.includes('timeout')) {
            userMessage = '⏰ La operación tardó demasiado tiempo. Por favor, intenta nuevamente.';
        } else if (error.message.includes('vacation')) {
            userMessage = '🏖️ Error procesando solicitud de vacaciones. Por favor, intenta nuevamente o contacta a Recursos Humanos.';
        }
        
        // Intentar enviar mensaje de error al usuario
        try {
            await context.sendActivity(userMessage);
        } catch (sendError) {
            console.error('DialogBot: Error sending error message:', sendError.message);
        }
    }

    /**
     * Maneja errores generales de actividad
     * @param {TurnContext} context - Contexto del turno
     * @param {Error} error - Error ocurrido
     * @private
     */
    async handleActivityError(context, error) {
        console.error('DialogBot Activity Error:', {
            error: error.message,
            activityType: context.activity?.type,
            activityId: context.activity?.id,
            userId: context.activity?.from?.id
        });

        // Intentar recuperación automática si es error de estado
        if (error.message.includes('state') || error.message.includes('dialog')) {
            try {
                await this.recoverFromError(context, error);
            } catch (recoveryError) {
                console.error('DialogBot: Error recovery failed:', recoveryError.message);
            }
        }
    }

    /**
     * Intenta recuperación automática de errores
     * @param {TurnContext} context - Contexto del turno
     * @param {Error} error - Error ocurrido
     * @private
     */
    async recoverFromError(context, error) {
        const errorMessage = error.message.toLowerCase();
        
        // Recuperación de errores de estado/diálogo
        if (errorMessage.includes('state') || errorMessage.includes('dialog')) {
            console.warn('DialogBot: Attempting state recovery');
            try {
                await this.dialogState.delete(context);
                console.warn('DialogBot: Dialog state cleared for recovery');
            } catch (cleanupError) {
                console.error('DialogBot: State cleanup failed:', cleanupError.message);
            }
        }
    }

    /**
     * Handles members added events
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMembersAdded(context, next) {
        try {
            // Procesar cada miembro añadido
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    // Llamar al manejador específico del bot hijo
                    if (this.onMemberAdded) {
                        await this.onMemberAdded(context, member);
                    }
                }
            }
        } catch (error) {
            console.error('DialogBot handleMembersAdded error:', error.message);
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
            if (!context || !context.activity) {
                throw new Error('Invalid context or activity');
            }

            // Ejecutar la lógica del bot padre
            await super.run(context);

            // Guardar cambios de estado
            await this.saveStates(context);

        } catch (error) {
            console.error('DialogBot run error:', error.message);
            
            // Intentar limpiar estados corruptos
            try {
                await this.handleStateError(context, error);
            } catch (cleanupError) {
                console.error('DialogBot: State cleanup error:', cleanupError.message);
            }
            
            throw error;
        }
    }

    /**
     * Saves conversation and user states to Cosmos DB
     * @param {TurnContext} context - The context object for the turn.
     * @private
     */
    async saveStates(context) {
        const savePromises = [];
        
        // Guardar estado de conversación
        if (this.conversationState) {
            savePromises.push(
                this.conversationState.saveChanges(context, false)
                    .catch(error => {
                        console.error('DialogBot: Error saving conversation state:', error.message);
                    })
            );
        }

        // Guardar estado de usuario
        if (this.userState) {
            savePromises.push(
                this.userState.saveChanges(context, false)
                    .catch(error => {
                        console.error('DialogBot: Error saving user state:', error.message);
                    })
            );
        }

        // Esperar a que todas las operaciones de guardado terminen
        await Promise.allSettled(savePromises);
    }

    /**
     * Handles state-related errors with recovery strategies
     * @param {TurnContext} context - The context object for the turn.
     * @param {Error} error - The error that occurred.
     * @private
     */
    async handleStateError(context, error) {
        const errorMessage = error.message.toLowerCase();
        const isStateError = errorMessage.includes('state') || 
                           errorMessage.includes('storage') ||
                           errorMessage.includes('cosmos');
        
        if (isStateError) {
            console.warn('DialogBot: State error detected, cleaning up');
            
            try {
                // Limpiar estado de diálogo
                if (this.dialogState) {
                    await this.dialogState.delete(context);
                }
                
                // Limpiar estado de conversación si es necesario
                if (errorMessage.includes('conversation')) {
                    await this.conversationState.delete(context);
                }
                
            } catch (cleanupError) {
                console.error('DialogBot: Cleanup error:', cleanupError.message);
            }
        }
    }

    /**
     * Gets the current dialog state with error handling
     * @param {TurnContext} context - The context object for the turn.
     * @returns {Object} - Current dialog state
     */
    async getDialogState(context) {
        try {
            return await this.dialogState.get(context, {});
        } catch (error) {
            console.error('DialogBot: Error getting dialog state:', error.message);
            
            // Intentar recuperación
            try {
                await this.dialogState.delete(context);
                return {};
            } catch (recoveryError) {
                console.error('DialogBot: Dialog state recovery error:', recoveryError.message);
                return {};
            }
        }
    }

    /**
     * Clears the dialog state
     * @param {TurnContext} context - The context object for the turn.
     */
    async clearDialogState(context) {
        try {
            await this.dialogState.delete(context);
        } catch (error) {
            console.error('DialogBot: Error clearing dialog state:', error.message);
        }
    }

    /**
     * Checks if the bot is properly initialized
     * @returns {boolean} - True if properly initialized
     */
    isInitialized() {
        const initialized = !!(this.conversationState && this.userState && this.dialog && this.dialogState);
        
        if (!initialized) {
            console.warn('DialogBot: Bot not fully initialized');
        }
        
        return initialized;
    }
}

module.exports.DialogBot = DialogBot;