// teamsBot.js - Versión corregida con token OAuth automático

const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');
const axios = require('axios');

// Importar los servicios
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

/**
 * TeamsBot class extends DialogBot to handle Teams-specific activities and OpenAI integration.
 * Incluye funcionalidad CORREGIDA para usar token OAuth automáticamente.
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
        procesarMensaje: async msg => `Servicio de OpenAI no disponible. Mensaje: "${msg}"`
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
        await context.sendActivity('👋 **Bienvenido a Alfa Bot**\n\nEscribe `login` para iniciar sesión o `acciones` para ver las acciones disponibles.');
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
        console.log('Token OAuth: ' + userInfo.token);
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
   * Maneja todos los mensajes entrantes con lógica de autenticación
   * @param {TurnContext} context - Contexto del turno
   * @param {Function} next - Siguiente middleware
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();

      // Recuperar estado de autenticación persistente
      const authData = await this.authState.get(context, {});
      const isAuthenticated = authData[userId]?.authenticated === true;

      console.log(`TeamsBot: Procesando mensaje de ${userId}: "${text}" (Autenticado: ${isAuthenticated})`);
      console.log('TeamsBot: Activity type:', context.activity.type);
      console.log('TeamsBot: Activity value:', context.activity.value);

      // Procesar comandos específicos primero
      if (this._isExplicitLoginCommand(text)) {
        await this._handleLoginRequest(context, userId);
      } else if (context.activity.value && Object.keys(context.activity.value).length > 0) {
        // CORREGIDO: Mejor detección de submit de tarjetas
        console.log('TeamsBot: Detectado submit de tarjeta adaptativa');
        await this._handleCardSubmit(context, context.activity.value);
      } else if (this._isActionsRequest(text)) {
        if (isAuthenticated) {
          await this._sendActionCards(context);
        } else {
          await context.sendActivity('🔒 Necesitas iniciar sesión primero. Escribe `login` para autenticarte.');
        }
      } else if (this._isHelpRequest(text)) {
        await this._sendHelpMessage(context);
      } else if (this._isLogoutRequest(text)) {
        await this._handleLogoutRequest(context, userId);
      } else {
        // Mensajes generales - requieren autenticación para OpenAI
        if (isAuthenticated) {
          await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
        } else {
          await context.sendActivity('🔒 Necesitas iniciar sesión para usar el asistente de OpenAI. Escribe `login` para autenticarte.');
        }
      }

    } catch (error) {
      console.error('TeamsBot: Error en handleMessageWithAuth:', error);
      await context.sendActivity('❌ Ocurrió un error inesperado. Intenta de nuevo o escribe `ayuda` para más información.');
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
   * Determina si es una solicitud de acciones
   * @param {string} text - Texto del mensaje
   * @returns {boolean}
   * @private
   */
  _isActionsRequest(text) {
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
   * Maneja solicitudes de login
   * @param {TurnContext} context - Contexto del turno
   * @param {string} userId - ID del usuario
   * @private
   */
  async _handleLoginRequest(context, userId) {
    const dialogKey = `auth-${userId}`;
    
    if (this.activeDialogs.has(dialogKey)) {
      return;
    }
    
    this.activeDialogs.add(dialogKey);

    try {
      const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
      
      if (!context.activity.value && connectionName) {
        const loginCard = CardFactory.oauthCard(
          connectionName,
          'Iniciar Sesión',
          'Por favor inicia sesión para continuar'
        );
        await context.sendActivity({ attachments: [loginCard] });
      } else if (!connectionName) {
        await context.sendActivity('❌ Error: Configuración OAuth no encontrada.');
      }

      await this.dialog.run(context, this.dialogState);
    } finally {
      this.activeDialogs.delete(dialogKey);
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

      await context.sendActivity('✅ Has cerrado sesión correctamente. Escribe `login` para iniciar sesión nuevamente.');
    } catch (error) {
      console.error('Error en logout:', error);
      await context.sendActivity('❌ Error al cerrar sesión. Intenta nuevamente.');
    }
  }

  /**
   * Envía mensaje de ayuda con comandos disponibles
   * @param {TurnContext} context - Contexto del turno
   * @private
   */
  async _sendHelpMessage(context) {
    const helpMessage = `
🤖 **Comandos disponibles**:

• \`login\` - Iniciar sesión con OAuth
• \`acciones\` - Ver tarjetas de acciones de API (requiere autenticación)
• \`ayuda\` - Mostrar este mensaje
• \`logout\` - Cerrar sesión

💬 **Uso general**:
Una vez autenticado, puedes escribir cualquier pregunta y el asistente de OpenAI te responderá.

🔧 **Acciones de API**:
Usa el comando \`acciones\` para ver todas las operaciones disponibles con el sistema SIRH.
Las acciones usan automáticamente tu token de autenticación OAuth.
    `;
    await context.sendActivity(helpMessage.trim());
  }

  /**
   * CORREGIDO: Maneja el submit de las tarjetas adaptativas con token OAuth automático
   * @param {TurnContext} context - Contexto del turno
   * @param {Object} submitData - Datos enviados desde la tarjeta
   * @private
   */
  async _handleCardSubmit(context, submitData) {
    try {
      console.log('TeamsBot: Procesando submit de tarjeta adaptativa');
      console.log('TeamsBot: Datos completos recibidos:', JSON.stringify(submitData, null, 2));

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
      formattedResponse = await this.openaiService.procesarMensaje(prompt, []);
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
   * CORREGIDO: Envía un conjunto de tarjetas adaptativas con acciones disponibles
   * @param {TurnContext} context - Contexto del turno
   * @private
   */
  async _sendActionCards(context) {
    try {
      // Definir todas las acciones disponibles
      const actions = this._getAvailableActions();
      
      // Crear tarjetas adaptativas (máximo 3 por vez para mejor visualización)
      const cards = this._createAdaptiveCards(actions);
      
      // Enviar mensaje introductorio
      await context.sendActivity('📋 **Acciones de API disponibles**:\n\nSelecciona una acción para ejecutar:');
      
      // Enviar tarjetas en grupos para mejor visualización
      const cardsPerMessage = 2; // Reducido para mejor visualización
      for (let i = 0; i < cards.length; i += cardsPerMessage) {
        const cardGroup = cards.slice(i, i + cardsPerMessage);
        
        // Enviar cada tarjeta por separado para mejor compatibilidad
        for (const card of cardGroup) {
          await context.sendActivity({ attachments: [card] });
          // Pequeña pausa entre tarjetas para evitar problemas de rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      await context.sendActivity('ℹ️ **Nota**: Las acciones usan automáticamente tu token de autenticación OAuth.');
      
    } catch (error) {
      console.error('Error enviando tarjetas de acciones:', error);
      await context.sendActivity('❌ Error al mostrar las acciones disponibles. Por favor, intenta nuevamente.');
    }
  }

  /**
   * Obtiene la lista de acciones disponibles con sus configuraciones
   * @returns {Array} - Lista de acciones
   * @private
   */
  _getAvailableActions() {
    return [
      {
        title: 'Información del Empleado',
        description: 'Consulta la información básica del empleado autenticado',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
        fields: [],
        icon: '👤'
      },
      {
        title: 'Obtener periodos',
        description: 'Consulta los periodos de vacaciones del empleado',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/recibo/periodos',
        fields: [],
        icon: '📅'
      },
      {
        title: 'Solicitudes de Vacaciones',
        description: 'Consulta todas las solicitudes de vacaciones del empleado',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
        fields: [],
        icon: '🏖️'
      },
      {
        title: 'Consultar Solicitud por ID',
        description: 'Consulta una solicitud específica por su ID',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}',
        fields: [
          { 
            id: 'idSolicitud', 
            type: 'text', 
            label: 'ID de Solicitud', 
            placeholder: 'Ej: 12345', 
            required: true 
          }
        ],
        icon: '🔍'
      },
      {
        title: 'Solicitudes de Dependientes',
        description: 'Consulta las solicitudes de vacaciones de los dependientes',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/dependientes',
        fields: [],
        icon: '👨‍👩‍👧‍👦'
      },
      {
        title: 'Simular Solicitud de Vacaciones',
        description: 'Simula una solicitud de vacaciones para un rango de fechas',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{fechaInicio}/{fechaFin}/{medioDia}/{simular}',
        fields: [
          { 
            id: 'fechaInicio', 
            type: 'date', 
            label: 'Fecha de inicio', 
            placeholder: 'Ej: 2025-06-18',
            required: true 
          },
          { 
            id: 'fechaFin', 
            type: 'date', 
            label: 'Fecha de fin', 
            placeholder: 'Ej: 2025-06-25',
            required: true 
          },
          { 
            id: 'medioDia', 
            type: 'choice', 
            label: '¿Medio día?', 
            value: 'false', 
            choices: ['true', 'false'], 
            required: true 
          },
          { 
            id: 'simular', 
            type: 'choice', 
            label: '¿Solo simular?', 
            value: 'true', 
            choices: ['true', 'false'], 
            required: true 
          }
        ],
        icon: '🎯'
      },
      {
        title: 'Solicitar vacaciones por Matrimonio',
        description: 'Solicita vacaciones por matrimonio con fecha específica',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/matrimonio/{fechaMatrimonio}',
        fields: [
          { 
            id: 'fechaMatrimonio', 
            type: 'date', 
            label: 'Fecha de Matrimonio',
            placeholder: 'Ej: 2025-06-18',
            required: true 
          }
        ],
        icon: '💍'
      },
      {
        title: 'Solicitar vacaciones por Nacimiento',
        description: 'Solicita vacaciones por nacimiento con fecha específica',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/nacimiento/{fechaNacimiento}',
        fields: [
          { 
            id: 'fechaNacimiento', 
            type: 'date', 
            label: 'Fecha de Nacimiento',
            placeholder: 'Ej: 2025-06-18',
            required: true 
          }
        ],
        icon: '👶'
      },
      {
        title: 'Autorizar Solicitud',
        description: 'Autoriza una solicitud de vacaciones por ID',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/autorizar',
        fields: [
          {
            id: 'idSolicitud',
            type: 'text',
            label: 'ID de Solicitud',
            placeholder: 'Ej: 12345',
            required: true
          }
        ],
        icon: '✅'
      },
      {
        title: 'Rechazar Solicitud',
        description: 'Rechaza una solicitud de vacaciones por ID',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/rechazar',
        fields: [
          {
            id: 'idSolicitud',
            type: 'text',
            label: 'ID de Solicitud',
            placeholder: 'Ej: 12345',
            required: true
          }
        ],
        icon: '❌'
      },
      {
        title: 'Cancelar Solicitud',
        description: 'Cancela una solicitud de vacaciones por ID',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/cancelar',
        fields: [
          { 
            id: 'idSolicitud', 
            type: 'text', 
            label: 'ID de Solicitud', 
            placeholder: 'Ej: 12345', 
            required: true 
          }
        ],
        icon: '❌'
      }
    ];
  }

  /**
   * CORREGIDO: Crea las tarjetas adaptativas sin imagen de fondo
   * @param {Array} actions - Lista de acciones
   * @returns {Array} - Lista de tarjetas adaptativas
   * @private
   */
  _createAdaptiveCards(actions) {
    return actions.map(action => {
      // Crear elementos del cuerpo de la tarjeta
      const bodyElements = [
        // TÍTULO PRINCIPAL
        {
          type: 'TextBlock',
          text: `${action.icon || '🔧'} ${action.title}`,
          size: 'Large',
          weight: 'Bolder',
          color: 'Accent',
          wrap: true,
          horizontalAlignment: 'Center'
        },
        // Separador visual
        {
          type: 'TextBlock',
          text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          size: 'Small',
          color: 'Accent',
          horizontalAlignment: 'Center',
          spacing: 'Small'
        },
        // Descripción
        {
          type: 'TextBlock',
          text: action.description,
          wrap: true,
          spacing: 'Medium',
          color: 'Default'
        },
        // Información del método
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Método:',
              value: action.method
            },
            {
              title: 'Endpoint:',
              value: action.url.split('/').pop() || 'API'
            }
          ],
          spacing: 'Medium'
        }
      ];

      // Agregar campos específicos de la acción
      if (action.fields && action.fields.length > 0) {
        bodyElements.push({
          type: 'TextBlock',
          text: '📝 Parámetros adicionales:',
          weight: 'Bolder',
          spacing: 'Large'
        });

        action.fields.forEach(field => {
          // Agregar etiqueta del campo
          bodyElements.push({
            type: 'TextBlock',
            text: `${this._getFieldIcon(field.type)} ${field.label}${field.required ? ' *' : ''}:`,
            weight: 'Bolder',
            spacing: 'Medium'
          });

          // Agregar input del campo
          const inputElement = this._createInputElement(field);
          bodyElements.push(inputElement);
        });
      } else {
        // Si no hay campos, agregar nota informativa
        bodyElements.push({
          type: 'TextBlock',
          text: '✅ Esta acción no requiere parámetros adicionales',
          isSubtle: true,
          spacing: 'Large',
          horizontalAlignment: 'Center'
        });
      }

      // Crear la tarjeta adaptativa sin imagen de fondo
      const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: bodyElements,
        actions: [
          {
            type: 'Action.Submit',
            title: `${action.icon || '▶️'} Ejecutar`,
            data: {
              action: action.title,
              method: action.method,
              url: action.url
            },
            style: 'positive'
          }
        ],
        speak: `Acción disponible: ${action.title}. ${action.description}`
      };

      return CardFactory.adaptiveCard(card);
    });
  }

  /**
   * Obtiene el icono apropiado para un tipo de campo
   * @param {string} fieldType - Tipo de campo
   * @returns {string} - Icono emoji
   * @private
   */
  _getFieldIcon(fieldType) {
    switch (fieldType) {
      case 'date': return '📅';
      case 'choice': return '📝';
      case 'text': return '✏️';
      default: return '📄';
    }
  }

  /**
   * Crea un elemento de input para un campo específico
   * @param {Object} field - Configuración del campo
   * @returns {Object} - Elemento de input
   * @private
   */
  _createInputElement(field) {
    const baseInput = {
      id: field.id,
      isRequired: field.required || false,
      spacing: 'Small'
    };

    if (field.type === 'date') {
      return {
        ...baseInput,
        type: 'Input.Date',
        placeholder: field.placeholder || field.label
      };
    } else if (field.type === 'choice' && field.choices) {
      return {
        ...baseInput,
        type: 'Input.ChoiceSet',
        style: 'compact',
        value: field.value || field.choices[0],
        choices: field.choices.map(choice => ({ title: choice, value: choice }))
      };
    } else {
      return {
        ...baseInput,
        type: 'Input.Text',
        placeholder: field.placeholder || field.label,
        value: field.value || ''
      };
    }
  }

  /**
   * Maneja actividades invoke (principalmente OAuth)
   * @param {TurnContext} context - Contexto del turno
   * @returns {Object} - Respuesta de la actividad invoke
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      console.log(`TeamsBot: Actividad invoke recibida: ${activityName}`);

      if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
        this.activeDialogs.add(dialogKey);
        try {
          await this.dialog.run(context, this.dialogState);
          return { status: 200 };
        } finally {
          this.activeDialogs.delete(dialogKey);
        }
      } else if (activityName === 'signin/failure') {
        await context.sendActivity('❌ Error en autenticación OAuth. Escribe `login` para intentar de nuevo.');
        this.activeDialogs.delete(dialogKey);
        return { status: 200 };
      }

      return await super.onInvokeActivity(context);
    } catch (error) {
      console.error('TeamsBot: Error en onInvokeActivity:', error);
      return { status: 500 };
    }
  }

  /**
   * Procesa mensajes con el servicio de OpenAI
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

      // Procesar con OpenAI
      const response = await this.openaiService.procesarMensaje(message, formattedHistory);

      // Guardar respuesta del bot
      try {
        await this.conversationService.saveMessage(response, conversationId, 'bot');
        await this.conversationService.updateLastActivity(conversationId);
      } catch (error) {
        console.warn('TeamsBot: Error guardando respuesta del bot:', error.message);
      }

      // Enviar respuesta al usuario
      await context.sendActivity(response);

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
      console.log(`TeamsBot: Usuario ${userId} ha cerrado sesión`);
      return true;
    }
    return false;
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
}

module.exports.TeamsBot = TeamsBot;
