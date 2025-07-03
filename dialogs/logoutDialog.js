const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog class extends ComponentDialog to handle user logout
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
        
        // Tracking de interrupciones activas para evitar duplicados
        this.activeInterruptions = new Set();
    }

    /**
     * Called when the dialog is started and pushed onto the dialog stack.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @param {Object} options - Optional. Initial information to pass to the dialog.
     */
    async onBeginDialog(innerDc, options) {
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }

            return await super.onBeginDialog(innerDc, options);
        } catch (error) {
            console.error('LogoutDialog: Error en onBeginDialog:', error.message);
            await this.handleDialogError(innerDc, error, 'onBeginDialog');
            return await innerDc.endDialog();
        }
    }

    /**
     * Called when the dialog is continued, where it is the active dialog and the user replies with a new activity.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async onContinueDialog(innerDc) {
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }

            return await super.onContinueDialog(innerDc);
        } catch (error) {
            console.error('LogoutDialog: Error en onContinueDialog:', error.message);
            await this.handleDialogError(innerDc, error, 'onContinueDialog');
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
            const userId = innerDc.context.activity.from.id;
            
            // Evitar interrupciones duplicadas
            if (this.activeInterruptions.has(userId)) {
                console.warn(`LogoutDialog: Interrupción ya en progreso para usuario ${userId}`);
                return null;
            }
            
            this.activeInterruptions.add(userId);
            
            try {
                // Comandos de logout
                const logoutCommands = [
                    'logout', 'cerrar sesion', 'cerrar sesión', 'salir',
                    'desconectar', 'sign out', 'log out', 'exit'
                ];
                
                if (logoutCommands.includes(text)) {
                    return await this.handleLogout(innerDc);
                }
                
            } finally {
                this.activeInterruptions.delete(userId);
            }
        }
        
        return null; // No interrumpir
    }

    /**
     * Handles the logout process with comprehensive cleanup
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleLogout(innerDc) {
        const userId = innerDc.context.activity.from.id;
        let logoutSuccessful = false;
        const logoutSteps = [];
        
        try {
            // Paso 1: Cerrar sesión OAuth
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
                    
                    logoutSteps.push('✅ Sesión OAuth cerrada');
                    logoutSuccessful = true;
                } else {
                    console.warn('LogoutDialog: No se encontró userTokenClient o connectionName');
                    logoutSteps.push('⚠️ OAuth no disponible');
                }
            } catch (oauthError) {
                console.error('LogoutDialog: Error al cerrar sesión OAuth:', oauthError.message);
                logoutSteps.push('❌ Error cerrando OAuth');
            }
            
            // Paso 2: Limpiar estado en el bot
            try {
                const bot = innerDc.context.turnState.get('bot');
                if (bot && typeof bot.logoutUser === 'function') {
                    const botLogoutSuccess = bot.logoutUser(userId);
                    if (botLogoutSuccess) {
                        logoutSteps.push('✅ Estado del bot limpiado');
                        logoutSuccessful = true;
                    } else {
                        logoutSteps.push('⚠️ Usuario no estaba en memoria del bot');
                    }
                } else {
                    console.warn('LogoutDialog: No se encontró instancia del bot');
                    logoutSteps.push('⚠️ Instancia del bot no disponible');
                }
            } catch (botError) {
                console.error('LogoutDialog: Error al limpiar estado del bot:', botError.message);
                logoutSteps.push('❌ Error limpiando estado del bot');
            }
            
            // Paso 3: Limpiar estado de usuario persistente
            try {
                const userState = innerDc.context.turnState.get('UserState');
                if (userState) {
                    const authState = userState.createProperty('AuthState');
                    const authData = await authState.get(innerDc.context, {});
                    
                    if (authData[userId]) {
                        const userData = { ...authData[userId] };
                        delete authData[userId];
                        await authState.set(innerDc.context, authData);
                        await userState.saveChanges(innerDc.context);
                        
                        logoutSteps.push('✅ Estado persistente limpiado');
                        logoutSuccessful = true;
                    } else {
                        logoutSteps.push('⚠️ No había estado persistente');
                    }
                } else {
                    console.warn('LogoutDialog: No se encontró UserState');
                    logoutSteps.push('⚠️ UserState no disponible');
                }
            } catch (stateError) {
                console.error('LogoutDialog: Error al limpiar estado de usuario:', stateError.message);
                logoutSteps.push('❌ Error limpiando estado persistente');
            }
            
            // Paso 4: Limpiar diálogos activos en MainDialog
            try {
                const mainDialog = global.mainDialogInstance;
                if (mainDialog && typeof mainDialog.endUserDialog === 'function') {
                    const hadActiveDialog = mainDialog.endUserDialog(userId);
                    if (hadActiveDialog) {
                        logoutSteps.push('✅ Diálogo de autenticación limpiado');
                    }
                }
            } catch (dialogError) {
                console.error('LogoutDialog: Error limpiando diálogos activos:', dialogError.message);
                logoutSteps.push('❌ Error limpiando diálogos');
            }
            
            // Enviar mensaje de confirmación
            const statusEmoji = logoutSuccessful ? '✅' : '⚠️';
            const statusText = logoutSuccessful ? 'Sesión cerrada exitosamente' : 'Logout parcial completado';
            
            const logoutMessage = `${statusEmoji} **${statusText}**\n\n` +
                `**Pasos ejecutados:**\n${logoutSteps.join('\n')}\n\n` +
                `💡 **Próximos pasos:**\n` +
                `• Escribe \`login\` para iniciar sesión nuevamente\n` +
                `• Escribe \`ayuda\` si necesitas asistencia\n\n` +
                `🔒 Tus datos están seguros y la sesión ha sido cerrada correctamente.`;
            
            await innerDc.context.sendActivity(logoutMessage);
            
            return await innerDc.cancelAllDialogs();
            
        } catch (error) {
            console.error(`LogoutDialog: Error crítico en handleLogout: ${error.message}`);
            
            await innerDc.context.sendActivity(
                '❌ **Error durante el logout**\n\n' +
                'Ocurrió un error al cerrar sesión. Por favor:\n' +
                '• Intenta escribir `logout` nuevamente\n' +
                '• Reinicia la aplicación si el problema persiste\n' +
                '• Contacta al administrador si continúas teniendo problemas'
            );
            return null;
        }
    }

    /**
     * Handles dialog errors with user-friendly messages
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @param {Error} error - The error that occurred
     * @param {string} context - Context where the error occurred
     * @private
     */
    async handleDialogError(innerDc, error, context) {
        console.error(`LogoutDialog: Error en ${context}:`, error.message);
        
        try {
            const errorMessage = `❌ **Error en el sistema**\n\n` +
                `Se produjo un error interno. Si el problema persiste:\n` +
                `• Intenta escribir \`logout\` y luego \`login\`\n` +
                `• Reinicia la aplicación\n` +
                `• Contacta al soporte técnico\n\n` +
                `**Código de error:** ${context}-${Date.now()}`;
            
            await innerDc.context.sendActivity(errorMessage);
        } catch (sendError) {
            console.error('LogoutDialog: Error adicional enviando mensaje de error:', sendError.message);
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
            
            // Verificar en el bot primero
            const bot = innerDc.context.turnState.get('bot');
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                const botAuthStatus = bot.isUserAuthenticated(userId);
                if (botAuthStatus) {
                    return true;
                }
            }
            
            // Verificar estado de autenticación persistente
            const userState = innerDc.context.turnState.get('UserState');
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(innerDc.context, {});
                const userAuthData = authData[userId];
                
                if (userAuthData && userAuthData.authenticated === true) {
                    // Verificar si el token no ha expirado
                    if (userAuthData.lastAuthenticated) {
                        const lastAuth = new Date(userAuthData.lastAuthenticated);
                        const now = new Date();
                        const hoursSinceAuth = (now - lastAuth) / (1000 * 60 * 60);
                        
                        // Si han pasado más de 24 horas, considerar no autenticado
                        if (hoursSinceAuth > 24) {
                            console.warn(`LogoutDialog: Token expirado para usuario ${userId} (${hoursSinceAuth.toFixed(1)} horas)`);
                            return false;
                        }
                    }
                    
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('LogoutDialog: Error verificando autenticación:', error.message);
            return false;
        }
    }

    /**
     * Forces cleanup of active interruptions (maintenance)
     * @returns {number} - Number of interruptions cleared
     */
    clearActiveInterruptions() {
        const count = this.activeInterruptions.size;
        this.activeInterruptions.clear();
        console.warn(`LogoutDialog: Limpiadas ${count} interrupciones activas`);
        return count;
    }
}

module.exports.LogoutDialog = LogoutDialog;