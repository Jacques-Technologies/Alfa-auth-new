const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio completo y optimizado para gestionar las conversaciones en CosmosDB o en memoria si no está disponible
 * Incluye mejoras para el manejo estricto de vacaciones y mejor rendimiento
 */
class ConversationService {
    constructor() {
        this.useCosmosDb = false;
        this.container = null;
        this.initializationAttempted = false;
        
        // Almacenamiento en memoria como respaldo con mejoras
        this.memoryStorage = {
            conversations: new Map(),
            messages: [],
            messageIndex: new Map(), // Índice para búsquedas rápidas
            userSessions: new Map()  // Sesiones de usuario para mejor gestión
        };
        
        // Estadísticas de rendimiento
        this.stats = {
            totalMessages: 0,
            totalConversations: 0,
            errorCount: 0,
            lastError: null,
            lastCleanup: new Date()
        };
        
        // Intentar inicializar CosmosDB
        this.initializeCosmosDb();
        
        // Configurar limpieza automática cada 6 horas
        this.setupAutoCleanup();
    }

    /**
     * Inicializa CosmosDB si está disponible
     * @private
     */
    async initializeCosmosDb() {
        if (this.initializationAttempted) {
            return;
        }
        
        this.initializationAttempted = true;
        
        try {
            // Esperar a que CosmosDB se inicialice
            await cosmosDbConfig.initializationPromise;
            
            if (cosmosDbConfig.isAvailable()) {
                this.container = cosmosDbConfig.getConversationContainer();
                this.useCosmosDb = true;
                console.log('ConversationService: Inicializado con CosmosDB');
                
                // Migrar datos de memoria a CosmosDB si es necesario
                await this.migrateMemoryToCosmosDb();
            } else {
                console.warn('ConversationService: CosmosDB no disponible, usando almacenamiento en memoria');
            }
        } catch (error) {
            console.warn(`ConversationService: Error al inicializar CosmosDB: ${error.message}`);
            console.warn('ConversationService: Usando almacenamiento en memoria');
            this.useCosmosDb = false;
            this.stats.errorCount++;
            this.stats.lastError = error.message;
        }
    }

    /**
     * Migra datos de memoria a CosmosDB (si hay datos pendientes)
     * @private
     */
    async migrateMemoryToCosmosDb() {
        if (!this.useCosmosDb || this.memoryStorage.messages.length === 0) {
            return;
        }

        try {
            console.log(`ConversationService: Migrando ${this.memoryStorage.messages.length} mensajes a CosmosDB`);
            
            let migratedCount = 0;
            for (const message of this.memoryStorage.messages) {
                try {
                    await this.container.items.create(message);
                    migratedCount++;
                } catch (error) {
                    console.warn(`Error migrando mensaje ${message.id}: ${error.message}`);
                }
            }
            
            console.log(`ConversationService: Migrados ${migratedCount} mensajes exitosamente`);
            
            // Limpiar memoria después de migración exitosa
            if (migratedCount > 0) {
                this.memoryStorage.messages = [];
                this.memoryStorage.messageIndex.clear();
            }
        } catch (error) {
            console.error(`Error durante migración: ${error.message}`);
        }
    }

    /**
     * Configura limpieza automática de memoria
     * @private
     */
    setupAutoCleanup() {
        // Limpiar cada 6 horas
        setInterval(() => {
            try {
                this.cleanupOldMessages(7); // Limpiar mensajes de más de 7 días
                this.cleanupInactiveSessions(24); // Limpiar sesiones inactivas de más de 24 horas
                this.stats.lastCleanup = new Date();
                console.log('ConversationService: Limpieza automática completada');
            } catch (error) {
                console.error('Error en limpieza automática:', error.message);
            }
        }, 6 * 60 * 60 * 1000); // 6 horas
    }

    /**
     * Verifica si CosmosDB está disponible y reintenta la inicialización si es necesario
     * @private
     */
    async ensureInitialized() {
        if (!this.useCosmosDb && !this.initializationAttempted) {
            await this.initializeCosmosDb();
        }
    }

    /**
     * Genera un ID único para mensajes
     * @param {string} conversationId - ID de la conversación
     * @returns {string} - ID único del mensaje
     * @private
     */
    generateMessageId(conversationId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `${conversationId}-${timestamp}-${random}`;
    }

    /**
     * Valida y normaliza los parámetros de entrada
     * @param {string} message - Mensaje a validar
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Parámetros validados
     * @private
     */
    validateParameters(message, conversationId, userId) {
        if (!message || typeof message !== 'string') {
            throw new Error('El mensaje debe ser una cadena de texto válida');
        }
        
        if (!conversationId || typeof conversationId !== 'string') {
            throw new Error('conversationId debe ser una cadena de texto válida');
        }
        
        if (!userId || typeof userId !== 'string') {
            throw new Error('userId debe ser una cadena de texto válida');
        }

        return {
            message: message.substring(0, 4000).trim(), // Limitar y limpiar mensaje
            conversationId: conversationId.trim(),
            userId: userId.trim()
        };
    }

    /**
     * Guarda un mensaje en la conversación con validación mejorada
     * @param {string} message - Mensaje a guardar
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Mensaje guardado
     */
    async saveMessage(message, conversationId, userId) {
        try {
            // Validar parámetros
            const validated = this.validateParameters(message, conversationId, userId);
            
            await this.ensureInitialized();

            const timestamp = new Date().toISOString();
            const messageId = this.generateMessageId(validated.conversationId);
            
            const messageRecord = {
                id: messageId,
                conversationId: validated.conversationId,
                userId: validated.userId,
                message: validated.message,
                timestamp,
                type: 'message',
                // Campos adicionales para mejor gestión
                messageLength: validated.message.length,
                userType: validated.userId === 'bot' ? 'assistant' : 'user'
            };
            
            if (this.useCosmosDb && this.container) {
                // Guardar en CosmosDB
                const { resource } = await this.container.items.create(messageRecord);
                console.log(`Mensaje guardado en CosmosDB: ${messageId}`);
                this.stats.totalMessages++;
                return resource;
            } else {
                // Guardar en memoria con indexación mejorada
                this.memoryStorage.messages.push(messageRecord);
                
                // Actualizar índice para búsquedas rápidas
                if (!this.memoryStorage.messageIndex.has(validated.conversationId)) {
                    this.memoryStorage.messageIndex.set(validated.conversationId, []);
                }
                this.memoryStorage.messageIndex.get(validated.conversationId).push(messageRecord);
                
                // Actualizar sesión de usuario
                this.updateUserSession(validated.userId, validated.conversationId);
                
                // Limitar mensajes en memoria para evitar uso excesivo de memoria
                if (this.memoryStorage.messages.length > 2000) {
                    this.memoryStorage.messages = this.memoryStorage.messages.slice(-1000);
                    console.log('ConversationService: Mensajes en memoria limitados a 1000 más recientes');
                    
                    // Reconstruir índice después de la limpieza
                    this.rebuildMessageIndex();
                }
                
                console.log(`Mensaje guardado en memoria: ${messageId}`);
                this.stats.totalMessages++;
                return messageRecord;
            }
        } catch (error) {
            console.error(`Error al guardar mensaje: ${error.message}`);
            this.stats.errorCount++;
            this.stats.lastError = error.message;
            
            // Si falla CosmosDB, intentar guardar en memoria
            if (this.useCosmosDb) {
                console.warn('ConversationService: Fallando a almacenamiento en memoria');
                this.useCosmosDb = false;
                
                // Reintentar en memoria
                return this.saveMessage(message, conversationId, userId);
            }
            
            throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
        }
    }

    /**
     * Actualiza la sesión de usuario en memoria
     * @param {string} userId - ID del usuario
     * @param {string} conversationId - ID de la conversación
     * @private
     */
    updateUserSession(userId, conversationId) {
        this.memoryStorage.userSessions.set(userId, {
            conversationId,
            lastActivity: new Date(),
            messageCount: (this.memoryStorage.userSessions.get(userId)?.messageCount || 0) + 1
        });
    }

    /**
     * Reconstruye el índice de mensajes en memoria
     * @private
     */
    rebuildMessageIndex() {
        this.memoryStorage.messageIndex.clear();
        
        for (const message of this.memoryStorage.messages) {
            if (!this.memoryStorage.messageIndex.has(message.conversationId)) {
                this.memoryStorage.messageIndex.set(message.conversationId, []);
            }
            this.memoryStorage.messageIndex.get(message.conversationId).push(message);
        }
        
        console.log('ConversationService: Índice de mensajes reconstruido');
    }

    /**
     * Obtiene los mensajes de una conversación con rendimiento optimizado
     * @param {string} conversationId - ID de la conversación
     * @param {number} limit - Límite de mensajes a obtener (opcional)
     * @returns {Array} - Lista de mensajes
     */
    async getConversationHistory(conversationId, limit = 50) {
        try {
            // Validar parámetros
            if (!conversationId || typeof conversationId !== 'string') {
                throw new Error('conversationId es requerido y debe ser una cadena válida');
            }

            const cleanConversationId = conversationId.trim();
            const cleanLimit = Math.max(1, Math.min(limit, 200)); // Limitar entre 1 y 200

            await this.ensureInitialized();

            if (this.useCosmosDb && this.container) {
                // Obtener de CosmosDB con consulta optimizada
                const querySpec = {
                    query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'message' ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
                    parameters: [
                        {
                            name: "@conversationId",
                            value: cleanConversationId
                        },
                        {
                            name: "@limit",
                            value: cleanLimit
                        }
                    ]
                };
                
                const { resources } = await this.container.items.query(querySpec).fetchAll();
                
                // Ordenar por timestamp ascendente para mantener orden cronológico
                const sortedMessages = resources.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                console.log(`Historial obtenido de CosmosDB: ${sortedMessages.length} mensajes`);
                return sortedMessages;
            } else {
                // Obtener de memoria usando índice optimizado
                const indexedMessages = this.memoryStorage.messageIndex.get(cleanConversationId) || [];
                const messages = indexedMessages
                    .filter(msg => msg.type === 'message')
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                    .slice(-cleanLimit); // Tomar los últimos N mensajes
                
                console.log(`Historial obtenido de memoria: ${messages.length} mensajes`);
                return messages;
            }
        } catch (error) {
            console.error(`Error al obtener historial: ${error.message}`);
            this.stats.errorCount++;
            this.stats.lastError = error.message;
            
            // Si falla CosmosDB, intentar obtener de memoria
            if (this.useCosmosDb) {
                console.warn('ConversationService: Fallando a almacenamiento en memoria para lectura');
                this.useCosmosDb = false;
                
                // Reintentar en memoria
                return this.getConversationHistory(conversationId, limit);
            }
            
            // Si todavía falla, devolver un array vacío
            console.warn('ConversationService: Devolviendo historial vacío debido a errores');
            return [];
        }
    }

    /**
     * Crea un registro de nueva conversación con validación mejorada
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Registro de conversación
     */
    async createConversation(conversationId, userId) {
        try {
            // Validar parámetros
            if (!conversationId || typeof conversationId !== 'string') {
                throw new Error('conversationId es requerido y debe ser una cadena válida');
            }
            
            if (!userId || typeof userId !== 'string') {
                throw new Error('userId es requerido y debe ser una cadena válida');
            }

            const cleanConversationId = conversationId.trim();
            const cleanUserId = userId.trim();

            await this.ensureInitialized();

            const timestamp = new Date().toISOString();
            const conversationRecord = {
                id: `conversation-${cleanConversationId}`,
                conversationId: cleanConversationId,
                userId: cleanUserId,
                startTime: timestamp,
                lastUpdateTime: timestamp,
                messageCount: 0,
                type: 'conversation',
                // Campos adicionales para mejor gestión
                isActive: true,
                tags: [], // Para futuras funcionalidades de etiquetado
                priority: 'normal'
            };
            
            if (this.useCosmosDb && this.container) {
                // Verificar si ya existe
                try {
                    const existingQuery = {
                        query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                        parameters: [{ name: "@conversationId", value: cleanConversationId }]
                    };
                    
                    const { resources } = await this.container.items.query(existingQuery).fetchAll();
                    
                    if (resources.length > 0) {
                        console.log(`Conversación ya existe en CosmosDB: ${cleanConversationId}`);
                        return resources[0];
                    }
                } catch (checkError) {
                    console.warn('Error verificando conversación existente:', checkError.message);
                }
                
                // Crear nueva conversación
                const { resource } = await this.container.items.create(conversationRecord);
                console.log(`Conversación creada en CosmosDB: ${cleanConversationId}`);
                this.stats.totalConversations++;
                return resource;
            } else {
                // Verificar si ya existe en memoria
                if (this.memoryStorage.conversations.has(cleanConversationId)) {
                    console.log(`Conversación ya existe en memoria: ${cleanConversationId}`);
                    return this.memoryStorage.conversations.get(cleanConversationId);
                }
                
                // Crear en memoria
                this.memoryStorage.conversations.set(cleanConversationId, conversationRecord);
                console.log(`Conversación creada en memoria: ${cleanConversationId}`);
                this.stats.totalConversations++;
                return conversationRecord;
            }
        } catch (error) {
            console.error(`Error al crear conversación: ${error.message}`);
            this.stats.errorCount++;
            this.stats.lastError = error.message;
            
            // Si falla CosmosDB, intentar crear en memoria
            if (this.useCosmosDb) {
                console.warn('ConversationService: Fallando a almacenamiento en memoria para creación');
                this.useCosmosDb = false;
                
                // Reintentar en memoria
                return this.createConversation(conversationId, userId);
            }
            
            throw new Error(`No se pudo crear la conversación: ${error.message}`);
        }
    }

    /**
     * Actualiza el tiempo de la última actividad con validación mejorada
     * @param {string} conversationId - ID de la conversación
     * @returns {Object} - Conversación actualizada
     */
    async updateLastActivity(conversationId) {
        try {
            // Validar parámetros
            if (!conversationId || typeof conversationId !== 'string') {
                throw new Error('conversationId es requerido y debe ser una cadena válida');
            }

            const cleanConversationId = conversationId.trim();

            await this.ensureInitialized();

            if (this.useCosmosDb && this.container) {
                // Actualizar en CosmosDB
                const querySpec = {
                    query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                    parameters: [
                        {
                            name: "@conversationId",
                            value: cleanConversationId
                        }
                    ]
                };
                
                const { resources } = await this.container.items.query(querySpec).fetchAll();
                
                if (resources.length > 0) {
                    const conversation = resources[0];
                    conversation.lastUpdateTime = new Date().toISOString();
                    conversation.messageCount = (conversation.messageCount || 0) + 1;
                    conversation.isActive = true; // Marcar como activa
                    
                    const { resource } = await this.container.item(conversation.id, conversation.conversationId)
                        .replace(conversation);
                    
                    console.log(`Actividad actualizada en CosmosDB: ${cleanConversationId}`);
                    return resource;
                }
                
                console.log(`Conversación no encontrada para actualizar: ${cleanConversationId}`);
                return null;
            } else {
                // Actualizar en memoria
                const conversation = this.memoryStorage.conversations.get(cleanConversationId);
                if (conversation) {
                    conversation.lastUpdateTime = new Date().toISOString();
                    conversation.messageCount = (conversation.messageCount || 0) + 1;
                    conversation.isActive = true;
                    this.memoryStorage.conversations.set(cleanConversationId, conversation);
                    
                    console.log(`Actividad actualizada en memoria: ${cleanConversationId}`);
                    return conversation;
                }
                
                console.log(`Conversación no encontrada en memoria: ${cleanConversationId}`);
                return null;
            }
        } catch (error) {
            console.error(`Error al actualizar actividad: ${error.message}`);
            this.stats.errorCount++;
            this.stats.lastError = error.message;
            
            // Si falla CosmosDB, intentar actualizar en memoria
            if (this.useCosmosDb) {
                console.warn('ConversationService: Fallando a almacenamiento en memoria para actualización');
                this.useCosmosDb = false;
                
                // Reintentar en memoria
                return this.updateLastActivity(conversationId);
            }
            
            return null;
        }
    }

    /**
     * Obtiene estadísticas completas del servicio
     * @returns {Object} - Estadísticas detalladas
     */
    getServiceStats() {
        const memoryUsage = process.memoryUsage();
        
        return {
            // Estado del servicio
            useCosmosDb: this.useCosmosDb,
            initializationAttempted: this.initializationAttempted,
            cosmosAvailable: cosmosDbConfig.isAvailable(),
            lastCleanup: this.stats.lastCleanup,
            
            // Estadísticas de datos
            totalMessages: this.stats.totalMessages,
            totalConversations: this.stats.totalConversations,
            errorCount: this.stats.errorCount,
            lastError: this.stats.lastError,
            
            // Estadísticas de memoria
            memoryStats: {
                conversations: this.memoryStorage.conversations.size,
                messages: this.memoryStorage.messages.length,
                messageIndex: this.memoryStorage.messageIndex.size,
                userSessions: this.memoryStorage.userSessions.size
            },
            
            // Uso de memoria del proceso
            processMemory: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
                external: Math.round(memoryUsage.external / 1024 / 1024), // MB
                rss: Math.round(memoryUsage.rss / 1024 / 1024) // MB
            },
            
            // Información de tiempo
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Limpia mensajes antiguos de la memoria (mantenimiento mejorado)
     * @param {number} daysOld - Días de antigüedad para limpiar
     * @returns {number} - Número de mensajes limpiados
     */
    cleanupOldMessages(daysOld = 7) {
        if (this.useCosmosDb) {
            console.log('ConversationService: Limpieza no necesaria con CosmosDB');
            return 0;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const originalCount = this.memoryStorage.messages.length;
        this.memoryStorage.messages = this.memoryStorage.messages.filter(
            msg => new Date(msg.timestamp) > cutoffDate
        );

        const cleanedCount = originalCount - this.memoryStorage.messages.length;
        
        if (cleanedCount > 0) {
            // Reconstruir índice después de la limpieza
            this.rebuildMessageIndex();
            console.log(`ConversationService: Limpiados ${cleanedCount} mensajes antiguos de memoria`);
        }
        
        return cleanedCount;
    }

    /**
     * Limpia sesiones inactivas de usuarios
     * @param {number} hoursInactive - Horas de inactividad para limpiar
     * @returns {number} - Número de sesiones limpiadas
     * @private
     */
    cleanupInactiveSessions(hoursInactive = 24) {
        if (this.useCosmosDb) {
            return 0; // No aplicable para CosmosDB
        }

        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - hoursInactive);

        let cleanedCount = 0;
        for (const [userId, session] of this.memoryStorage.userSessions) {
            if (session.lastActivity < cutoffTime) {
                this.memoryStorage.userSessions.delete(userId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`ConversationService: Limpiadas ${cleanedCount} sesiones inactivas`);
        }

        return cleanedCount;
    }

    /**
     * Busca conversaciones por usuario
     * @param {string} userId - ID del usuario
     * @param {number} limit - Límite de resultados
     * @returns {Array} - Lista de conversaciones del usuario
     */
    async getUserConversations(userId, limit = 10) {
        try {
            if (!userId || typeof userId !== 'string') {
                throw new Error('userId es requerido y debe ser una cadena válida');
            }

            const cleanUserId = userId.trim();
            const cleanLimit = Math.max(1, Math.min(limit, 50));

            await this.ensureInitialized();

            if (this.useCosmosDb && this.container) {
                const querySpec = {
                    query: "SELECT * FROM c WHERE c.userId = @userId AND c.type = 'conversation' ORDER BY c.lastUpdateTime DESC OFFSET 0 LIMIT @limit",
                    parameters: [
                        { name: "@userId", value: cleanUserId },
                        { name: "@limit", value: cleanLimit }
                    ]
                };
                
                const { resources } = await this.container.items.query(querySpec).fetchAll();
                return resources;
            } else {
                const conversations = Array.from(this.memoryStorage.conversations.values())
                    .filter(conv => conv.userId === cleanUserId && conv.type === 'conversation')
                    .sort((a, b) => new Date(b.lastUpdateTime) - new Date(a.lastUpdateTime))
                    .slice(0, cleanLimit);
                
                return conversations;
            }
        } catch (error) {
            console.error(`Error obteniendo conversaciones del usuario: ${error.message}`);
            return [];
        }
    }

    /**
     * Marca una conversación como inactiva
     * @param {string} conversationId - ID de la conversación
     * @returns {boolean} - Éxito de la operación
     */
    async markConversationInactive(conversationId) {
        try {
            if (!conversationId || typeof conversationId !== 'string') {
                return false;
            }

            const cleanConversationId = conversationId.trim();

            if (this.useCosmosDb && this.container) {
                const querySpec = {
                    query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                    parameters: [{ name: "@conversationId", value: cleanConversationId }]
                };
                
                const { resources } = await this.container.items.query(querySpec).fetchAll();
                
                if (resources.length > 0) {
                    const conversation = resources[0];
                    conversation.isActive = false;
                    conversation.lastUpdateTime = new Date().toISOString();
                    
                    await this.container.item(conversation.id, conversation.conversationId)
                        .replace(conversation);
                    
                    return true;
                }
            } else {
                const conversation = this.memoryStorage.conversations.get(cleanConversationId);
                if (conversation) {
                    conversation.isActive = false;
                    conversation.lastUpdateTime = new Date().toISOString();
                    this.memoryStorage.conversations.set(cleanConversationId, conversation);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error(`Error marcando conversación como inactiva: ${error.message}`);
            return false;
        }
    }

    /**
     * Reinicia las estadísticas del servicio
     */
    resetStats() {
        this.stats = {
            totalMessages: 0,
            totalConversations: 0,
            errorCount: 0,
            lastError: null,
            lastCleanup: new Date()
        };
        
        console.log('ConversationService: Estadísticas reiniciadas');
    }

    /**
     * Obtiene información de salud del servicio
     * @returns {Object} - Estado de salud
     */
    getHealthStatus() {
        const stats = this.getServiceStats();
        const isHealthy = stats.errorCount < 10 && (this.useCosmosDb || stats.memoryStats.messages < 1500);
        
        return {
            status: isHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            details: {
                database: this.useCosmosDb ? 'cosmosdb' : 'memory',
                initialized: this.initializationAttempted,
                errorRate: stats.errorCount / Math.max(stats.totalMessages, 1),
                memoryPressure: stats.processMemory.heapUsed / stats.processMemory.heapTotal,
                uptime: stats.uptime
            },
            recommendations: this.getHealthRecommendations(stats)
        };
    }

    /**
     * Obtiene recomendaciones de salud basadas en estadísticas
     * @param {Object} stats - Estadísticas del servicio
     * @returns {Array} - Lista de recomendaciones
     * @private
     */
    getHealthRecommendations(stats) {
        const recommendations = [];
        
        if (stats.errorCount > 5) {
            recommendations.push('Considerar revisar logs de errores y configuración de CosmosDB');
        }
        
        if (stats.memoryStats.messages > 1000) {
            recommendations.push('Considerar ejecutar limpieza manual de mensajes antiguos');
        }
        
        if (stats.processMemory.heapUsed > 500) {
            recommendations.push('Uso de memoria alto, considerar reinicio del servicio');
        }
        
        if (!this.useCosmosDb) {
            recommendations.push('CosmosDB no disponible, funcionando en modo memoria');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('Servicio funcionando correctamente');
        }
        
        return recommendations;
    }
}

module.exports = new ConversationService();