// conversationService.js - Servicio optimizado con fallbacks seguros

const cosmosDbConfig = require('../config/cosmosConfigs');

/**
 * Servicio de conversaciones con fallback a memoria si CosmosDB falla
 */
class ConversationService {
    constructor() {
        this.container = null;
        this.initialized = false;
        
        // Fallback en memoria
        this.memoryStorage = {
            conversations: new Map(),
            messages: new Map()
        };
        
        // Control de inicialización
        this.initializationPromise = this.initialize();
        
        // Limpiar memoria cada hora
        setInterval(() => this.cleanupMemory(), 60 * 60 * 1000);
    }

    /**
     * Inicializa CosmosDB con manejo de errores
     */
    async initialize() {
        try {
            await cosmosDbConfig.initializationPromise;
            
            if (cosmosDbConfig.isAvailable()) {
                this.container = cosmosDbConfig.getConversationContainer();
                this.initialized = true;
                console.log('ConversationService: CosmosDB inicializado correctamente');
            } else {
                throw new Error('CosmosDB no disponible');
            }
            
        } catch (error) {
            console.warn('ConversationService: Error inicializando CosmosDB, usando memoria:', error.message);
            this.initialized = false;
            // Continuar con fallback en memoria
        }
    }

    /**
     * Asegura que el servicio esté inicializado
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initializationPromise;
        }
    }

    /**
     * Guarda un mensaje (CosmosDB con fallback a memoria)
     */
    async saveMessage(message, conversationId, userId) {
        if (!message || !conversationId || !userId) {
            throw new Error('Parámetros requeridos: message, conversationId, userId');
        }

        const messageData = {
            id: `${conversationId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            conversationId,
            userId,
            message: message.substring(0, 4000), // Limitar longitud
            timestamp: new Date().toISOString(),
            type: 'message'
        };

        try {
            await this.ensureInitialized();
            
            if (this.initialized && this.container) {
                // Intentar guardar en CosmosDB
                const { resource } = await this.container.items.create(messageData);
                console.log(`Mensaje guardado en CosmosDB: ${messageData.id}`);
                return resource;
            } else {
                // Usar fallback en memoria
                return this.saveMessageToMemory(messageData);
            }
            
        } catch (error) {
            console.warn(`Error guardando en CosmosDB, usando memoria: ${error.message}`);
            return this.saveMessageToMemory(messageData);
        }
    }

    /**
     * Guarda mensaje en memoria como fallback
     */
    saveMessageToMemory(messageData) {
        const conversationMessages = this.memoryStorage.messages.get(messageData.conversationId) || [];
        conversationMessages.push(messageData);
        
        // Mantener solo los últimos 50 mensajes por conversación
        if (conversationMessages.length > 50) {
            conversationMessages.splice(0, conversationMessages.length - 50);
        }
        
        this.memoryStorage.messages.set(messageData.conversationId, conversationMessages);
        console.log(`Mensaje guardado en memoria: ${messageData.id}`);
        return messageData;
    }

    /**
     * Obtiene historial de conversación
     */
    async getConversationHistory(conversationId, limit = 50) {
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        try {
            await this.ensureInitialized();
            
            if (this.initialized && this.container) {
                // Intentar obtener de CosmosDB
                return await this.getHistoryFromCosmos(conversationId, limit);
            } else {
                // Usar fallback en memoria
                return this.getHistoryFromMemory(conversationId, limit);
            }
            
        } catch (error) {
            console.warn(`Error obteniendo historial de CosmosDB, usando memoria: ${error.message}`);
            return this.getHistoryFromMemory(conversationId, limit);
        }
    }

    /**
     * Obtiene historial de CosmosDB
     */
    async getHistoryFromCosmos(conversationId, limit) {
        const querySpec = {
            query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'message' ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
            parameters: [
                { name: "@conversationId", value: conversationId },
                { name: "@limit", value: limit }
            ]
        };
        
        const { resources } = await this.container.items.query(querySpec).fetchAll();
        
        // Ordenar cronológicamente
        return resources.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    /**
     * Obtiene historial de memoria
     */
    getHistoryFromMemory(conversationId, limit) {
        const messages = this.memoryStorage.messages.get(conversationId) || [];
        
        // Retornar últimos mensajes hasta el límite
        return messages.slice(-limit);
    }

    /**
     * Crea una conversación
     */
    async createConversation(conversationId, userId) {
        if (!conversationId || !userId) {
            throw new Error('Parámetros requeridos: conversationId, userId');
        }

        const conversationData = {
            id: `conversation-${conversationId}`,
            conversationId,
            userId,
            startTime: new Date().toISOString(),
            lastUpdateTime: new Date().toISOString(),
            messageCount: 0,
            type: 'conversation'
        };

        try {
            await this.ensureInitialized();
            
            if (this.initialized && this.container) {
                // Verificar si ya existe
                const existing = await this.checkExistingConversation(conversationId);
                if (existing) {
                    return existing;
                }
                
                // Crear nueva
                const { resource } = await this.container.items.create(conversationData);
                console.log(`Conversación creada en CosmosDB: ${conversationId}`);
                return resource;
            } else {
                // Usar memoria
                return this.createConversationInMemory(conversationData);
            }
            
        } catch (error) {
            if (error.code === 409) {
                // Ya existe, obtener existente
                return await this.getExistingConversation(conversationId);
            }
            
            console.warn(`Error creando conversación en CosmosDB, usando memoria: ${error.message}`);
            return this.createConversationInMemory(conversationData);
        }
    }

    /**
     * Verifica conversación existente en CosmosDB
     */
    async checkExistingConversation(conversationId) {
        try {
            const querySpec = {
                query: "SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type = 'conversation'",
                parameters: [{ name: "@conversationId", value: conversationId }]
            };
            
            const { resources } = await this.container.items.query(querySpec).fetchAll();
            return resources.length > 0 ? resources[0] : null;
            
        } catch (error) {
            console.warn('Error verificando conversación existente:', error.message);
            return null;
        }
    }

    /**
     * Crea conversación en memoria
     */
    createConversationInMemory(conversationData) {
        this.memoryStorage.conversations.set(conversationData.conversationId, conversationData);
        console.log(`Conversación creada en memoria: ${conversationData.conversationId}`);
        return conversationData;
    }

    /**
     * Actualiza última actividad
     */
    async updateLastActivity(conversationId) {
        if (!conversationId) {
            throw new Error('conversationId es requerido');
        }

        try {
            await this.ensureInitialized();
            
            if (this.initialized && this.container) {
                return await this.updateActivityInCosmos(conversationId);
            } else {
                return this.updateActivityInMemory(conversationId);
            }
            
        } catch (error) {
            console.warn(`Error actualizando actividad en CosmosDB, usando memoria: ${error.message}`);
            return this.updateActivityInMemory(conversationId);
        }
    }

    /**
     * Actualiza actividad en CosmosDB
     */
    async updateActivityInCosmos(conversationId) {
        const existing = await this.checkExistingConversation(conversationId);
        
        if (existing) {
            existing.lastUpdateTime = new Date().toISOString();
            existing.messageCount = (existing.messageCount || 0) + 1;
            
            try {
                const { resource } = await this.container.item(existing.id, conversationId).replace(existing);
                return resource;
            } catch (error) {
                console.warn('Error actualizando conversación, creando nueva:', error.message);
                return await this.createConversation(conversationId, 'unknown');
            }
        } else {
            return await this.createConversation(conversationId, 'unknown');
        }
    }

    /**
     * Actualiza actividad en memoria
     */
    updateActivityInMemory(conversationId) {
        let conversation = this.memoryStorage.conversations.get(conversationId);
        
        if (!conversation) {
            conversation = {
                id: `conversation-${conversationId}`,
                conversationId,
                userId: 'unknown',
                startTime: new Date().toISOString(),
                lastUpdateTime: new Date().toISOString(),
                messageCount: 1,
                type: 'conversation'
            };
        } else {
            conversation.lastUpdateTime = new Date().toISOString();
            conversation.messageCount = (conversation.messageCount || 0) + 1;
        }
        
        this.memoryStorage.conversations.set(conversationId, conversation);
        return conversation;
    }

    /**
     * Limpia memoria para evitar memory leaks
     */
    cleanupMemory() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 horas
        let cleanedMessages = 0;
        let cleanedConversations = 0;

        // Limpiar mensajes antiguos
        for (const [conversationId, messages] of this.memoryStorage.messages.entries()) {
            const filteredMessages = messages.filter(msg => {
                const messageAge = now - new Date(msg.timestamp).getTime();
                return messageAge < maxAge;
            });
            
            cleanedMessages += messages.length - filteredMessages.length;
            
            if (filteredMessages.length === 0) {
                this.memoryStorage.messages.delete(conversationId);
            } else {
                this.memoryStorage.messages.set(conversationId, filteredMessages);
            }
        }

        // Limpiar conversaciones antiguas
        for (const [conversationId, conversation] of this.memoryStorage.conversations.entries()) {
            const conversationAge = now - new Date(conversation.lastUpdateTime).getTime();
            if (conversationAge > maxAge) {
                this.memoryStorage.conversations.delete(conversationId);
                cleanedConversations++;
            }
        }

        if (cleanedMessages > 0 || cleanedConversations > 0) {
            console.log(`ConversationService: Limpieza memoria - ${cleanedMessages} mensajes, ${cleanedConversations} conversaciones`);
        }
    }

    /**
     * Obtiene estadísticas del servicio
     */
    getStats() {
        return {
            initialized: this.initialized,
            cosmosAvailable: !!(this.container),
            memoryConversations: this.memoryStorage.conversations.size,
            memoryMessages: Array.from(this.memoryStorage.messages.values())
                .reduce((total, messages) => total + messages.length, 0),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Fuerza reinicialización
     */
    async forceReinitialize() {
        console.warn('ConversationService: Forzando reinicialización');
        this.initialized = false;
        this.container = null;
        this.initializationPromise = this.initialize();
        await this.initializationPromise;
    }

    /**
     * Limpia completamente la memoria (para debugging)
     */
    clearMemory() {
        const stats = this.getStats();
        this.memoryStorage.conversations.clear();
        this.memoryStorage.messages.clear();
        console.log('ConversationService: Memoria limpiada completamente');
        return stats;
    }
}

module.exports = new ConversationService();