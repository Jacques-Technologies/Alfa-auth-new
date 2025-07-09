// logoutDialog.js - Versión simplificada y confiable

const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog - Manejo simplificado de logout
 */
class LogoutDialog extends ComponentDialog {
    constructor(id, connectionName) {
        super(id);
        this.connectionName = connectionName;
        
        if (!connectionName) {
            console.warn('LogoutDialog: connectionName no proporcionado');
        }
    }

    async onBeginDialog(innerDc, options) {
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }
            return await super.onBeginDialog(innerDc, options);
        } catch (error) {
            console.error('LogoutDialog onBeginDialog error:', error.message);
            return await innerDc.endDialog();
        }
    }

    async onContinueDialog(innerDc) {
        try {
            const result = await this.interrupt(innerDc);
            if (result) {
                return result;
            }
            return await super.onContinueDialog(innerDc);
        } catch (error) {
            console.error('LogoutDialog onContinueDialog error:', error.message);
            return await innerDc.endDialog();
        }
    }

    /**
     * Maneja interrupciones para comandos de logout
     */
    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text?.toLowerCase()?.trim() || '';
            
            const logoutCommands = [
                'logout', 'cerrar sesion', 'cerrar sesión', 'salir',
                'desconectar', 'sign out', 'log out', 'exit'
            ];
            
            if (logoutCommands.includes(text)) {
                return await this.handleLogout(innerDc);
            }
        }
        
        return null;
    }

    /**
     * Maneja el proceso de logout simplificado
     */
    async handleLogout(innerDc) {
        const userId = innerDc.context.activity.from.id;
        
        try {
            console.log(`[${userId}] Iniciando logout`);
            
            const logoutSteps = [];
            
            // 1. Cerrar sesión OAuth
            try {
                const userTokenClient = innerDc.context.turnState.get(
                    innerDc.context.adapter.UserTokenClientKey
                );
                
                if (userTokenClient && this.connectionName) {
                    await userTokenClient.signOutUser(
                        userId,
                        this.connectionName,
                        innerDc.context.activity.channelId
                    );
                    logoutSteps.push('Sesión OAuth cerrada');
                }
            } catch (oauthError) {
                console.error('Error cerrando sesión OAuth:', oauthError.message);
                logoutSteps.push('Error en OAuth (continuando)');
            }
            
            // 2. Limpiar estado en el bot
            try {
                const bot = innerDc.context.turnState.get('bot') || global.botInstance;
                
                if (bot && typeof bot.forceCleanUserState === 'function') {
                    const cleanupSuccess = await bot.forceCleanUserState(userId, innerDc.context);
                    logoutSteps.push(cleanupSuccess ? 'Bot limpiado' : 'Error limpiando bot');
                } else if (bot && bot.authenticatedUsers) {
                    bot.authenticatedUsers.delete(userId);
                    logoutSteps.push('Usuario removido de memoria');
                }
            } catch (botError) {
                console.error('Error limpiando bot:', botError.message);
                logoutSteps.push('Error limpiando bot');
            }
            
            // 3. Limpiar estado persistente
            try {
                const userState = innerDc.context.turnState.get('UserState');
                if (userState) {
                    const authState = userState.createProperty('AuthState');
                    const authData = await authState.get(innerDc.context, {});
                    
                    if (authData[userId]) {
                        delete authData[userId];
                        await authState.set(innerDc.context, authData);
                        await userState.saveChanges(innerDc.context);
                        logoutSteps.push('Estado persistente limpiado');
                    }
                }
            } catch (stateError) {
                console.error('Error limpiando estado:', stateError.message);
                logoutSteps.push('Error limpiando estado');
            }
            
            // 4. Limpiar MainDialog
            try {
                const mainDialog = global.mainDialogInstance;
                if (mainDialog && typeof mainDialog.endUserDialog === 'function') {
                    mainDialog.endUserDialog(userId);
                    logoutSteps.push('Diálogo principal limpiado');
                }
            } catch (dialogError) {
                console.error('Error limpiando MainDialog:', dialogError.message);
                logoutSteps.push('Error limpiando diálogo');
            }
            
            // Enviar confirmación
            const successMessage = logoutSteps.length > 0 ?
                '✅ **Sesión cerrada exitosamente**\n\nEscribe `login` cuando quieras volver a autenticarte.' :
                '✅ **Logout completado**';
                
            await innerDc.context.sendActivity(successMessage);
            
            console.log(`[${userId}] Logout completado: ${logoutSteps.join(', ')}`);
            
            return await innerDc.cancelAllDialogs();
            
        } catch (error) {
            console.error(`[${userId}] Error crítico en logout:`, error.message);
            
            await innerDc.context.sendActivity(
                '❌ **Error durante logout**\n\n' +
                'Hubo un problema cerrando la sesión. Intenta:\n' +
                '• Escribir `logout` nuevamente\n' +
                '• Reiniciar la aplicación si persiste el problema'
            );
            
            return await innerDc.endDialog();
        }
    }
}

module.exports.LogoutDialog = LogoutDialog;