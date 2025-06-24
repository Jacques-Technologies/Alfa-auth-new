// teamsBot.js

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
      } else if (context.activity.value && context.activity.value.action) {
        const { action, method, url, token, ...params } = context.activity.value;

        try {
          const response = await axios({
            method: method.toLowerCase(),
            url,
            headers: {
              'Authorization': token,
              'Content-Type': 'application/json'
            },
            params: method.toUpperCase() === 'GET' ? params : undefined,
            data: method.toUpperCase() === 'GET' ? undefined : params
          });

          await context.sendActivity(
            `*${action}* ejecutada exitosamente:\n\`\`\`json\n${JSON.stringify(response.data, null, 2)}\n\`\`\``
          );
        } catch (err) {
          console.error(`Error al ejecutar ${action}:`, err);
          await context.sendActivity(
            `Error al ejecutar *${action}*: ${err.response?.data || err.message}`
          );
        }

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
   * Envía un carrusel de Adaptive Cards con un campo de token inyectado
   */
  async _sendActionCards(context) {
    const userId = context.activity.from.id;
    const userData = this.authenticatedUsers.get(userId) || {};

    // Campo token
    const tokenField = {
      id: 'token',
      type: 'text',
      placeholder: 'Bearer <tu_token>',
      label: 'Token',
      value: userData.token || ''
    };

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
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', value: '' }
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
          { id: 'fechaInicio', type: 'date', label: 'Fecha inicio', value: '' },
          { id: 'fechaFin', type: 'date', label: 'Fecha fin', value: '' },
          { id: 'medioDia', type: 'choice', label: '¿Medio día?', value: 'false', choices: ['true', 'false'] },
          { id: 'simular', type: 'choice', label: '¿Simular?', value: 'true', choices: ['true', 'false'] }
        ]
      },
      {
        title: 'Cancelar solicitud',
        description: 'Cancela una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/cancelar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', value: '' }
        ]
      },
      {
        title: 'Solicitar días por matrimonio',
        description: 'Solicita días de vacaciones por matrimonio.',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/matrimonio/{fechaMatrimonio}',
        fields: [
          { id: 'fechaMatrimonio', type: 'date', label: 'Fecha de Matrimonio', value: '' }
        ]
      },
      {
        title: 'Solicitar días por nacimiento',
        description: 'Solicita días de vacaciones por nacimiento de hijo.',
        method: 'POST',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/nacimiento/{fechaNacimiento}',
        fields: [
          { id: 'fechaNacimiento', type: 'date', label: 'Fecha de Nacimiento', value: '' }
        ]
      },
      {
        title: 'Autorizar solicitud',
        description: 'Autoriza una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/autorizar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', value: '' }
        ]
      },
      {
        title: 'Rechazar solicitud',
        description: 'Rechaza una solicitud de vacaciones por ID.',
        method: 'PUT',
        url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/rechazar',
        fields: [
          { id: 'idSolicitud', type: 'text', label: 'ID de Solicitud', value: '' }
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
      const inputs = [tokenField, ...action.fields]
        .map(field => {
          switch (field.type) {
            case 'text':
              return {
                type: 'Input.Text',
                id: field.id,
                placeholder: field.placeholder || field.label,
                value: field.value || ''
              };
            case 'date':
              return {
                type: 'Input.Date',
                id: field.id,
                placeholder: field.placeholder || field.label,
                value: field.value || ''
              };
            case 'choice':
              return {
                type: 'Input.ChoiceSet',
                id: field.id,
                style: 'compact',
                value: field.value,
                choices: field.choices.map(c => ({ title: c, value: c }))
              };
            default:
              return null;
          }
        })
        .filter(Boolean);

      const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: action.title, weight: 'Bolder', size: 'Medium' },
          { type: 'TextBlock', text: action.description, wrap: true },
          ...inputs
        ],
        actions: [
          {
            type: 'Action.Submit',
            title: 'Ejecutar',
            data: {
              action: action.title,
              method: action.method,
              url: action.url
            }
          }
        ]
      };

      return CardFactory.adaptiveCard(card);
    });

    await context.sendActivity({
      attachments: cards,
      attachmentLayout: 'carousel'
    });
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
