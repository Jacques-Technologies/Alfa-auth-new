const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio simplificado para gestionar las conversaciones en CosmosDB
 * Siempre usa CosmosDB, sin fallback a memoria
 */
class ConversationService {
    constructor() {
        this.container = null;
        this.initializationAttempted = false;
        this.conversationCache = new Map();
        
        // Inicializar CosmosDB
        this.initializeCosmosDb();
    }

    /**
     * Inicializa CosmosDB
     * @private
     */
    async initializeCosmosDb() {
        if (this.initializationAttempted) {
            return;
        }
        
        this.initializationAttempted = true;
        
        try {
            await cosmosDbConfig.initializationPromise;
            
            if (!cosmosDbConfig.isAvailable()) {
                throw new Error('CosmosDB no está disponible');
            }
            
            this.container = cosmosDbConfig.getConversationContainer();
        } catch (error) {
            console.error(`ConversationService: Error al inicializar CosmosDB: ${error.message}`);
            throw error;
        }
    }

    /**
     * Asegura que CosmosDB esté inicializado
     * @private
     */
    async ensureInitialized() {
        if (!this.container) {
            await this.initializeCosmosDb();
        }
    }

    /**
     * Guarda un mensaje en la conversación
     * @param {string} message - Mensaje a guardar
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Mensaje guardado
     */
    async saveMessage(message, conversationId, userId) {
        if (!message || !conversationId || !userId) {
            throw new Error('Parámetros requeridos: message, conversationId, userId');
        }

        await this.ensureInitialized();

        try {
            const timestamp = new Date().toISOString();
            const messageId = `${conversationId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            const messageRecord = {
                id: messageId,
                conversationId,
                userId,
                message: message.substring(0, 4000), // Limitar longitud del mensaje
                timestamp,
                type: 'message'
            };
            
            const { resource } = await this.container.items.create(messageRecord);
            return resource;
        } catch (error) {
            console.error(`Error al guardar mensaje: ${error.message}`);
            throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
        }
    }

    /**
     * Obtiene los mensajes de una conversación
     * @param {string} conversationId - ID de la conversación
     * @param {number} limit - Límite de mensajes a obtener (opcional)
     * @returns {Array} - Lista de mensajes
     */
    async getConversationHistory(conversationId, limit = 50) {
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        await this.ensureInitialized();

        try {
            const querySpec = {
                query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'message' ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
                parameters: [
                    {
                        name: "@conversationId",
                        value: conversationId
                    },
                    {
                        name: "@limit",
                        value: limit
                    }
                ]
            };
            
            const { resources } = await this.container.items.query(querySpec).fetchAll();
            
            // Ordenar por timestamp ascendente para mantener orden cronológico
            return resources.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        } catch (error) {
            console.error(`Error al obtener historial: ${error.message}`);
            throw new Error(`No se pudo obtener el historial: ${error.message}`);
        }
    }

    /**
     * Crea un registro de nueva conversación
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Registro de conversación
     */
    async createConversation(conversationId, userId) {
        if (!conversationId || !userId) {
            throw new Error('Parámetros requeridos: conversationId, userId');
        }

        await this.ensureInitialized();

        try {
            // Verificar cache primero
            if (this.conversationCache.has(conversationId)) {
                return this.conversationCache.get(conversationId);
            }
            
            const timestamp = new Date().toISOString();
            const conversationRecordId = `conversation-${conversationId}`;
            
            const conversationRecord = {
                id: conversationRecordId,
                conversationId,
                userId,
                startTime: timestamp,
                lastUpdateTime: timestamp,
                messageCount: 0,
                type: 'conversation'
            };
            
            // Verificar si ya existe en CosmosDB
            try {
                const existingQuery = {
                    query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                    parameters: [{ name: "@conversationId", value: conversationId }]
                };
                
                const { resources } = await this.container.items.query(existingQuery).fetchAll();
                
                if (resources.length > 0) {
                    this.conversationCache.set(conversationId, resources[0]);
                    return resources[0];
                }
            } catch (checkError) {
                console.warn('Error verificando conversación existente:', checkError.message);
            }
            
            // Crear nueva conversación
            try {
                const { resource } = await this.container.items.create(conversationRecord);
                this.conversationCache.set(conversationId, resource);
                return resource;
            } catch (createError) {
                if (createError.code === 409) {
                    // Conflicto - la conversación ya existe
                    this.conversationCache.set(conversationId, conversationRecord);
                    return conversationRecord;
                }
                throw createError;
            }
        } catch (error) {
            console.error(`Error al crear conversación: ${error.message}`);
            throw new Error(`No se pudo crear la conversación: ${error.message}`);
        }
    }

    /**
     * Actualiza el tiempo de la última actividad
     * @param {string} conversationId - ID de la conversación
     * @returns {Object} - Conversación actualizada
     */
    async updateLastActivity(conversationId) {
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        await this.ensureInitialized();

        try {
            // Buscar la conversación
            const querySpec = {
                query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                parameters: [
                    {
                        name: "@conversationId",
                        value: conversationId
                    }
                ]
            };
            
            const { resources } = await this.container.items.query(querySpec).fetchAll();
            
            if (resources.length > 0) {
                const conversation = resources[0];
                conversation.lastUpdateTime = new Date().toISOString();
                conversation.messageCount = (conversation.messageCount || 0) + 1;
                
                try {
                    const { resource } = await this.container.item(conversation.id, conversation.conversationId)
                        .replace(conversation);
                    
                    this.conversationCache.set(conversationId, resource);
                    return resource;
                } catch (replaceError) {
                    if (replaceError.code === 404) {
                        console.warn(`Conversación no encontrada para actualizar: ${conversationId}, creando nueva`);
                        return await this.createConversation(conversationId, 'unknown');
                    }
                    throw replaceError;
                }
            } else {
                console.warn(`Conversación no encontrada para actualizar: ${conversationId}, creando nueva`);
                return await this.createConversation(conversationId, 'unknown');
            }
        } catch (error) {
            console.error(`Error al actualizar actividad: ${error.message}`);
            
            // Como último recurso, crear una conversación básica
            try {
                return await this.createConversation(conversationId, 'unknown');
            } catch (createError) {
                console.error(`Error crítico: no se pudo crear conversación de respaldo: ${createError.message}`);
                throw new Error(`No se pudo actualizar ni crear conversación: ${error.message}`);
            }
        }
    }

    /**
     * Limpia mensajes antiguos de CosmosDB
     * @param {number} daysOld - Días de antigüedad para limpiar
     * @returns {number} - Número de mensajes eliminados
     */
    async cleanupOldMessages(daysOld = 7) {
        await this.ensureInitialized();

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const cutoffISO = cutoffDate.toISOString();

            // Buscar mensajes antiguos
            const querySpec = {
                query: "SELECT * FROM c WHERE c.type = 'message' AND c.timestamp < @cutoffDate",
                parameters: [
                    {
                        name: "@cutoffDate",
                        value: cutoffISO
                    }
                ]
            };

            const { resources } = await this.container.items.query(querySpec).fetchAll();
            
            let deletedCount = 0;
            
            // Eliminar mensajes en lotes
            for (const message of resources) {
                try {
                    await this.container.item(message.id, message.conversationId).delete();
                    deletedCount++;
                } catch (deleteError) {
                    console.warn(`Error eliminando mensaje ${message.id}: ${deleteError.message}`);
                }
            }

            if (deletedCount > 0) {
                console.warn(`ConversationService: Limpiados ${deletedCount} mensajes antiguos de CosmosDB`);
            }

            return deletedCount;
        } catch (error) {
            console.error(`Error en limpieza de mensajes: ${error.message}`);
            throw error;
        }
    }

    /**
     * Limpia el cache de conversaciones
     * @returns {number} - Número de entradas limpiadas
     */
    clearConversationCache() {
        const count = this.conversationCache.size;
        this.conversationCache.clear();
        if (count > 0) {
            console.warn(`ConversationService: Cache de conversaciones limpiado (${count} entradas)`);
        }
        return count;
    }

    /**
     * Fuerza la reinicialización del servicio
     */
    async forceReinitialize() {
        console.warn('ConversationService: Forzando reinicialización');
        this.initializationAttempted = false;
        this.container = null;
        this.conversationCache.clear();
        
        await this.initializeCosmosDb();
    }
}

module.exports = new ConversationService();