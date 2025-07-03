// utilities/auth_timeout.js - Utilidades para manejo de timeouts de autenticación - VERSIÓN CORREGIDA

class AuthTimeoutManager {
  constructor(timeoutMs = 2 * 60 * 1000) { // Reducido a 2 minutos para evitar contextos revocados
    this.timeouts = new Map();
    this.timeoutMs = timeoutMs;
    this.startCleanupInterval();
  }

  /**
   * Establece un timeout para un proceso de autenticación
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto para almacenar info (NO se almacena directamente)
   * @param {Function} onTimeout - Callback cuando se agota el tiempo
   */
  setAuthTimeout(userId, context, onTimeout) {
    // Limpiar timeout anterior si existe
    this.clearAuthTimeout(userId);
    
    // CORRECCIÓN: Solo almacenar información mínima necesaria, NO el contexto completo
    const conversationRef = {
      conversationId: context.activity.conversation.id,
      channelId: context.activity.channelId,
      userId: userId,
      botId: context.activity.recipient.id,
      serviceUrl: context.activity.serviceUrl
    };
    
    const timeoutId = setTimeout(async () => {
      try {
        await this.handleTimeout(userId, conversationRef, onTimeout);
      } catch (error) {
        console.error(`[${userId}] Error en timeout de autenticación:`, error);
        // CORRECCIÓN: Continuar con limpieza incluso si hay error
        if (onTimeout && typeof onTimeout === 'function') {
          try {
            await onTimeout(userId);
          } catch (cleanupError) {
            console.error(`[${userId}] Error en limpieza de timeout:`, cleanupError);
          }
        }
      }
    }, this.timeoutMs);
    
    this.timeouts.set(userId, {
      timeoutId,
      startTime: Date.now(),
      conversationRef, // Solo referencia mínima
      onTimeout
    });
    
    console.log(`[${userId}] Timeout de autenticación establecido para ${this.timeoutMs/1000} segundos`);
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
      console.log(`[${userId}] Timeout de autenticación limpiado`);
    }
  }

  /**
   * Maneja cuando se agota el tiempo de autenticación
   * @param {string} userId - ID del usuario
   * @param {Object} conversationRef - Referencia mínima de la conversación
   * @param {Function} onTimeout - Callback cuando se agota el tiempo
   * @private
   */
  async handleTimeout(userId, conversationRef, onTimeout) {
    console.log(`[${userId}] Timeout de autenticación alcanzado`);
    
    // CORRECCIÓN: Ejecutar limpieza ANTES de intentar enviar mensaje
    if (onTimeout && typeof onTimeout === 'function') {
      try {
        await onTimeout(userId);
      } catch (cleanupError) {
        console.error(`[${userId}] Error en callback de timeout:`, cleanupError);
      }
    }
    
    // CORRECCIÓN: Limpiar el timeout inmediatamente
    this.clearAuthTimeout(userId);
    
    // CORRECCIÓN: Intentar enviar mensaje solo si tenemos bot instance
    try {
      await this.sendTimeoutMessage(userId, conversationRef);
    } catch (messageError) {
      console.error(`[${userId}] Error enviando mensaje de timeout:`, messageError);
      // No re-lanzar el error, solo loggear
    }
  }

  /**
   * NUEVO: Envía mensaje de timeout usando bot instance global
   * @param {string} userId - ID del usuario
   * @param {Object} conversationRef - Referencia de la conversación
   * @private
   */
  async sendTimeoutMessage(userId, conversationRef) {
    try {
      // CORRECCIÓN: Usar bot instance global en lugar de contexto almacenado
      const bot = global.botInstance;
      if (!bot || !bot.adapter) {
        console.warn(`[${userId}] No se puede enviar mensaje de timeout - bot no disponible`);
        return;
      }

      // CORRECCIÓN: Crear referencia de conversación para proactive messaging
      const conversationReference = {
        conversation: { id: conversationRef.conversationId },
        user: { id: userId },
        bot: { id: conversationRef.botId },
        channelId: conversationRef.channelId,
        serviceUrl: conversationRef.serviceUrl,
        activityId: null
      };

      // CORRECCIÓN: Usar continueConversation para envío proactivo
      await bot.adapter.continueConversation(conversationReference, async (context) => {
        const timeoutMessage = this.createTimeoutMessage();
        await context.sendActivity(timeoutMessage);
      });

      console.log(`[${userId}] Mensaje de timeout enviado exitosamente`);
      
    } catch (error) {
      console.error(`[${userId}] Error enviando mensaje proactivo de timeout:`, error);
    }
  }

  /**
   * Crea el mensaje de timeout - VERSIÓN MEJORADA
   * @returns {string} - Mensaje de timeout formateado
   * @private
   */
  createTimeoutMessage() {
    const minutes = Math.round(this.timeoutMs / 60000);
    
    return `⏰ **Tiempo de autenticación agotado**\n\n` +
           `🚫 **El proceso de autenticación ha tardado demasiado tiempo.**\n\n` +
           `**¿Qué pasó?**\n` +
           `• El proceso de login duró más de ${minutes} minutos\n` +
           `• La ventana de autenticación se cerró sin completar\n` +
           `• Hubo problemas de conectividad\n\n` +
           `**Para continuar:**\n` +
           `• Escribe \`login\` para iniciar un nuevo proceso\n` +
           `• Completa la autenticación rápidamente\n` +
           `• No cierres la ventana hasta ver el mensaje de éxito\n\n` +
           `💡 **Tip**: El proceso debe completarse en menos de ${minutes} minutos.`;
  }

  /**
   * Inicia la limpieza periódica de timeouts
   * @private
   */
  startCleanupInterval() {
    // Limpiar timeouts cada 5 minutos
    setInterval(() => {
      this.cleanupExpiredTimeouts();
    }, 5 * 60 * 1000);
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
      if (elapsed > this.timeoutMs + 30000) { // 30 segundos extra de margen
        expiredTimeouts.push(userId);
      }
    }
    
    expiredTimeouts.forEach(userId => {
      console.warn(`[${userId}] Limpiando timeout expirado automáticamente`);
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
    
    console.log(`AuthTimeout: Todos los timeouts limpiados (${beforeCount} eliminados)`);
    
    return {
      cleared: beforeCount,
      remaining: this.timeouts.size
    };
  }

  /**
   * NUEVO: Fuerza limpieza de timeout específico con callback
   * @param {string} userId - ID del usuario
   * @returns {boolean} - Si se limpió algún timeout
   */
  forceCleanupUser(userId) {
    const timeoutInfo = this.timeouts.get(userId);
    if (!timeoutInfo) {
      return false;
    }
    
    console.log(`[${userId}] Limpieza forzada de timeout`);
    
    // Ejecutar callback de limpieza si existe
    if (timeoutInfo.onTimeout && typeof timeoutInfo.onTimeout === 'function') {
      try {
        timeoutInfo.onTimeout(userId);
      } catch (error) {
        console.error(`[${userId}] Error en callback de limpieza forzada:`, error);
      }
    }
    
    // Limpiar el timeout
    this.clearAuthTimeout(userId);
    
    return true;
  }
}

module.exports = { AuthTimeoutManager };