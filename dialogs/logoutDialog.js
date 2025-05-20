const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog extendido con detección de comando de logout y handler especial
 */
class LogoutDialog extends ComponentDialog {
    /**
     * Constructor de LogoutDialog
     * @param {string} id - ID del diálogo
     * @param {string} connectionName - Nombre de la conexión OAuth
     */
    constructor(id, connectionName) {
        super(id);
        this.connectionName = connectionName;
    }

    /**
     * Se ejecuta al iniciar el diálogo
     * @param {DialogContext} innerDc - Contexto del diálogo
     * @param {Object} options - Opciones iniciales
     */
    async onBeginDialog(innerDc, options) {
        const result = await this.interrupt(innerDc);
        if (result) {
            return result;
        }

        return await super.onBeginDialog(innerDc, options);
    }

    /**
     * Se ejecuta al continuar el diálogo
     * @param {DialogContext} innerDc - Contexto del diálogo
     */
    async onContinueDialog(innerDc) {
        const result = await this.interrupt(innerDc);
        if (result) {
            return result;
        }

        return await super.onContinueDialog(innerDc);
    }

    /**
     * Procesa la interrupción por comando de logout
     * @param {DialogContext} innerDc - Contexto del diálogo
     */
    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text.toLowerCase();
            
            // Detectar varios posibles comandos de logout
            if (text === 'logout' || text === 'cerrar sesión' || text === 'salir' || text === 'cerrar sesion') {
                // Obtener el cliente de tokens de usuario
                const userTokenClient = innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey);
                const { activity } = innerDc.context;
                
                // Cerrar sesión con el proveedor OAuth
                await userTokenClient.signOutUser(activity.from.id, this.connectionName, activity.channelId);
                
                // Además, marcar como no autenticado en el bot
                const bot = innerDc.context.turnState.get('bot');
                if (bot && bot.logoutUser) {
                    bot.logoutUser(activity.from.id);
                }
                
                await innerDc.context.sendActivity('Has cerrado sesión exitosamente. Escribe algo para iniciar sesión nuevamente.');
                return await innerDc.cancelAllDialogs();
            }
        }
    }
}

module.exports.LogoutDialog = LogoutDialog;