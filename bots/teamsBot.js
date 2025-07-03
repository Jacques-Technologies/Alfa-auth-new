// teamsBot.js - Versión refactorizada y limpia

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
 * TeamsBot class - Versión refactorizada y limpia
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
   * Maneja todos los mensajes entrantes
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();

      // Evitar procesamiento duplicado
      if (this.activeProcesses.has(userId) || this.activeDialogs.has(`auth-${userId}`)) {
        return await next();
      }

      this.activeProcesses.set(userId, Date.now());

      try {
        // Recuperar estado de autenticación
        const authData = await this.authState.get(context, {});
        const isAuthenticated = authData[userId]?.authenticated === true;

        // Procesar comandos específicos
        if (this._isExplicitLoginCommand(text)) {
          await this._handleLoginRequest(context, userId);
        } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
          await this._handleCardSubmit(context, context.activity.value);
        } else if (this._isLogoutRequest(text)) {
          await this._handleLogoutRequest(context, userId);
        } else {
          // Mensajes generales - requieren autenticación
          if (isAuthenticated) {
            if (this._isAmbiguousVacationQuery(context.activity.text)) {
              await this._handleAmbiguousVacationQuery(context);
            } else {
              await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
            }
          } else {
            await context.sendActivity('🔒 Necesitas iniciar sesión para usar el asistente. Escribe `login` para autenticarte.');
          }
        }
      } finally {
        this.activeProcesses.delete(userId);
      }

    } catch (error) {
      console.error('Error en handleMessageWithAuth:', error);
      await context.sendActivity('❌ Ocurrió un error inesperado. Intenta de nuevo.');
      
      const userId = context.activity.from.id;
      this.activeProcesses.delete(userId);
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
   * Maneja solicitudes de login
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;
    
    if (this.activeDialogs.has(dialogKey)) {
      await context.sendActivity('⏳ Ya tienes un proceso de autenticación en curso.');
      return;
    }
    
    // Verificar si ya está autenticado
    const authData = await this.authState.get(context, {});
    if (authData[userId]?.authenticated === true) {
      await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot!');
      return;
    }
    
    this.activeDialogs.add(dialogKey);

    // Establecer timeout para autenticación
    this.authTimeoutManager.setAuthTimeout(userId, context, async (timeoutUserId) => {
      this.activeDialogs.delete(`auth-${timeoutUserId}`);
      this.activeProcesses.delete(timeoutUserId);
    });

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
      
      if (!connectionName) {
        await context.sendActivity('❌ **Error de configuración OAuth**');
        return;
      }
      
      await this.dialog.run(context, this.dialogState);
      
    } catch (error) {
      console.error('Error en _handleLoginRequest:', error);
      await context.sendActivity('❌ Error al iniciar el proceso de autenticación.');
      
      this.activeDialogs.delete(dialogKey);
      this.authTimeoutManager.clearAuthTimeout(userId);
    }
  }

  /**
   * Maneja solicitudes de logout
   */
  async _handleLogoutRequest(context, userId) {
    try {
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

      await context.sendActivity('✅ **Sesión cerrada exitosamente**');
    } catch (error) {
      console.error('Error en logout:', error);
      await context.sendActivity('❌ Error al cerrar sesión.');
    }
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
      console.error('Error obteniendo token OAuth:', error);
      return null;
    }
  }

  /**
   * Maneja expiración de token
   */
  async _handleTokenExpiration(context, userId) {
    // Limpiar estado de autenticación
    const authData = await this.authState.get(context, {});
    if (authData[userId]) {
      delete authData[userId];
      await this.authState.set(context, authData);
      await this.userState.saveChanges(context);
    }
    
    this.authenticatedUsers.delete(userId);
    
    await context.sendActivity('🔐 **Tu sesión ha expirado**\n\nEscribe `login` para autenticarte nuevamente.');
  }

  /**
   * Maneja actividades invoke
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      if (this.activeProcesses.has(userId)) {
        return { status: 200 };
      }

      if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
        if (!this.activeDialogs.has(dialogKey)) {
          this.activeDialogs.add(dialogKey);
          this.activeProcesses.set(userId, Date.now());
          
          try {
            await this.dialog.run(context, this.dialogState);
            return { status: 200 };
          } finally {
            this.activeDialogs.delete(dialogKey);
            this.activeProcesses.delete(userId);
          }
        } else {
          return { status: 200 };
        }
      } else if (activityName === 'signin/failure') {
        this.activeDialogs.delete(dialogKey);
        this.activeProcesses.delete(userId);
        this.authTimeoutManager.clearAuthTimeout(userId);
        
        await context.sendActivity('❌ **Autenticación fallida**\n\n' +
          'El proceso de autenticación no se completó correctamente.\n\n' +
          'Escribe `login` para intentar nuevamente y asegúrate de completar todo el proceso.');
        
        return { status: 200 };
      }

      return await super.onInvokeActivity(context);
    } catch (error) {
      console.error('Error en onInvokeActivity:', error);
      
      const userId = context.activity.from.id;
      this.activeDialogs.delete(`auth-${userId}`);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      
      try {
        await context.sendActivity('❌ **Error en el proceso de autenticación**\n\n' +
          'Ocurrió un problema técnico. Intenta `login` nuevamente.');
      } catch (sendError) {
        console.error('Error enviando mensaje de error:', sendError);
      }
      
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
        // Continuar sin bloquear
      }

      // Obtener historial de conversación
      let history = [];
      try {
        history = await this.conversationService.getConversationHistory(conversationId);
      } catch (error) {
        // Continuar sin bloquear
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
          // Continuar sin bloquear
        }
      } else {
        const responseContent = response.content || response;
        
        try {
          await this.conversationService.saveMessage(responseContent, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          // Continuar sin bloquear
        }

        await context.sendActivity(responseContent);
      }

    } catch (error) {
      console.error('Error en processOpenAIMessage:', error);
      await context.sendActivity('❌ Error al procesar tu mensaje. Intenta más tarde.');
    }
  }

  /**
   * Marca usuario como autenticado
   */
  async setUserAuthenticated(userId, conversationId, userData) {
    try {
      const { email, name, token, context } = userData;
      
      // Almacenar en memoria
      this.authenticatedUsers.set(userId, { email, name, token, context });

      // Almacenar persistentemente
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

      // Limpiar diálogos activos y timeouts
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);

      // Crear registro de conversación
      try {
        await this.conversationService.createConversation(conversationId, userId);
      } catch (error) {
        // Continuar sin bloquear
      }

      return true;
    } catch (error) {
      console.error('Error en setUserAuthenticated:', error);
      return false;
    }
  }

  /**
   * Verifica si un usuario está autenticado
   */
  isUserAuthenticated(userId) {
    return this.authenticatedUsers.has(userId);
  }

  /**
   * Cierra sesión de usuario
   */
  logoutUser(userId) {
    if (this.authenticatedUsers.has(userId)) {
      this.authenticatedUsers.delete(userId);
      
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      
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
      timestamp: new Date().toISOString()
    };
  }
}

module.exports.TeamsBot = TeamsBot;