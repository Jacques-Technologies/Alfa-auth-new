// teamsBot.js - Versión corregida sin duplicaciones y con mejor manejo de autenticación

const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');
const axios = require('axios');

// Importar los servicios
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

/**
 * TeamsBot class extends DialogBot to handle Teams-specific activities, OpenAI integration, and strict vacation management.
 * CORREGIDO: Elimina duplicaciones y mejora el manejo de autenticación.
 */
class TeamsBot extends DialogBot {
  /**
   * Creates an instance of TeamsBot.
   * @param {ConversationState} conversationState - Estado de conversación
   * @param {UserState} userState - Estado de usuario
   * @param {Dialog} dialog - Diálogo principal
   */
  constructor(conversationState, userState, dialog) {
    super(conversationState, userState, dialog);

    // Registrar la instancia globalmente para acceso desde otras partes
    global.botInstance = this;
    console.log('TeamsBot: Instancia registrada globalmente');

    // Configurar manejadores de actividades
    this.onMembersAdded(this.handleMembersAdded.bind(this));
    this.onMessage(this.handleMessageWithAuth.bind(this));

    // Inicializar servicios
    this.initializeServices();

    // Estados de autenticación y control de diálogos
    this.authenticatedUsers = new Map();
    this.authState = this.userState.createProperty('AuthState');
    this.activeDialogs = new Set();
    
    // NUEVO: Control de procesos activos para evitar duplicaciones
    this.activeProcesses = new Map();
    
    // NUEVO: Control de timeouts para procesos de autenticación abandonados
    this.authTimeouts = new Map();
    this.AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos timeout para autenticación
    
    // NUEVO: Iniciar limpieza periódica de timeouts
    this.startTimeoutCleanup();
  }

  /**
   * Inicializa y valida los servicios externos
   * @private
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
      console.log('TeamsBot: Servicio OpenAI inicializado correctamente');
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
      console.log('TeamsBot: Servicio de conversación inicializado correctamente');
    }
  }

  /**
   * Maneja cuando nuevos miembros se unen al chat
   * @param {TurnContext} context - Contexto del turno
   * @param {Function} next - Siguiente middleware
   */
  async handleMembersAdded(context, next) {
    for (const member of context.activity.membersAdded) {
      if (member.id !== context.activity.recipient.id) {
        await context.sendActivity('👋 **Bienvenido a Alfa Bot**\n\nEscribe `login` para iniciar sesión. Una vez autenticado, puedes:\n\n• Preguntar sobre **vacaciones** y te mostraré las opciones disponibles\n• Consultar tu **información personal**\n• Ver tus **recibos de pago**\n• Buscar en **documentos** de la empresa\n• Y mucho más...\n\n¡Pregúntame cualquier cosa!');
      }
    }
    await next();
  }

  /**
   * Obtiene el token OAuth del usuario autenticado
   * @param {TurnContext} context - Contexto del turno
   * @param {string} userId - ID del usuario
   * @returns {string|null} - Token OAuth o null si no está disponible
   * @private
   */
  async _getUserOAuthToken(context, userId) {
    try {
      // Primero intentar obtener de la memoria
      const userInfo = this.authenticatedUsers.get(userId);
      if (userInfo && userInfo.token) {
        console.log('Token OAuth obtenido de memoria');
        return userInfo.token;
      }

      // Si no está en memoria, intentar obtener del UserTokenClient
      const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey);
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
      
      if (userTokenClient && connectionName) {
        const tokenResponse = await userTokenClient.getUserToken(
          userId,
          connectionName,
          context.activity.channelId
        );
        
        if (tokenResponse && tokenResponse.token) {
          // Actualizar en memoria
          if (userInfo) {
            userInfo.token = tokenResponse.token;
            this.authenticatedUsers.set(userId, userInfo);
          }
          return tokenResponse.token;
        }
      }

      // Si no se pudo obtener el token, verificar el estado persistente
      const authData = await this.authState.get(context, {});
      if (authData[userId] && authData[userId].token) {
        return authData[userId].token;
      }

      return null;
    } catch (error) {
      console.error('Error obteniendo token OAuth:', error.message);
      return null;
    }
  }

  /**
   * Verifica si el token OAuth es válido haciendo una llamada de prueba
   * @param {string} token - Token OAuth a verificar
   * @returns {boolean} - Si el token es válido
   * @private
   */
  async _isTokenValid(token) {
    if (!token) return false;
    
    try {
      // Hacer una llamada simple para verificar el token
      const response = await axios.get(
        'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
        {
          headers: {
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
          },
          timeout: 5000
        }
      );
      
      return response.status === 200;
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('Token OAuth expirado o inválido');
        return false;
      }
      // Para otros errores, asumimos que el token podría ser válido
      return true;
    }
  }

  /**
   * Maneja la expiración del token y solicita re-autenticación
   * @param {TurnContext} context - Contexto del turno
   * @param {string} userId - ID del usuario
   * @private
   */
  async _handleTokenExpiration(context, userId) {
    console.log(`Token expirado para usuario ${userId}, solicitando re-autenticación`);
    
    // Limpiar estado de autenticación
    const authData = await this.authState.get(context, {});
    if (authData[userId]) {
      delete authData[userId];
      await this.authState.set(context, authData);
      await this.userState.saveChanges(context);
    }
    
    // Limpiar memoria
    this.authenticatedUsers.delete(userId);
    
    // Enviar mensaje y solicitar re-autenticación
    await context.sendActivity('🔐 **Tu sesión ha expirado**\n\nPor favor, escribe `login` para autenticarte nuevamente.');
  }

  /**
   * Detecta si una consulta de vacaciones es ambigua y requiere aclaración
   * @param {string} message - Mensaje del usuario
   * @returns {boolean} - Si la consulta requiere aclaración
   * @private
   */
  _isAmbiguousVacationQuery(message) {
    const lowerMessage = message.toLowerCase();
    
    // Frases que indican solicitud ambigua de vacaciones
    const ambiguousPatterns = [
      'quiero vacaciones',
      'solicitar vacaciones',
      'pedir vacaciones',
      'necesito vacaciones',
      'tramitar vacaciones'
    ];
    
    // Palabras que especifican el tipo (si las contiene, no es ambigua)
    const specificWords = [
      'matrimonio', 'boda', 'casarse',
      'nacimiento', 'bebé', 'paternidad', 'maternidad',
      'consultar', 'ver mis', 'estado de',
      'simular', 'verificar', 'información', 'info', 'tipos'
    ];
    
    // Es ambigua si contiene patrones ambiguos pero no palabras específicas
    const hasAmbiguousPattern = ambiguousPatterns.some(pattern => lowerMessage.includes(pattern));
    const hasSpecificWord = specificWords.some(word => lowerMessage.includes(word));
    
    return hasAmbiguousPattern && !hasSpecificWord;
  }

  /**
   * CORREGIDO: Maneja todos los mensajes entrantes sin duplicaciones
   * @param {TurnContext} context - Contexto del turno
   * @param {Function} next - Siguiente middleware
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();

      // NUEVO: Evitar procesamiento duplicado MÁS ESTRICTO
      const processKey = `${userId}-${Date.now()}`;
      if (this.activeProcesses.has(userId)) {
        console.log(`TeamsBot: Procesamiento ya activo para usuario ${userId}, ignorando mensaje`);
        return await next();
      }
      
      // NUEVO: También verificar si hay diálogo OAuth activo
      const dialogKey = `auth-${userId}`;
      if (this.activeDialogs.has(dialogKey)) {
        console.log(`TeamsBot: Diálogo OAuth activo para usuario ${userId}, ignorando mensaje`);
        return await next();
      }

      this.activeProcesses.set(userId, processKey);

      try {
        // Recuperar estado de autenticación persistente
        const authData = await this.authState.get(context, {});
        const isAuthenticated = authData[userId]?.authenticated === true;

        console.log(`TeamsBot: Procesando mensaje de ${userId}: "${text}" (Autenticado: ${isAuthenticated})`);

        // Procesar comandos específicos primero
        if (this._isExplicitLoginCommand(text)) {
          await this._handleLoginRequest(context, userId);
        } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
          // Manejo de submit de tarjetas adaptativas
          console.log('TeamsBot: Detectado submit de tarjeta adaptativa');
          await this._handleCardSubmit(context, context.activity.value);
        } else if (this._isHelpRequest(text)) {
          await this._sendHelpMessage(context);
        } else if (this._isLogoutRequest(text)) {
          await this._handleLogoutRequest(context, userId);
        } else if (this._isLegacyActionsRequest(text)) {
          // Comando legacy "acciones" - explicar el nuevo comportamiento
          await this._handleLegacyActions(context, isAuthenticated);
        } else {
          // Mensajes generales - requieren autenticación para OpenAI
          if (isAuthenticated) {
            // NUEVO: Verificar si es una consulta ambigua de vacaciones
            if (this._isAmbiguousVacationQuery(context.activity.text)) {
              console.log('TeamsBot: Detectada consulta ambigua de vacaciones');
              
              // Generar respuesta con tarjeta guía
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
                console.error('TeamsBot: Error procesando consulta ambigua:', error);
                await context.sendActivity('🏖️ Para solicitar vacaciones, necesito saber qué tipo necesitas:\n\n• **Vacaciones regulares** - días anuales\n• **Por matrimonio** - días especiales por boda\n• **Por nacimiento** - paternidad/maternidad\n\n¿Cuál necesitas?');
              }
            } else {
              // Procesamiento normal con OpenAI
              await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
            }
          } else {
            await context.sendActivity('🔒 Necesitas iniciar sesión para usar el asistente. Escribe `login` para autenticarte.');
          }
        }
      } finally {
        // Limpiar proceso activo
        this.activeProcesses.delete(userId);
      }

    } catch (error) {
      console.error('TeamsBot: Error en handleMessageWithAuth:', error);
      await context.sendActivity('❌ Ocurrió un error inesperado. Intenta de nuevo o escribe `ayuda` para más información.');
      
      // Limpiar proceso activo en caso de error
      const userId = context.activity.from.id;
      this.activeProcesses.delete(userId);
    }

    await next();
  }

  /**
   * Determina si es un comando explícito de login
   * @param {string} text - Texto del mensaje
   * @returns {boolean}
   * @private
   */
  _isExplicitLoginCommand(text) {
    return text === 'login' || text === 'iniciar sesion' || text === 'iniciar sesión';
  }

  /**
   * Determina si es una solicitud de acciones legacy
   * @param {string} text - Texto del mensaje
   * @returns {boolean}
   * @private
   */
  _isLegacyActionsRequest(text) {
    return ['acciones', 'menú', 'menu', 'actions', 'opciones'].includes(text);
  }

  /**
   * Determina si es una solicitud de ayuda
   * @param {string} text - Texto del mensaje
   * @returns {boolean}
   * @private
   */
  _isHelpRequest(text) {
    return ['ayuda', 'help', 'comandos', 'commands'].includes(text);
  }

  /**
   * Determina si es una solicitud de logout
   * @param {string} text - Texto del mensaje
   * @returns {boolean}
   * @private
   */
  _isLogoutRequest(text) {
    return ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'].includes(text);
  }

  /**
   * CORREGIDO: Maneja solicitudes de login sin duplicaciones
   * @param {TurnContext} context - Contexto del turno
   * @param {string} userId - ID del usuario
   * @private
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;
    
    // CORREGIDO: Verificar si ya hay un proceso de autenticación activo
    if (this.activeDialogs.has(dialogKey)) {
      console.log(`TeamsBot: Proceso de autenticación ya activo para usuario ${userId}`);
      await context.sendActivity('⏳ Ya tienes un proceso de autenticación en curso. Por favor, completa el login actual.');
      return;
    }
    
    // CORREGIDO: Verificar si hay proceso activo también
    if (this.activeProcesses.has(userId)) {
      console.log(`TeamsBot: Proceso general ya activo para usuario ${userId}`);
      await context.sendActivity('⏳ Ya hay un proceso activo. Espera un momento e intenta nuevamente.');
      return;
    }
    
    // CORREGIDO: Verificar si el usuario ya está autenticado
    const authData = await this.authState.get(context, {});
    const isAuthenticated = authData[userId]?.authenticated === true;
    
    if (isAuthenticated) {
      console.log(`TeamsBot: Usuario ${userId} ya está autenticado`);
      await context.sendActivity('✅ **Ya estás autenticado**\n\n¡Puedes usar todas las funciones del bot! Pregúntame lo que necesites.');
      return;
    }
    
    // Marcar como activo ANTES de ejecutar
    this.activeDialogs.add(dialogKey);

    // NUEVO: Establecer timeout para detectar proceso abandonado
    this.setAuthTimeout(userId, context);

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
      
      if (!connectionName) {
        console.error('TeamsBot: connectionName no configurado');
        await context.sendActivity('❌ **Error de configuración OAuth**\n\nContacta al administrador del sistema.');
        return;
      }

      console.log(`TeamsBot: Ejecutando diálogo OAuth para usuario ${userId}`);
      
      // CORREGIDO: Solo ejecutar el diálogo, sin mensajes previos
      // El MainDialog ya maneja todos los mensajes informativos
      await this.dialog.run(context, this.dialogState);
      
    } catch (error) {
      console.error('TeamsBot: Error en _handleLoginRequest:', error);
      await context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta nuevamente.');
      
      // Limpiar en caso de error
      this.activeDialogs.delete(dialogKey);
      this.clearAuthTimeout(userId);
    } finally {
      // IMPORTANTE: Limpiar SOLO si el diálogo terminó completamente
      // No limpiar aquí ya que el diálogo puede estar en progreso
      console.log(`TeamsBot: Manteniendo diálogo activo para usuario ${userId}`);
    }
  }

  /**
   * Maneja solicitudes de logout
   * @param {TurnContext} context - Contexto del turno
   * @param {string} userId - ID del usuario
   * @private
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

      // Limpiar memoria
      this.authenticatedUsers.delete(userId);

      await context.sendActivity('✅ **Sesión cerrada exitosamente**\n\nEscribe `login` para iniciar sesión nuevamente cuando desees usar el bot.');

    } catch (error) {
      console.error('Error en logout:', error);
      await context.sendActivity('❌ Error al cerrar sesión. Intenta nuevamente.');
    }
  }

  /**
   * Maneja el comando legacy "acciones"
   * @param {TurnContext} context - Contexto del turno
   * @param {boolean} isAuthenticated - Si el usuario está autenticado
   * @private
   */
  async _handleLegacyActions(context, isAuthenticated) {
    if (!isAuthenticated) {
      await context.sendActivity('🔒 Necesitas iniciar sesión primero. Escribe `login` para autenticarte.');
      return;
    }

    const helpMessage = `
🎯 **¡Funcionalidad Mejorada!**

Ahora las acciones aparecen automáticamente según lo que necesites. Solo dime qué quieres hacer:

**💬 Ejemplos de lo que puedes preguntar:**
• "quiero solicitar vacaciones"
• "ver mis solicitudes de vacaciones" 
• "mi información personal"
• "consultar mis recibos"
• "permiso por matrimonio"
• "días por nacimiento"
• "autorizar una solicitud"

**✨ El asistente detectará tu intención y te mostrará exactamente lo que necesitas.**

**🔍 También puedes:**
• Buscar en documentos: "busca en documentos sobre..."
• Ver el menú: "qué hay de comer hoy"
• Buscar empleados: "buscar a Juan Pérez"

¡Pruébalo! Es mucho más intuitivo ahora. 😊
    `;

    await context.sendActivity(helpMessage.trim());
  }

  /**
   * Envía mensaje de ayuda con comandos disponibles
   * @param {TurnContext} context - Contexto del turno
   * @private
   */
  async _sendHelpMessage(context) {
    const helpMessage = `
🤖 **Comandos disponibles**:

**Autenticación:**
• \`login\` - Iniciar sesión con OAuth
• \`logout\` - Cerrar sesión

**💡 Nuevo Sistema Inteligente:**
En lugar de mostrar un menú fijo, ahora solo pregúntame qué necesitas:

**🏖️ Vacaciones:**
• "quiero solicitar vacaciones"
• "ver mis vacaciones"
• "simular una solicitud"

**👤 Información Personal:**
• "mi información"
• "mis datos"

**💰 Recibos:**
• "mis recibos"
• "periodos de pago"

**🎯 Casos Especiales:**
• "permiso por matrimonio"
• "días por nacimiento"

**📋 Gestión (supervisores):**
• "autorizar solicitud"
• "rechazar solicitud"

**📚 Otros:**
• "buscar en documentos sobre..."
• "menú del comedor"
• "buscar empleado"

¡Solo dime qué necesitas y te ayudo! 😊
            `;
            
    await context.sendActivity(helpMessage.trim());
  }

  /**
   * Maneja submits específicos de la tarjeta guía de vacaciones
   * @param {TurnContext} context - Contexto del turno
   * @param {Object} submitData - Datos del submit
   * @returns {boolean} - Si se manejó el submit
   * @private
   */
  async _handleVacationGuideSubmit(context, submitData) {
    const { vacation_type, action } = submitData;
    
    if (!vacation_type) {
      return false; // No es un submit de la guía de vacaciones
    }
    
    console.log(`TeamsBot: Manejando selección de tipo de vacación: ${vacation_type}`);
    
    try {
      let openaiResponse;
      
      switch (vacation_type) {
        case 'regular':
          // Procesar solicitud de vacaciones regulares
          const regularPrompt = "El usuario seleccionó vacaciones regulares. Genera la tarjeta para solicitar vacaciones regulares.";
          openaiResponse = await this.openaiService.procesarMensaje(regularPrompt, []);
          break;
          
        case 'matrimonio':
          // Procesar solicitud de vacaciones por matrimonio
          const matrimonioPrompt = "El usuario seleccionó vacaciones por matrimonio. Genera la tarjeta para vacaciones por matrimonio.";
          openaiResponse = await this.openaiService.procesarMensaje(matrimonioPrompt, []);
          break;
          
        case 'nacimiento':
          // Procesar solicitud de vacaciones por nacimiento
          const nacimientoPrompt = "El usuario seleccionó vacaciones por nacimiento. Genera la tarjeta para vacaciones por nacimiento.";
          openaiResponse = await this.openaiService.procesarMensaje(nacimientoPrompt, []);
          break;
          
        default:
          await context.sendActivity('⚠️ Tipo de vacación no reconocido. Por favor, selecciona una opción válida.');
          return true;
      }
      
      // Enviar respuesta generada por OpenAI
      if (openaiResponse) {
        if (openaiResponse.type === 'card') {
          if (openaiResponse.content) {
            await context.sendActivity(openaiResponse.content);
          }
          
          if (Array.isArray(openaiResponse.card)) {
            for (const card of openaiResponse.card) {
              await context.sendActivity({ attachments: [card] });
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } else {
            await context.sendActivity({ attachments: [openaiResponse.card] });
          }
        } else {
          await context.sendActivity(openaiResponse.content || openaiResponse);
        }
      }
      
      return true; // Se manejó exitosamente
      
    } catch (error) {
      console.error('TeamsBot: Error manejando selección de vacaciones:', error);
      await context.sendActivity('❌ Error al procesar tu selección de vacaciones. Por favor, intenta nuevamente.');
      return true;
    }
  }

  /**
   * CORREGIDO: Maneja el submit de las tarjetas adaptativas sin duplicaciones
   * @param {TurnContext} context - Contexto del turno
   * @param {Object} submitData - Datos enviados desde la tarjeta
   * @private
   */
  async _handleCardSubmit(context, submitData) {
    try {
      console.log('TeamsBot: Procesando submit de tarjeta adaptativa');
      console.log('TeamsBot: Datos completos recibidos:', JSON.stringify(submitData, null, 2));

      // NUEVO: Verificar si es un submit de la guía de vacaciones
      if (submitData.vacation_type) {
        const handled = await this._handleVacationGuideSubmit(context, submitData);
        if (handled) {
          return; // Ya se manejó, no continuar con el procesamiento normal
        }
      }

      const { action, method, url, ...fieldData } = submitData;
      const userId = context.activity.from.id;
      
      // Validar que tengamos los datos básicos necesarios
      if (!action || !method || !url) {
        console.error('TeamsBot: Faltan datos básicos en el submit:', { action, method, url });
        await context.sendActivity('❌ **Error**: Datos incompletos en la solicitud. Por favor, intenta nuevamente.');
        return;
      }

      console.log(`TeamsBot: Ejecutando acción "${action}" con método ${method}`);
      
      // Enviar indicador de que se está procesando
      await context.sendActivity({ type: 'typing' });
      await context.sendActivity(`⏳ **Ejecutando acción**: ${action}...`);

      // Obtener token OAuth del usuario autenticado
      const oauthToken = await this._getUserOAuthToken(context, userId);
      
      if (!oauthToken) {
        await this._handleTokenExpiration(context, userId);
        return;
      }

      // Verificar si el token es válido
      const isValid = await this._isTokenValid(oauthToken);
      if (!isValid) {
        await this._handleTokenExpiration(context, userId);
        return;
      }

      // Procesar fechas en los datos de campo
      const processedFieldData = this._processDateFields(fieldData);
      console.log('TeamsBot: Datos procesados:', JSON.stringify(processedFieldData, null, 2));

      // Procesar URL con parámetros dinámicos
      const { processedUrl, remainingData } = this._processUrlParameters(url, processedFieldData);
      
      if (!processedUrl) {
        await context.sendActivity('❌ **Error**: Faltan parámetros requeridos para esta acción.');
        return;
      }

      console.log('TeamsBot: URL procesada:', processedUrl);
      console.log('TeamsBot: Datos restantes para body:', JSON.stringify(remainingData, null, 2));

      // Configurar y ejecutar petición HTTP con token OAuth
      const response = await this._executeHttpRequest(method, processedUrl, oauthToken, remainingData);

      // Formatear y enviar respuesta usando OpenAI para mejorar estilo
      const payload = (method.toUpperCase() === 'POST' && response && typeof response === 'object' && response.message)
        ? response.message
        : response;
      let formattedResponse;
      try {
        const prompt = `Por favor formatea de manera amigable y con emojis la respuesta de la acción "${action}":\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
        const openaiResponse = await this.openaiService.procesarMensaje(prompt, []);
        formattedResponse = openaiResponse.type === 'text' ? openaiResponse.content : openaiResponse;
      } catch (e) {
        // Si falla OpenAI, usar formato manual
        if (typeof payload === 'string') {
          formattedResponse = `✅ **${action}** ejecutada exitosamente:\n\n${payload}`;
        } else {
          formattedResponse = this._formatApiResponse(action, response);
        }
      }
      await context.sendActivity(formattedResponse);

    } catch (error) {
      await this._handleApiError(context, error, submitData.action || 'Desconocida');
    }
  }

  /**
   * CORREGIDO: Maneja actividades invoke sin duplicaciones
   * @param {TurnContext} context - Contexto del turno
   * @returns {Object} - Respuesta de la actividad invoke
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      console.log(`TeamsBot: Actividad invoke recibida: ${activityName} para usuario ${userId}`);

      // CORREGIDO: Verificar si ya hay proceso activo antes de continuar
      if (this.activeProcesses.has(userId)) {
        console.log(`TeamsBot: Proceso ya activo para invoke ${activityName}, ignorando`);
        return { status: 200 };
      }

      if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
        // CORREGIDO: Solo ejecutar si no hay ya un diálogo activo
        if (!this.activeDialogs.has(dialogKey)) {
          this.activeDialogs.add(dialogKey);
          this.activeProcesses.set(userId, `invoke-${Date.now()}`);
          
          try {
            console.log(`TeamsBot: Ejecutando diálogo OAuth para ${activityName}`);
            await this.dialog.run(context, this.dialogState);
            return { status: 200 };
          } finally {
            this.activeDialogs.delete(dialogKey);
            this.activeProcesses.delete(userId);
          }
        } else {
          console.log(`TeamsBot: Diálogo ya activo para invoke ${activityName}, ignorando`);
          return { status: 200 };
        }
      } else if (activityName === 'signin/failure') {
        // MEJORADO: Manejo específico cuando el usuario cierra el card de autenticación
        console.log(`TeamsBot: Usuario ${userId} falló en autenticación - posiblemente cerró el card`);
        
        // Limpiar estados en caso de fallo
        this.activeDialogs.delete(dialogKey);
        this.activeProcesses.delete(userId);
        
        // NUEVO: Mensaje específico para cuando se cierra el card
        await context.sendActivity('❌ **Autenticación fallida**\n\n' +
          '🚫 **El proceso de autenticación no se completó correctamente.**\n\n' +
          '**Posibles causas:**\n' +
          '• Cerraste la ventana de autenticación antes de completar el proceso\n' +
          '• Cancelaste la autenticación en el proveedor OAuth\n' +
          '• Hubo un error de conectividad durante el proceso\n' +
          '• El servidor de autenticación no respondió\n\n' +
          '**Para usar el bot:**\n' +
          '• Escribe `login` para intentar autenticarte nuevamente\n' +
          '• Asegúrate de completar todo el proceso sin cerrar ventanas\n' +
          '• Verifica tu conexión a internet\n\n' +
          '💡 **Recuerda**: Necesitas completar la autenticación para usar las funciones del bot.');
        
        return { status: 200 };
      }

      return await super.onInvokeActivity(context);
    } catch (error) {
      console.error('TeamsBot: Error en onInvokeActivity:', error);
      
      // Limpiar estados en caso de error
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      
      // NUEVO: Enviar mensaje de error específico para problemas de invoke
      try {
        await context.sendActivity('❌ **Error en el proceso de autenticación**\n\n' +
          'Ocurrió un problema técnico durante la autenticación.\n\n' +
          '**Soluciones:**\n' +
          '• Espera un momento e intenta `login` nuevamente\n' +
          '• Verifica que tu navegador permita ventanas emergentes\n' +
          '• Si continúa fallando, contacta al administrador\n\n' +
          `**Código de error**: INV-${Date.now()}`);
      } catch (sendError) {
        console.error('TeamsBot: Error adicional enviando mensaje de error invoke:', sendError.message);
      }
      
      return { status: 500 };
    }
  }

  /**
   * Procesa los campos de fecha para convertirlos al formato ISO 8601
   * @param {Object} fieldData - Datos de los campos
   * @returns {Object} - Datos con fechas procesadas
   * @private
   */
  _processDateFields(fieldData) {
    const processed = { ...fieldData };
    
    // Campos que típicamente contienen fechas
    const dateFields = [
      'fechaInicio', 'fechaFin', 'fechaMatrimonio', 'fechaNacimiento',
      'fecha', 'startDate', 'endDate', 'marriageDate', 'birthDate'
    ];
    
    for (const [key, value] of Object.entries(processed)) {
      // Detectar campos de fecha por nombre o contenido
      const isDateField = key.toLowerCase().includes('fecha') || 
                         key.toLowerCase().includes('date') || 
                         dateFields.includes(key);
      
      if (isDateField && value && typeof value === 'string') {
        const convertedDate = this._convertToISODate(value);
        if (convertedDate) {
          processed[key] = convertedDate;
          console.log(`TeamsBot: Fecha convertida ${key}: ${value} → ${convertedDate}`);
        }
      }
    }
    
    return processed;
  }

  /**
   * Convierte una fecha en diferentes formatos al formato ISO 8601
   * @param {string} dateString - Fecha en formato string
   * @returns {string|null} - Fecha en formato ISO o null si no se puede convertir
   * @private
   */
  _convertToISODate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
      return null;
    }

    // Si ya está en formato ISO, validar y devolver
    if (dateString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/)) {
      return dateString.endsWith('Z') ? dateString : dateString + 'Z';
    }

    // Si es solo una fecha YYYY-MM-DD, agregar tiempo
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString + 'T00:00:00.000Z';
    }

    let date = null;

    // Formato dd-MM-yyyy o dd/MM/yyyy (más común en México)
    const ddMMyyyyMatch = dateString.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddMMyyyyMatch) {
      const day = ddMMyyyyMatch[1].padStart(2, '0');
      const month = ddMMyyyyMatch[2].padStart(2, '0');
      const year = ddMMyyyyMatch[3];
      
      // Validar rangos de fecha
      if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
          parseInt(day) >= 1 && parseInt(day) <= 31) {
        date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      }
    }

    // Formato yyyy-MM-dd
    if (!date) {
      const yyyyMMddMatch = dateString.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (yyyyMMddMatch) {
        const year = yyyyMMddMatch[1];
        const month = yyyyMMddMatch[2].padStart(2, '0');
        const day = yyyyMMddMatch[3].padStart(2, '0');
        
        if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
            parseInt(day) >= 1 && parseInt(day) <= 31) {
          date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
        }
      }
    }

    // Intentar con Date.parse como último recurso
    if (!date) {
      try {
        date = new Date(dateString);
        if (isNaN(date.getTime())) {
          date = null;
        }
      } catch (error) {
        console.warn(`TeamsBot: No se pudo convertir fecha: ${dateString}`);
        return null;
      }
    }

    // Convertir a ISO string si es válida
    if (date && !isNaN(date.getTime())) {
      return date.toISOString();
    }

    console.warn(`TeamsBot: Formato de fecha no reconocido: ${dateString}`);
    return null;
  }

  /**
   * Procesa los parámetros de URL reemplazando placeholders
   * @param {string} url - URL con placeholders
   * @param {Object} fieldData - Datos de campos
   * @returns {Object} - URL procesada y datos restantes
   * @private
   */
  _processUrlParameters(url, fieldData) {
    let processedUrl = url;
    const remainingData = { ...fieldData };

    // Extraer parámetros de la URL (entre llaves)
    const urlPattern = /\{([^}]+)\}/g;
    const matches = [...url.matchAll(urlPattern)];

    for (const match of matches) {
      const paramName = match[1];
      const value = remainingData[paramName];

      if (value !== undefined && value !== '') {
        processedUrl = processedUrl.replace(`{${paramName}}`, encodeURIComponent(value));
        delete remainingData[paramName]; // Remover ya que se usó en la URL
      } else {
        console.error(`TeamsBot: Parámetro faltante en URL: ${paramName}`);
        return { processedUrl: null, remainingData: null };
      }
    }

    return { processedUrl, remainingData };
  }

  /**
   * Ejecuta la petición HTTP con la configuración adecuada
   * @param {string} method - Método HTTP
   * @param {string} url - URL procesada
   * @param {string} oauthToken - Token OAuth del usuario
   * @param {Object} data - Datos adicionales
   * @returns {Object} - Respuesta de la API
   * @private
   */
  async _executeHttpRequest(method, url, oauthToken, data) {
    console.log(`TeamsBot: Ejecutando petición ${method} a ${url}`);

    const axiosConfig = {
      method: method.toLowerCase(),
      url: url,
      headers: {
        'Authorization': oauthToken.startsWith('Bearer ') ? oauthToken : `Bearer ${oauthToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000 // 30 segundos timeout
    };

    // Configurar datos según el método HTTP
    if (method.toUpperCase() === 'GET') {
      if (Object.keys(data).length > 0) {
        axiosConfig.params = data;
      }
    } else {
      if (Object.keys(data).length > 0) {
        axiosConfig.data = data;
      }
    }

    console.log('TeamsBot: Configuración de petición:', {
      method: axiosConfig.method,
      url: axiosConfig.url,
      hasData: !!axiosConfig.data,
      hasParams: !!axiosConfig.params,
      dataKeys: axiosConfig.data ? Object.keys(axiosConfig.data) : [],
      paramsKeys: axiosConfig.params ? Object.keys(axiosConfig.params) : []
    });

    const response = await axios(axiosConfig);
    return response.data;
  }

  /**
   * Formatea la respuesta de la API para mostrar al usuario
   * @param {string} action - Nombre de la acción ejecutada
   * @param {*} data - Datos de respuesta
   * @returns {string} - Mensaje formateado
   * @private
   */
  _formatApiResponse(action, data) {
    let message = `✅ **${action}** ejecutada exitosamente:\n\n`;
    
    if (data === null || data === undefined) {
      message += '_Sin datos en la respuesta_';
    } else if (typeof data === 'object') {
      if (Array.isArray(data)) {
        message += `📊 **Resultados encontrados**: ${data.length}\n\n`;
        if (data.length > 0) {
          // Mostrar solo los primeros elementos si hay muchos
          const itemsToShow = Math.min(data.length, 3);
          for (let i = 0; i < itemsToShow; i++) {
            message += `**Elemento ${i + 1}**:\n`;
            message += this._formatObjectData(data[i]) + '\n\n';
          }
          if (data.length > 3) {
            message += `_... y ${data.length - 3} elementos más_\n`;
          }
        }
      } else {
        message += this._formatObjectData(data);
      }
    } else {
      message += String(data);
    }
    
    return message;
  }

  /**
   * Formatea un objeto de datos para visualización
   * @param {Object} obj - Objeto a formatear
   * @returns {string} - Objeto formateado
   * @private
   */
  _formatObjectData(obj) {
    if (!obj || typeof obj !== 'object') {
      return String(obj);
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return '_Objeto vacío_';
    }

    // Si hay pocas propiedades, mostrar como lista
    if (keys.length <= 8) {
      return keys
        .map(key => `• **${key}**: ${this._formatValue(obj[key])}`)
        .join('\n');
    }

    // Si hay muchas propiedades, mostrar como JSON
    return `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
  }

  /**
   * Formatea un valor individual para visualización
   * @param {*} value - Valor a formatear
   * @returns {string} - Valor formateado
   * @private
   */
  _formatValue(value) {
    if (value === null || value === undefined) {
      return '_null_';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Maneja errores de API de forma amigable
   * @param {TurnContext} context - Contexto del turno
   * @param {Error} error - Error ocurrido
   * @param {string} action - Acción que causó el error
   * @private
   */
  async _handleApiError(context, error, action) {
    console.error(`TeamsBot: Error en acción "${action}":`, error);
    
    let errorMessage = `❌ **Error en ${action}**:\n\n`;
    
    if (error.response) {
      // Error de respuesta HTTP
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      errorMessage += `**Código**: ${status} - ${statusText}\n`;
      
      if (error.response.data) {
        if (typeof error.response.data === 'object') {
          const errorData = error.response.data;
          if (errorData.message) {
            errorMessage += `**Mensaje**: ${errorData.message}\n`;
          } else {
            errorMessage += `**Detalles**: ${JSON.stringify(errorData, null, 2)}\n`;
          }
        } else {
          errorMessage += `**Detalles**: ${error.response.data}\n`;
        }
      }

      // Sugerencias basadas en el código de error
      if (status === 401) {
        errorMessage += '\n💡 **Sugerencia**: Tu sesión ha expirado. Escribe `login` para autenticarte nuevamente.';
        // Manejar expiración de token
        await this._handleTokenExpiration(context, context.activity.from.id);
      } else if (status === 403) {
        errorMessage += '\n💡 **Sugerencia**: No tienes permisos suficientes para esta operación.';
      } else if (status === 404) {
        errorMessage += '\n💡 **Sugerencia**: El recurso solicitado no existe. Verifica los parámetros.';
      } else if (status >= 500) {
        errorMessage += '\n💡 **Sugerencia**: Error del servidor. Intenta nuevamente en unos momentos.';
      }
      
    } else if (error.request) {
      // Error de red
      errorMessage += '**Problema**: No se pudo conectar con el servidor.\n';
      errorMessage += '💡 **Sugerencia**: Verifica tu conexión a internet e intenta nuevamente.';
    } else {
      // Otro tipo de error
      errorMessage += `**Detalles**: ${error.message}`;
    }

    await context.sendActivity(errorMessage);
  }

  /**
   * Procesa mensajes con el servicio de OpenAI (ahora incluye manejo de tarjetas dinámicas y manejo estricto de vacaciones)
   * @param {TurnContext} context - Contexto del turno
   * @param {string} message - Mensaje del usuario
   * @param {string} userId - ID del usuario
   * @param {string} conversationId - ID de la conversación
   */
  async processOpenAIMessage(context, message, userId, conversationId) {
    try {
      // Verificar token OAuth antes de procesar
      const oauthToken = await this._getUserOAuthToken(context, userId);
      if (!oauthToken) {
        await this._handleTokenExpiration(context, userId);
        return;
      }

      // Almacenar contexto para typing indicator
      this.currentContext = context;
      
      await context.sendActivity({ type: 'typing' });
      
      // Guardar mensaje del usuario
      try {
        await this.conversationService.saveMessage(message, conversationId, userId);
      } catch (error) {
        console.warn('TeamsBot: Error guardando mensaje del usuario:', error.message);
      }

      // Obtener historial de conversación
      let history = [];
      try {
        history = await this.conversationService.getConversationHistory(conversationId);
      } catch (error) {
        console.warn('TeamsBot: Error obteniendo historial:', error.message);
      }

      // Formatear historial para OpenAI
      const formattedHistory = history.map(item => ({
        type: item.userId === userId ? 'user' : 'assistant',
        message: item.message
      }));

      // Procesar con OpenAI (puede devolver texto o tarjeta)
      const response = await this.openaiService.procesarMensaje(message, formattedHistory);

      // Manejar diferentes tipos de respuesta
      if (response.type === 'card') {
        // Respuesta con tarjeta dinámica
        if (response.content) {
          await context.sendActivity(response.content);
        }
        
        // Enviar tarjeta(s)
        if (Array.isArray(response.card)) {
          // Múltiples tarjetas
          for (const card of response.card) {
            await context.sendActivity({ attachments: [card] });
            // Pequeña pausa entre tarjetas
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          // Tarjeta única
          await context.sendActivity({ attachments: [response.card] });
        }
        
        // Guardar respuesta del bot (solo el texto, no la tarjeta)
        try {
          const botMessage = response.content || 'Tarjeta enviada';
          await this.conversationService.saveMessage(botMessage, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          console.warn('TeamsBot: Error guardando respuesta del bot:', error.message);
        }
      } else {
        // Respuesta de texto normal
        const responseContent = response.content || response;
        
        // Guardar respuesta del bot
        try {
          await this.conversationService.saveMessage(responseContent, conversationId, 'bot');
          await this.conversationService.updateLastActivity(conversationId);
        } catch (error) {
          console.warn('TeamsBot: Error guardando respuesta del bot:', error.message);
        }

        // Enviar respuesta al usuario
        await context.sendActivity(responseContent);
      }

    } catch (error) {
      console.error('TeamsBot: Error en processOpenAIMessage:', error);
      await context.sendActivity('❌ Error al procesar tu mensaje con OpenAI. Por favor, intenta más tarde.');
    } finally {
      this.currentContext = null;
    }
  }

  /**
   * Marca al usuario como autenticado y almacena sus datos
   * @param {string} userId - ID del usuario
   * @param {string} conversationId - ID de la conversación
   * @param {Object} userData - Datos del usuario
   * @returns {boolean} - Éxito de la operación
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

      // NUEVO: Limpiar diálogos activos y timeouts al completar autenticación exitosa
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.clearAuthTimeout(userId);
      console.log(`TeamsBot: Limpiados diálogos activos y timeouts para usuario autenticado ${userId}`);

      // Crear registro de conversación
      try {
        await this.conversationService.createConversation(conversationId, userId);
      } catch (error) {
        console.warn('TeamsBot: Error creando conversación:', error.message);
      }

      console.log(`TeamsBot: Usuario ${userId} autenticado correctamente`);
      return true;
    } catch (error) {
      console.error('TeamsBot: Error en setUserAuthenticated:', error);
      return false;
    }
  }

  /**
   * Verifica si un usuario está autenticado
   * @param {string} userId - ID del usuario
   * @returns {boolean} - Estado de autenticación
   */
  isUserAuthenticated(userId) {
    return this.authenticatedUsers.has(userId);
  }

  /**
   * Cierra la sesión de un usuario
   * @param {string} userId - ID del usuario
   * @returns {boolean} - Éxito de la operación
   */
  logoutUser(userId) {
    if (this.authenticatedUsers.has(userId)) {
      this.authenticatedUsers.delete(userId);
      
      // NUEVO: Limpiar también los diálogos activos y timeouts al hacer logout
      const dialogKey = `auth-${userId}`;
      this.activeDialogs.delete(dialogKey);
      this.activeProcesses.delete(userId);
      this.clearAuthTimeout(userId);
      
      console.log(`TeamsBot: Usuario ${userId} ha cerrado sesión y limpiado estados activos`);
      return true;
    }
    return false;
  }

  // NUEVOS MÉTODOS PARA MANEJO DE TIMEOUTS

  /**
   * Establece un timeout para un proceso de autenticación
   * @param {string} userId - ID del usuario
   * @param {TurnContext} context - Contexto para enviar mensajes
   * @private
   */
  setAuthTimeout(userId, context) {
    // Limpiar timeout anterior si existe
    this.clearAuthTimeout(userId);
    
    const timeoutId = setTimeout(async () => {
      console.log(`TeamsBot: Timeout de autenticación para usuario ${userId}`);
      
      try {
        // Verificar si el usuario no completó la autenticación
        if (!this.isUserAuthenticated(userId) && (this.activeDialogs.has(`auth-${userId}`) || this.activeProcesses.has(userId))) {
          
          // Limpiar estados
          this.activeDialogs.delete(`auth-${userId}`);
          this.activeProcesses.delete(userId);
          this.clearAuthTimeout(userId);
          
          // Enviar mensaje de timeout
          await context.sendActivity('⏰ **Tiempo de autenticación agotado**\n\n' +
            '🚫 **El proceso de autenticación ha tomado demasiado tiempo.**\n\n' +
            '**Posibles causas:**\n' +
            '• No completaste el proceso de autenticación\n' +
            '• Dejaste abierta la ventana sin finalizar\n' +
            '• Hubo problemas de conectividad\n\n' +
            '**Para usar el bot:**\n' +
            '• Escribe `login` para iniciar un nuevo proceso de autenticación\n' +
            '• Asegúrate de completar el proceso rápidamente\n' +
            '• Verifica tu conexión a internet\n\n' +
            '💡 **Recuerda**: Tienes 5 minutos para completar la autenticación.');
            
        }
      } catch (error) {
        console.error('TeamsBot: Error enviando mensaje de timeout:', error.message);
      }
    }, this.AUTH_TIMEOUT_MS);
    
    this.authTimeouts.set(userId, {
      timeoutId,
      startTime: Date.now(),
      context: context
    });
    
    console.log(`TeamsBot: Timeout de autenticación establecido para usuario ${userId} (${this.AUTH_TIMEOUT_MS}ms)`);
  }

  /**
   * Limpia el timeout de autenticación para un usuario
   * @param {string} userId - ID del usuario
   * @private
   */
  clearAuthTimeout(userId) {
    const timeoutInfo = this.authTimeouts.get(userId);
    if (timeoutInfo) {
      clearTimeout(timeoutInfo.timeoutId);
      this.authTimeouts.delete(userId);
      console.log(`TeamsBot: Timeout de autenticación limpiado para usuario ${userId}`);
    }
  }

  /**
   * Inicia la limpieza periódica de timeouts
   * @private
   */
  startTimeoutCleanup() {
    // Limpiar timeouts cada 10 minutos
    setInterval(() => {
      const now = Date.now();
      const expiredTimeouts = [];
      
      for (const [userId, timeoutInfo] of this.authTimeouts.entries()) {
        const elapsed = now - timeoutInfo.startTime;
        if (elapsed > this.AUTH_TIMEOUT_MS + 60000) { // 1 minuto extra de margen
          expiredTimeouts.push(userId);
        }
      }
      
      expiredTimeouts.forEach(userId => {
        console.log(`TeamsBot: Limpiando timeout expirado para usuario ${userId}`);
        this.clearAuthTimeout(userId);
        this.activeDialogs.delete(`auth-${userId}`);
        this.activeProcesses.delete(userId);
      });
      
      if (expiredTimeouts.length > 0) {
        console.log(`TeamsBot: Limpieza periódica completada - ${expiredTimeouts.length} timeouts expirados removidos`);
      }
    }, 10 * 60 * 1000); // 10 minutos
  }

  /**
   * Asegura que el bot y los estados estén disponibles en el contexto del turno
   * @param {TurnContext} context - Contexto del turno
   * @private
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
   * NUEVO: Limpia estados colgados para mantenimiento
   * @returns {Object} - Información de limpieza
   */
  cleanupStuckStates() {
    const beforeDialogs = this.activeDialogs.size;
    const beforeProcesses = this.activeProcesses.size;
    const beforeTimeouts = this.authTimeouts.size;
    
    // Limpiar todos los estados activos
    this.activeDialogs.clear();
    this.activeProcesses.clear();
    
    // Limpiar todos los timeouts
    for (const [userId, timeoutInfo] of this.authTimeouts.entries()) {
      clearTimeout(timeoutInfo.timeoutId);
    }
    this.authTimeouts.clear();
    
    const cleaned = {
      dialogs: beforeDialogs,
      processes: beforeProcesses,
      timeouts: beforeTimeouts,
      total: beforeDialogs + beforeProcesses + beforeTimeouts
    };
    
    console.log(`TeamsBot: Limpieza de mantenimiento - Removidos ${cleaned.total} estados colgados`);
    return cleaned;
  }

  /**
   * NUEVO: Obtiene información de estados activos para debugging
   * @returns {Object} - Estado actual
   */
  getActiveStatesInfo() {
    const timeoutInfo = [];
    const now = Date.now();
    
    for (const [userId, timeoutData] of this.authTimeouts.entries()) {
      const elapsed = now - timeoutData.startTime;
      const remaining = Math.max(0, this.AUTH_TIMEOUT_MS - elapsed);
      
      timeoutInfo.push({
        userId,
        elapsed: Math.round(elapsed / 1000), // segundos
        remaining: Math.round(remaining / 1000), // segundos
        startTime: new Date(timeoutData.startTime).toISOString()
      });
    }
    
    return {
      activeDialogs: Array.from(this.activeDialogs),
      activeProcesses: Array.from(this.activeProcesses.keys()),
      authTimeouts: timeoutInfo,
      authenticatedUsers: Array.from(this.authenticatedUsers.keys()),
      timeoutDurationMs: this.AUTH_TIMEOUT_MS,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * NUEVO: Obtiene estadísticas detalladas del sistema de autenticación
   * @returns {Object} - Estadísticas completas
   */
  getAuthenticationStats() {
    const now = Date.now();
    const timeoutStats = {
      active: this.authTimeouts.size,
      details: []
    };
    
    for (const [userId, timeoutData] of this.authTimeouts.entries()) {
      const elapsed = now - timeoutData.startTime;
      const remaining = Math.max(0, this.AUTH_TIMEOUT_MS - elapsed);
      
      timeoutStats.details.push({
        userId,
        elapsedMs: elapsed,
        remainingMs: remaining,
        percentage: Math.round((elapsed / this.AUTH_TIMEOUT_MS) * 100)
      });
    }
    
    return {
      authenticated: {
        total: this.authenticatedUsers.size,
        users: Array.from(this.authenticatedUsers.keys())
      },
      activeProcesses: {
        dialogs: this.activeDialogs.size,
        processes: this.activeProcesses.size,
        timeouts: this.authTimeouts.size
      },
      timeouts: timeoutStats,
      configuration: {
        timeoutMs: this.AUTH_TIMEOUT_MS,
        timeoutMinutes: Math.round(this.AUTH_TIMEOUT_MS / 60000)
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports.TeamsBot = TeamsBot;