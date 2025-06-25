// teamsBot.js - Versión corregida para tarjetas dinámicas

const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');
const axios = require('axios');

// Importar los servicios correctamente
const openaiService = require('../services/openaiService');
const conversationService = require('../services/conversationService');

/**
 * TeamsBot class extends DialogBot to handle Teams-specific activities and OpenAI integration.
 */
class TeamsBot extends DialogBot {
  /**
   * Procesa los campos de fecha para convertirlos al formato ISO
   * @param {Object} fieldData - Datos de los campos
   * @returns {Object} - Datos con fechas procesadas
   */
  _processDateFields(fieldData) {
    const processed = { ...fieldData };
    
    // Lista de campos que típicamente contienen fechas
    const dateFields = [
      'fechaInicio', 'fechaFin', 'fechaMatrimonio', 'fechaNacimiento',
      'fecha', 'startDate', 'endDate', 'marriageDate', 'birthDate'
    ];
    
    for (const [key, value] of Object.entries(processed)) {
      // Si el campo contiene "fecha" o "date" en el nombre, o está en la lista
      const isDateField = key.toLowerCase().includes('fecha') || 
                         key.toLowerCase().includes('date') || 
                         dateFields.includes(key);
      
      if (isDateField && value && typeof value === 'string') {
        const convertedDate = this._convertToISODate(value);
        if (convertedDate) {
          processed[key] = convertedDate;
          console.log(`Fecha convertida: ${key} = ${value} -> ${convertedDate}`);
        }
      }
    }
    
    return processed;
  }

  /**
   * Convierte una fecha en diferentes formatos al formato ISO
   * @param {string} dateString - Fecha en formato string
   * @returns {string|null} - Fecha en formato ISO o null si no se puede convertir
   */
  _convertToISODate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
      return null;
    }

    // Si ya está en formato ISO, devolverla tal como está
    if (dateString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/)) {
      return dateString.endsWith('Z') ? dateString : dateString + 'Z';
    }

    // Si es solo una fecha YYYY-MM-DD, agregarle la hora
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString + 'T00:00:00.000Z';
    }

    let date = null;

    // Intentar diferentes formatos comunes
    const formats = [
      // Formato dd-MM-yyyy o dd/MM/yyyy
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
      // Formato yyyy-MM-dd
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
      // Formato MM-dd-yyyy o MM/dd/yyyy
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
    ];

    // Formato dd-MM-yyyy o dd/MM/yyyy
    const ddMMyyyyMatch = dateString.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddMMyyyyMatch) {
      const day = ddMMyyyyMatch[1].padStart(2, '0');
      const month = ddMMyyyyMatch[2].padStart(2, '0');
      const year = ddMMyyyyMatch[3];
      
      // Verificar que el mes y día sean válidos
      if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
          parseInt(day) >= 1 && parseInt(day) <= 31) {
        date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      }
    }

    // Formato yyyy-MM-dd
    const yyyyMMddMatch = dateString.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!date && yyyyMMddMatch) {
      const year = yyyyMMddMatch[1];
      const month = yyyyMMddMatch[2].padStart(2, '0');
      const day = yyyyMMddMatch[3].padStart(2, '0');
      
      if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
          parseInt(day) >= 1 && parseInt(day) <= 31) {
        date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      }
    }

    // Si no se pudo parsear con los formatos anteriores, intentar con Date.parse
    if (!date) {
      try {
        date = new Date(dateString);
        if (isNaN(date.getTime())) {
          date = null;
        }
      } catch (error) {
        console.warn(`No se pudo convertir la fecha: ${dateString}`);
        return null;
      }
    }

    // Convertir a ISO string si es válida
    if (date && !isNaN(date.getTime())) {
      return date.toISOString();
    }

    console.warn(`No se pudo convertir la fecha: ${dateString}`);
    return null;
  }

  /**
   * Creates an instance of TeamsBot.
   * @param {ConversationState} conversationState
   * @param {UserState} userState
   * @param {Dialog} dialog
   */
  constructor(conversationState, userState, dialog) {
    super(conversationState, userState, dialog);

    // Registrar la instancia globalmente para poder accederla desde otras partes
    global.botInstance = this;
    console.log('Instancia del bot registrada globalmente');

    // Manejadores de actividades
    this.onMembersAdded(this.handleMembersAdded.bind(this));
    this.onMessage(this.handleMessageWithAuth.bind(this));

    // Servicios
    this.openaiService = openaiService;
    this.conversationService = conversationService;

    // Validar OpenAI Service
    if (!this.openaiService || typeof this.openaiService.procesarMensaje !== 'function') {
      console.error('ERROR: openaiService inválido, usando fallback');
      this.openaiService = {
        procesarMensaje: async msg => `Servicio de OpenAI no disponible. Mensaje: "${msg}"`
      };
    } else {
      console.log('Servicio OpenAI importado correctamente');
    }

    // Validar Conversation Service
    if (!this.conversationService || typeof this.conversationService.saveMessage !== 'function') {
      console.error('ERROR: conversationService inválido, usando fallback');
      this.conversationService = {
        saveMessage: async () => ({}),
        getConversationHistory: async () => [],
        createConversation: async () => ({}),
        updateLastActivity: async () => ({})
      };
    } else {
      console.log('Servicio de conversación importado correctamente');
    }

    // Estado de autenticación en memoria y persistente
    this.authenticatedUsers = new Map();
    this.authState = this.userState.createProperty('AuthState');
    // Para evitar diálogos concurrentes
    this.activeDialogs = new Set();
  }

  /**
   * Saluda cuando alguien se une
   */
  async handleMembersAdded(context, next) {
    for (const member of context.activity.membersAdded) {
      if (member.id !== context.activity.recipient.id) {
        await context.sendActivity('Bienvenido a Alfa Bot. Escribe "login" para iniciar sesión.');
      }
    }
    await next();
  }

  /**
   * Maneja mensajes, incluyendo login, submits de tarjetas y OpenAI
   */
  async handleMessageWithAuth(context, next) {
    this._ensureBotInContext(context);

    try {
      const userId = context.activity.from.id;
      const conversationId = context.activity.conversation.id;
      const text = (context.activity.text || '').trim().toLowerCase();

      // Recuperar estado de autenticación
      const authData = await this.authState.get(context, {});
      const isAuthenticated = authData[userId]?.authenticated === true;

      console.log('Procesando mensaje:', { text, isAuthenticated, hasValue: !!context.activity.value });

      // 1) Login
      if (text === 'login' || !isAuthenticated) {
        const dialogKey = `auth-${userId}`;
        if (this.activeDialogs.has(dialogKey)) {
          return await next();
        }
        this.activeDialogs.add(dialogKey);

        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        if (!context.activity.value) {
          if (connectionName) {
            const loginCard = CardFactory.oauthCard(
              connectionName,
              'Iniciar Sesión',
              'Por favor inicia sesión para continuar'
            );
            await context.sendActivity({ attachments: [loginCard] });
          } else {
            await context.sendActivity('Error: no se configuró OAuth connectionName.');
          }
        }

        await this.dialog.run(context, this.dialogState);
        this.activeDialogs.delete(dialogKey);

      // 2) Submit de Adaptive Card (acción seleccionada)
      } else if (context.activity.value) {
        console.log('Datos recibidos del submit:', JSON.stringify(context.activity.value, null, 2));
        await this._handleCardSubmit(context, context.activity.value);

      // 3) Mostrar tarjetas de acciones
      } else if (text === 'acciones' || text === 'menú') {
        await this._sendActionCards(context);

      // 4) Mensaje libre -> OpenAI
      } else {
        await this.processOpenAIMessage(context, context.activity.text, userId, conversationId);
      }

    } catch (error) {
      console.error('Error en handleMessageWithAuth:', error);
      await context.sendActivity('Ocurrió un error. Intenta de nuevo o escribe "login".');
    }

    await next();
  }

  /**
   * Maneja el submit de las tarjetas adaptativas
   * @param {TurnContext} context - Contexto del turno
   * @param {Object} submitData - Datos enviados desde la tarjeta
   */
  async _handleCardSubmit(context, submitData) {
    try {
      const { action, method, url, token, ...fieldData } = submitData;
      
      console.log('Procesando acción:', action);
      console.log('Método:', method);
      console.log('URL base:', url);
      console.log('Datos de campos:', fieldData);

      // Validar que el token esté presente
      if (!token || token.trim() === '') {
        await context.sendActivity('❌ Token de autorización requerido. Por favor, ingresa tu token.');
        return;
      }

      // Procesar fechas en los datos de campo
      const processedFieldData = this._processDateFields(fieldData);

      console.log('Datos de campos procesados:', processedFieldData);

      // Procesar la URL reemplazando los placeholders
      let processedUrl = url;
      const urlParams = {};

      // Extraer parámetros de la URL (entre llaves) y reemplazarlos
      const urlPattern = /\{([^}]+)\}/g;
      let match;
      const urlParamNames = [];
      
      while ((match = urlPattern.exec(url)) !== null) {
        urlParamNames.push(match[1]);
      }

      // Reemplazar parámetros en la URL
      for (const paramName of urlParamNames) {
        if (processedFieldData[paramName] !== undefined && processedFieldData[paramName] !== '') {
          processedUrl = processedUrl.replace(`{${paramName}}`, encodeURIComponent(processedFieldData[paramName]));
          // Remover este parámetro de los datos de campo ya que se usó en la URL
          delete processedFieldData[paramName];
        } else {
          await context.sendActivity(`❌ Falta el parámetro requerido: ${paramName}`);
          return;
        }
      }

      console.log('URL procesada:', processedUrl);

      // Preparar configuración de la petición
      const axiosConfig = {
        method: method.toLowerCase(),
        url: processedUrl,
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      // Para métodos GET, poner los parámetros restantes en query params
      // Para otros métodos, poner en el body
      if (method.toUpperCase() === 'GET') {
        if (Object.keys(processedFieldData).length > 0) {
          axiosConfig.params = processedFieldData;
        }
      } else {
        if (Object.keys(processedFieldData).length > 0) {
          axiosConfig.data = processedFieldData;
        }
      }

      console.log('Configuración de axios:', axiosConfig);

      // Realizar la petición
      await context.sendActivity({ type: 'typing' });
      
      const response = await axios(axiosConfig);

      // Formatear y enviar respuesta
      const responseMessage = this._formatApiResponse(action, response.data);
      await context.sendActivity(responseMessage);

    } catch (error) {
      console.error(`Error al ejecutar acción:`, error);
      
      let errorMessage = `❌ Error al ejecutar *${submitData.action || 'acción'}*:\n`;
      
      if (error.response) {
        // Error de respuesta HTTP
        errorMessage += `Código: ${error.response.status}\n`;
        errorMessage += `Mensaje: ${error.response.data?.message || error.response.statusText || 'Error desconocido'}`;
        
        if (error.response.data && typeof error.response.data === 'object') {
          errorMessage += `\n\`\`\`json\n${JSON.stringify(error.response.data, null, 2)}\n\`\`\``;
        }
      } else if (error.request) {
        // Error de red
        errorMessage += 'No se pudo conectar con el servidor.';
      } else {
        // Otro tipo de error
        errorMessage += error.message;
      }

      await context.sendActivity(errorMessage);
    }
  }

  /**
   * Formatea la respuesta de la API para mostrar al usuario
   * @param {string} action - Nombre de la acción ejecutada
   * @param {*} data - Datos de respuesta
   * @returns {string} - Mensaje formateado
   */
  _formatApiResponse(action, data) {
    let message = `✅ *${action}* ejecutada exitosamente:\n\n`;
    
    if (typeof data === 'object' && data !== null) {
      // Si es un objeto, intentar formatear de manera legible
      if (Array.isArray(data)) {
        message += `Se encontraron ${data.length} resultados:\n`;
        message += `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
      } else {
        // Objeto simple, mostrar propiedades principales
        const keys = Object.keys(data);
        if (keys.length <= 5) {
          // Pocas propiedades, mostrar directamente
          for (const key of keys) {
            message += `**${key}**: ${data[key]}\n`;
          }
        } else {
          // Muchas propiedades, mostrar JSON
          message += `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
        }
      }
    } else {
      // Valor simple
      message += String(data);
    }
    
    return message;
  }

  /**
   * Envía un carrusel de Adaptive Cards con acciones disponibles
   */
  async _sendActionCards(context) {
    const actions = [
      {
        title: 'Obtener información del empleado',
        description: 'Consulta la información básica del empleado.',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
        fields: []
      },
      {
        title: 'Obtener solicitudes del empleado',
        description: 'Consulta todas las solicitudes de vacaciones del empleado.',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
        fields: []
      },
      {
        title: 'Obtener solicitud por ID',
        description: 'Consulta una solicitud específica por su ID.',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', placeholder: 'Ingresa el ID de la solicitud', required: true }
        ]
      },
      {
        title: 'Obtener solicitudes de dependientes',
        description: 'Consulta las solicitudes de vacaciones de los dependientes.',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/dependientes',
        fields: []
      },
      {
        title: 'Simular solicitud de vacaciones',
        description: 'Simula una solicitud de vacaciones para un rango de fechas.',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{fechaInicio}/{fechaFin}/{medioDia}/{simular}',
        fields: [
          { id: 'fechaInicio', type: 'date', label: 'Fecha inicio', required: true },
          { id: 'fechaFin', type: 'date', label: 'Fecha fin', required: true },
          { id: 'medioDia', type: 'choice', label: '¿Medio día?', value: 'false', choices: ['true', 'false'], required: true },
          { id: 'simular', type: 'choice', label: '¿Simular?', value: 'true', choices: ['true', 'false'], required: true }
        ]
      },
      {
        title: 'Cancelar solicitud',
        description: 'Cancela una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/cancelar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', placeholder: 'Ingresa el ID de la solicitud', required: true }
        ]
      },
      {
        title: 'Solicitar días por matrimonio',
        description: 'Solicita días de vacaciones por matrimonio.',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/matrimonio/{fechaMatrimonio}',
        fields: [
          { id: 'fechaMatrimonio', type: 'date', label: 'Fecha de Matrimonio', required: true }
        ]
      },
      {
        title: 'Solicitar días por nacimiento',
        description: 'Solicita días de vacaciones por nacimiento de hijo.',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/nacimiento/{fechaNacimiento}',
        fields: [
          { id: 'fechaNacimiento', type: 'date', label: 'Fecha de Nacimiento', required: true }
        ]
      },
      {
        title: 'Autorizar solicitud',
        description: 'Autoriza una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/autorizar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', placeholder: 'Ingresa el ID de la solicitud', required: true }
        ]
      },
      {
        title: 'Rechazar solicitud',
        description: 'Rechaza una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/rechazar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', placeholder: 'Ingresa el ID de la solicitud', required: true }
        ]
      },
      {
        title: 'Obtener periodos de recibo',
        description: 'Consulta los periodos de recibo disponibles.',
        method: 'GET',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/recibo/periodos',
        fields: []
      },
      {
        title: 'Enviar prueba de correo',
        description: 'Envía una prueba de correo electrónico.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/pruebacorreo',
        fields: []
      }
    ];

    const cards = actions.map(action => {
      // Crear campos de entrada
      const inputs = [];
      
      // Siempre agregar campo de token
      inputs.push({
        type: 'Input.Text',
        id: 'token',
        placeholder: 'Bearer tu_token_aqui',
        label: 'Token de Autorización',
        isRequired: true,
        spacing: 'Medium'
      });

      // Agregar campos específicos de la acción
      action.fields.forEach(field => {
        const input = {
          id: field.id,
          label: field.label,
          isRequired: field.required || false,
          spacing: 'Small'
        };

        if (field.placeholder) {
          input.placeholder = field.placeholder;
        }

        if (field.type === 'date') {
          input.type = 'Input.Date';
        } else if (field.type === 'choice' && field.choices) {
          input.type = 'Input.ChoiceSet';
          input.style = 'compact';
          input.value = field.value || field.choices[0];
          input.choices = field.choices.map(choice => ({ title: choice, value: choice }));
        } else {
          input.type = 'Input.Text';
          if (field.value) {
            input.value = field.value;
          }
        }

        inputs.push(input);
      });

      // Crear la tarjeta
      const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
          {
            type: 'TextBlock',
            text: action.title,
            weight: 'Bolder',
            size: 'Medium',
            wrap: true
          },
          {
            type: 'TextBlock',
            text: action.description,
            wrap: true,
            color: 'Accent',
            spacing: 'Small'
          }
        ]
      };

      // Agregar inputs al body si existen
      if (inputs.length > 0) {
        card.body.push(...inputs);
      }

      // Agregar acciones
      card.actions = [
        {
          type: 'Action.Submit',
          title: 'Ejecutar',
          data: {
            action: action.title,
            method: action.method,
            url: action.url
          }
        }
      ];

      return CardFactory.adaptiveCard(card);
    });

    // Enviar mensaje introductorio
    await context.sendActivity('📋 **Acciones disponibles**:');
    
    // Enviar todas las tarjetas en formato de lista
    await context.sendActivity({
      attachments: cards,
      attachmentLayout: 'list'
    });

    await context.sendActivity('ℹ️ **Nota**: Necesitarás proporcionar tu token de autorización para usar estas acciones.');
  }

  /**
   * Maneja actividades invoke (OAuth)
   */
  async onInvokeActivity(context) {
    try {
      this._ensureBotInContext(context);
      const activityName = context.activity.name || 'unknown';
      const userId = context.activity.from.id;
      const dialogKey = `auth-${userId}`;

      if (activityName === 'signin/verifyState' || activityName === 'signin/tokenExchange') {
        this.activeDialogs.add(dialogKey);
        await this.dialog.run(context, this.dialogState);
        this.activeDialogs.delete(dialogKey);
        return { status: 200 };
      } else if (activityName === 'signin/failure') {
        await context.sendActivity('Error en autenticación. Escribe "login" para intentar de nuevo.');
        this.activeDialogs.delete(dialogKey);
        return { status: 200 };
      }

      return await super.onInvokeActivity(context);
    } catch (error) {
      console.error('Error en onInvokeActivity:', error);
      return { status: 500 };
    }
  }

  /**
   * Procesa mensajes con OpenAI
   */
  async processOpenAIMessage(context, message, userId, conversationId) {
    try {
      await context.sendActivity({ type: 'typing' });
      try {
        await this.conversationService.saveMessage(message, conversationId, userId);
      } catch {}
      let history = [];
      try {
        history = await this.conversationService.getConversationHistory(conversationId);
      } catch {}
      const formatted = history.map(i => ({
        type: i.userId === userId ? 'user' : 'assistant',
        message: i.message
      }));
      const response = await this.openaiService.procesarMensaje(message, formatted);
      try {
        await this.conversationService.saveMessage(response, conversationId, 'bot');
        await this.conversationService.updateLastActivity(conversationId);
      } catch {}
      await context.sendActivity(response);
    } catch (err) {
      console.error('Error en processOpenAIMessage:', err);
      await context.sendActivity('Error al procesar tu mensaje. Intenta más tarde.');
    }
  }

  /**
   * Marca al usuario como autenticado (almacena token)
   */
  async setUserAuthenticated(userId, conversationId, userData) {
    try {
      // userData debe incluir { email, name, token, context }
      const { email, name, token, context } = userData;
      this.authenticatedUsers.set(userId, { email, name, token, context });

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

      try {
        await this.conversationService.createConversation(conversationId, userId);
      } catch {}
      console.log(`Usuario ${userId} autenticado correctamente.`);
      return true;
    } catch (err) {
      console.error('Error en setUserAuthenticated:', err);
      return false;
    }
  }

  isUserAuthenticated(userId) {
    return this.authenticatedUsers.has(userId);
  }

  logoutUser(userId) {
    if (this.authenticatedUsers.has(userId)) {
      this.authenticatedUsers.delete(userId);
      console.log(`Usuario ${userId} ha cerrado sesión.`);
      return true;
    }
    return false;
  }

  /**
   * Asegura que el bot y los estados estén en turnState
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