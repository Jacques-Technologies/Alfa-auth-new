const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog class - FIX PARA ERRORES DE INSTANCIA
 */
class LogoutDialog extends ComponentDialog {
    constructor(id, connectionName) {
        super(id);
        this.connectionName = connectionName;
        
        if (!connectionName) {
            console.warn('LogoutDialog: connectionName no proporcionado');
        }
        
        this.activeInterruptions = new Set();
    }

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

    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text?.toLowerCase()?.trim() || '';
            const userId = innerDc.context.activity.from.id;
            
            if (this.activeInterruptions.has(userId)) {
                console.warn(`LogoutDialog: Interrupción ya en progreso para usuario ${userId}`);
                return null;
            }
            
            this.activeInterruptions.add(userId);
            
            try {
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
        
        return null;
    }

    async handleLogout(innerDc) {
        const userId = innerDc.context.activity.from.id;
        let logoutSuccessful = false;
        const logoutSteps = [];
        
        try {
            // CORREGIDO: Mejor manejo de instancias
            console.log(`[${userId}] Iniciando proceso de logout`);
            
            // Paso 1: Cerrar sesión OAuth
            try {
                const userTokenClient = innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey);
                
                if (userTokenClient && this.connectionName) {
                    const { activity } = innerDc.context;
                    await userTokenClient.signOutUser(
                        activity.from.id, 
                        this.connectionName, 
                        activity.channelId
                    );
                    logoutSteps.push('✅ Sesión OAuth cerrada');
                    logoutSuccessful = true;
                } else {
                    console.warn('LogoutDialog: userTokenClient o connectionName no disponible');
                    logoutSteps.push('⚠️ OAuth no disponible');
                }
            } catch (oauthError) {
                console.error('LogoutDialog: Error al cerrar sesión OAuth:', oauthError.message);
                logoutSteps.push('❌ Error cerrando OAuth');
            }
            
            // Paso 2: Limpiar estado en el bot - CORREGIDO
            try {
                // Intentar obtener bot desde diferentes lugares
                let bot = innerDc.context.turnState.get('bot');
                if (!bot) {
                    bot = global.botInstance;
                }
                
                if (bot && typeof bot.logoutUser === 'function') {
                    const botLogoutSuccess = bot.logoutUser(userId);
                    if (botLogoutSuccess) {
                        logoutSteps.push('✅ Estado del bot limpiado');
                        logoutSuccessful = true;
                    } else {
                        logoutSteps.push('⚠️ Usuario no estaba en memoria del bot');
                    }
                } else {
                    console.warn('LogoutDialog: No se encontró instancia del bot válida');
                    logoutSteps.push('⚠️ Instancia del bot no disponible');
                }
            } catch (botError) {
                console.error('LogoutDialog: Error al limpiar estado del bot:', botError.message);
                logoutSteps.push('❌ Error limpiando estado del bot');
            }
            
            // Paso 3: Limpiar estado persistente - CORREGIDO
            try {
                // Intentar obtener UserState desde diferentes lugares
                let userState = innerDc.context.turnState.get('UserState');
                if (!userState) {
                    // Intentar desde el bot
                    const bot = innerDc.context.turnState.get('bot') || global.botInstance;
                    if (bot && bot.userState) {
                        userState = bot.userState;
                    }
                }
                
                if (userState) {
                    const authState = userState.createProperty('AuthState');
                    const authData = await authState.get(innerDc.context, {});
                    
                    if (authData[userId]) {
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
            
            // Paso 4: Limpiar diálogos activos
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

    async isUserAuthenticated(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            
            // Verificar en el bot primero
            let bot = innerDc.context.turnState.get('bot');
            if (!bot) {
                bot = global.botInstance;
            }
            
            if (bot && typeof bot.isUserAuthenticated === 'function') {
                const botAuthStatus = bot.isUserAuthenticated(userId);
                if (botAuthStatus) {
                    return true;
                }
            }
            
            // Verificar estado persistente
            let userState = innerDc.context.turnState.get('UserState');
            if (!userState && bot && bot.userState) {
                userState = bot.userState;
            }
            
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(innerDc.context, {});
                const userAuthData = authData[userId];
                
                if (userAuthData && userAuthData.authenticated === true) {
                    if (userAuthData.lastAuthenticated) {
                        const lastAuth = new Date(userAuthData.lastAuthenticated);
                        const now = new Date();
                        const hoursSinceAuth = (now - lastAuth) / (1000 * 60 * 60);
                        
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

    clearActiveInterruptions() {
        const count = this.activeInterruptions.size;
        this.activeInterruptions.clear();
        console.warn(`LogoutDialog: Limpiadas ${count} interrupciones activas`);
        return count;
    }
}

module.exports.LogoutDialog = LogoutDialog;