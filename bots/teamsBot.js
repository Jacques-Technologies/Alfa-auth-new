// teamsBot.js - VERSIÓN MEJORADA CON MEJOR MANEJO DE TOKEN INVÁLIDO

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
 * TeamsBot class - VERSIÓN MEJORADA CON MEJOR MANEJO DE TOKEN INVÁLIDO
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
    
    // MEJORADO: Cache de verificación con mejor manejo de invalidación
    this.authVerificationCache = new Map();
    this.cacheTimeout = 3000; // Reducido a 3 segundos para mejor responsividad
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
   * MEJORADO: Limpia completamente el estado de autenticación de un usuario
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @param {string} reason - Razón de la limpieza
   */
  async forceCleanUserAuthState(userId, context, reason = 'manual') {
    console.log(`[${userId}] 🧹 LIMPIEZA COMPLETA DE AUTENTICACIÓN - Razón: ${reason}`);
    
    try {
      // 1. Limpiar cache de verificación PRIMERO
      this.authVerificationCache.delete(`auth_${userId}`);
      console.log(`[${userId}] ✅ Cache de verificación limpiado`);

      // 2. Limpiar memoria
      if (this.authenticatedUsers.has(userId)) {
        this.authenticatedUsers.delete(userId);
        console.log(`[${userId}] ✅ Usuario removido de memoria`);
      }

      // 3. Limpiar estado persistente
      if (context) {
        try {
          const authData = await this.authState.get(context, {});
          if (authData[userId]) {
            delete authData[userId];
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);
            console.log(`[${userId}] ✅ Estado persistente limpiado`);
          }
        } catch (stateError) {
          console.error(`[${userId}] Error limpiando estado persistente:`, stateError.message);
        }
      }

      // 4. Limpiar procesos activos
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
      console.log(`[${userId}] ✅ Procesos activos limpiados`);

      // 5. Limpiar timeouts
      this.authTimeoutManager.clearAuthTimeout(userId);
      console.log(`[${userId}] ✅ Timeouts limpiados`);

      // 6. Limpiar mensajes mostrados
      this.authMessagesShown.delete(userId);
      
      // Limpiar también versiones con diferentes sufijos
      const messagesToDelete = [];
      for (const messageKey of this.authMessagesShown) {
        if (messageKey.includes(userId)) {
          messagesToDelete.push(messageKey);
        }
      }
      messagesToDelete.forEach(key => this.authMessagesShown.delete(key));
      console.log(`[${userId}] ✅ Mensajes de auth limpiados`);

      // 7. Limpiar en MainDialog
      const mainDialog = global.mainDialogInstance;
      if (mainDialog && typeof mainDialog.emergencyUserCleanup === 'function') {
        mainDialog.emergencyUserCleanup(userId);
        console.log(`[${userId}] ✅ MainDialog limpiado`);
      }

      console.log(`[${userId}] 🎉 LIMPIEZA COMPLETA TERMINADA - Usuario listo para nuevo login`);
      return true;

    } catch (error) {
      console.error(`[${userId}] ❌ Error en limpieza completa:`, error);
      return false;
    }
  }

  /**
   * MEJORADO: Verificación de autenticación con mejor manejo de token inválido
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto del turno
   * @param {boolean} skipCache - Saltar cache para forzar verificación
   * @returns {Object} - Resultado detallado de la verificación
   */
  async isUserAuthenticatedEnhanced(userId, context, skipCache = false) {
    try {
      const cacheKey = `auth_${userId}`;
      
      // 1. Verificar cache solo si no saltamos cache
      if (!skipCache) {
        const cachedResult = this.authVerificationCache.get(cacheKey);
        if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheTimeout) {
          console.log(`[${userId}] 📋 Usando resultado de cache: ${cachedResult.authenticated}`);
          return {
            authenticated: cachedResult.authenticated,
            source: 'cache',
            needsCleanup: false
          };
        }
      }

      // 2. Verificar en memoria
      const memoryAuth = this.authenticatedUsers.has(userId);
      const userInfo = this.authenticatedUsers.get(userId);
      
      // 3. Verificar estado persistente
      const authData = await this.authState.get(context, {});
      const persistentAuth = authData[userId]?.authenticated === true;
      const persistentToken = authData[userId]?.token;

      console.log(`[${userId}] 🔍 Verificación de auth - Memoria: ${memoryAuth}, Persistente: ${persistentAuth}`);

      // 4. NUEVO: Verificar validez del token si existe
      let tokenValid = false;
      const tokenToCheck = userInfo?.token || persistentToken;
      
      if (tokenToCheck) {
        try {
          console.log(`[${userId}] 🔑 Verificando validez del token...`);
          tokenValid = await isTokenValid(tokenToCheck);
          console.log(`[${userId}] 🔑 Token válido: ${tokenValid}`);
        } catch (tokenError) {
          console.warn(`[${userId}] Error verificando token:`, tokenError.message);
          tokenValid = false;
        }
      }

      // 5. MEJORADO: Lógica de decisión
      let finalAuth = false;
      let needsCleanup = false;
      let source = 'verification';

      if (tokenToCheck && !tokenValid) {
        // TOKEN INVÁLIDO - Limpiar todo inmediatamente
        console.log(`[${userId}] 🚫 TOKEN INVÁLIDO DETECTADO - Iniciando limpieza`);
        needsCleanup = true;
        finalAuth = false;
        source = 'token_invalid';
        
        // Limpiar inmediatamente sin esperar
        this.forceCleanUserAuthState(userId, context, 'token_invalid').catch(error => {
          console.error(`[${userId}] Error en limpieza por token inválido:`, error);
        });
        
      } else if (memoryAuth && persistentAuth && tokenValid) {
        // Todo consistente y token válido
        finalAuth = true;
        source = 'consistent_valid';
        
      } else if (memoryAuth && !persistentAuth && tokenValid) {
        // Sincronizar persistente desde memoria
        await this.syncPersistentFromMemory(userId, context);
        finalAuth = true;
        source = 'synced_to_persistent';
        
      } else if (!memoryAuth && persistentAuth && tokenValid) {
        // Sincronizar memoria desde persistente
        await this.syncMemoryFromPersistent(userId, context, authData[userId]);
        finalAuth = true;
        source = 'synced_to_memory';
        
      } else {
        // No autenticado o datos inconsistentes
        finalAuth = false;
        source = 'not_authenticated';
        
        // Si hay datos inconsistentes, marcar para limpieza
        if (memoryAuth || persistentAuth) {
          needsCleanup = true;
        }
      }

      // 6. Guardar en cache solo si no necesita limpieza
      if (!needsCleanup) {
        this.authVerificationCache.set(cacheKey, {
          authenticated: finalAuth,
          timestamp: Date.now(),
          source: source
        });

        // Limpiar cache después del timeout
        setTimeout(() => {
          this.authVerificationCache.delete(cacheKey);
        }, this.cacheTimeout);
      }

      console.log(`[${userId}] ✅ Resultado final - Auth: ${finalAuth}, Fuente: ${source}, Limpieza: ${needsCleanup}`);

      return {
        authenticated: finalAuth,
        source: source,
        needsCleanup: needsCleanup,
        tokenValid: tokenValid
      };

    } catch (error) {
      console.error(`[${userId}] ❌ Error en verificación de autenticación:`, error);
      return {
        authenticated: false,
        source: 'error',
        needsCleanup: true,
        error: error.message
      };
    }
  }

  /**
   * Sincroniza estado persistente desde memoria
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
        console.log(`[${userId}] 🔄 Estado persistente sincronizado desde memoria`);
      }
    } catch (error) {
      console.error(`[${userId}] Error sincronizando persistente desde memoria:`, error);
    }
  }

  /**
   * Sincroniza memoria desde estado persistente
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
        console.log(`[${userId}] 🔄 Memoria sincronizada desde estado persistente`);
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
   * MEJORADO: Maneja todos los mensajes entrantes con mejor lógica de token inválido
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

      // Verificar si hay un proceso activo con timeout más estricto
      if (this.activeProcesses.has(userId)) {
        const processStartTime = this.activeProcesses.get(userId);
        const timeElapsed = Date.now() - processStartTime;
        
        if (timeElapsed > 20000) { // Reducido a 20 segundos
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
        // MEJORADO: Usar verificación mejorada de autenticación
        const authResult = await this.isUserAuthenticatedEnhanced(userId, context);
        
        console.log(`[${userId}] ==> RESULTADO DE AUTENTICACIÓN:`, authResult);

        // NUEVO: Si necesita limpieza, hacerla inmediatamente
        if (authResult.needsCleanup) {
          console.log(`[${userId}] 🧹 Realizando limpieza necesaria`);
          await this.forceCleanUserAuthState(userId, context, 'verification_cleanup');
        }

        // Procesar comandos específicos
        if (this._isExplicitLoginCommand(text)) {
          // MEJORADO: Siempre permitir login si el usuario lo solicita explícitamente
          if (authResult.authenticated && authResult.tokenValid) {
            await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot! Escribe cualquier mensaje para empezar.');
          } else {
            // Limpiar estado antes de nuevo login
            await this.forceCleanUserAuthState(userId, context, 'explicit_login_request');
            await this._handleLoginRequest(context, userId);
          }
        } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
          await this._handleCardSubmit(context, context.activity.value);
        } else if (this._isLogoutRequest(text)) {
          await this._handleLogoutRequest(context, userId);
        } else {
          // Mensajes generales - requieren autenticación válida
          if (authResult.authenticated && authResult.tokenValid) {
            console.log(`[${userId}] Procesando mensaje autenticado`);
            if (this._isAmbiguousVacationQuery(context.activity.text)) {
              await this._handleAmbiguousVacationQuery(context);
            } else {
              await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
            }
          } else {
            console.log(`[${userId}] Usuario no autenticado o token inválido`);
            
            let message = '🔒 **Necesitas iniciar sesión para usar el asistente**\n\nEscribe `login` para autenticarte.';
            
            // Mensaje específico si el token era inválido
            if (authResult.source === 'token_invalid') {
              message = '🔐 **Tu sesión ha expirado o es inválida**\n\n' +
                       'Tu token de autenticación ya no es válido. Esto puede ocurrir por:\n' +
                       '• La sesión expiró naturalmente\n' +
                       '• Se revocaron los permisos\n' +
                       '• Cambio de contraseña en el sistema\n\n' +
                       '✨ Escribe `login` para autenticarte nuevamente.';
            }
            
            await context.sendActivity(message);
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
   * MEJORADO: Maneja solicitudes de login con limpieza previa
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;

    console.log(`[${userId}] 🔑 SOLICITUD DE LOGIN RECIBIDA`);

    // SIEMPRE limpiar estado antes de nuevo login
    await this.forceCleanUserAuthState(userId, context, 'pre_login_cleanup');

    // Verificar después de limpieza
    const authResult = await this.isUserAuthenticatedEnhanced(userId, context, true); // Saltamos cache
    
    if (authResult.authenticated && authResult.tokenValid) {
      await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot!');
      return;
    }

    if (this.activeDialogs.has(dialogKey)) {
      console.log(`[${userId}] Diálogo ya activo después de limpieza - forzando limpieza adicional`);
      this.activeDialogs.delete(dialogKey);
    }
    
    this.activeDialogs.add(dialogKey);

    // Establecer timeout para autenticación
    this.authTimeoutManager.setAuthTimeout(userId, context, async (timeoutUserId) => {
      this.activeDialogs.delete(`auth-${timeoutUserId}`);
      this.activeProcesses.delete(timeoutUserId);
      await this.forceCleanUserAuthState(timeoutUserId, context, 'auth_timeout');
      console.log(`[${timeoutUserId}] Timeout de autenticación - estado limpiado`);
    });

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;

      if (!connectionName) {
        await context.sendActivity('❌ **Error de configuración OAuth**');
        return;
      }

      console.log(`[${userId}] 🚀 Iniciando diálogo de autenticación`);
      await this.dialog.run(context, this.dialogState);

    } catch (error) {
      console.error(`[${userId}] Error en _handleLoginRequest:`, error);
      await context.sendActivity('❌ Error al iniciar el proceso de autenticación.');

      // Limpiar estados en caso de error
      this.activeDialogs.delete(dialogKey);
      this.authTimeoutManager.clearAuthTimeout(userId);
      await this.forceCleanUserAuthState(userId, context, 'login_error');
    }
  }

  /**
   * MEJORADO: Maneja solicitudes de logout con limpieza completa
   */
  async _handleLogoutRequest(context, userId) {
    try {
      console.log(`[${userId}] 🚪 SOLICITUD DE LOGOUT RECIBIDA`);
      
      // Usar limpieza completa
      const cleanupSuccess = await this.forceCleanUserAuthState(userId, context, 'explicit_logout');
      
      if (cleanupSuccess) {
        await context.sendActivity('✅ **Sesión cerrada exitosamente**\n\nPuedes escribir `login` para autenticarte nuevamente.');
      } else {
        await context.sendActivity('⚠️ **Sesión cerrada**\n\nSe intentó cerrar la sesión. Si tienes problemas, escribe `login` para autenticarte.');
      }
      
      console.log(`[${userId}] 🎉 Logout completado`);
    } catch (error) {
      console.error(`[${userId}] Error en logout:`, error);
      await context.sendActivity('❌ Error al cerrar sesión. Escribe `login` para autenticarte nuevamente.');
    }
  }

  /**
   * MEJORADO: Maneja expiración de token con limpieza completa
   */
  async _handleTokenExpiration(context, userId) {
    console.log(`[${userId}] 🔐 MANEJANDO EXPIRACIÓN DE TOKEN`);
    
    // Limpiar completamente el estado
    await this.forceCleanUserAuthState(userId, context, 'token_expiration');

    await context.sendActivity('🔐 **Tu sesión ha expirado**\n\nEscribe `login` para autenticarte nuevamente.');
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
   * MEJORADO: Obtiene token OAuth con verificación de validez
   */
  async _getUserOAuthToken(context, userId) {
    try {
      // Verificar estado de autenticación actual
      const authResult = await this.isUserAuthenticatedEnhanced(userId, context);
      
      if (!authResult.authenticated || !authResult.tokenValid) {
        console.log(`[${userId}] Token no disponible o inválido en _getUserOAuthToken`);
        return null;
      }

      // Primero intentar obtener de la memoria
      const userInfo = this.authenticatedUsers.get(userId);
      if (userInfo && userInfo.token) {
        // Verificar que el token siga siendo válido
        const stillValid = await isTokenValid(userInfo.token);
        if (stillValid) {
          return userInfo.token;
        } else {
          console.log(`[${userId}] Token en memoria ya no es válido`);
          // Limpiar automáticamente
          await this.forceCleanUserAuthState(userId, context, 'invalid_token_detected');
          return null;
        }
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
          // Verificar que el token sea válido antes de devolverlo
          const isValid = await isTokenValid(tokenResponse.token);
          if (isValid) {
            if (userInfo) {
              userInfo.token = tokenResponse.token;
              this.authenticatedUsers.set(userId, userInfo);
            }
            return tokenResponse.token;
          } else {
            console.log(`[${userId}] Token de UserTokenClient es inválido`);
            return null;
          }
        }
      }

      // Verificar estado persistente
      const authData = await this.authState.get(context, {});
      if (authData[userId] && authData[userId].token) {
        const isValid = await isTokenValid(authData[userId].token);
        if (isValid) {
          return authData[userId].token;
        } else {
          console.log(`[${userId}] Token persistente es inválido`);
          // Limpiar estado persistente inválido
          await this.forceCleanUserAuthState(userId, context, 'persistent_token_invalid');
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error(`[${userId}] Error obteniendo token OAuth:`, error);
      return null;
    }
  }

  // ... [resto de métodos sin cambios significativos]

  /**
   * RESTO DE MÉTODOS - Solo agregando logs mejorados donde sea necesario
   */
  
  async processOpenAIMessage(context, message, userId, conversationId) {
    try {
      // Verificar token OAuth con validación
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

  async setUserAuthenticated(userId, conversationId, userData) {
    try {
      const { email, name, token, context } = userData;

      console.log(`\n=== ESTABLECIENDO AUTENTICACIÓN ===`);
      console.log(`Usuario: ${userId}`);
      console.log(`Email: ${email}`);
      console.log(`Timestamp: ${new Date().toISOString()}`);
      
      // Limpiar cache de verificación primero
      this.authVerificationCache.delete(`auth_${userId}`);
      
      // Almacenar en memoria
      this.authenticatedUsers.set(userId, { email, name, token, context });
      console.log(`[${userId}] ✅ Almacenado en memoria`);

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
      console.log(`[${userId}] ✅ Almacenado persistentemente`);

      // Limpiar diálogos activos y timeouts después de autenticación exitosa
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.authTimeoutManager.clearAuthTimeout(userId);
      this.authMessagesShown.delete(userId);

      console.log(`[${userId}] ✅ Estados limpiados post-autenticación`);

      // Crear registro de conversación
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
   * MEJORADO: Verificación simple de autenticación
   */
  isUserAuthenticated(userId) {
    return this.authenticatedUsers.has(userId);
  }

  /**
   * MEJORADO: Logout usando limpieza completa
   */
  logoutUser(userId) {
    try {
      const hadUser = this.authenticatedUsers.has(userId);
      
      // Usar método de limpieza completa
      this.forceCleanUserAuthState(userId, null, 'programmatic_logout');
      
      console.log(`[${userId}] Usuario ha cerrado sesión`);
      return hadUser;
    } catch (error) {
      console.error(`[${userId}] Error en logoutUser:`, error);
      return false;
    }
  }

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

  cleanupStaleProcesses() {
    const now = Date.now();
    const staleProcesses = [];
    
    for (const [userId, startTime] of this.activeProcesses.entries()) {
      const timeElapsed = now - startTime;
      if (timeElapsed > 30000) { // Reducido a 30 segundos
        staleProcesses.push(userId);
      }
    }
    
    staleProcesses.forEach(userId => {
      this.activeProcesses.delete(userId);
      this.activeDialogs.delete(`auth-${userId}`);
      this.authMessagesShown.delete(userId);
      this.authVerificationCache.delete(`auth_${userId}`);
      // También limpiar estado completo
      this.forceCleanUserAuthState(userId, null, 'stale_process_cleanup').catch(error => {
        console.error(`Error limpiando proceso obsoleto para ${userId}:`, error);
      });
    });
    
    if (staleProcesses.length > 0) {
      console.warn(`Limpiados ${staleProcesses.length} procesos obsoletos`);
    }
    
    return staleProcesses.length;
  }

  async forceAuthVerification(userId, context) {
    // Limpiar cache y verificar desde cero
    this.authVerificationCache.delete(`auth_${userId}`);
    return await this.isUserAuthenticatedEnhanced(userId, context, true);
  }

  // Método detecta consultas ambiguas de vacaciones (sin cambios)
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
        
        // Limpiar completamente en caso de falla
        await this.forceCleanUserAuthState(userId, context, 'signin_failure');

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
      console.error('Error en onInvokeActivity:', error);

      const userId = context.activity.from.id;
      // Limpiar estados en caso de error
      await this.forceCleanUserAuthState(userId, context, 'invoke_error');

      return { status: 500 };
    }
  }
}

module.exports.TeamsBot = TeamsBot;