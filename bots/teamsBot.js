// teamsBot.js - FIX PARA DOBLE AUTENTICACIÓN

const { DialogBot } = require('./dialogBot');
const axios = require('axios');

// Importar servicios
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

// Importar utilities
const { handleCardSubmit } = require('../utilities/procesar_card');
const { isTokenValid } = require('../utilities/http_utils');
const { AuthTimeoutManager } = require('../utilities/auth_timeout');

/**
 * TeamsBot class - VERSIÓN CON FIX PARA DOBLE AUTENTICACIÓN
 */
class TeamsBot extends DialogBot {
  constructor(conversationState, userState, dialog) {
    super(conversationState, userState, dialog);

    // Registrar instancia globalmente
    global.botInstance = this;

    // Configurar manejadores de actividades
    this.onMembersAdded(this.handleMembersAdded.bind(this));
    this.onMessage(this.handleMessageWithAuth.bind(this));

    // Inicializar servicios
    this.initializeServices();

    // Estados de autenticación y control
    this.authenticatedUsers = new Map();
    this.authState = this.userState.createProperty('AuthState');
    this.activeDialogs = new Set();
    this.activeProcesses = new Map();

    // Inicializar gestor de timeouts
    this.authTimeoutManager = new AuthTimeoutManager();
    
    // Control de mensajes de autenticación enviados
    this.authMessagesShown = new Set();
    
    // NUEVO: Cache de verificación de autenticación para evitar race conditions
    this.authVerificationCache = new Map();
    this.cacheTimeout = 5000; // 5 segundos
  }

  /**
   * Inicializa y valida los servicios externos
   */
  initializeServices() {
    // Validar OpenAI Service
    if (!openaiService || typeof openaiService.procesarMensaje !== 'function') {
      console.error('ERROR: openaiService inválido, usando fallback');
      this.openaiService = {
        procesarMensaje: async msg => ({
          type: 'text',
          content: `Servicio de OpenAI no disponible. Mensaje: "${msg}"`
        })
      };
    } else {
      this.openaiService = openaiService;
    }

    // Validar Conversation Service
    if (!conversationService || typeof conversationService.saveMessage !== 'function') {
      console.error('ERROR: conversationService inválido, usando fallback');
      this.conversationService = {
        saveMessage: async () => ({}),
        getConversationHistory: async () => [],
        createConversation: async () => ({}),
        updateLastActivity: async () => ({})
      };
    } else {
      this.conversationService = conversationService;
    }
  }

  /**
   * NUEVO: Verificación mejorada de autenticación con cache
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @returns {boolean} - Si el usuario está autenticado
   */
  async isUserAuthenticatedEnhanced(userId, context) {
    try {
      // 1. Verificar cache primero para evitar verificaciones duplicadas
      const cacheKey = `auth_${userId}`;
      const cachedResult = this.authVerificationCache.get(cacheKey);
      if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheTimeout) {
        console.log(`[${userId}] Usando resultado de cache: ${cachedResult.authenticated}`);
        return cachedResult.authenticated;
      }

      // 2. Verificar en memoria (más rápido)
      const memoryAuth = this.authenticatedUsers.has(userId);
      console.log(`[${userId}] Autenticación en memoria: ${memoryAuth}`);

      // 3. Verificar estado persistente
      const authData = await this.authState.get(context, {});
      const persistentAuth = authData[userId]?.authenticated === true;
      console.log(`[${userId}] Autenticación persistente: ${persistentAuth}`);

      // 4. Si hay inconsistencia, sincronizar
      let finalAuth = false;
      if (memoryAuth && persistentAuth) {
        finalAuth = true;
        console.log(`[${userId}] ✅ Autenticación consistente: verdadero`);
      } else if (memoryAuth && !persistentAuth) {
        // Sincronizar persistente con memoria
        await this.syncPersistentFromMemory(userId, context);
        finalAuth = true;
        console.log(`[${userId}] 🔄 Sincronizado persistente desde memoria`);
      } else if (!memoryAuth && persistentAuth) {
        // Sincronizar memoria desde persistente
        await this.syncMemoryFromPersistent(userId, context, authData[userId]);
        finalAuth = true;
        console.log(`[${userId}] 🔄 Sincronizado memoria desde persistente`);
      } else {
        finalAuth = false;
        console.log(`[${userId}] ❌ No autenticado en ningún lugar`);
      }

      // 5. Guardar en cache
      this.authVerificationCache.set(cacheKey, {
        authenticated: finalAuth,
        timestamp: Date.now()
      });

      // 6. Limpiar cache antiguo
      setTimeout(() => {
        this.authVerificationCache.delete(cacheKey);
      }, this.cacheTimeout);

      return finalAuth;

    } catch (error) {
      console.error(`[${userId}] Error en verificación de autenticación:`, error);
      return false;
    }
  }

  /**
   * NUEVO: Sincroniza estado persistente desde memoria
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   */
  async syncPersistentFromMemory(userId, context) {
    try {
      const userInfo = this.authenticatedUsers.get(userId);
      if (userInfo) {
        const authData = await this.authState.get(context, {});
        authData[userId] = {
          authenticated: true,
          email: userInfo.email,
          name: userInfo.name,
          token: userInfo.token,
          lastAuthenticated: new Date().toISOString()
        };
        await this.authState.set(context, authData);
        await this.userState.saveChanges(context);
        console.log(`[${userId}] Estado persistente sincronizado desde memoria`);
      }
    } catch (error) {
      console.error(`[${userId}] Error sincronizando persistente desde memoria:`, error);
    }
  }

  /**
   * NUEVO: Sincroniza memoria desde estado persistente
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @param {Object} authData - Datos de autenticación persistentes
   */
  async syncMemoryFromPersistent(userId, context, authData) {
    try {
      if (authData && authData.authenticated) {
        this.authenticatedUsers.set(userId, {
          email: authData.email,
          name: authData.name,
          token: authData.token,
          context: context
        });
        console.log(`[${userId}] Memoria sincronizada desde estado persistente`);
      }
    } catch (error) {
      console.error(`[${userId}] Error sincronizando memoria desde persistente:`, error);
    }
  }

  /**
   * Maneja nuevos miembros
   */
  async handleMembersAdded(context, next) {
    for (const member of context.activity.membersAdded) {
      if (member.id !== context.activity.recipient.id) {
        await context.sendActivity('👋 **Bienvenido a Alfa Bot**\n\nEscribe `login` para iniciar sesión. Una vez autenticado, puedes preguntarme cualquier cosa sobre vacaciones, información personal, recibos y mucho más.');
      }
    }
    await next();
  }

  /**
   * Maneja todos los mensajes entrantes - VERSIÓN CON FIX DE DOBLE AUTENTICACIÓN
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();

      console.log(`\n=== MENSAJE ENTRANTE ===`);
      console.log(`Usuario: ${userId}`);
      console.log(`Mensaje: "${text}"`);
      console.log(`Timestamp: ${new Date().toISOString()}`);

      // Verificar si hay un proceso activo, pero con timeout
      if (this.activeProcesses.has(userId)) {
        const processStartTime = this.activeProcesses.get(userId);
        const timeElapsed = Date.now() - processStartTime;
        
        if (timeElapsed > 30000) {
          console.warn(`[${userId}] Limpiando proceso activo obsoleto (${timeElapsed}ms)`);
          this.activeProcesses.delete(userId);
          this.activeDialogs.delete(`auth-${userId}`);
        } else {
          console.log(`[${userId}] Proceso activo, ignorando mensaje`);
          return await next();
        }
      }

      // Verificar diálogos activos con timeout también
      if (this.activeDialogs.has(`auth-${userId}`)) {
        console.log(`[${userId}] Diálogo de autenticación activo`);
        return await next();
      }

      this.activeProcesses.set(userId, Date.now());

      try {
        // CORREGIDO: Usar verificación mejorada de autenticación
        const isAuthenticated = await this.isUserAuthenticatedEnhanced(userId, context);

        console.log(`[${userId}] ==> RESULTADO FINAL DE AUTENTICACIÓN: ${isAuthenticated}`);

        // Procesar comandos específicos
        if (this._isExplicitLoginCommand(text)) {
          if (isAuthenticated) {
            // FIX: Si ya está autenticado, no procesar login
            await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot! Escribe cualquier mensaje para empezar.');
          } else {
            await this._handleLoginRequest(context, userId);
          }
        } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
          await this._handleCardSubmit(context, context.activity.value);
        } else if (this._isLogoutRequest(text)) {
          await this._handleLogoutRequest(context, userId);
        } else {
          // Mensajes generales - requieren autenticación
          if (isAuthenticated) {
            console.log(`[${userId}] Procesando mensaje autenticado`);
            if (this._isAmbiguousVacationQuery(context.activity.text)) {
              await this._handleAmbiguousVacationQuery(context);
            } else {
              await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
            }
          } else {
            console.log(`[${userId}] Usuario no autenticado, solicitando login`);
            await context.sendActivity('🔒 **Necesitas iniciar sesión para usar el asistente**\n\nEscribe `login` para autenticarte.');
          }
        }
      } finally {
        // Limpiar proceso activo después de completar
        this.activeProcesses.delete(userId);
        console.log(`[${userId}] Proceso completado, limpiando estados`);
      }

    } catch (error) {
      console.error('Error en handleMessageWithAuth:', error);
      await context.sendActivity('❌ Ocurrió un error inesperado. Intenta de nuevo.');

      const userId = context.activity.from.id;
      // Limpiar todos los estados en caso de error
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
    }

    await next();
  }

  /**
   * Verifica comandos específicos
   */
  _isExplicitLoginCommand(text) {
    return text === 'login' || text === 'iniciar sesion' || text === 'iniciar sesión';
  }

  _isLogoutRequest(text) {
    return ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'].includes(text);
  }

  /**
   * Detecta consultas ambiguas de vacaciones
   */
  _isAmbiguousVacationQuery(message) {
    const lowerMessage = message.toLowerCase();

    const ambiguousPatterns = [
      'quiero vacaciones',
      'solicitar vacaciones',
      'pedir vacaciones',
      'necesito vacaciones',
      'tramitar vacaciones'
    ];

    const specificWords = [
      'matrimonio', 'boda', 'casarse',
      'nacimiento', 'bebé', 'paternidad', 'maternidad',
      'consultar', 'ver mis', 'estado de',
      'simular', 'verificar', 'información', 'info', 'tipos'
    ];

    const hasAmbiguousPattern = ambiguousPatterns.some(pattern => lowerMessage.includes(pattern));
    const hasSpecificWord = specificWords.some(word => lowerMessage.includes(word));

    return hasAmbiguousPattern && !hasSpecificWord;
  }

  /**
   * Maneja consultas ambiguas de vacaciones
   */
  async _handleAmbiguousVacationQuery(context) {
    const guidePrompt = "El usuario quiere solicitar vacaciones pero no especifica el tipo. Usa la herramienta guiar_proceso_vacaciones.";

    try {
      const response = await this.openaiService.procesarMensaje(guidePrompt, []);

      if (response.type === 'card') {
        if (response.content) {
          await context.sendActivity(response.content);
        }
        await context.sendActivity({ attachments: [response.card] });
      } else {
        await context.sendActivity(response.content || response);
      }
    } catch (error) {
      console.error('Error procesando consulta ambigua:', error);
      await context.sendActivity('🏖️ Para solicitar vacaciones, necesito saber qué tipo necesitas:\n\n• **Vacaciones regulares** - días anuales\n• **Por matrimonio** - días especiales por boda\n• **Por nacimiento** - paternidad/maternidad\n\n¿Cuál necesitas?');
    }
  }

  /**
   * Maneja solicitudes de login - VERSIÓN MEJORADA
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;

    // CORREGIDO: Verificar con método mejorado
    const isAuthenticated = await this.isUserAuthenticatedEnhanced(userId, context);
    if (isAuthenticated) {
      await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot!');
      return;
    }

    if (this.activeDialogs.has(dialogKey)) {
      await context.sendActivity('⏳ Ya tienes un proceso de autenticación en curso.');
      return;
    }
    
    this.activeDialogs.add(dialogKey);

    // Establecer timeout para autenticación
    this.authTimeoutManager.setAuthTimeout(userId, context, async (timeoutUserId) => {
      this.activeDialogs.delete(`auth-${timeoutUserId}`);
      this.activeProcesses.delete(timeoutUserId);
      console.log(`Timeout de autenticación para usuario ${timeoutUserId}`);
    });

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;

      if (!connectionName) {
        await context.sendActivity('❌ **Error de configuración OAuth**');
        return;
      }

      console.log(`[${userId}] Iniciando diálogo de autenticación`);
      await this.dialog.run(context, this.dialogState);

    } catch (error) {
      console.error(`[${userId}] Error en _handleLoginRequest:`, error);
      await context.sendActivity('❌ Error al iniciar el proceso de autenticación.');

      // Limpiar estados en caso de error
      this.activeDialogs.delete(dialogKey);
      this.authTimeoutManager.clearAuthTimeout(userId);
    }
  }

  /**
   * Maneja solicitudes de logout
   */
  async _handleLogoutRequest(context, userId) {
    try {
      // Limpiar cache de verificación primero
      this.authVerificationCache.delete(`auth_${userId}`);
      
      // Limpiar estado de autenticación
      const authData = await this.authState.get(context, {});
      if (authData[userId]) {
        delete authData[userId];
        await this.authState.set(context, authData);
        await this.userState.saveChanges(context);
      }

      // Limpiar memoria y estados
      this.authenticatedUsers.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
      this.authMessagesShown.delete(userId);

      await context.sendActivity('✅ **Sesión cerrada exitosamente**');
      console.log(`[${userId}] Logout completado`);
    } catch (error) {
      console.error(`[${userId}] Error en logout:`, error);
      await context.sendActivity('❌ Error al cerrar sesión.');
    }
  }

  /**
   * Marca usuario como autenticado - VERSIÓN MEJORADA
   */
  async setUserAuthenticated(userId, conversationId, userData) {
    try {
      const { email, name, token, context } = userData;

      console.log(`\n=== ESTABLECIENDO AUTENTICACIÓN ===`);
      console.log(`Usuario: ${userId}`);
      console.log(`Email: ${email}`);
      console.log(`Timestamp: ${new Date().toISOString()}`);
      
      // 1. Limpiar cache de verificación primero
      this.authVerificationCache.delete(`auth_${userId}`);
      
      // 2. Almacenar en memoria
      this.authenticatedUsers.set(userId, { email, name, token, context });
      console.log(`[${userId}] ✅ Almacenado en memoria`);

      // 3. Almacenar persistentemente
      const authData = await this.authState.get(context, {});
      authData[userId] = {
        authenticated: true,
        email,
        name,
        token,
        lastAuthenticated: new Date().toISOString()
      };
      await this.authState.set(context, authData);
      await this.userState.saveChanges(context);
      console.log(`[${userId}] ✅ Almacenado persistentemente`);

      // 4. Limpiar diálogos activos y timeouts después de autenticación exitosa
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      this.authMessagesShown.delete(userId);

      console.log(`[${userId}] ✅ Estados limpiados post-autenticación`);

      // 5. Crear registro de conversación
      try {
        await this.conversationService.createConversation(conversationId, userId);
        console.log(`[${userId}] ✅ Conversación creada`);
      } catch (error) {
        console.warn(`[${userId}] Error creando conversación:`, error.message);
      }

      console.log(`[${userId}] 🎉 AUTENTICACIÓN COMPLETADA EXITOSAMENTE`);
      return true;
      
    } catch (error) {
      console.error(`[${userId}] ❌ Error en setUserAuthenticated:`, error);
      return false;
    }
  }

  /**
   * CORREGIDO: Verifica si un usuario está autenticado (método simple para compatibilidad)
   */
  isUserAuthenticated(userId) {
    return this.authenticatedUsers.has(userId);
  }

  /**
   * Maneja submit de tarjetas adaptativas
   */
  async _handleCardSubmit(context, submitData) {
    await handleCardSubmit(
      context,
      submitData,
      this._getUserOAuthToken.bind(this),
      this._handleTokenExpiration.bind(this),
      isTokenValid,
      this.openaiService
    );
  }

  /**
   * Obtiene token OAuth del usuario
   */
  async _getUserOAuthToken(context, userId) {
    try {
      // Primero intentar obtener de la memoria
      const userInfo = this.authenticatedUsers.get(userId);
      if (userInfo && userInfo.token) {
        return userInfo.token;
      }

      // Intentar obtener del UserTokenClient
      const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey);
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;

      if (userTokenClient && connectionName) {
        const tokenResponse = await userTokenClient.getUserToken(
          userId,
          connectionName,
          context.activity.channelId
        );

        if (tokenResponse && tokenResponse.token) {
          if (userInfo) {
            userInfo.token = tokenResponse.token;
            this.authenticatedUsers.set(userId, userInfo);
          }
          return tokenResponse.token;
        }
      }

      // Verificar estado persistente
      const authData = await this.authState.get(context, {});
      if (authData[userId] && authData[userId].token) {
        return authData[userId].token;
      }

      return null;
    } catch (error) {
      console.error(`[${userId}] Error obteniendo token OAuth:`, error);
      return null;
    }
  }

  /**
   * Maneja expiración de token
   */
  async _handleTokenExpiration(context, userId) {
    console.log(`[${userId}] Manejando expiración de token`);
    
    // Limpiar cache de verificación
    this.authVerificationCache.delete(`auth_${userId}`);
    
    // Limpiar estado de autenticación
    const authData = await this.authState.get(context, {});
    if (authData[userId]) {
      delete authData[userId];
      await this.authState.set(context, authData);
      await this.userState.saveChanges(context);
    }

    this.authenticatedUsers.delete(userId);
    this.activeProcesses.delete(userId);
    this.activeDialogs.delete(`auth-${userId}`);
    this.authMessagesShown.delete(userId);

    await context.sendActivity('🔐 **Tu sesión ha expirado**\n\nEscribe `login` para autenticarte nuevamente.');
  }

  /**
   * Maneja actividades invoke - VERSIÓN CORREGIDA
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      console.log(`\n=== INVOKE ACTIVITY ===`);
      console.log(`Actividad: ${activityName}`);
      console.log(`Usuario: ${userId}`);
      console.log(`Timestamp: ${new Date().toISOString()}`);

      if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
        console.log(`[${userId}] Procesando ${activityName}`);
        
        try {
          await this.dialog.run(context, this.dialogState);
          return { status: 200 };
        } catch (error) {
          console.error(`[${userId}] Error en ${activityName}:`, error);
          return { status: 500 };
        }
      } else if (activityName === 'signin/failure') {
        console.log(`[${userId}] Autenticación fallida`);
        
        // Limpiar todos los estados en caso de falla
        this.activeDialogs.delete(dialogKey);
        this.activeProcesses.delete(userId);
        this.authTimeoutManager.clearAuthTimeout(userId);
        this.authVerificationCache.delete(`auth_${userId}`);

        const messageKey = `auth_failed_${userId}`;
        if (!this.authMessagesShown.has(messageKey)) {
          this.authMessagesShown.add(messageKey);
          
          setTimeout(() => {
            this.authMessagesShown.delete(messageKey);
          }, 30000);

          await context.sendActivity('❌ **Proceso de autenticación interrumpido**\n\n' +
            'El proceso no se completó correctamente. Escribe `login` para intentar nuevamente.');
        }

        return { status: 200 };
      }

      return await super.onInvokeActivity(context);
    } catch (error) {
      console.error(`Error en onInvokeActivity:`, error);

      const userId = context.activity.from.id;
      // Limpiar estados en caso de error
      this.activeDialogs.delete(`auth-${userId}`);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      this.authVerificationCache.delete(`auth_${userId}`);

      return { status: 500 };
    }
  }

  /**
   * Procesa mensajes con OpenAI
   */
  async processOpenAIMessage(context, message, userId, conversationId) {
    try {
      // Verificar token OAuth
      const oauthToken = await this._getUserOAuthToken(context, userId);
      if (!oauthToken) {
        await this._handleTokenExpiration(context, userId);
        return;
      }

      await context.sendActivity({ type: 'typing' });

      // Guardar mensaje del usuario
      try {
        await this.conversationService.saveMessage(message, conversationId, userId);
      } catch (error) {
        console.warn(`[${userId}] Error guardando mensaje:`, error.message);
      }

      // Obtener historial de conversación
      let history = [];
      try {
        history = await this.conversationService.getConversationHistory(conversationId);
      } catch (error) {
        console.warn(`[${userId}] Error obteniendo historial:`, error.message);
      }

      // Formatear historial para OpenAI
      const formattedHistory = history.map(item => ({
        type: item.userId === userId ? 'user' : 'assistant',
        message: item.message
      }));

      // Procesar con OpenAI
      const response = await this.openaiService.procesarMensaje(message, formattedHistory);

      // Manejar respuesta
      if (response.type === 'card') {
        if (response.content) {
          await context.sendActivity(response.content);
        }

        if (Array.isArray(response.card)) {
          for (const card of response.card) {
            await context.sendActivity({ attachments: [card] });
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          await context.sendActivity({ attachments: [response.card] });
        }

        try {
          const botMessage = response.content || 'Tarjeta enviada';
          await this.conversationService.saveMessage(botMessage, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          console.warn(`[${userId}] Error guardando respuesta:`, error.message);
        }
      } else {
        const responseContent = response.content || response;

        try {
          await this.conversationService.saveMessage(responseContent, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          console.warn(`[${userId}] Error guardando respuesta:`, error.message);
        }

        await context.sendActivity(responseContent);
      }

    } catch (error) {
      console.error(`[${userId}] Error en processOpenAIMessage:`, error);
      await context.sendActivity('❌ Error al procesar tu mensaje. Intenta más tarde.');
    }
  }

  /**
   * Cierra sesión de usuario
   */
  logoutUser(userId) {
    if (this.authenticatedUsers.has(userId)) {
      // Limpiar cache de verificación
      this.authVerificationCache.delete(`auth_${userId}`);
      
      this.authenticatedUsers.delete(userId);

      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      this.authMessagesShown.delete(userId);

      console.log(`[${userId}] Usuario ha cerrado sesión`);
      return true;
    }
    return false;
  }

  /**
   * Asegura que el bot esté en el contexto
   */
  _ensureBotInContext(context) {
    if (!context.turnState.get('bot')) {
      context.turnState.set('bot', this);
    }
    if (!context.turnState.get('ConversationState')) {
      context.turnState.set('ConversationState', this.conversationState);
    }
    if (!context.turnState.get('UserState')) {
      context.turnState.set('UserState', this.userState);
    }
  }

  /**
   * Obtiene estadísticas del bot
   */
  getStats() {
    return {
      authenticatedUsers: this.authenticatedUsers.size,
      activeDialogs: this.activeDialogs.size,
      activeProcesses: this.activeProcesses.size,
      authTimeouts: this.authTimeoutManager.getActiveTimeouts(),
      authMessagesShown: this.authMessagesShown.size,
      authVerificationCache: this.authVerificationCache.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Método de limpieza para mantenimiento - MEJORADO
   */
  cleanupStaleProcesses() {
    const now = Date.now();
    const staleProcesses = [];
    
    for (const [userId, startTime] of this.activeProcesses.entries()) {
      const timeElapsed = now - startTime;
      if (timeElapsed > 60000) { // 1 minuto
        staleProcesses.push(userId);
      }
    }
    
    staleProcesses.forEach(userId => {
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
      this.authMessagesShown.delete(userId);
      // NUEVO: Limpiar también cache de verificación
      this.authVerificationCache.delete(`auth_${userId}`);
    });
    
    if (staleProcesses.length > 0) {
      console.warn(`Limpiados ${staleProcesses.length} procesos obsoletos`);
    }
    
    return staleProcesses.length;
  }

  /**
   * NUEVO: Fuerza verificación de autenticación desde cero
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @returns {boolean} - Estado de autenticación verificado
   */
  async forceAuthVerification(userId, context) {
    // Limpiar cache
    this.authVerificationCache.delete(`auth_${userId}`);
    
    // Verificar desde cero
    return await this.isUserAuthenticatedEnhanced(userId, context);
  }
}

module.exports.TeamsBot = TeamsBot;