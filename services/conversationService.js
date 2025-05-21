const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio para gestionar las conversaciones en CosmosDB o en memoria si no está disponible
 */
class ConversationService {
    constructor() {
        // Intentar obtener el contenedor de CosmosDB, si está disponible
        try {
            this.container = cosmosDbConfig.getConversationContainer();
            this.useCosmosDb = true;
            console.log('ConversationService inicializado con almacenamiento en CosmosDB');
        } catch (error) {
            console.warn(`No se pudo inicializar CosmosDB: ${error.message}`);
            console.warn('Usando almacenamiento en memoria como respaldo');
            
            // Almacenamiento en memoria como respaldo
            this.useCosmosDb = false;
            this.memoryStorage = {
                conversations: new Map(),
                messages: []
            };
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
        try {
            const timestamp = new Date().toISOString();
            const messageRecord = {
                id: `${conversationId}-${timestamp}`,
                conversationId,
                userId,
                message,
                timestamp,
                type: 'message'
            };
            
            if (this.useCosmosDb && this.container) {
                // Guardar en CosmosDB
                const { resource } = await this.container.items.create(messageRecord);
                return resource;
            } else {
                // Guardar en memoria
                this.memoryStorage.messages.push(messageRecord);
                return messageRecord;
            }
        } catch (error) {
            console.error(`Error al guardar mensaje: ${error.message}`);
            
            // Si falla CosmosDB, intentar guardar en memoria
            if (this.useCosmosDb) {
                console.warn('Cambiando a almacenamiento en memoria');
                this.useCosmosDb = false;
                this.memoryStorage = this.memoryStorage || {
                    conversations: new Map(),
                    messages: []
                };
                
                // Reintentar en memoria
                return this.saveMessage(message, conversationId, userId);
            }
            
            throw error;
        }
    }

    /**
     * Obtiene los mensajes de una conversación
     * @param {string} conversationId - ID de la conversación
     * @returns {Array} - Lista de mensajes
     */
    async getConversationHistory(conversationId) {
        try {
            if (this.useCosmosDb && this.container) {
                // Obtener de CosmosDB
                const querySpec = {
                    query: "SELECT * FROM c WHERE c.conversationId = @conversationId ORDER BY c.timestamp",
                    parameters: [
                        {
                            name: "@conversationId",
                            value: conversationId
                        }
                    ]
                };
                
                const { resources } = await this.container.items.query(querySpec).fetchAll();
                return resources;
            } else {
                // Obtener de memoria
                return this.memoryStorage.messages
                    .filter(msg => msg.conversationId === conversationId)
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            }
        } catch (error) {
            console.error(`Error al obtener historial: ${error.message}`);
            
            // Si falla CosmosDB, intentar obtener de memoria
            if (this.useCosmosDb) {
                console.warn('Cambiando a almacenamiento en memoria');
                this.useCosmosDb = false;
                this.memoryStorage = this.memoryStorage || {
                    conversations: new Map(),
                    messages: []
                };
                
                // Reintentar en memoria
                return this.getConversationHistory(conversationId);
            }
            
            // Si todavía falla, devolver un array vacío
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
        try {
            const timestamp = new Date().toISOString();
            const conversationRecord = {
                id: conversationId,
                conversationId,
                userId,
                startTime: timestamp,
                lastUpdateTime: timestamp,
                type: 'conversation'
            };
            
            if (this.useCosmosDb && this.container) {
                // Crear en CosmosDB
                const { resource } = await this.container.items.create(conversationRecord);
                return resource;
            } else {
                // Crear en memoria
                this.memoryStorage.conversations.set(conversationId, conversationRecord);
                return conversationRecord;
            }
        } catch (error) {
            console.error(`Error al crear conversación: ${error.message}`);
            
            // Si falla CosmosDB, intentar crear en memoria
            if (this.useCosmosDb) {
                console.warn('Cambiando a almacenamiento en memoria');
                this.useCosmosDb = false;
                this.memoryStorage = this.memoryStorage || {
                    conversations: new Map(),
                    messages: []
                };
                
                // Reintentar en memoria
                return this.createConversation(conversationId, userId);
            }
            
            throw error;
        }
    }

    /**
     * Actualiza el tiempo de la última actividad
     * @param {string} conversationId - ID de la conversación
     * @returns {Object} - Conversación actualizada
     */
    async updateLastActivity(conversationId) {
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
                    
                    const { resource } = await this.container.item(conversation.id, conversation.conversationId)
                        .replace(conversation);
                    
                    return resource;
                }
                
                return null;
            } else {
                // Actualizar en memoria
                const conversation = this.memoryStorage.conversations.get(conversationId);
                if (conversation) {
                    conversation.lastUpdateTime = new Date().toISOString();
                    this.memoryStorage.conversations.set(conversationId, conversation);
                    return conversation;
                }
                
                return null;
            }
        } catch (error) {
            console.error(`Error al actualizar actividad: ${error.message}`);
            
            // Si falla CosmosDB, intentar actualizar en memoria
            if (this.useCosmosDb) {
                console.warn('Cambiando a almacenamiento en memoria');
                this.useCosmosDb = false;
                this.memoryStorage = this.memoryStorage || {
                    conversations: new Map(),
                    messages: []
                };
                
                // Reintentar en memoria
                return this.updateLastActivity(conversationId);
            }
            
            return null;
        }
    }
}

module.exports = new ConversationService();