const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio mejorado para gestionar las conversaciones en CosmosDB o en memoria si no está disponible
 */
class ConversationService {
    constructor() {
        this.useCosmosDb = false;
        this.container = null;
        this.initializationAttempted = false;
        
        // Almacenamiento en memoria como respaldo
        this.memoryStorage = {
            conversations: new Map(),
            messages: []
        };
        
        // Intentar inicializar CosmosDB
        this.initializeCosmosDb();
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
            } else {
                console.warn('ConversationService: CosmosDB no disponible, usando almacenamiento en memoria');
            }
        } catch (error) {
            console.warn(`ConversationService: Error al inicializar CosmosDB: ${error.message}`);
            console.warn('ConversationService: Usando almacenamiento en memoria');
            this.useCosmosDb = false;
        }
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
     * Guarda un mensaje en la conversación
     * @param {string} message - Mensaje a guardar
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Mensaje guardado
     */
    async saveMessage(message, conversationId, userId) {
        // Validar parámetros
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
            
            if (this.useCosmosDb && this.container) {
                // Guardar en CosmosDB
                const { resource } = await this.container.items.create(messageRecord);
                console.log(`Mensaje guardado en CosmosDB: ${messageId}`);
                return resource;
            } else {
                // Guardar en memoria
                this.memoryStorage.messages.push(messageRecord);
                
                // Limitar mensajes en memoria para evitar uso excesivo de memoria
                if (this.memoryStorage.messages.length > 1000) {
                    this.memoryStorage.messages = this.memoryStorage.messages.slice(-500);
                    console.log('ConversationService: Mensajes en memoria limitados a 500 más recientes');
                }
                
                console.log(`Mensaje guardado en memoria: ${messageId}`);
                return messageRecord;
            }
        } catch (error) {
            console.error(`Error al guardar mensaje: ${error.message}`);
            
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
     * Obtiene los mensajes de una conversación
     * @param {string} conversationId - ID de la conversación
     * @param {number} limit - Límite de mensajes a obtener (opcional)
     * @returns {Array} - Lista de mensajes
     */
    async getConversationHistory(conversationId, limit = 50) {
        // Validar parámetros
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        await this.ensureInitialized();

        try {
            if (this.useCosmosDb && this.container) {
                // Obtener de CosmosDB
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
                const sortedMessages = resources.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                console.log(`Historial obtenido de CosmosDB: ${sortedMessages.length} mensajes`);
                return sortedMessages;
            } else {
                // Obtener de memoria
                const messages = this.memoryStorage.messages
                    .filter(msg => msg.conversationId === conversationId && msg.type === 'message')
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                    .slice(-limit); // Tomar los últimos N mensajes
                
                console.log(`Historial obtenido de memoria: ${messages.length} mensajes`);
                return messages;
            }
        } catch (error) {
            console.error(`Error al obtener historial: ${error.message}`);
            
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
     * Crea un registro de nueva conversación
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Registro de conversación
     */
    async createConversation(conversationId, userId) {
        // Validar parámetros
        if (!conversationId || !userId) {
            throw new Error('Parámetros requeridos: conversationId, userId');
        }

        await this.ensureInitialized();

        try {
            const timestamp = new Date().toISOString();
            const conversationRecord = {
                id: `conversation-${conversationId}`,
                conversationId,
                userId,
                startTime: timestamp,
                lastUpdateTime: timestamp,
                messageCount: 0,
                type: 'conversation'
            };
            
            if (this.useCosmosDb && this.container) {
                // Verificar si ya existe
                try {
                    const existingQuery = {
                        query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                        parameters: [{ name: "@conversationId", value: conversationId }]
                    };
                    
                    const { resources } = await this.container.items.query(existingQuery).fetchAll();
                    
                    if (resources.length > 0) {
                        console.log(`Conversación ya existe en CosmosDB: ${conversationId}`);
                        return resources[0];
                    }
                } catch (checkError) {
                    console.warn('Error verificando conversación existente:', checkError.message);
                }
                
                // Crear nueva conversación
                const { resource } = await this.container.items.create(conversationRecord);
                console.log(`Conversación creada en CosmosDB: ${conversationId}`);
                return resource;
            } else {
                // Verificar si ya existe en memoria
                if (this.memoryStorage.conversations.has(conversationId)) {
                    console.log(`Conversación ya existe en memoria: ${conversationId}`);
                    return this.memoryStorage.conversations.get(conversationId);
                }
                
                // Crear en memoria
                this.memoryStorage.conversations.set(conversationId, conversationRecord);
                console.log(`Conversación creada en memoria: ${conversationId}`);
                return conversationRecord;
            }
        } catch (error) {
            console.error(`Error al crear conversación: ${error.message}`);
            
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
     * Actualiza el tiempo de la última actividad
     * @param {string} conversationId - ID de la conversación
     * @returns {Object} - Conversación actualizada
     */
    async updateLastActivity(conversationId) {
        // Validar parámetros
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        await this.ensureInitialized();

        try {
            if (this.useCosmosDb && this.container) {
                // Actualizar en CosmosDB
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
                    
                    const { resource } = await this.container.item(conversation.id, conversation.conversationId)
                        .replace(conversation);
                    
                    console.log(`Actividad actualizada en CosmosDB: ${conversationId}`);
                    return resource;
                }
                
                console.log(`Conversación no encontrada para actualizar: ${conversationId}`);
                return null;
            } else {
                // Actualizar en memoria
                const conversation = this.memoryStorage.conversations.get(conversationId);
                if (conversation) {
                    conversation.lastUpdateTime = new Date().toISOString();
                    conversation.messageCount = (conversation.messageCount || 0) + 1;
                    this.memoryStorage.conversations.set(conversationId, conversation);
                    
                    console.log(`Actividad actualizada en memoria: ${conversationId}`);
                    return conversation;
                }
                
                console.log(`Conversación no encontrada en memoria: ${conversationId}`);
                return null;
            }
        } catch (error) {
            console.error(`Error al actualizar actividad: ${error.message}`);
            
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
     * Obtiene estadísticas del servicio
     * @returns {Object} - Estadísticas
     */
    getServiceStats() {
        return {
            useCosmosDb: this.useCosmosDb,
            initializationAttempted: this.initializationAttempted,
            memoryStats: {
                conversations: this.memoryStorage.conversations.size,
                messages: this.memoryStorage.messages.length
            },
            cosmosAvailable: cosmosDbConfig.isAvailable()
        };
    }

    /**
     * Limpia mensajes antiguos de la memoria (mantenimiento)
     * @param {number} daysOld - Días de antigüedad para limpiar
     */
    cleanupOldMessages(daysOld = 7) {
        if (this.useCosmosDb) {
            console.log('ConversationService: Limpieza no necesaria con CosmosDB');
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const originalCount = this.memoryStorage.messages.length;
        this.memoryStorage.messages = this.memoryStorage.messages.filter(
            msg => new Date(msg.timestamp) > cutoffDate
        );

        const cleanedCount = originalCount - this.memoryStorage.messages.length;
        if (cleanedCount > 0) {
            console.log(`ConversationService: Limpiados ${cleanedCount} mensajes antiguos de memoria`);
        }
    }
}

module.exports = new ConversationService();