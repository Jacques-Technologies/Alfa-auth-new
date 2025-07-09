// cosmosConfigs.js - Configuración optimizada y resiliente para CosmosDB

const { CosmosClient } = require('@azure/cosmos');
require('dotenv').config();

/**
 * Configuración resiliente para CosmosDB con reintentos y manejo de errores
 */
class CosmosDbConfig {
    constructor() {
        this.initialized = false;
        this.container = null;
        this.client = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 segundos
        
        // Configuración
        this.endpoint = process.env.COSMOSDB_ENDPOINT;
        this.key = process.env.COSMOSDB_KEY;
        this.databaseId = process.env.COSMOSDB_DATABASE_ID || 'alfabot';
        this.containerId = process.env.COSMOSDB_CONVERSATIONS_CONTAINER || 'conversations';
        
        // Promesa de inicialización
        this.initializationPromise = this.initializeWithRetry();
    }

    /**
     * Inicializa CosmosDB con reintentos automáticos
     */
    async initializeWithRetry() {
        while (this.retryCount < this.maxRetries && !this.initialized) {
            try {
                await this.attemptInitialization();
                this.initialized = true;
                console.log('CosmosDB inicializado correctamente');
                return;
                
            } catch (error) {
                this.retryCount++;
                console.error(`CosmosDB intento ${this.retryCount}/${this.maxRetries} falló:`, error.message);
                
                if (this.retryCount < this.maxRetries) {
                    console.log(`Reintentando en ${this.retryDelay/1000} segundos...`);
                    await this.delay(this.retryDelay);
                } else {
                    console.error('CosmosDB no pudo inicializarse después de todos los reintentos');
                    this.initialized = false;
                }
            }
        }
    }

    /**
     * Intenta una inicialización individual
     */
    async attemptInitialization() {
        // Verificar configuración
        if (!this.endpoint || !this.key) {
            throw new Error('Configuración CosmosDB incompleta (ENDPOINT o KEY faltante)');
        }

        // Crear cliente
        this.client = new CosmosClient({
            endpoint: this.endpoint,
            key: this.key,
            connectionPolicy: {
                requestTimeout: 30000, // 30 segundos
                retryOptions: {
                    maxRetryAttemptCount: 3,
                    fixedRetryIntervalInMilliseconds: 1000,
                    maxWaitTimeInSeconds: 30
                }
            }
        });

        // Verificar conectividad
        await this.testConnection();

        // Crear/verificar base de datos
        const { database } = await this.client.databases.createIfNotExists({
            id: this.databaseId,
            throughput: 400 // RU/s mínimo para shared throughput
        });

        console.log(`Base de datos '${this.databaseId}' verificada`);

        // Crear/verificar contenedor
        const { container } = await database.containers.createIfNotExists({
            id: this.containerId,
            partitionKey: { 
                paths: ["/conversationId"],
                kind: "Hash"
            },
            indexingPolicy: {
                indexingMode: "consistent",
                automatic: true,
                includedPaths: [
                    { path: "/*" }
                ],
                excludedPaths: [
                    { path: "/message/*" },
                    { path: "/_etag/?" }
                ]
            }
        });

        console.log(`Contenedor '${this.containerId}' verificado`);

        this.container = container;
    }

    /**
     * Prueba la conexión a CosmosDB
     */
    async testConnection() {
        try {
            // Intenta obtener las bases de datos para verificar conectividad
            const { resources } = await this.client.databases.readAll().fetchAll();
            console.log(`CosmosDB conectado - ${resources.length} base(s) de datos encontrada(s)`);
        } catch (error) {
            throw new Error(`Error de conectividad CosmosDB: ${error.message}`);
        }
    }

    /**
     * Obtiene el contenedor de conversaciones
     */
    getConversationContainer() {
        if (!this.initialized || !this.container) {
            throw new Error('CosmosDB no está inicializado');
        }
        return this.container;
    }

    /**
     * Verifica si CosmosDB está disponible
     */
    isAvailable() {
        return this.initialized && this.container !== null;
    }

    /**
     * Obtiene estadísticas de la configuración
     */
    getStats() {
        return {
            initialized: this.initialized,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            hasContainer: !!this.container,
            hasClient: !!this.client,
            endpoint: this.endpoint ? 'configurado' : 'faltante',
            key: this.key ? 'configurado' : 'faltante',
            databaseId: this.databaseId,
            containerId: this.containerId,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Prueba la salud del servicio
     */
    async healthCheck() {
        try {
            if (!this.isAvailable()) {
                return {
                    status: 'unhealthy',
                    error: 'CosmosDB no inicializado',
                    timestamp: new Date().toISOString()
                };
            }

            // Intentar una operación simple
            await this.container.items.readAll({ maxItemCount: 1 }).fetchNext();
            
            return {
                status: 'healthy',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Intenta reconectarse a CosmosDB
     */
    async reconnect() {
        console.log('CosmosDB: Intentando reconexión...');
        
        this.initialized = false;
        this.container = null;
        this.client = null;
        this.retryCount = 0;
        
        this.initializationPromise = this.initializeWithRetry();
        await this.initializationPromise;
        
        return this.isAvailable();
    }

    /**
     * Limpia los recursos de CosmosDB
     */
    async cleanup() {
        try {
            if (this.client) {
                await this.client.dispose();
                console.log('Cliente CosmosDB limpiado');
            }
        } catch (error) {
            console.error('Error limpiando CosmosDB:', error.message);
        } finally {
            this.initialized = false;
            this.container = null;
            this.client = null;
        }
    }

    /**
     * Delay helper para reintentos
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtiene información de configuración (sin datos sensibles)
     */
    getConfigInfo() {
        return {
            databaseId: this.databaseId,
            containerId: this.containerId,
            endpointConfigured: !!this.endpoint,
            keyConfigured: !!this.key,
            maxRetries: this.maxRetries,
            retryDelay: this.retryDelay
        };
    }

    /**
     * Verifica que la configuración sea válida
     */
    validateConfig() {
        const errors = [];
        
        if (!this.endpoint) {
            errors.push('COSMOSDB_ENDPOINT no configurado');
        }
        
        if (!this.key) {
            errors.push('COSMOSDB_KEY no configurado');
        }
        
        if (!this.databaseId) {
            errors.push('COSMOSDB_DATABASE_ID no configurado');
        }
        
        if (!this.containerId) {
            errors.push('COSMOSDB_CONVERSATIONS_CONTAINER no configurado');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Ejecuta operaciones con reintentos automáticos
     */
    async executeWithRetry(operation, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                console.warn(`CosmosDB operación falló (intento ${attempt}/${maxRetries}):`, error.message);
                
                if (attempt < maxRetries) {
                    await this.delay(1000 * attempt); // Backoff exponencial
                }
            }
        }
        
        throw lastError;
    }
}

// Crear instancia única
const cosmosDbConfig = new CosmosDbConfig();

// Manejo graceful de shutdown
process.on('SIGINT', async () => {
    console.log('Cerrando conexión CosmosDB...');
    await cosmosDbConfig.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Cerrando conexión CosmosDB...');
    await cosmosDbConfig.cleanup();
    process.exit(0);
});

module.exports = cosmosDbConfig;