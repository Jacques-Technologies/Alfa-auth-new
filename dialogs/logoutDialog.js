const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog class extends ComponentDialog to handle user logout with improved functionality.
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
        
        // Validar parámetros
        if (!connectionName) {
            console.warn('LogoutDialog: connectionName no proporcionado');
        }
        
        console.log(`LogoutDialog inicializado con connectionName: ${connectionName}`);
    }

    /**
     * Called when the dialog is started and pushed onto the dialog stack.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @param {Object} options - Optional. Initial information to pass to the dialog.
     */
    async onBeginDialog(innerDc, options) {
        console.log('LogoutDialog.onBeginDialog llamado');
        
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }

            return await super.onBeginDialog(innerDc, options);
        } catch (error) {
            console.error('LogoutDialog: Error en onBeginDialog:', error.message);
            return await innerDc.endDialog();
        }
    }

    /**
     * Called when the dialog is continued, where it is the active dialog and the user replies with a new activity.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async onContinueDialog(innerDc) {
        console.log('LogoutDialog.onContinueDialog llamado');
        
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }

            return await super.onContinueDialog(innerDc);
        } catch (error) {
            console.error('LogoutDialog: Error en onContinueDialog:', error.message);
            return await innerDc.endDialog();
        }
    }

    /**
     * Interrupts the dialog to handle logout and other commands.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text?.toLowerCase()?.trim() || '';
            
            // Comandos de logout
            const logoutCommands = ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'];
            
            if (logoutCommands.includes(text)) {
                console.log(`LogoutDialog: Comando de logout detectado: "${text}"`);
                return await this.handleLogout(innerDc);
            }
            
            // Comandos de ayuda
            const helpCommands = ['ayuda', 'help', 'comandos', 'commands'];
            if (helpCommands.includes(text)) {
                console.log(`LogoutDialog: Comando de ayuda detectado: "${text}"`);
                return await this.handleHelp(innerDc);
            }
        }
        
        return null; // No interrumpir
    }

    /**
     * Handles the logout process
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleLogout(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            console.log(`LogoutDialog: Procesando logout para usuario ${userId}`);
            
            let logoutSuccessful = false;
            
            // Intentar cerrar sesión OAuth
            try {
                const userTokenClient = innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey);
                
                if (userTokenClient && this.connectionName) {
                    const { activity } = innerDc.context;
                    
                    // Cerrar sesión OAuth
                    await userTokenClient.signOutUser(
                        activity.from.id, 
                        this.connectionName, 
                        activity.channelId
                    );
                    
                    console.log('LogoutDialog: Sesión OAuth cerrada exitosamente');
                    logoutSuccessful = true;
                } else {
                    console.warn('LogoutDialog: No se encontró userTokenClient o connectionName');
                }
            } catch (oauthError) {
                console.error('LogoutDialog: Error al cerrar sesión OAuth:', oauthError.message);
                // Continuar con otros métodos de logout
            }
            
            // Limpiar estado en el bot
            try {
                const bot = innerDc.context.turnState.get('bot');
                if (bot && typeof bot.logoutUser === 'function') {
                    const botLogoutSuccess = bot.logoutUser(userId);
                    if (botLogoutSuccess) {
                        console.log('LogoutDialog: Estado del bot limpiado exitosamente');
                        logoutSuccessful = true;
                    }
                }
            } catch (botError) {
                console.error('LogoutDialog: Error al limpiar estado del bot:', botError.message);
            }
            
            // Limpiar estado de usuario directamente
            try {
                const userState = innerDc.context.turnState.get('UserState');
                if (userState) {
                    const authState = userState.createProperty('AuthState');
                    const authData = await authState.get(innerDc.context, {});
                    
                    if (authData[userId]) {
                        delete authData[userId];
                        await authState.set(innerDc.context, authData);
                        await userState.saveChanges(innerDc.context);
                        console.log('LogoutDialog: Estado de usuario limpiado exitosamente');
                        logoutSuccessful = true;
                    }
                }
            } catch (stateError) {
                console.error('LogoutDialog: Error al limpiar estado de usuario:', stateError.message);
            }
            
            // Enviar mensaje de confirmación
            if (logoutSuccessful) {
                await innerDc.context.sendActivity('✅ **Sesión cerrada exitosamente**\n\nEscribe `login` para iniciar sesión nuevamente cuando desees usar el bot.');
            } else {
                await innerDc.context.sendActivity('⚠️ **Logout parcial**\n\nSe limpió la sesión local. Si tienes problemas, escribe `login` para autenticarte nuevamente.');
            }
            
            return await innerDc.cancelAllDialogs();
            
        } catch (error) {
            console.error(`LogoutDialog: Error crítico en handleLogout: ${error.message}`);
            await innerDc.context.sendActivity('❌ Ocurrió un error al cerrar sesión. Por favor, intenta nuevamente o contacta al administrador.');
            return null;
        }
    }

    /**
     * Handles help commands
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleHelp(innerDc) {
        try {
            const helpMessage = `
🤖 **Comandos disponibles**:

**Autenticación:**
• \`login\` - Iniciar sesión
• \`logout\` - Cerrar sesión

**Funcionalidades:**
• \`acciones\` - Ver acciones de API disponibles
• \`ayuda\` - Mostrar este mensaje

**Uso general:**
Una vez autenticado, puedes hacer preguntas al asistente de OpenAI o usar las acciones de API para interactuar con los sistemas de la empresa.

❓ **¿Necesitas más ayuda?** Contacta al administrador del sistema.
            `;
            
            await innerDc.context.sendActivity(helpMessage.trim());
            return null; // No interrumpir el diálogo actual
            
        } catch (error) {
            console.error('LogoutDialog: Error en handleHelp:', error.message);
            await innerDc.context.sendActivity('❌ Error al mostrar ayuda. Por favor, intenta nuevamente.');
            return null;
        }
    }

    /**
     * Checks if user is authenticated
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @returns {boolean} - Authentication status
     * @private
     */
    async isUserAuthenticated(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            const bot = innerDc.context.turnState.get('bot');
            
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                return bot.isUserAuthenticated(userId);
            }
            
            // Verificar estado de autenticación directamente
            const userState = innerDc.context.turnState.get('UserState');
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(innerDc.context, {});
                return authData[userId]?.authenticated === true;
            }
            
            return false;
        } catch (error) {
            console.error('LogoutDialog: Error verificando autenticación:', error.message);
            return false;
        }
    }

    /**
     * Gets user authentication info for debugging
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @returns {Object} - Authentication info
     */
    async getAuthenticationInfo(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            const isAuthenticated = await this.isUserAuthenticated(innerDc);
            
            return {
                userId,
                isAuthenticated,
                connectionName: this.connectionName,
                hasUserTokenClient: !!innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey),
                hasBot: !!innerDc.context.turnState.get('bot')
            };
        } catch (error) {
            console.error('LogoutDialog: Error obteniendo información de autenticación:', error.message);
            return {
                error: error.message
            };
        }
    }
}

module.exports.LogoutDialog = LogoutDialog;