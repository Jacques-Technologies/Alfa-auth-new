const { DialogSet } = require('botbuilder-dialogs');

class InvalidTokenMiddleware {
  /**
   * @param {ConversationState} conversationState
   * @param {UserState} userState
   * @param {DialogSet} dialogs
   */
  constructor(conversationState, userState, dialogs) {
    this.conversationState = conversationState;
    this.userState = userState;
    this.dialogs = dialogs;
  }

  /**
   * Middleware entrypoint.
   * @param {TurnContext} context
   * @param {function} next
   */
  async onTurn(context, next) {
    try {
      await next();
    } catch (err) {
      // Detectamos error 401 (token inválido)
      if (err.statusCode === 401 || err.code === 'UnauthorizedAccess') {
        // Borrar token guardado
        const oauthProperty = this.userState.createProperty('OAuthToken');
        await oauthProperty.delete(context);

        // Cancelar todos los diálogos activos
        const dialogContext = await this.dialogs.createContext(context);
        await dialogContext.cancelAllDialogs();

        // Informar al usuario y reiniciar flujo de MainDialog
        await context.sendActivity('Tu sesión expiró. Por favor, inicia sesión nuevamente.');
        await dialogContext.beginDialog('MainDialog');
      } else {
        // Re-lanzar si no es 401
        throw err;
      }
    } finally {
      // Guardar cambios de estado
      await this.conversationState.saveChanges(context, false);
      await this.userState.saveChanges(context, false);
    }
  }
}

module.exports = InvalidTokenMiddleware;
