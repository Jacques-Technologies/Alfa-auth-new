// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { TeamsActivityHandler } = require('botbuilder');

/**
 * DialogBot class extends TeamsActivityHandler to handle Teams activities with comprehensive error handling,
 * performance optimization, and enhanced state management for the vacation system.
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

        // Validar parámetros requeridos con mensajes más descriptivos
        if (!conversationState) {
            throw new Error('[DialogBot]: Missing parameter. conversationState is required for state management');
        }
        if (!userState) {
            throw new Error('[DialogBot]: Missing parameter. userState is required for user authentication');
        }
        if (!dialog) {
            throw new Error('[DialogBot]: Missing parameter. dialog is required for conversation flow');
        }

        this.conversationState = conversationState;
        this.userState = userState;
        this.dialog = dialog;
        this.dialogState = this.conversationState.createProperty('DialogState');

        // Estadísticas de rendimiento y monitoreo
        this.stats = {
            messagesProcessed: 0,
            errorsHandled: 0,
            stateOperations: 0,
            lastActivity: new Date(),
            startTime: new Date(),
            averageResponseTime: 0,
            responseTimes: []
        };

        // Configurar manejadores de eventos con binding seguro
        this.onMessage(this.handleMessage.bind(this));
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        this.onMessageUpdate(this.handleMessageUpdate.bind(this));
        this.onMessageDelete(this.handleMessageDelete.bind(this));
        this.onInstallationUpdate(this.handleInstallationUpdate.bind(this));
        
        // Configurar manejo de errores específicos
        this.setupErrorHandlers();
        
        console.log('DialogBot: Inicializado correctamente con estadísticas de rendimiento');
    }

    /**
     * Configura manejadores de errores específicos
     * @private
     */
    setupErrorHandlers() {
        // Manejador para errores de actividad
        this.onError = async (context, error) => {
            console.error('DialogBot: Error en actividad:', error.message);
            this.stats.errorsHandled++;
            
            try {
                await this.handleActivityError(context, error);
            } catch (handlerError) {
                console.error('DialogBot: Error crítico en handleActivityError:', handlerError.message);
            }
        };
    }

    /**
     * Handles incoming message activities with enhanced error handling and performance tracking.
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessage(context, next) {
        const startTime = Date.now();
        
        try {
            console.log('DialogBot: Procesando actividad de mensaje');
            this.stats.messagesProcessed++;
            this.stats.lastActivity = new Date();

            // Verificar que el contexto y la actividad sean válidos
            if (!context || !context.activity) {
                console.warn('DialogBot: Contexto o actividad inválidos');
                return await next();
            }

            // Validaciones adicionales de la actividad
            if (!this.isValidActivity(context.activity)) {
                console.warn('DialogBot: Actividad no válida, ignorando');
                return await next();
            }

            // Log detallado de la actividad
            this.logActivityDetails(context.activity);

            // Verificar límites de recursos antes de procesar
            if (await this.checkResourceLimits()) {
                console.warn('DialogBot: Límites de recursos alcanzados, procesamiento diferido');
                await context.sendActivity('⚠️ El sistema está temporalmente ocupado. Por favor, intenta en unos momentos.');
                return await next();
            }

            // Ejecutar el diálogo con la nueva actividad de mensaje
            await this.dialog.run(context, this.dialogState);

            // Registrar tiempo de respuesta
            const responseTime = Date.now() - startTime;
            this.recordResponseTime(responseTime);

            console.log(`DialogBot: Mensaje procesado en ${responseTime}ms`);

        } catch (error) {
            console.error('DialogBot: Error en handleMessage:', error.message);
            this.stats.errorsHandled++;
            
            // Manejo específico de errores
            await this.handleMessageError(context, error);
            
            // Re-lanzar el error para que lo maneje el manejador global
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
        const supportedTypes = ['message', 'invoke', 'event', 'installationUpdate', 'messageUpdate', 'messageDelete'];
        if (!supportedTypes.includes(activity.type)) {
            console.log(`DialogBot: Tipo de actividad no soportado: ${activity.type}`);
            return false;
        }

        // Validar estructura de mensaje
        if (activity.type === 'message') {
            // Verificar que tenga contenido válido
            if (!activity.text && !activity.value && !activity.attachments?.length) {
                console.log('DialogBot: Mensaje sin contenido válido');
                return false;
            }

            // Verificar límites de longitud
            if (activity.text && activity.text.length > 4000) {
                console.warn('DialogBot: Mensaje excede límite de caracteres');
                return false;
            }
        }

        return true;
    }

    /**
     * Registra detalles de la actividad para debugging
     * @param {Activity} activity - La actividad a registrar
     * @private
     */
    logActivityDetails(activity) {
        const details = {
            type: activity.type,
            id: activity.id,
            timestamp: activity.timestamp,
            from: activity.from?.id,
            conversation: activity.conversation?.id,
            channelId: activity.channelId,
            hasText: !!activity.text,
            hasValue: !!activity.value,
            hasAttachments: !!(activity.attachments?.length)
        };

        console.log('DialogBot: Detalles de actividad:', JSON.stringify(details, null, 2));
        
        // Log especial para actividades de vacaciones
        if (activity.text && activity.text.toLowerCase().includes('vacation')) {
            console.log('DialogBot: 🏖️ Actividad relacionada con vacaciones detectada');
        }
    }

    /**
     * Verifica límites de recursos del sistema
     * @returns {boolean} - Si se han alcanzado los límites
     * @private
     */
    async checkResourceLimits() {
        try {
            const memUsage = process.memoryUsage();
            const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
            
            // Límite de memoria: 400MB
            if (heapUsedMB > 400) {
                console.warn(`DialogBot: Uso alto de memoria: ${Math.round(heapUsedMB)}MB`);
                
                // Forzar garbage collection si está disponible
                if (global.gc) {
                    global.gc();
                    console.log('DialogBot: Garbage collection ejecutado');
                }
                
                return true;
            }

            // Verificar carga de CPU (aproximada por tiempo de respuesta promedio)
            if (this.stats.averageResponseTime > 5000) {
                console.warn(`DialogBot: Tiempo de respuesta alto: ${this.stats.averageResponseTime}ms`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('DialogBot: Error verificando límites de recursos:', error.message);
            return false;
        }
    }

    /**
     * Registra tiempo de respuesta para estadísticas
     * @param {number} responseTime - Tiempo de respuesta en ms
     * @private
     */
    recordResponseTime(responseTime) {
        this.stats.responseTimes.push(responseTime);
        
        // Mantener solo los últimos 100 tiempos
        if (this.stats.responseTimes.length > 100) {
            this.stats.responseTimes = this.stats.responseTimes.slice(-100);
        }
        
        // Calcular promedio
        this.stats.averageResponseTime = this.stats.responseTimes.reduce((a, b) => a + b, 0) / this.stats.responseTimes.length;
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
            userMessage = '🔒 Error de autenticación. Por favor, escribe `login` para iniciar sesión nuevamente.';
        } else if (error.message.includes('timeout')) {
            userMessage = '⏰ La operación tardó demasiado tiempo. Por favor, intenta nuevamente.';
        } else if (error.message.includes('vacation')) {
            userMessage = '🏖️ Error procesando solicitud de vacaciones. Por favor, intenta nuevamente o contacta a Recursos Humanos.';
        } else if (error.message.includes('network')) {
            userMessage = '🔗 Error de conectividad. Verifica tu conexión e intenta nuevamente.';
        } else if (error.message.includes('storage')) {
            userMessage = '💾 Error de almacenamiento temporal. Tus datos están seguros, intenta nuevamente.';
        }
        
        // Intentar enviar mensaje de error al usuario
        try {
            await context.sendActivity(userMessage);
        } catch (sendError) {
            console.error('DialogBot: Error al enviar mensaje de error:', sendError.message);
        }
    }

    /**
     * Maneja errores generales de actividad
     * @param {TurnContext} context - Contexto del turno
     * @param {Error} error - Error ocurrido
     * @private
     */
    async handleActivityError(context, error) {
        console.error('DialogBot: Error en actividad:', {
            error: error.message,
            activityType: context.activity?.type,
            activityId: context.activity?.id,
            userId: context.activity?.from?.id
        });

        // Intentar recuperación automática
        try {
            await this.attemptErrorRecovery(context, error);
        } catch (recoveryError) {
            console.error('DialogBot: Error en recuperación automática:', recoveryError.message);
        }
    }

    /**
     * Intenta recuperación automática de errores
     * @param {TurnContext} context - Contexto del turno
     * @param {Error} error - Error ocurrido
     * @private
     */
    async attemptErrorRecovery(context, error) {
        // Estrategias de recuperación basadas en el tipo de error
        if (error.message.includes('state')) {
            console.log('DialogBot: Intentando recuperación de estado');
            await this.recoverFromStateError(context);
        } else if (error.message.includes('dialog')) {
            console.log('DialogBot: Intentando recuperación de diálogo');
            await this.recoverFromDialogError(context);
        }
    }

    /**
     * Recuperación de errores de estado
     * @param {TurnContext} context - Contexto del turno
     * @private
     */
    async recoverFromStateError(context) {
        try {
            // Intentar limpiar estado corrupto
            await this.conversationState.delete(context);
            console.log('DialogBot: Estado de conversación limpiado para recuperación');
        } catch (cleanupError) {
            console.error('DialogBot: Error en limpieza de estado:', cleanupError.message);
        }
    }

    /**
     * Recuperación de errores de diálogo
     * @param {TurnContext} context - Contexto del turno
     * @private
     */
    async recoverFromDialogError(context) {
        try {
            // Intentar reiniciar diálogo
            await this.dialogState.delete(context);
            console.log('DialogBot: Estado de diálogo limpiado para recuperación');
        } catch (cleanupError) {
            console.error('DialogBot: Error en limpieza de diálogo:', cleanupError.message);
        }
    }

    /**
     * Handles members added events with enhanced functionality
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMembersAdded(context, next) {
        try {
            console.log('DialogBot: Procesando evento de miembros añadidos');
            
            // Registrar evento en estadísticas
            this.stats.lastActivity = new Date();
            
            // Procesar cada miembro añadido
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    console.log(`DialogBot: Nuevo miembro añadido: ${member.id}`);
                    
                    // Llamar al manejador específico del bot hijo
                    if (this.onMemberAdded) {
                        await this.onMemberAdded(context, member);
                    }
                }
            }
            
        } catch (error) {
            console.error('DialogBot: Error en handleMembersAdded:', error.message);
            this.stats.errorsHandled++;
        }
        
        await next();
    }

    /**
     * Handles message update events
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessageUpdate(context, next) {
        try {
            console.log('DialogBot: Procesando actualización de mensaje');
            this.stats.lastActivity = new Date();
            
            // Registrar detalles de la actualización
            const updateDetails = {
                originalId: context.activity.id,
                updatedText: context.activity.text,
                timestamp: context.activity.timestamp
            };
            
            console.log('DialogBot: Detalles de actualización:', JSON.stringify(updateDetails, null, 2));
            
        } catch (error) {
            console.error('DialogBot: Error en handleMessageUpdate:', error.message);
            this.stats.errorsHandled++;
        }
        
        await next();
    }

    /**
     * Handles message delete events
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleMessageDelete(context, next) {
        try {
            console.log('DialogBot: Procesando eliminación de mensaje');
            this.stats.lastActivity = new Date();
            
            // Registrar detalles de la eliminación
            console.log('DialogBot: Mensaje eliminado:', context.activity.id);
            
        } catch (error) {
            console.error('DialogBot: Error en handleMessageDelete:', error.message);
            this.stats.errorsHandled++;
        }
        
        await next();
    }

    /**
     * Handles installation update events
     * @param {TurnContext} context - The context object for the turn.
     * @param {Function} next - The next middleware function in the pipeline.
     */
    async handleInstallationUpdate(context, next) {
        try {
            console.log('DialogBot: Procesando actualización de instalación');
            this.stats.lastActivity = new Date();
            
            const installationAction = context.activity.action;
            console.log(`DialogBot: Acción de instalación: ${installationAction}`);
            
            // Manejar diferentes acciones de instalación
            if (installationAction === 'add') {
                console.log('DialogBot: Bot añadido a nueva conversación');
            } else if (installationAction === 'remove') {
                console.log('DialogBot: Bot removido de conversación');
            }
            
        } catch (error) {
            console.error('DialogBot: Error en handleInstallationUpdate:', error.message);
            this.stats.errorsHandled++;
        }
        
        await next();
    }

    /**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     * @param {TurnContext} context - The context object for the turn.
     */
    async run(context) {
        const startTime = Date.now();
        
        try {
            // Verificar que el contexto sea válido
            if (!context) {
                throw new Error('Context is null or undefined');
            }

            // Verificar que la actividad sea válida
            if (!context.activity) {
                throw new Error('Activity is null or undefined');
            }

            // Log de inicio de procesamiento
            console.log(`DialogBot: Iniciando procesamiento de actividad ${context.activity.type}`);

            // Ejecutar la lógica del bot padre
            await super.run(context);

            // Guardar cambios de estado de manera segura
            await this.saveStates(context);

            // Registrar tiempo de procesamiento
            const processingTime = Date.now() - startTime;
            console.log(`DialogBot: Actividad procesada en ${processingTime}ms`);

        } catch (error) {
            console.error('DialogBot: Error en run():', error.message);
            this.stats.errorsHandled++;
            
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
     * Saves conversation and user states safely with enhanced error handling
     * @param {TurnContext} context - The context object for the turn.
     * @private
     */
    async saveStates(context) {
        const savePromises = [];
        const saveResults = [];
        
        // Guardar estado de conversación
        if (this.conversationState) {
            savePromises.push(
                this.conversationState.saveChanges(context, false)
                    .then(() => {
                        console.log('DialogBot: Estado de conversación guardado');
                        saveResults.push({ type: 'conversation', success: true });
                        this.stats.stateOperations++;
                    })
                    .catch(error => {
                        console.error('DialogBot: Error al guardar estado de conversación:', error.message);
                        saveResults.push({ type: 'conversation', success: false, error: error.message });
                    })
            );
        }

        // Guardar estado de usuario
        if (this.userState) {
            savePromises.push(
                this.userState.saveChanges(context, false)
                    .then(() => {
                        console.log('DialogBot: Estado de usuario guardado');
                        saveResults.push({ type: 'user', success: true });
                        this.stats.stateOperations++;
                    })
                    .catch(error => {
                        console.error('DialogBot: Error al guardar estado de usuario:', error.message);
                        saveResults.push({ type: 'user', success: false, error: error.message });
                    })
            );
        }

        // Esperar a que todas las operaciones de guardado terminen
        await Promise.allSettled(savePromises);
        
        // Verificar resultados
        const failedSaves = saveResults.filter(result => !result.success);
        if (failedSaves.length > 0) {
            console.warn('DialogBot: Algunos estados no se pudieron guardar:', failedSaves);
        }
    }

    /**
     * Handles state-related errors with enhanced recovery strategies
     * @param {TurnContext} context - The context object for the turn.
     * @param {Error} error - The error that occurred.
     * @private
     */
    async handleStateError(context, error) {
        console.log('DialogBot: Manejando error de estado');
        
        // Analizar el tipo de error
        const errorMessage = error.message.toLowerCase();
        const isStateError = errorMessage.includes('state') || 
                           errorMessage.includes('storage') ||
                           errorMessage.includes('serialize') ||
                           errorMessage.includes('deserialize');
        
        if (isStateError) {
            console.log('DialogBot: Error de estado detectado, iniciando limpieza');
            
            try {
                // Estrategia de limpieza progresiva
                
                // 1. Limpiar estado de diálogo primero
                if (this.dialogState) {
                    await this.dialogState.delete(context);
                    console.log('DialogBot: Estado de diálogo limpiado');
                }
                
                // 2. Limpiar estado de conversación si el error persiste
                if (errorMessage.includes('conversation')) {
                    await this.conversationState.delete(context);
                    console.log('DialogBot: Estado de conversación limpiado');
                }
                
                // 3. Solo limpiar estado de usuario como último recurso
                if (errorMessage.includes('user') && errorMessage.includes('critical')) {
                    console.warn('DialogBot: Limpiando estado de usuario (último recurso)');
                    await this.userState.delete(context);
                    console.log('DialogBot: Estado de usuario limpiado');
                }
                
                console.log('DialogBot: Limpieza de estado completada');
                
            } catch (cleanupError) {
                console.error('DialogBot: Error durante limpieza:', cleanupError.message);
                
                // Como último recurso, intentar limpiar todo
                try {
                    await Promise.allSettled([
                        this.conversationState?.delete(context),
                        this.dialogState?.delete(context)
                    ]);
                    console.log('DialogBot: Limpieza de emergencia completada');
                } catch (emergencyError) {
                    console.error('DialogBot: Error en limpieza de emergencia:', emergencyError.message);
                }
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
            const dialogState = await this.dialogState.get(context, {});
            console.log('DialogBot: Estado del diálogo obtenido exitosamente');
            return dialogState;
        } catch (error) {
            console.error('DialogBot: Error al obtener estado del diálogo:', error.message);
            
            // Intentar recuperación
            try {
                await this.dialogState.delete(context);
                console.log('DialogBot: Estado del diálogo reiniciado debido a error');
                return {};
            } catch (recoveryError) {
                console.error('DialogBot: Error en recuperación de estado:', recoveryError.message);
                return {};
            }
        }
    }

    /**
     * Clears the dialog state with enhanced error handling
     * @param {TurnContext} context - The context object for the turn.
     */
    async clearDialogState(context) {
        try {
            await this.dialogState.delete(context);
            console.log('DialogBot: Estado del diálogo limpiado');
        } catch (error) {
            console.error('DialogBot: Error al limpiar estado del diálogo:', error.message);
            
            // Intentar forzar limpieza
            try {
                await this.dialogState.set(context, {});
                await this.conversationState.saveChanges(context);
                console.log('DialogBot: Estado del diálogo forzado a limpiar');
            } catch (forceError) {
                console.error('DialogBot: Error forzando limpieza:', forceError.message);
            }
        }
    }

    /**
     * Checks if the bot is properly initialized
     * @returns {boolean} - True if properly initialized
     */
    isInitialized() {
        const initialized = !!(this.conversationState && this.userState && this.dialog && this.dialogState);
        
        if (!initialized) {
            console.warn('DialogBot: Bot no está completamente inicializado');
            console.warn('DialogBot: Estado de componentes:', {
                conversationState: !!this.conversationState,
                userState: !!this.userState,
                dialog: !!this.dialog,
                dialogState: !!this.dialogState
            });
        }
        
        return initialized;
    }

    /**
     * Gets comprehensive bot information for debugging and monitoring
     * @returns {Object} - Bot information
     */
    getBotInfo() {
        return {
            // Estado de componentes
            components: {
                conversationState: !!this.conversationState,
                userState: !!this.userState,
                dialog: !!this.dialog,
                dialogState: !!this.dialogState
            },
            
            // Estadísticas de rendimiento
            stats: {
                ...this.stats,
                uptime: Date.now() - this.stats.startTime.getTime(),
                messagesPerHour: this.calculateMessagesPerHour(),
                errorRate: this.calculateErrorRate()
            },
            
            // Información de la clase
            className: this.constructor.name,
            initialized: this.isInitialized(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Calcula mensajes por hora
     * @returns {number} - Mensajes por hora
     * @private
     */
    calculateMessagesPerHour() {
        const uptimeHours = (Date.now() - this.stats.startTime.getTime()) / (1000 * 60 * 60);
        return uptimeHours > 0 ? Math.round(this.stats.messagesProcessed / uptimeHours) : 0;
    }

    /**
     * Calcula tasa de error
     * @returns {number} - Tasa de error (0-1)
     * @private
     */
    calculateErrorRate() {
        const totalOperations = this.stats.messagesProcessed + this.stats.stateOperations;
        return totalOperations > 0 ? this.stats.errorsHandled / totalOperations : 0;
    }

    /**
     * Resets statistics for monitoring
     */
    resetStats() {
        this.stats = {
            messagesProcessed: 0,
            errorsHandled: 0,
            stateOperations: 0,
            lastActivity: new Date(),
            startTime: new Date(),
            averageResponseTime: 0,
            responseTimes: []
        };
        
        console.log('DialogBot: Estadísticas reiniciadas');
    }

    /**
     * Gets health status of the bot
     * @returns {Object} - Health status
     */
    getHealthStatus() {
        const memUsage = process.memoryUsage();
        const uptime = Date.now() - this.stats.startTime.getTime();
        
        return {
            status: this.isInitialized() ? 'healthy' : 'unhealthy',
            uptime: uptime,
            lastActivity: this.stats.lastActivity,
            performance: {
                messagesProcessed: this.stats.messagesProcessed,
                averageResponseTime: this.stats.averageResponseTime,
                errorRate: this.calculateErrorRate(),
                memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024) // MB
            },
            components: {
                conversationState: !!this.conversationState,
                userState: !!this.userState,
                dialog: !!this.dialog,
                dialogState: !!this.dialogState
            }
        };
    }
}

module.exports.DialogBot = DialogBot;