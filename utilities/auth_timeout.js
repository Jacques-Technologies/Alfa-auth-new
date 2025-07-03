// utilities/auth_timeout.js - Utilidades para manejo de timeouts de autenticación

class AuthTimeoutManager {
  constructor(timeoutMs = 5 * 60 * 1000) { // 5 minutos por defecto
    this.timeouts = new Map();
    this.timeoutMs = timeoutMs;
    this.startCleanupInterval();
  }

  /**
   * Establece un timeout para un proceso de autenticación
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto para enviar mensajes
   * @param {Function} onTimeout - Callback cuando se agota el tiempo
   */
  setAuthTimeout(userId, context, onTimeout) {
    // Limpiar timeout anterior si existe
    this.clearAuthTimeout(userId);
    
    const timeoutId = setTimeout(async () => {
      try {
        await this.handleTimeout(userId, context, onTimeout);
      } catch (error) {
        console.error('Error en timeout de autenticación:', error);
      }
    }, this.timeoutMs);
    
    this.timeouts.set(userId, {
      timeoutId,
      startTime: Date.now(),
      context
    });
  }

  /**
   * Limpia el timeout de autenticación para un usuario
   * @param {string} userId - ID del usuario
   */
  clearAuthTimeout(userId) {
    const timeoutInfo = this.timeouts.get(userId);
    if (timeoutInfo) {
      clearTimeout(timeoutInfo.timeoutId);
      this.timeouts.delete(userId);
    }
  }

  /**
   * Maneja cuando se agota el tiempo de autenticación
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @param {Function} onTimeout - Callback cuando se agota el tiempo
   * @private
   */
  async handleTimeout(userId, context, onTimeout) {
    // Limpiar el timeout
    this.clearAuthTimeout(userId);
    
    // Ejecutar callback si existe
    if (onTimeout && typeof onTimeout === 'function') {
      await onTimeout(userId);
    }
    
    // Enviar mensaje de timeout
    const timeoutMessage = this.createTimeoutMessage();
    await context.sendActivity(timeoutMessage);
  }

  /**
   * Crea el mensaje de timeout
   * @returns {string} - Mensaje de timeout formateado
   * @private
   */
  createTimeoutMessage() {
    const minutes = Math.round(this.timeoutMs / 60000);
    
    return `⏰ **Tiempo de autenticación agotado**\n\n` +
           `🚫 **El proceso de autenticación ha tomado demasiado tiempo.**\n\n` +
           `**Posibles causas:**\n` +
           `• No completaste el proceso de autenticación\n` +
           `• Dejaste abierta la ventana sin finalizar\n` +
           `• Hubo problemas de conectividad\n\n` +
           `**Para usar el bot:**\n` +
           `• Escribe \`login\` para iniciar un nuevo proceso de autenticación\n` +
           `• Asegúrate de completar el proceso rápidamente\n` +
           `• Verifica tu conexión a internet\n\n` +
           `💡 **Recuerda**: Tienes ${minutes} minutos para completar la autenticación.`;
  }

  /**
   * Inicia la limpieza periódica de timeouts
   * @private
   */
  startCleanupInterval() {
    // Limpiar timeouts cada 10 minutos
    setInterval(() => {
      this.cleanupExpiredTimeouts();
    }, 10 * 60 * 1000);
  }

  /**
   * Limpia timeouts expirados
   * @private
   */
  cleanupExpiredTimeouts() {
    const now = Date.now();
    const expiredTimeouts = [];
    
    for (const [userId, timeoutInfo] of this.timeouts.entries()) {
      const elapsed = now - timeoutInfo.startTime;
      if (elapsed > this.timeoutMs + 60000) { // 1 minuto extra de margen
        expiredTimeouts.push(userId);
      }
    }
    
    expiredTimeouts.forEach(userId => {
      this.clearAuthTimeout(userId);
    });
    
    if (expiredTimeouts.length > 0) {
      console.log(`AuthTimeout: Limpieza periódica - ${expiredTimeouts.length} timeouts expirados removidos`);
    }
  }

  /**
   * Obtiene información de timeouts activos
   * @returns {Object} - Información de timeouts
   */
  getActiveTimeouts() {
    const timeoutInfo = [];
    const now = Date.now();
    
    for (const [userId, timeoutData] of this.timeouts.entries()) {
      const elapsed = now - timeoutData.startTime;
      const remaining = Math.max(0, this.timeoutMs - elapsed);
      
      timeoutInfo.push({
        userId,
        elapsed: Math.round(elapsed / 1000),
        remaining: Math.round(remaining / 1000),
        startTime: new Date(timeoutData.startTime).toISOString()
      });
    }
    
    return {
      active: this.timeouts.size,
      timeoutDurationMs: this.timeoutMs,
      timeouts: timeoutInfo
    };
  }

  /**
   * Verifica si un usuario tiene un timeout activo
   * @param {string} userId - ID del usuario
   * @returns {boolean} - Si tiene timeout activo
   */
  hasActiveTimeout(userId) {
    return this.timeouts.has(userId);
  }

  /**
   * Obtiene el tiempo restante para un usuario
   * @param {string} userId - ID del usuario
   * @returns {number} - Tiempo restante en milisegundos, 0 si no tiene timeout
   */
  getRemainingTime(userId) {
    const timeoutInfo = this.timeouts.get(userId);
    if (!timeoutInfo) {
      return 0;
    }
    
    const elapsed = Date.now() - timeoutInfo.startTime;
    return Math.max(0, this.timeoutMs - elapsed);
  }

  /**
   * Limpia todos los timeouts
   */
  clearAllTimeouts() {
    const beforeCount = this.timeouts.size;
    
    for (const [userId, timeoutInfo] of this.timeouts.entries()) {
      clearTimeout(timeoutInfo.timeoutId);
    }
    
    this.timeouts.clear();
    
    return {
      cleared: beforeCount,
      remaining: this.timeouts.size
    };
  }
}

module.exports = { AuthTimeoutManager };