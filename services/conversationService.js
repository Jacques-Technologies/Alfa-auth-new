const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio para gestionar las conversaciones en CosmosDB
 */
class ConversationService {
    constructor() {
        this.container = cosmosDbConfig.getConversationContainer();
    }

    /**
     * Guarda un mensaje en la conversación
     * @param {Object} message - Mensaje a guardar
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
            
            const { resource } = await this.container.items.create(messageRecord);
            return resource;
        } catch (error) {
            console.error(`Error al guardar mensaje: ${error.message}`);
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
        } catch (error) {
            console.error(`Error al obtener historial: ${error.message}`);
            throw error;
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
            
            const { resource } = await this.container.items.create(conversationRecord);
            return resource;
        } catch (error) {
            console.error(`Error al crear conversación: ${error.message}`);
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
                
                const { resource } = await this.container.item(conversation.id, conversation.conversationId)
                    .replace(conversation);
                
                return resource;
            }
            
            return null;
        } catch (error) {
            console.error(`Error al actualizar actividad: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new ConversationService();