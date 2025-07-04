// utilities/invalidTokenHandler.js - Utilidad especializada para manejo de tokens inválidos

const { isTokenValid } = require('./http_utils');

/**
 * Clase especializada para manejar tokens inválidos y situaciones relacionadas
 */
class InvalidTokenHandler {
    constructor() {
        this.invalidTokenEvents = [];
        this.maxEventHistory = 100;
        this.tokenValidationCache = new Map();
        this.cacheTimeout = 30000; // 30 segundos
    }

    /**
     * Registra un evento de token inválido
     * @param {string} userId - ID del usuario
     * @param {string} source - Fuente donde se detectó el token inválido
     * @param {Object} details - Detalles adicionales
     */
    logInvalidTokenEvent(userId, source, details = {}) {
        const event = {
            userId,
            source,
            details,
            timestamp: new Date().toISOString(),
            id: Date.now() + Math.random()
        };

        this.invalidTokenEvents.push(event);
        
        // Mantener solo los últimos eventos
        if (this.invalidTokenEvents.length > this.maxEventHistory) {
            this.invalidTokenEvents.shift();
        }

        console.log(`🚫 TOKEN INVÁLIDO DETECTADO [${userId}] en ${source}:`, details);
    }

    /**
     * Verifica si un token es válido con cache
     * @param {string} token - Token a verificar
     * @param {string} userId - ID del usuario (para logging)
     * @returns {boolean} - Si el token es válido
     */
    async verifyToken(token, userId) {
        if (!token) {
            this.logInvalidTokenEvent(userId, 'verifyToken', { reason: 'token_missing' });
            return false;
        }

        // Verificar cache
        const cacheKey = this._generateTokenCacheKey(token);
        const cachedResult = this.tokenValidationCache.get(cacheKey);
        
        if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheTimeout) {
            console.log(`[${userId}] 📋 Usando resultado de cache para token: ${cachedResult.valid}`);
            return cachedResult.valid;
        }

        try {
            console.log(`[${userId}] 🔍 Verificando token...`);
            const isValid = await isTokenValid(token);
            
            // Guardar en cache
            this.tokenValidationCache.set(cacheKey, {
                valid: isValid,
                timestamp: Date.now()
            });

            // Limpiar cache después del timeout
            setTimeout(() => {
                this.tokenValidationCache.delete(cacheKey);
            }, this.cacheTimeout);

            if (!isValid) {
                this.logInvalidTokenEvent(userId, 'verifyToken', { 
                    reason: 'api_validation_failed',
                    tokenLength: token.length,
                    tokenPrefix: token.substring(0, 10) + '...'
                });
            }

            console.log(`[${userId}] 🔑 Token válido: ${isValid}`);
            return isValid;

        } catch (error) {
            console.error(`[${userId}] Error verificando token:`, error.message);
            
            this.logInvalidTokenEvent(userId, 'verifyToken', { 
                reason: 'verification_error',
                error: error.message 
            });
            
            // En caso de error, asumimos inválido para mayor seguridad
            return false;
        }
    }

    /**
     * Ejecuta limpieza completa cuando se detecta un token inválido
     * @param {string} userId - ID del usuario
     * @param {TurnContext} context - Contexto del turno
     * @param {string} source - Fuente donde se detectó el problema
     * @returns {Object} - Resultado de la limpieza
     */
    async handleInvalidToken(userId, context, source) {
        console.log(`🧹 MANEJANDO TOKEN INVÁLIDO [${userId}] desde ${source}`);
        
        const cleanupResult = {
            userId,
            source,
            timestamp: new Date().toISOString(),
            actionsExecuted: [],
            success: false
        };

        try {
            // 1. Registrar el evento
            this.logInvalidTokenEvent(userId, source, { 
                action: 'cleanup_initiated',
                context_available: !!context 
            });

            // 2. Limpiar cache de verificación de tokens
            this._clearTokenCacheForUser(userId);
            cleanupResult.actionsExecuted.push('token_cache_cleared');

            // 3. Limpiar en bot instance
            const bot = global.botInstance;
            if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                const botCleanupSuccess = await bot.forceCleanUserAuthState(userId, context, `invalid_token_${source}`);
                cleanupResult.actionsExecuted.push(`bot_cleanup_${botCleanupSuccess ? 'success' : 'failed'}`);
            }

            // 4. Limpiar en MainDialog
            const mainDialog = global.mainDialogInstance;
            if (mainDialog && typeof mainDialog.emergencyUserCleanup === 'function') {
                const dialogCleanup = mainDialog.emergencyUserCleanup(userId);
                cleanupResult.actionsExecuted.push(`dialog_cleanup_${dialogCleanup.actionsExecuted.length}_actions`);
            }

            // 5. Enviar mensaje al usuario si hay contexto
            if (context) {
                const message = this._createInvalidTokenMessage(userId, source);
                try {
                    await context.sendActivity(message);
                    cleanupResult.actionsExecuted.push('user_notified');
                } catch (messageError) {
                    console.error(`Error enviando mensaje de token inválido a ${userId}:`, messageError);
                    cleanupResult.actionsExecuted.push('user_notification_failed');
                }
            }

            cleanupResult.success = true;
            console.log(`✅ Limpieza por token inválido completada para ${userId}`);

        } catch (error) {
            console.error(`❌ Error en limpieza por token inválido para ${userId}:`, error);
            cleanupResult.error = error.message;
            cleanupResult.success = false;
        }

        return cleanupResult;
    }

    /**
     * Crea un mensaje apropiado para el usuario cuando se detecta token inválido
     * @param {string} userId - ID del usuario
     * @param {string} source - Fuente donde se detectó
     * @returns {string} - Mensaje para el usuario
     * @private
     */
    _createInvalidTokenMessage(userId, source) {
        const baseMessage = '🔐 **Tu sesión ha expirado o es inválida**\n\n';
        
        let specificMessage = '';
        switch (source) {
            case 'api_request':
                specificMessage = '📡 Se detectó que tu token no es válido al hacer una consulta al servidor.\n\n';
                break;
            case 'verification':
                specificMessage = '🔍 La verificación de tu sesión determinó que el token ya no es válido.\n\n';
                break;
            case 'login_step':
                specificMessage = '🚪 Se recibió un token inválido durante el proceso de autenticación.\n\n';
                break;
            default:
                specificMessage = '🔧 Se detectó un problema con tu token de autenticación.\n\n';
                break;
        }

        const reasonsMessage = '**Esto puede ocurrir por:**\n' +
                             '• La sesión expiró naturalmente\n' +
                             '• Se revocaron los permisos en el sistema\n' +
                             '• Cambio de contraseña en tu cuenta\n' +
                             '• Problemas de conectividad durante la autenticación\n\n';

        const actionMessage = '✨ **Para continuar:**\n' +
                            '• Escribe `login` para autenticarte nuevamente\n' +
                            '• Asegúrate de completar todo el proceso sin cerrar ventanas\n' +
                            '• Si el problema persiste, contacta al administrador\n\n' +
                            '💡 **Tip:** Tu sesión se ha limpiado automáticamente y estás listo para un nuevo login.';

        return baseMessage + specificMessage + reasonsMessage + actionMessage;
    }

    /**
     * Genera una clave de cache para un token
     * @param {string} token - Token
     * @returns {string} - Clave de cache
     * @private
     */
    _generateTokenCacheKey(token) {
        // Usar los primeros y últimos caracteres + longitud como clave
        // No guardamos el token completo por seguridad
        if (!token || token.length < 10) {
            return 'invalid_token';
        }
        
        return `token_${token.substring(0, 5)}_${token.substring(token.length - 5)}_${token.length}`;
    }

    /**
     * Limpia el cache de tokens para un usuario específico
     * @param {string} userId - ID del usuario
     * @private
     */
    _clearTokenCacheForUser(userId) {
        // Como no asociamos cache con usuario directamente, limpiamos todo el cache
        // (es más seguro y el cache se renueva rápidamente de todas formas)
        const beforeSize = this.tokenValidationCache.size;
        this.tokenValidationCache.clear();
        
        if (beforeSize > 0) {
            console.log(`[${userId}] 🧹 Cache de tokens limpiado (${beforeSize} entradas)`);
        }
    }

    /**
     * Obtiene estadísticas de tokens inválidos
     * @returns {Object} - Estadísticas
     */
    getInvalidTokenStats() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        const eventsLastHour = this.invalidTokenEvents.filter(
            event => new Date(event.timestamp).getTime() > oneHourAgo
        );

        const eventsLastDay = this.invalidTokenEvents.filter(
            event => new Date(event.timestamp).getTime() > oneDayAgo
        );

        // Contar por usuario
        const userStats = {};
        this.invalidTokenEvents.forEach(event => {
            if (!userStats[event.userId]) {
                userStats[event.userId] = 0;
            }
            userStats[event.userId]++;
        });

        // Contar por fuente
        const sourceStats = {};
        this.invalidTokenEvents.forEach(event => {
            if (!sourceStats[event.source]) {
                sourceStats[event.source] = 0;
            }
            sourceStats[event.source]++;
        });

        return {
            totalEvents: this.invalidTokenEvents.length,
            eventsLastHour: eventsLastHour.length,
            eventsLastDay: eventsLastDay.length,
            userStats,
            sourceStats,
            cacheSize: this.tokenValidationCache.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Obtiene el historial de eventos para un usuario específico
     * @param {string} userId - ID del usuario
     * @returns {Array} - Eventos del usuario
     */
    getUserInvalidTokenHistory(userId) {
        return this.invalidTokenEvents.filter(event => event.userId === userId);
    }

    /**
     * Formatea las estadísticas para mostrar al administrador
     * @returns {string} - Estadísticas formateadas
     */
    formatStatsForDisplay() {
        const stats = this.getInvalidTokenStats();
        
        let formatted = `🚫 **Estadísticas de Tokens Inválidos**\n\n`;
        formatted += `**Eventos totales**: ${stats.totalEvents}\n`;
        formatted += `**Última hora**: ${stats.eventsLastHour}\n`;
        formatted += `**Último día**: ${stats.eventsLastDay}\n`;
        formatted += `**Cache activo**: ${stats.cacheSize} entradas\n\n`;

        if (Object.keys(stats.userStats).length > 0) {
            formatted += `**Por usuario**:\n`;
            Object.entries(stats.userStats)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
                .forEach(([userId, count]) => {
                    formatted += `• ${userId}: ${count} eventos\n`;
                });
            formatted += '\n';
        }

        if (Object.keys(stats.sourceStats).length > 0) {
            formatted += `**Por fuente**:\n`;
            Object.entries(stats.sourceStats)
                .sort(([,a], [,b]) => b - a)
                .forEach(([source, count]) => {
                    formatted += `• ${source}: ${count} eventos\n`;
                });
        }

        return formatted;
    }

    /**
     * Limpia eventos antiguos
     * @param {number} maxAge - Edad máxima en milisegundos
     * @returns {number} - Número de eventos limpiados
     */
    cleanupOldEvents(maxAge = 24 * 60 * 60 * 1000) { // 24 horas por defecto
        const cutoffTime = Date.now() - maxAge;
        const beforeLength = this.invalidTokenEvents.length;
        
        this.invalidTokenEvents = this.invalidTokenEvents.filter(
            event => new Date(event.timestamp).getTime() > cutoffTime
        );
        
        const cleaned = beforeLength - this.invalidTokenEvents.length;
        
        if (cleaned > 0) {
            console.log(`InvalidTokenHandler: Limpiados ${cleaned} eventos antiguos`);
        }
        
        return cleaned;
    }

    /**
     * Comando de emergencia para usuario específico
     * @param {string} userId - ID del usuario
     * @returns {Object} - Resultado de la limpieza de emergencia
     */
    async emergencyCleanupUser(userId) {
        console.log(`🚨 LIMPIEZA DE EMERGENCIA POR TOKEN INVÁLIDO: ${userId}`);
        
        try {
            // Limpiar eventos del usuario
            const beforeEvents = this.invalidTokenEvents.length;
            this.invalidTokenEvents = this.invalidTokenEvents.filter(event => event.userId !== userId);
            const eventsCleared = beforeEvents - this.invalidTokenEvents.length;

            // Limpiar cache
            this._clearTokenCacheForUser(userId);

            // Ejecutar limpieza en bot
            const bot = global.botInstance;
            let botCleanupResult = null;
            if (bot && typeof bot.forceCleanUserAuthState === 'function') {
                botCleanupResult = await bot.forceCleanUserAuthState(userId, null, 'emergency_invalid_token');
            }

            // Ejecutar limpieza en mainDialog
            const mainDialog = global.mainDialogInstance;
            let dialogCleanupResult = null;
            if (mainDialog && typeof mainDialog.emergencyUserCleanup === 'function') {
                dialogCleanupResult = mainDialog.emergencyUserCleanup(userId);
            }

            const result = {
                userId,
                timestamp: new Date().toISOString(),
                eventsCleared,
                botCleanup: botCleanupResult,
                dialogCleanup: dialogCleanupResult,
                success: true
            };

            console.log(`✅ Limpieza de emergencia completada para ${userId}:`, result);
            return result;

        } catch (error) {
            console.error(`❌ Error en limpieza de emergencia para ${userId}:`, error);
            return {
                userId,
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message
            };
        }
    }
}

// Crear instancia única
const invalidTokenHandler = new InvalidTokenHandler();

// Funciones de conveniencia
const handleInvalidToken = async (userId, context, source) => {
    return await invalidTokenHandler.handleInvalidToken(userId, context, source);
};

const verifyTokenSafely = async (token, userId) => {
    return await invalidTokenHandler.verifyToken(token, userId);
};

const cleanupInvalidTokenUser = async (userId) => {
    return await invalidTokenHandler.emergencyCleanupUser(userId);
};

const getTokenStats = () => {
    return invalidTokenHandler.formatStatsForDisplay();
};

// Limpiar eventos antiguos cada hora
setInterval(() => {
    invalidTokenHandler.cleanupOldEvents();
}, 60 * 60 * 1000);

module.exports = {
    InvalidTokenHandler,
    invalidTokenHandler,
    handleInvalidToken,
    verifyTokenSafely,
    cleanupInvalidTokenUser,
    getTokenStats
};