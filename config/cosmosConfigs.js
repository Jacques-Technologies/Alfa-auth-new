const { CosmosClient } = require('@azure/cosmos');
require('dotenv').config();

/**
 * Configuración para la conexión a CosmosDB con manejo de errores
 */
class CosmosDbConfig {
    constructor() {
        this.initialized = false;
        this.container = null;
        
        // Intentar inicializar, pero no bloquear si falla
        this.initializationPromise = this.init().catch(error => {
            console.error(`Error al inicializar CosmosDB: ${error.message}`);
            this.initialized = false;
        });
    }

    /**
     * Inicializa los recursos de CosmosDB (base de datos y contenedor)
     */
    async init() {
        try {
            // Verificar si la configuración está disponible
            this.endpoint = process.env.COSMOSDB_ENDPOINT;
            this.key = process.env.COSMOSDB_KEY;
            this.databaseId = process.env.COSMOSDB_DATABASE_ID;
            this.containerId = process.env.COSMOSDB_CONVERSATIONS_CONTAINER;
            
            // Si falta alguna configuración, registrar el error y salir
            if (!this.endpoint || !this.key || !this.databaseId || !this.containerId) {
                console.warn('Falta configuración de CosmosDB. Algunas funciones pueden no estar disponibles.');
                this.initialized = false;
                return;
            }
            
            // Cliente de Cosmos
            this.client = new CosmosClient({ 
                endpoint: this.endpoint, 
                key: this.key 
            });
            
            // Crear base de datos si no existe
            const { database } = await this.client.databases.createIfNotExists({
                id: this.databaseId
            });
            console.log(`Base de datos ${this.databaseId} configurada exitosamente`);

            // Crear contenedor si no existe
            const { container } = await database.containers.createIfNotExists({
                id: this.containerId,
                partitionKey: { paths: ["/conversationId"] }
            });
            console.log(`Contenedor ${this.containerId} configurado exitosamente`);

            this.container = container;
            this.initialized = true;
        } catch (error) {
            console.error(`Error al inicializar CosmosDB: ${error.message}`);
            this.initialized = false;
            
            // Re-lanzar el error para que se pueda manejar externamente
            throw error;
        }
    }

    /**
     * Obtiene el contenedor para las conversaciones de manera segura
     * @returns {Object|null} Contenedor de CosmosDB o null si no está disponible
     */
    getConversationContainer() {
        if (!this.initialized || !this.container) {
            console.warn('Contenedor de CosmosDB no inicializado');
            throw new Error('Contenedor de CosmosDB no disponible');
        }
        return this.container;
    }
    
    /**
     * Verifica si el servicio de CosmosDB está disponible
     * @returns {boolean} Estado de disponibilidad
     */
    isAvailable() {
        return this.initialized && this.container !== null;
    }
}

// Exportar una instancia única
const cosmosDbConfig = new CosmosDbConfig();
module.exports = cosmosDbConfig;