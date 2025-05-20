const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog class that extends ComponentDialog to handle user logout.
 */
class LogoutDialog extends ComponentDialog {
    /**
     * Creates an instance of LogoutDialog.
     * @param {string} id - The dialog ID.
     * @param {string} connectionName - The connection name for the OAuth provider.
     */
    constructor(id, connectionName) {
        super(id);
        this.connectionName = connectionName;
        console.log(`LogoutDialog inicializado con connectionName: ${connectionName}`);
    }

    /**
     * Called when the dialog is started and pushed onto the dialog stack.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @param {Object} options - Optional. Initial information to pass to the dialog.
     */
    async onBeginDialog(innerDc, options) {
        console.log('LogoutDialog.onBeginDialog llamado');
        const result = await this.interrupt(innerDc);
        if (result) {
            return result;
        }

        return await super.onBeginDialog(innerDc, options);
    }

    /**
     * Called when the dialog is the active dialog and the user replies with a new activity.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async onContinueDialog(innerDc) {
        console.log('LogoutDialog.onContinueDialog llamado');
        const result = await this.interrupt(innerDc);
        if (result) {
            return result;
        }

        return await super.onContinueDialog(innerDc);
    }

    /**
     * Checks for 'logout' message and signs the user out if detected.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text?.toLowerCase() || '';
            
            if (text === 'logout') {
                console.log('Comando de logout detectado');
                
                try {
                    // Obtener el cliente de token
                    const userTokenClient = innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey);
                    
                    if (userTokenClient) {
                        const { activity } = innerDc.context;
                        // Cerrar sesión del usuario
                        await userTokenClient.signOutUser(
                            activity.from.id, 
                            this.connectionName, 
                            activity.channelId
                        );
                        
                        // Actualizar estado de autenticación en el bot
                        const bot = innerDc.context.turnState.get('bot');
                        if (bot && typeof bot.logoutUser === 'function') {
                            bot.logoutUser(activity.from.id);
                        }
                        
                        await innerDc.context.sendActivity('Has cerrado sesión exitosamente. Escribe "login" para iniciar sesión nuevamente.');
                        return await innerDc.cancelAllDialogs();
                    } else {
                        console.error('No se encontró el cliente de token');
                        await innerDc.context.sendActivity('No se pudo cerrar sesión. Por favor, intenta nuevamente.');
                    }
                } catch (error) {
                    console.error(`Error al cerrar sesión: ${error.message}`);
                    await innerDc.context.sendActivity('Ocurrió un error al cerrar sesión. Por favor, intenta nuevamente.');
                }
            }
        }
    }
}

module.exports.LogoutDialog = LogoutDialog;