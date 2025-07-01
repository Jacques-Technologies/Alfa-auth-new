const { CosmosClient } = require('@azure/cosmos');
require('dotenv').config();

/**
 * Configuración completa y optimizada para la conexión a CosmosDB con manejo avanzado de errores,
 * reconexión automática y monitoreo de rendimiento para el bot de vacaciones.
 */
class CosmosDbConfig {
    constructor() {
        this.initialized = false;
        this.container = null;
        this.database = null;
        this.client = null;
        
        // Estado de configuración
        this.config = {
            endpoint: process.env.COSMOSDB_ENDPOINT,
            key: process.env.COSMOSDB_KEY,
            databaseId: process.env.COSMOSDB_DATABASE_ID || 'AlfaBotDB',
            containerId: process.env.COSMOSDB_CONVERSATIONS_CONTAINER || 'conversations'
        };
        
        // Estadísticas de conexión
        this.stats = {
            connectionAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            lastConnectionAttempt: null,
            lastSuccessfulConnection: null,
            lastError: null,
            operationsPerformed: 0,
            averageLatency: 0,
            latencyMeasurements: []
        };
        
        // Estado de reconexión
        this.reconnection = {
            isReconnecting: false,
            maxRetries: 5,
            retryDelay: 5000, // 5 segundos
            backoffMultiplier: 2,
            nextRetryTime: null
        };
        
        // Configuración de rendimiento
        this.performance = {
            maxRetryAttempts: 3,
            requestTimeout: 30000, // 30 segundos
            maxDegreeOfParallelism: 10,
            preferredLocations: ['East US', 'West US 2'], // Configurar según la región
            enableEndpointDiscovery: true,
            connectionPolicy: {
                requestTimeout: 30000,
                mediaRequestTimeout: 30000,
                enableEndpointDiscovery: true,
                preferredLocations: ['East US', 'West US 2'],
                retryOptions: {
                    maxRetryAttemptCount: 3,
                    fixedRetryIntervalInMilliseconds: 1000,
                    maxWaitTimeInSeconds: 30
                }
            }
        };
        
        // Intentar inicializar automáticamente
        this.initializationPromise = this.init().catch(error => {
            console.error(`CosmosDbConfig: Error de inicialización automática: ${error.message}`);
            this.initialized = false;
            this.stats.lastError = error.message;
        });
        
        // Configurar monitoreo de salud
        this.setupHealthMonitoring();
    }

    /**
     * Configura monitoreo automático de salud de la conexión
     * @private
     */
    setupHealthMonitoring() {
        // Verificar salud cada 5 minutos
        setInterval(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                console.warn('CosmosDbConfig: Error en chequeo de salud:', error.message);
            }
        }, 5 * 60 * 1000); // 5 minutos
        
        console.log('CosmosDbConfig: Monitoreo de salud configurado');
    }

    /**
     * Realiza un chequeo de salud de la conexión
     * @private
     */
    async performHealthCheck() {
        if (!this.initialized || !this.database) {
            return;
        }
        
        try {
            const startTime = Date.now();
            
            // Realizar una operación simple para verificar conectividad
            await this.database.read();
            
            const latency = Date.now() - startTime;
            this.recordLatency(latency);
            
            console.log(`CosmosDbConfig: Chequeo de salud exitoso (${latency}ms)`);
            
        } catch (error) {
            console.warn(`CosmosDbConfig: Chequeo de salud falló: ${error.message}`);
            
            // Si falla el chequeo, intentar reconectar
            if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                console.log('CosmosDbConfig: Iniciando reconexión debido a falla de conectividad');
                await this.attemptReconnection();
            }
        }
    }

    /**
     * Intenta reconectar a CosmosDB con backoff exponencial
     * @private
     */
    async attemptReconnection() {
        if (this.reconnection.isReconnecting) {
            console.log('CosmosDbConfig: Reconexión ya en progreso');
            return;
        }
        
        this.reconnection.isReconnecting = true;
        let attempt = 0;
        
        try {
            while (attempt < this.reconnection.maxRetries) {
                attempt++;
                console.log(`CosmosDbConfig: Intento de reconexión ${attempt}/${this.reconnection.maxRetries}`);
                
                try {
                    // Reinicializar la conexión
                    await this.init();
                    
                    if (this.initialized) {
                        console.log('CosmosDbConfig: Reconexión exitosa');
                        this.reconnection.isReconnecting = false;
                        return;
                    }
                } catch (retryError) {
                    console.warn(`CosmosDbConfig: Fallo en intento ${attempt}: ${retryError.message}`);
                    
                    if (attempt < this.reconnection.maxRetries) {
                        const delay = this.reconnection.retryDelay * Math.pow(this.reconnection.backoffMultiplier, attempt - 1);
                        console.log(`CosmosDbConfig: Esperando ${delay}ms antes del siguiente intento`);
                        await this.sleep(delay);
                    }
                }
            }
            
            console.error('CosmosDbConfig: Todas las tentativas de reconexión fallaron');
            
        } finally {
            this.reconnection.isReconnecting = false;
        }
    }

    /**
     * Utility function para esperar
     * @param {number} ms - Milisegundos a esperar
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Registra latencia para estadísticas
     * @param {number} latency - Latencia en ms
     * @private
     */
    recordLatency(latency) {
        this.stats.latencyMeasurements.push(latency);
        this.stats.operationsPerformed++;
        
        // Mantener solo las últimas 100 mediciones
        if (this.stats.latencyMeasurements.length > 100) {
            this.stats.latencyMeasurements = this.stats.latencyMeasurements.slice(-100);
        }
        
        // Calcular latencia promedio
        this.stats.averageLatency = this.stats.latencyMeasurements.reduce((a, b) => a + b, 0) / this.stats.latencyMeasurements.length;
    }

    /**
     * Inicializa los recursos de CosmosDB con configuración optimizada
     */
    async init() {
        this.stats.connectionAttempts++;
        this.stats.lastConnectionAttempt = new Date().toISOString();
        
        try {
            // Validar configuración
            if (!this.validateConfiguration()) {
                throw new Error('Configuración de CosmosDB incompleta');
            }
            
            console.log('CosmosDbConfig: Iniciando conexión a CosmosDB...');
            console.log(`CosmosDbConfig: Endpoint: ${this.config.endpoint}`);
            console.log(`CosmosDbConfig: Database: ${this.config.databaseId}`);
            console.log(`CosmosDbConfig: Container: ${this.config.containerId}`);
            
            // Crear cliente de Cosmos con configuración optimizada
            this.client = new CosmosClient({
                endpoint: this.config.endpoint,
                key: this.config.key,
                connectionPolicy: this.performance.connectionPolicy,
                consistencyLevel: 'Session' // Mejor balance entre consistencia y rendimiento
            });
            
            // Verificar conectividad con timeout
            console.log('CosmosDbConfig: Verificando conectividad...');
            await this.testConnection();
            
            // Crear o obtener base de datos
            console.log('CosmosDbConfig: Configurando base de datos...');
            const { database } = await this.client.databases.createIfNotExists({
                id: this.config.databaseId,
                throughput: 400 // RU/s mínimo para desarrollo
            });
            
            this.database = database;
            console.log(`CosmosDbConfig: Base de datos '${this.config.databaseId}' configurada`);

            // Crear o obtener contenedor con configuración optimizada
            console.log('CosmosDbConfig: Configurando contenedor...');
            const { container } = await database.containers.createIfNotExists({
                id: this.config.containerId,
                partitionKey: { 
                    paths: ["/conversationId"],
                    kind: "Hash" 
                },
                indexingPolicy: {
                    indexingMode: "consistent",
                    includedPaths: [
                        { path: "/*" }
                    ],
                    excludedPaths: [
                        { path: "/message/*" }, // Excluir contenido de mensajes del índice
                        { path: "/_etag/*" }
                    ]
                },
                defaultTtl: -1, // Sin expiración automática
                throughput: 400 // RU/s mínimo
            });
            
            this.container = container;
            console.log(`CosmosDbConfig: Contenedor '${this.config.containerId}' configurado`);

            // Verificar funcionamiento del contenedor
            await this.verifyContainerFunctionality();
            
            // Marcar como inicializado
            this.initialized = true;
            this.stats.successfulConnections++;
            this.stats.lastSuccessfulConnection = new Date().toISOString();
            
            console.log('CosmosDbConfig: ✅ Inicialización completada exitosamente');
            
        } catch (error) {
            console.error(`CosmosDbConfig: ❌ Error en inicialización: ${error.message}`);
            
            this.initialized = false;
            this.stats.failedConnections++;
            this.stats.lastError = error.message;
            
            // Log detallado del error
            if (error.code) {
                console.error(`CosmosDbConfig: Código de error: ${error.code}`);
            }
            
            if (error.substatus) {
                console.error(`CosmosDbConfig: Sub-estado: ${error.substatus}`);
            }
            
            // Sugerencias basadas en el tipo de error
            this.logErrorSuggestions(error);
            
            throw error;
        }
    }

    /**
     * Valida la configuración requerida
     * @returns {boolean} - Si la configuración es válida
     * @private
     */
    validateConfiguration() {
        const requiredFields = ['endpoint', 'key', 'databaseId', 'containerId'];
        const missingFields = requiredFields.filter(field => !this.config[field]);
        
        if (missingFields.length > 0) {
            console.error('CosmosDbConfig: Faltan campos de configuración:', missingFields);
            console.error('CosmosDbConfig: Variables de entorno requeridas:');
            console.error('  - COSMOSDB_ENDPOINT');
            console.error('  - COSMOSDB_KEY');
            console.error('  - COSMOSDB_DATABASE_ID (opcional, default: AlfaBotDB)');
            console.error('  - COSMOSDB_CONVERSATIONS_CONTAINER (opcional, default: conversations)');
            return false;
        }
        
        // Validar formato del endpoint
        if (!this.config.endpoint.startsWith('https://')) {
            console.error('CosmosDbConfig: El endpoint debe comenzar con https://');
            return false;
        }
        
        return true;
    }

    /**
     * Prueba la conectividad básica con CosmosDB
     * @private
     */
    async testConnection() {
        try {
            const startTime = Date.now();
            
            // Realizar una operación simple para verificar conectividad
            await this.client.getDatabaseAccount();
            
            const latency = Date.now() - startTime;
            this.recordLatency(latency);
            
            console.log(`CosmosDbConfig: Conectividad verificada (${latency}ms)`);
            
        } catch (error) {
            if (error.code === 401) {
                throw new Error('Credenciales de CosmosDB inválidas. Verifica COSMOSDB_KEY.');
            } else if (error.code === 'ENOTFOUND') {
                throw new Error('No se puede resolver el endpoint de CosmosDB. Verifica COSMOSDB_ENDPOINT.');
            } else if (error.code === 'ETIMEDOUT') {
                throw new Error('Timeout conectando a CosmosDB. Verifica conectividad de red.');
            } else {
                throw new Error(`Error de conectividad: ${error.message}`);
            }
        }
    }

    /**
     * Verifica que el contenedor funcione correctamente
     * @private
     */
    async verifyContainerFunctionality() {
        try {
            console.log('CosmosDbConfig: Verificando funcionalidad del contenedor...');
            
            // Crear un documento de prueba
            const testDocument = {
                id: 'test-' + Date.now(),
                conversationId: 'test-conversation',
                type: 'test',
                message: 'Documento de prueba para verificar funcionalidad',
                timestamp: new Date().toISOString()
            };
            
            // Insertar documento de prueba
            const { resource: created } = await this.container.items.create(testDocument);
            console.log('CosmosDbConfig: Documento de prueba creado');
            
            // Leer documento de prueba
            const { resource: read } = await this.container.item(created.id, created.conversationId).read();
            console.log('CosmosDbConfig: Documento de prueba leído');
            
            // Eliminar documento de prueba
            await this.container.item(created.id, created.conversationId).delete();
            console.log('CosmosDbConfig: Documento de prueba eliminado');
            
            console.log('CosmosDbConfig: ✅ Funcionalidad del contenedor verificada');
            
        } catch (error) {
            console.error('CosmosDbConfig: ❌ Error verificando funcionalidad:', error.message);
            throw new Error(`El contenedor no funciona correctamente: ${error.message}`);
        }
    }

    /**
     * Registra sugerencias basadas en el tipo de error
     * @param {Error} error - Error ocurrido
     * @private
     */
    logErrorSuggestions(error) {
        console.log('\nCosmosDbConfig: 💡 Sugerencias para resolver el error:');
        
        if (error.code === 401) {
            console.log('  - Verifica que COSMOSDB_KEY sea correcta y tenga permisos suficientes');
            console.log('  - Asegúrate de que la key no haya expirado');
        } else if (error.code === 'ENOTFOUND') {
            console.log('  - Verifica que COSMOSDB_ENDPOINT sea correcto');
            console.log('  - Asegúrate de tener conectividad a internet');
        } else if (error.code === 'ETIMEDOUT') {
            console.log('  - Verifica la conectividad de red');
            console.log('  - Considera usar un timeout más largo');
            console.log('  - Verifica si hay restricciones de firewall');
        } else if (error.code === 403) {
            console.log('  - Verifica que la cuenta tenga permisos para crear databases/containers');
            console.log('  - Asegúrate de tener suficientes RU/s disponibles');
        } else if (error.message.includes('throughput')) {
            console.log('  - Considera ajustar el throughput del contenedor');
            console.log('  - Verifica los límites de tu cuenta de CosmosDB');
        }
        
        console.log('  - Verifica que todas las variables de entorno estén configuradas correctamente');
        console.log('  - Consulta la documentación de CosmosDB para más información\n');
    }

    /**
     * Obtiene el contenedor para las conversaciones de manera segura
     * @returns {Object} Contenedor de CosmosDB
     * @throws {Error} Si el contenedor no está disponible
     */
    getConversationContainer() {
        if (!this.initialized || !this.container) {
            const errorMsg = 'CosmosDB no está inicializado o no está disponible';
            console.warn(`CosmosDbConfig: ${errorMsg}`);
            
            // Intentar reconexión automática si no está en progreso
            if (!this.reconnection.isReconnecting) {
                console.log('CosmosDbConfig: Iniciando reconexión automática...');
                this.attemptReconnection().catch(error => {
                    console.error('CosmosDbConfig: Error en reconexión automática:', error.message);
                });
            }
            
            throw new Error(errorMsg);
        }
        
        return this.container;
    }
    
    /**
     * Verifica si el servicio de CosmosDB está disponible
     * @returns {boolean} Estado de disponibilidad
     */
    isAvailable() {
        return this.initialized && this.container !== null && this.database !== null;
    }

    /**
     * Obtiene estadísticas detalladas del servicio
     * @returns {Object} Estadísticas completas
     */
    getStats() {
        return {
            // Estado de conexión
            connection: {
                initialized: this.initialized,
                isAvailable: this.isAvailable(),
                connectionAttempts: this.stats.connectionAttempts,
                successfulConnections: this.stats.successfulConnections,
                failedConnections: this.stats.failedConnections,
                lastConnectionAttempt: this.stats.lastConnectionAttempt,
                lastSuccessfulConnection: this.stats.lastSuccessfulConnection,
                lastError: this.stats.lastError
            },
            
            // Rendimiento
            performance: {
                operationsPerformed: this.stats.operationsPerformed,
                averageLatency: Math.round(this.stats.averageLatency),
                latencyMeasurements: this.stats.latencyMeasurements.length,
                minLatency: Math.min(...this.stats.latencyMeasurements) || 0,
                maxLatency: Math.max(...this.stats.latencyMeasurements) || 0
            },
            
            // Estado de reconexión
            reconnection: {
                isReconnecting: this.reconnection.isReconnecting,
                maxRetries: this.reconnection.maxRetries,
                nextRetryTime: this.reconnection.nextRetryTime
            },
            
            // Configuración
            config: {
                endpoint: this.config.endpoint ? this.config.endpoint.substring(0, 50) + '...' : null,
                databaseId: this.config.databaseId,
                containerId: this.config.containerId,
                hasKey: !!this.config.key
            },
            
            // Timestamp
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Obtiene el estado de salud del servicio
     * @returns {Object} Estado de salud
     */
    getHealthStatus() {
        const stats = this.getStats();
        const uptime = this.stats.lastSuccessfulConnection ? 
            Date.now() - new Date(this.stats.lastSuccessfulConnection).getTime() : 0;
        
        let status = 'healthy';
        const issues = [];
        
        if (!this.isAvailable()) {
            status = 'unhealthy';
            issues.push('CosmosDB no disponible');
        } else if (this.stats.averageLatency > 1000) {
            status = 'degraded';
            issues.push('Latencia alta');
        } else if (this.stats.failedConnections > this.stats.successfulConnections) {
            status = 'degraded';
            issues.push('Múltiples fallos de conexión');
        }
        
        return {
            status,
            uptime,
            issues,
            lastCheck: new Date().toISOString(),
            details: {
                initialized: this.initialized,
                averageLatency: Math.round(this.stats.averageLatency),
                operationsPerformed: this.stats.operationsPerformed,
                errorRate: this.stats.connectionAttempts > 0 ? 
                    this.stats.failedConnections / this.stats.connectionAttempts : 0
            }
        };
    }

    /**
     * Ejecuta una operación con manejo de errores y reintentos
     * @param {Function} operation - Operación a ejecutar
     * @param {string} operationName - Nombre de la operación para logging
     * @returns {*} Resultado de la operación
     */
    async executeWithRetry(operation, operationName = 'operation') {
        let lastError;
        
        for (let attempt = 1; attempt <= this.performance.maxRetryAttempts; attempt++) {
            try {
                const startTime = Date.now();
                
                const result = await operation();
                
                const latency = Date.now() - startTime;
                this.recordLatency(latency);
                
                if (attempt > 1) {
                    console.log(`CosmosDbConfig: ${operationName} exitosa en intento ${attempt}`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                console.warn(`CosmosDbConfig: ${operationName} falló en intento ${attempt}: ${error.message}`);
                
                // Si es un error de conectividad, intentar reconexión
                if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                    console.log('CosmosDbConfig: Error de conectividad, intentando reconexión...');
                    await this.attemptReconnection();
                }
                
                // Si no es el último intento, esperar antes de reintentar
                if (attempt < this.performance.maxRetryAttempts) {
                    const delay = 1000 * attempt; // Backoff lineal
                    console.log(`CosmosDbConfig: Esperando ${delay}ms antes del siguiente intento`);
                    await this.sleep(delay);
                }
            }
        }
        
        // Si llegamos aquí, todos los intentos fallaron
        console.error(`CosmosDbConfig: ${operationName} falló después de ${this.performance.maxRetryAttempts} intentos`);
        throw lastError;
    }

    /**
     * Reinicia la configuración y estadísticas
     */
    reset() {
        console.log('CosmosDbConfig: Reiniciando configuración...');
        
        this.initialized = false;
        this.container = null;
        this.database = null;
        this.client = null;
        
        // Reiniciar estadísticas
        this.stats = {
            connectionAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            lastConnectionAttempt: null,
            lastSuccessfulConnection: null,
            lastError: null,
            operationsPerformed: 0,
            averageLatency: 0,
            latencyMeasurements: []
        };
        
        // Reiniciar estado de reconexión
        this.reconnection.isReconnecting = false;
        this.reconnection.nextRetryTime = null;
        
        console.log('CosmosDbConfig: Configuración reiniciada');
    }

    /**
     * Cierra la conexión de manera limpia
     */
    async dispose() {
        console.log('CosmosDbConfig: Cerrando conexión...');
        
        try {
            if (this.client) {
                // CosmosClient no tiene un método dispose explícito,
                // pero podemos limpiar las referencias
                this.client = null;
            }
            
            this.container = null;
            this.database = null;
            this.initialized = false;
            
            console.log('CosmosDbConfig: Conexión cerrada correctamente');
            
        } catch (error) {
            console.error('CosmosDbConfig: Error cerrando conexión:', error.message);
        }
    }
}

// Exportar una instancia única (singleton)
const cosmosDbConfig = new CosmosDbConfig();

// Manejar cierre limpio de la aplicación
process.on('SIGINT', async () => {
    console.log('CosmosDbConfig: Recibida señal SIGINT, cerrando conexión...');
    await cosmosDbConfig.dispose();
});

process.on('SIGTERM', async () => {
    console.log('CosmosDbConfig: Recibida señal SIGTERM, cerrando conexión...');
    await cosmosDbConfig.dispose();
});

module.exports = cosmosDbConfig;