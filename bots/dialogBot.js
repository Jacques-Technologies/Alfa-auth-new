// dialogBot.js - Versión optimizada y robusta

const { TeamsActivityHandler } = require('botbuilder');

/**
 * DialogBot - Clase base optimizada para manejo de diálogos en Teams
 */
class DialogBot extends TeamsActivityHandler {
    constructor(conversationState, userState, dialog) {
        super();

        // Validar parámetros requeridos
        if (!conversationState) {
            throw new Error('[DialogBot]: conversationState es requerido');
        }
        if (!userState) {
            throw new Error('[DialogBot]: userState es requerido');
        }
        if (!dialog) {
            throw new Error('[DialogBot]: dialog es requerido');
        }

        this.conversationState = conversationState;
        this.userState = userState;
        this.dialog = dialog;
        this.dialogState = this.conversationState.createProperty('DialogState');

        // Configurar manejadores de eventos
        this.onMessage(this.handleMessage.bind(this));
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        console.log('DialogBot inicializado correctamente');
    }

    /**
     * Maneja mensajes entrantes
     */
    async handleMessage(context, next) {
        try {
            // Validación básica del contexto
            if (!context || !context.activity) {
                console.warn('DialogBot: Contexto o actividad inválida');
                return await next();
            }

            // Validar que la actividad sea procesable
            if (!this.isValidActivity(context.activity)) {
                console.warn('DialogBot: Actividad no válida, ignorando');
                return await next();
            }

            // Ejecutar el diálogo principal
            await this.dialog.run(context, this.dialogState);

        } catch (error) {
            console.error('DialogBot: Error en handleMessage:', error.message);
            await this.handleError(context, error);
        }

        await next();
    }

    /**
     * Valida si una actividad es procesable
     */
    isValidActivity(activity) {
        // Verificar propiedades esenciales
        if (!activity.type || !activity.from || !activity.conversation) {
            return false;
        }

        // Verificar tipos soportados
        const supportedTypes = ['message', 'invoke', 'event'];
        if (!supportedTypes.includes(activity.type)) {
            return false;
        }

        // Para mensajes, verificar que tengan contenido
        if (activity.type === 'message') {
            const hasText = activity.text && activity.text.trim().length > 0;
            const hasValue = activity.value && Object.keys(activity.value).length > 0;
            const hasAttachments = activity.attachments && activity.attachments.length > 0;
            
            if (!hasText && !hasValue && !hasAttachments) {
                return false;
            }

            // Verificar límite de caracteres
            if (activity.text && activity.text.length > 4000) {
                console.warn('DialogBot: Mensaje excede límite de caracteres');
                return false;
            }
        }

        return true;
    }

    /**
     * Maneja nuevos miembros añadidos
     */
    async handleMembersAdded(context, next) {
        try {
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    // Llamar al manejador específico del bot derivado si existe
                    if (this.onMemberAdded && typeof this.onMemberAdded === 'function') {
                        await this.onMemberAdded(context, member);
                    }
                }
            }
        } catch (error) {
            console.error('DialogBot: Error en handleMembersAdded:', error.message);
            await this.handleError(context, error);
        }
        
        await next();
    }

    /**
     * Maneja errores de forma centralizada
     */
    async handleError(context, error) {
        console.error('DialogBot: Error:', {
            error: error.message,
            activityType: context.activity?.type,
            activityId: context.activity?.id,
            userId: context.activity?.from?.id
        });

        try {
            // Enviar mensaje de error genérico al usuario
            const errorMessage = this.getErrorMessage(error);
            await context.sendActivity(errorMessage);

            // Intentar limpiar estados corruptos si es necesario
            if (this.isStateError(error)) {
                await this.recoverFromStateError(context, error);
            }

        } catch (handlingError) {
            console.error('DialogBot: Error manejando error:', handlingError.message);
        }
    }

    /**
     * Genera mensaje de error apropiado
     */
    getErrorMessage(error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
            return '🔒 **Error de autenticación**\n\nPor favor, intenta autenticarte nuevamente escribiendo `login`.';
        } else if (errorMessage.includes('timeout')) {
            return '⏰ **Tiempo de espera agotado**\n\nLa operación tardó demasiado. Por favor, intenta nuevamente.';
        } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
            return '🌐 **Error de conexión**\n\nProblemas de conectividad. Intenta nuevamente en unos momentos.';
        } else {
            return '❌ **Error inesperado**\n\nOcurrió un error procesando tu solicitud. Intenta nuevamente.';
        }
    }

    /**
     * Verifica si el error está relacionado con estados
     */
    isStateError(error) {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('state') || 
               errorMessage.includes('dialog') || 
               errorMessage.includes('storage') ||
               errorMessage.includes('cosmos');
    }

    /**
     * Intenta recuperarse de errores de estado
     */
    async recoverFromStateError(context, error) {
        const errorMessage = error.message.toLowerCase();
        
        try {
            console.warn('DialogBot: Intentando recuperación de estado');
            
            if (errorMessage.includes('dialog')) {
                // Limpiar estado de diálogo
                await this.dialogState.delete(context);
                console.warn('DialogBot: Estado de diálogo limpiado');
            }
            
            if (errorMessage.includes('conversation')) {
                // Limpiar estado de conversación
                await this.conversationState.delete(context);
                console.warn('DialogBot: Estado de conversación limpiado');
            }
            
        } catch (recoveryError) {
            console.error('DialogBot: Error en recuperación:', recoveryError.message);
        }
    }

    /**
     * Override del método run para guardar cambios de estado
     */
    async run(context) {
        try {
            // Validar contexto
            if (!context || !context.activity) {
                throw new Error('Contexto inválido');
            }

            // Asegurar que el bot esté en el contexto para otros componentes
            this.ensureBotInContext(context);

            // Ejecutar lógica del bot padre
            await super.run(context);

            // Guardar cambios de estado
            await this.saveStates(context);

        } catch (error) {
            console.error('DialogBot: Error en run:', error.message);
            
            // Intentar recuperación
            await this.handleError(context, error);
            
            // Re-lanzar para que sea manejado por el framework
            throw error;
        }
    }

    /**
     * Asegura que el bot esté disponible en el contexto
     */
    ensureBotInContext(context) {
        if (!context.turnState.get('bot')) {
            context.turnState.set('bot', this);
        }
        if (!context.turnState.get('ConversationState')) {
            context.turnState.set('ConversationState', this.conversationState);
        }
        if (!context.turnState.get('UserState')) {
            context.turnState.set('UserState', this.userState);
        }
    }

    /**
     * Guarda los estados de conversación y usuario
     */
    async saveStates(context) {
        const savePromises = [];
        
        // Guardar estado de conversación
        if (this.conversationState) {
            savePromises.push(
                this.conversationState.saveChanges(context, false)
                    .catch(error => {
                        console.error('DialogBot: Error guardando estado de conversación:', error.message);
                    })
            );
        }

        // Guardar estado de usuario
        if (this.userState) {
            savePromises.push(
                this.userState.saveChanges(context, false)
                    .catch(error => {
                        console.error('DialogBot: Error guardando estado de usuario:', error.message);
                    })
            );
        }

        // Esperar a que terminen todas las operaciones de guardado
        await Promise.allSettled(savePromises);
    }

    /**
     * Obtiene el estado actual del diálogo
     */
    async getDialogState(context) {
        try {
            return await this.dialogState.get(context, {});
        } catch (error) {
            console.error('DialogBot: Error obteniendo estado de diálogo:', error.message);
            
            // Intentar limpiar y devolver estado vacío
            try {
                await this.dialogState.delete(context);
                return {};
            } catch (recoveryError) {
                console.error('DialogBot: Error en recuperación de estado:', recoveryError.message);
                return {};
            }
        }
    }

    /**
     * Limpia el estado del diálogo
     */
    async clearDialogState(context) {
        try {
            await this.dialogState.delete(context);
            console.log('DialogBot: Estado de diálogo limpiado');
        } catch (error) {
            console.error('DialogBot: Error limpiando estado de diálogo:', error.message);
        }
    }

    /**
     * Verifica si el bot está correctamente inicializado
     */
    isInitialized() {
        const initialized = !!(
            this.conversationState && 
            this.userState && 
            this.dialog && 
            this.dialogState
        );
        
        if (!initialized) {
            console.warn('DialogBot: Bot no está completamente inicializado');
        }
        
        return initialized;
    }

    /**
     * Obtiene estadísticas del bot
     */
    getStats() {
        return {
            initialized: this.isInitialized(),
            hasConversationState: !!this.conversationState,
            hasUserState: !!this.userState,
            hasDialog: !!this.dialog,
            hasDialogState: !!this.dialogState,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports.DialogBot = DialogBot;