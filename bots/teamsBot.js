// teamsBot.js - Código completo corregido con manejo de timeouts mejorado

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
 * TeamsBot class - Versión completa corregida para el manejo de timeouts
 */
class TeamsBot extends DialogBot {
  constructor(conversationState, userState, dialog) {
    super(conversationState, userState, dialog);

    // CORRECCIÓN: Registrar instancia globalmente ANTES de inicializar otros componentes
    global.botInstance = this;

    // CORRECCIÓN: Asegurar que el adapter esté disponible
    this.adapter = null; // Se establecerá cuando se use el bot

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
    
    // CORRECCIÓN: Inicializar gestor de timeouts con tiempo reducido
    this.authTimeoutManager = new AuthTimeoutManager(2 * 60 * 1000); // 2 minutos
    
    // CORRECCIÓN: Configurar cleanup automático cada 5 minutos
    this.setupPeriodicCleanup();
  }

  /**
   * NUEVO: Configura limpieza periódica de estados obsoletos
   * @private
   */
  setupPeriodicCleanup() {
    setInterval(() => {
      try {
        // Limpiar procesos obsoletos
        const staleProcesses = this.cleanupStaleProcesses();
        
        // Limpiar timeouts expirados
        this.authTimeoutManager.cleanupExpiredTimeouts();
        
        if (staleProcesses > 0) {
          console.log(`Limpieza periódica: ${staleProcesses} procesos obsoletos removidos`);
        }
      } catch (error) {
        console.error('Error en limpieza periódica:', error);
      }
    }, 5 * 60 * 1000); // Cada 5 minutos
  }

  /**
   * Override run method para asegurar que el adapter esté disponible
   * @param {TurnContext} context - The context object for the turn.
   */
  async run(context) {
    // CORRECCIÓN: Asegurar que el adapter esté disponible para messaging proactivo
    if (!this.adapter && context.adapter) {
      this.adapter = context.adapter;
    }

    // Llamar al método padre
    await super.run(context);
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
   * Maneja todos los mensajes entrantes - VERSIÓN CORREGIDA CON PRIORIDAD PARA COMANDOS DE EMERGENCIA
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();
      const activityType = context.activity.type;

      console.log(`[${userId}] Mensaje recibido: "${text}" (Tipo: ${activityType})`);

      // CORRECCIÓN: Solo procesar actividades de tipo 'message'
      if (activityType !== 'message') {
        console.log(`[${userId}] Ignorando actividad tipo ${activityType}`);
        return await next();
      }

      // 🚨 CORRECCIÓN CRÍTICA: Comandos de emergencia tienen prioridad absoluta
      const emergencyCommands = ['logout', 'cerrar sesion', 'cerrar sesión', 'salir', 'exit', 'reset'];
      const isEmergencyCommand = emergencyCommands.includes(text);
      
      if (isEmergencyCommand) {
        console.log(`[${userId}] Comando de emergencia detectado: "${text}"`);
        
        // Limpiar TODOS los estados inmediatamente
        this.cleanupUserStates(userId);
        
        // Limpiar en MainDialog también
        const mainDialog = global.mainDialogInstance;
        if (mainDialog) {
          mainDialog.endUserDialog(userId);
        }
        
        console.log(`[${userId}] Estados limpiados por comando de emergencia`);
        
        // Procesar el logout directamente
        await this._handleLogoutRequest(context, userId);
        return await next();
      }

      // CORRECCIÓN: Verificar si hay un proceso activo con timeout más estricto
      if (this.activeProcesses.has(userId)) {
        const processStartTime = this.activeProcesses.get(userId);
        const timeElapsed = Date.now() - processStartTime;
        
        // Reducir timeout a 15 segundos para evitar bloqueos largos
        if (timeElapsed > 15000) {
          console.warn(`[${userId}] Limpiando proceso activo obsoleto (${timeElapsed}ms)`);
          this.cleanupUserStates(userId);
        } else {
          console.log(`[${userId}] Proceso activo reciente (${timeElapsed}ms), ignorando mensaje`);
          return await next();
        }
      }

      // CORRECCIÓN: Verificar diálogos activos con timeout
      const dialogKey = `auth-${userId}`;
      if (this.activeDialogs.has(dialogKey)) {
        console.log(`[${userId}] Diálogo de autenticación activo, ignorando mensaje`);
        return await next();
      }

      // CORRECCIÓN: Marcar proceso como activo SOLO para comandos específicos
      const needsProcessing = this._isExplicitLoginCommand(text) || 
                            (context.activity.value && Object.keys(context.activity.value).length > 0);

      if (needsProcessing) {
        this.activeProcesses.set(userId, Date.now());
        console.log(`[${userId}] Proceso marcado como activo para comando: ${text}`);
      }

      try {
        // Recuperar estado de autenticación
        const authData = await this.authState.get(context, {});
        const isAuthenticated = authData[userId]?.authenticated === true;

        console.log(`[${userId}] Estado de autenticación: ${isAuthenticated}`);

        // Procesar comandos específicos
        if (this._isExplicitLoginCommand(text)) {
          await this._handleLoginRequest(context, userId);
        } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
          await this._handleCardSubmit(context, context.activity.value);
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
        // CORRECCIÓN: Solo limpiar si se marcó como activo
        if (needsProcessing) {
          this.activeProcesses.delete(userId);
          console.log(`[${userId}] Proceso completado y limpiado`);
        }
      }

    } catch (error) {
      console.error(`[${context.activity.from.id}] Error en handleMessageWithAuth:`, error);
      await context.sendActivity('❌ Ocurrió un error inesperado. Intenta de nuevo.');
      
      const userId = context.activity.from.id;
      // CORRECCIÓN: Limpiar todos los estados en caso de error
      this.cleanupUserStates(userId);
    }

    await next();
  }

  /**
   * Verifica comandos específicos
   */
  _isExplicitLoginCommand(text) {
    return text === 'login' || text === 'iniciar sesion' || text === 'iniciar sesión';
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
   * Maneja solicitudes de login - VERSIÓN CORREGIDA PARA TIMEOUTS
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;
    
    console.log(`[${userId}] Iniciando proceso de login`);
    
    // CORRECCIÓN: Verificar si ya está autenticado ANTES de iniciar proceso
    const authData = await this.authState.get(context, {});
    if (authData[userId]?.authenticated === true) {
      console.log(`[${userId}] Ya está autenticado, saltando proceso`);
      await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot!');
      return;
    }
    
    // CORRECCIÓN: Verificar si hay un diálogo activo
    if (this.activeDialogs.has(dialogKey)) {
      console.log(`[${userId}] Ya hay un proceso de autenticación activo`);
      await context.sendActivity('⏳ Ya tienes un proceso de autenticación en curso. Por favor, completa el proceso actual.');
      return;
    }
    
    // CORRECCIÓN: Marcar diálogo como activo ANTES de iniciar
    this.activeDialogs.add(dialogKey);
    console.log(`[${userId}] Marcando diálogo como activo`);

    // CORRECCIÓN: Establecer timeout con callback mejorado que NO usa contexto revocado
    this.authTimeoutManager.setAuthTimeout(userId, context, async (timeoutUserId) => {
      console.log(`[${timeoutUserId}] Ejecutando limpieza por timeout`);
      
      // Limpiar estados locales
      this.activeDialogs.delete(`auth-${timeoutUserId}`);
      this.activeProcesses.delete(timeoutUserId);
      
      // Limpiar en MainDialog también
      const mainDialog = global.mainDialogInstance;
      if (mainDialog) {
        mainDialog.endUserDialog(timeoutUserId);
      }
      
      // CORRECCIÓN: No intentar enviar mensaje aquí - se maneja en AuthTimeoutManager
      console.log(`[${timeoutUserId}] Estados limpiados por timeout`);
    });

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
      
      if (!connectionName) {
        console.error(`[${userId}] No se encontró connectionName en las variables de entorno`);
        await context.sendActivity('❌ **Error de configuración OAuth**\n\nLa configuración de autenticación no está disponible. Contacta al administrador.');
        return;
      }
      
      console.log(`[${userId}] Iniciando diálogo OAuth con connectionName: ${connectionName}`);
      
      // CORRECCIÓN: Enviar mensaje de inicio una sola vez
      await context.sendActivity('🔄 **Iniciando autenticación...**\n\nTe redirigiremos al sistema de login corporativo.\n\n⏱️ **Importante**: Completa el proceso en menos de 2 minutos para evitar que expire.');
      
      // Iniciar el diálogo OAuth
      await this.dialog.run(context, this.dialogState);
      
      console.log(`[${userId}] Diálogo OAuth iniciado exitosamente`);
      
    } catch (error) {
      console.error(`[${userId}] Error en _handleLoginRequest:`, error);
      await context.sendActivity('❌ **Error al iniciar autenticación**\n\nOcurrió un problema al iniciar el proceso de autenticación. Intenta nuevamente.');
      
      // CORRECCIÓN: Limpiar estados en caso de error
      this.activeDialogs.delete(dialogKey);
      this.authTimeoutManager.clearAuthTimeout(userId);
    }
  }

  /**
   * Maneja solicitudes de logout - VERSIÓN MEJORADA
   */
  async _handleLogoutRequest(context, userId) {
    try {
      console.log(`[${userId}] Iniciando proceso de logout`);
      
      // CORRECCIÓN: Limpiar timeout inmediatamente
      this.authTimeoutManager.clearAuthTimeout(userId);
      
      // Limpiar estado de autenticación
      const authData = await this.authState.get(context, {});
      if (authData[userId]) {
        delete authData[userId];
        await this.authState.set(context, authData);
        await this.userState.saveChanges(context);
      }

      // Limpiar memoria y estados
      this.authenticatedUsers.delete(userId);
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);

      // Limpiar en MainDialog también
      const mainDialog = global.mainDialogInstance;
      if (mainDialog) {
        mainDialog.endUserDialog(userId);
      }

      await context.sendActivity('✅ **Sesión cerrada exitosamente**\n\n🔒 Para volver a usar el bot, escribe `login` para autenticarte nuevamente.');
      
      console.log(`[${userId}] Logout completado exitosamente`);
      
    } catch (error) {
      console.error(`[${userId}] Error en logout:`, error);
      await context.sendActivity('❌ Error al cerrar sesión. Intenta nuevamente.');
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
   * Maneja expiración de token - VERSIÓN MEJORADA
   */
  async _handleTokenExpiration(context, userId) {
    console.log(`[${userId}] Manejando expiración de token`);
    
    // CORRECCIÓN: Limpiar timeout si existe
    this.authTimeoutManager.clearAuthTimeout(userId);
    
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
    
    await context.sendActivity('🔐 **Tu sesión ha expirado**\n\nEscribe `login` para autenticarte nuevamente.');
  }

  /**
   * Maneja actividades invoke - VERSIÓN CORREGIDA Y MEJORADA
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      console.log(`[${userId}] onInvokeActivity - Actividad: ${activityName}`);

      // CORRECCIÓN: Manejar actividades OAuth específicas
      if (activityName === 'signin/verifyState') {
        console.log(`[${userId}] Procesando signin/verifyState`);
        
        try {
          // Asegurarse de que el diálogo esté marcado como activo
          if (!this.activeDialogs.has(dialogKey)) {
            console.log(`[${userId}] Agregando diálogo a activeDialogs para verifyState`);
            this.activeDialogs.add(dialogKey);
          }
          
          const result = await this.dialog.run(context, this.dialogState);
          console.log(`[${userId}] signin/verifyState procesado correctamente`);
          
          return { status: 200 };
        } catch (error) {
          console.error(`[${userId}] Error en signin/verifyState:`, error);
          return { status: 500 };
        }
      } 
      else if (activityName === 'signin/tokenExchange') {
        console.log(`[${userId}] Procesando signin/tokenExchange`);
        
        try {
          // Asegurarse de que el diálogo esté marcado como activo
          if (!this.activeDialogs.has(dialogKey)) {
            console.log(`[${userId}] Agregando diálogo a activeDialogs para tokenExchange`);
            this.activeDialogs.add(dialogKey);
          }
          
          const result = await this.dialog.run(context, this.dialogState);
          console.log(`[${userId}] signin/tokenExchange procesado correctamente`);
          
          return { status: 200 };
        } catch (error) {
          console.error(`[${userId}] Error en signin/tokenExchange:`, error);
          return { status: 500 };
        }
      } 
      else if (activityName === 'signin/failure') {
        console.log(`[${userId}] Procesando signin/failure`);
        
        // CORRECCIÓN: Limpiar todos los estados en caso de falla
        this.cleanupUserStates(userId);
        
        await context.sendActivity('❌ **Autenticación fallida**\n\n' +
          'El proceso de autenticación no se completó correctamente.\n\n' +
          '**Posibles causas:**\n' +
          '• Se canceló el proceso en la ventana de login\n' +
          '• Hubo un error en el servidor de autenticación\n' +
          '• La sesión expiró durante el proceso\n\n' +
          '**Solución:**\n' +
          '• Escribe `login` para intentar nuevamente\n' +
          '• Asegúrate de completar todo el proceso sin cerrar ventanas\n' +
          '• Verifica tu conexión a internet');
        
        return { status: 200 };
      }
      else if (activityName === 'signin/success') {
        console.log(`[${userId}] Procesando signin/success`);
        
        try {
          const result = await this.dialog.run(context, this.dialogState);
          console.log(`[${userId}] signin/success procesado correctamente`);
          
          return { status: 200 };
        } catch (error) {
          console.error(`[${userId}] Error en signin/success:`, error);
          return { status: 500 };
        }
      }
      else {
        console.log(`[${userId}] Actividad invoke no reconocida: ${activityName}`);
        // Para otras actividades invoke, usar el manejador base
        return await super.onInvokeActivity(context);
      }

    } catch (error) {
      console.error(`[${context.activity.from.id}] Error crítico en onInvokeActivity:`, error);
      
      const userId = context.activity.from.id;
      // CORRECCIÓN: Limpiar estados en caso de error crítico
      this.cleanupUserStates(userId);
      
      try {
        await context.sendActivity('❌ **Error en el proceso de autenticación**\n\n' +
          'Ocurrió un problema técnico durante la autenticación. Intenta escribir `login` nuevamente.');
      } catch (sendError) {
        console.error(`[${userId}] Error enviando mensaje de error:`, sendError);
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
        console.warn('Error guardando mensaje:', error.message);
      }

      // Obtener historial de conversación
      let history = [];
      try {
        history = await this.conversationService.getConversationHistory(conversationId);
      } catch (error) {
        console.warn('Error obteniendo historial:', error.message);
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
          console.warn('Error guardando respuesta:', error.message);
        }
      } else {
        const responseContent = response.content || response;
        
        try {
          await this.conversationService.saveMessage(responseContent, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          console.warn('Error guardando respuesta:', error.message);
        }

        await context.sendActivity(responseContent);
      }

    } catch (error) {
      console.error('Error en processOpenAIMessage:', error);
      await context.sendActivity('❌ Error al procesar tu mensaje. Intenta más tarde.');
    }
  }

  /**
   * Marca usuario como autenticado - VERSIÓN CORREGIDA Y MEJORADA
   */
  async setUserAuthenticated(userId, conversationId, userData) {
    try {
      const { email, name, token, context } = userData;
      
      console.log(`[${userId}] Marcando usuario como autenticado - Email: ${email}`);
      
      // CORRECCIÓN: Limpiar timeout ANTES de marcar como autenticado
      this.authTimeoutManager.clearAuthTimeout(userId);
      
      // CORRECCIÓN: Limpiar diálogos activos y timeouts ANTES de marcar como autenticado
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      
      console.log(`[${userId}] Estados de autenticación limpiados`);
      
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

      console.log(`[${userId}] Usuario marcado como autenticado exitosamente`);

      // Crear registro de conversación
      try {
        await this.conversationService.createConversation(conversationId, userId);
      } catch (error) {
        console.warn(`[${userId}] Error creando conversación:`, error.message);
      }

      return true;
    } catch (error) {
      console.error(`[${userId}] Error en setUserAuthenticated:`, error);
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
      this.cleanupUserStates(userId);
      console.log(`Usuario ${userId} ha cerrado sesión`);
      return true;
    }
    return false;
  }

  /**
   * NUEVO: Limpia procesos obsoletos específicos del usuario
   * @param {string} userId - ID del usuario
   * @returns {boolean} - Si se limpió algo
   */
  cleanupUserStates(userId) {
    let cleaned = false;
    
    // Limpiar procesos activos
    if (this.activeProcesses.has(userId)) {
      this.activeProcesses.delete(userId);
      cleaned = true;
    }
    
    // Limpiar diálogos activos
    if (this.activeDialogs.has(`auth-${userId}`)) {
      this.activeDialogs.delete(`auth-${userId}`);
      cleaned = true;
    }
    
    // Limpiar timeout
    if (this.authTimeoutManager.hasActiveTimeout(userId)) {
      this.authTimeoutManager.clearAuthTimeout(userId);
      cleaned = true;
    }
    
    if (cleaned) {
      console.log(`[${userId}] Estados limpiados automáticamente`);
    }
    
    return cleaned;
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
   * Obtiene estadísticas del bot - VERSIÓN MEJORADA
   */
  getStats() {
    const timeoutStats = this.authTimeoutManager.getActiveTimeouts();
    
    return {
      authenticatedUsers: this.authenticatedUsers.size,
      activeDialogs: this.activeDialogs.size,
      activeProcesses: this.activeProcesses.size,
      authTimeouts: timeoutStats.active,
      authTimeoutDetails: timeoutStats.timeouts,
      adapterAvailable: !!this.adapter,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * NUEVA FUNCIÓN: Método de limpieza para mantenimiento - VERSIÓN MEJORADA
   */
  cleanupStaleProcesses() {
    const now = Date.now();
    const staleProcesses = [];
    
    for (const [userId, startTime] of this.activeProcesses.entries()) {
      const timeElapsed = now - startTime;
      if (timeElapsed > 3 * 60 * 1000) { // 3 minutos
        staleProcesses.push(userId);
      }
    }
    
    staleProcesses.forEach(userId => {
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
      this.authTimeoutManager.clearAuthTimeout(userId);
    });
    
    if (staleProcesses.length > 0) {
      console.warn(`Limpiados ${staleProcesses.length} procesos obsoletos`);
    }
    
    return staleProcesses.length;
  }
}

module.exports.TeamsBot = TeamsBot;