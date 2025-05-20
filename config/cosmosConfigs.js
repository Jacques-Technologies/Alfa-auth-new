const { CosmosClient } = require('@azure/cosmos');
require('dotenv').config();

/**
 * Configuración para la conexión a CosmosDB
 */
class CosmosDbConfig {
    constructor() {
        // Valores de configuración desde variables de entorno
        this.endpoint = process.env.COSMOSDB_ENDPOINT;
        this.key = process.env.COSMOSDB_KEY;
        this.databaseId = process.env.COSMOSDB_DATABASE_ID;
        this.containerId = process.env.COSMOSDB_CONVERSATIONS_CONTAINER;
        
        // Cliente de Cosmos
        this.client = new CosmosClient({ 
            endpoint: this.endpoint, 
            key: this.key 
        });
        
        // Inicialización de recursos de Cosmos
        this.init();
    }

    /**
     * Inicializa los recursos de CosmosDB (base de datos y contenedor)
     */
    async init() {
        try {
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
        } catch (error) {
            console.error(`Error al inicializar CosmosDB: ${error.message}`);
            throw error;
        }
    }

    /**
     * Obtiene el contenedor para las conversaciones
     * @returns {Object} Contenedor de CosmosDB
     */
    getConversationContainer() {
        return this.container;
    }
}

// Exportar una instancia única
const cosmosDbConfig = new CosmosDbConfig();
module.exports = cosmosDbConfig;