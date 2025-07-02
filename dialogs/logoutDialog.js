const { ActivityTypes } = require('botbuilder');
const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog class extends ComponentDialog to handle user logout with comprehensive functionality
 * and enhanced error handling for the vacation management system.
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
        
        // Estadísticas de logout para monitoreo
        this.logoutStats = {
            totalLogouts: 0,
            successfulLogouts: 0,
            failedLogouts: 0,
            lastLogout: null,
            activeInterruptions: new Set()
        };
        
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
            await this.handleDialogError(innerDc, error, 'onBeginDialog');
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
            await this.handleDialogError(innerDc, error, 'onContinueDialog');
            return await innerDc.endDialog();
        }
    }

    /**
     * Interrupts the dialog to handle logout and other commands with enhanced command processing.
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     */
    async interrupt(innerDc) {
        if (innerDc.context.activity.type === ActivityTypes.Message) {
            const text = innerDc.context.activity.text?.toLowerCase()?.trim() || '';
            const userId = innerDc.context.activity.from.id;
            
            // Evitar interrupciones duplicadas
            const interruptionKey = `${userId}-${Date.now()}`;
            if (this.logoutStats.activeInterruptions.has(userId)) {
                console.log(`LogoutDialog: Interrupción ya en progreso para usuario ${userId}`);
                return null;
            }
            
            this.logoutStats.activeInterruptions.add(userId);
            
            try {
                // Comandos de logout con variaciones más amplias
                const logoutCommands = [
                    'logout', 'cerrar sesion', 'cerrar sesión', 'salir',
                    'desconectar', 'sign out', 'log out', 'exit'
                ];
                
                if (logoutCommands.includes(text)) {
                    console.log(`LogoutDialog: Comando de logout detectado: "${text}"`);
                    return await this.handleLogout(innerDc);
                }
                
                // Comandos de ayuda con variaciones
                const helpCommands = [
                    'ayuda', 'help', 'comandos', 'commands', 
                    '?', 'que puedo hacer', 'opciones', 'menu'
                ];
                if (helpCommands.includes(text)) {
                    console.log(`LogoutDialog: Comando de ayuda detectado: "${text}"`);
                    return await this.handleHelp(innerDc);
                }
                
                // Comandos de estado de autenticación
                const statusCommands = ['estado', 'status', 'whoami', 'quien soy'];
                if (statusCommands.includes(text)) {
                    console.log(`LogoutDialog: Comando de estado detectado: "${text}"`);
                    return await this.handleAuthStatus(innerDc);
                }
                
                // Comandos de información del bot
                const infoCommands = ['info', 'version', 'acerca de', 'about'];
                if (infoCommands.includes(text)) {
                    console.log(`LogoutDialog: Comando de información detectado: "${text}"`);
                    return await this.handleBotInfo(innerDc);
                }
                
            } finally {
                this.logoutStats.activeInterruptions.delete(userId);
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
        console.log(`LogoutDialog: Procesando logout para usuario ${userId}`);
        
        this.logoutStats.totalLogouts++;
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
                    
                    console.log('LogoutDialog: Sesión OAuth cerrada exitosamente');
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
                        console.log('LogoutDialog: Estado del bot limpiado exitosamente');
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
                        
                        console.log('LogoutDialog: Estado de usuario limpiado exitosamente');
                        logoutSteps.push('✅ Estado persistente limpiado');
                        logoutSuccessful = true;
                        
                        // Log de información del usuario que cerró sesión
                        console.log(`LogoutDialog: Usuario desconectado - Email: ${userData.email || 'N/A'}, Nombre: ${userData.name || 'N/A'}`);
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
                const mainDialog = global.mainDialogInstance; // Si se registra globalmente
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
            
            // Actualizar estadísticas
            if (logoutSuccessful) {
                this.logoutStats.successfulLogouts++;
            } else {
                this.logoutStats.failedLogouts++;
            }
            this.logoutStats.lastLogout = new Date().toISOString();
            
            // Enviar mensaje de confirmación detallado
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
            this.logoutStats.failedLogouts++;
            
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
     * Handles help commands with comprehensive information
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleHelp(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            const isAuthenticated = await this.isUserAuthenticated(innerDc);
            
            const helpMessage = `
🤖 **Alfa Bot - Centro de Ayuda**

**🔐 Comandos de Autenticación:**
• \`login\` - Iniciar sesión con OAuth
• \`logout\` - Cerrar sesión completamente
• \`estado\` - Ver estado de autenticación actual

**⚠️ Problemas de Autenticación:**
• Si cerraste la ventana de login por error, escribe \`login\` nuevamente
• Si el proceso se quedó colgado, escribe \`logout\` y luego \`login\`
• Si ves errores de timeout, verifica tu conexión e intenta de nuevo

**💡 Sistema Inteligente de Vacaciones:**
${isAuthenticated ? 
    '• "quiero solicitar vacaciones" - Proceso guiado\n' +
    '• "ver mis vacaciones" - Consultar solicitudes\n' +
    '• "información sobre vacaciones" - Tipos disponibles\n' +
    '• "permiso por matrimonio" - Solicitud especial\n' +
    '• "días por nacimiento" - Solicitud especial'
    : 
    '• Inicia sesión primero para acceder a las funciones de vacaciones'
}

**👤 Información Personal:**
${isAuthenticated ? 
    '• "mi información" - Datos de empleado\n' +
    '• "mis recibos" - Períodos de pago\n' +
    '• "buscar empleado [nombre]" - Directorio'
    : 
    '• Disponible después de iniciar sesión'
}

**📚 Otros Servicios:**
• "buscar en documentos sobre [tema]" - Búsqueda en base de conocimientos
• "menú del comedor" - Comida del día
• \`ayuda\` - Mostrar este mensaje
• \`info\` - Información del bot

**🆘 Solución de Problemas:**
• **Error "Autenticación cancelada"**: Completaste el proceso sin cerrar ventanas
• **Error "Tiempo agotado"**: Tienes 5 minutos para completar la autenticación
• **Proceso colgado**: Escribe \`logout\` para limpiar y luego \`login\` para intentar de nuevo
• **Ventana cerrada**: Escribe \`login\` nuevamente y completa todo el proceso

**Estado Actual:** ${isAuthenticated ? '🟢 Autenticado' : '🔴 No autenticado'}
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
     * Handles authentication status commands
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleAuthStatus(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            const isAuthenticated = await this.isUserAuthenticated(innerDc);
            const authInfo = await this.getAuthenticationInfo(innerDc);
            
            let statusMessage = `🔍 **Estado de Autenticación**\n\n`;
            statusMessage += `**Usuario ID:** ${userId}\n`;
            statusMessage += `**Estado:** ${isAuthenticated ? '🟢 Autenticado' : '🔴 No autenticado'}\n`;
            
            if (isAuthenticated) {
                // Obtener información adicional si está disponible
                const bot = innerDc.context.turnState.get('bot');
                if (bot && bot.authenticatedUsers && bot.authenticatedUsers.has(userId)) {
                    const userInfo = bot.authenticatedUsers.get(userId);
                    statusMessage += `**Nombre:** ${userInfo.name || 'N/A'}\n`;
                    statusMessage += `**Email:** ${userInfo.email || 'N/A'}\n`;
                }
                
                statusMessage += `**Conexión OAuth:** ${this.connectionName || 'N/A'}\n`;
                statusMessage += `**Token válido:** ${authInfo.hasUserTokenClient ? '✅' : '❌'}\n`;
                
                statusMessage += `\n💡 **Funciones disponibles:**\n`;
                statusMessage += `• Gestión de vacaciones\n`;
                statusMessage += `• Consulta de información personal\n`;
                statusMessage += `• Acceso a recibos de pago\n`;
                statusMessage += `• Búsqueda en documentos\n`;
            } else {
                statusMessage += `\n🔒 **Para acceder a las funciones:**\n`;
                statusMessage += `• Escribe \`login\` para autenticarte\n`;
                statusMessage += `• Una vez autenticado, tendrás acceso completo\n`;
                
                // NUEVO: Verificar si hay procesos de autenticación activos
                const bot = innerDc.context.turnState.get('bot');
                if (bot && typeof bot.getActiveStatesInfo === 'function') {
                    const activeStates = bot.getActiveStatesInfo();
                    const hasActiveAuth = activeStates.activeDialogs.includes(`auth-${userId}`) || 
                                         activeStates.activeProcesses.includes(userId);
                    
                    if (hasActiveAuth) {
                        statusMessage += `\n⚠️ **Proceso de autenticación activo detectado**\n`;
                        statusMessage += `• Tienes un proceso de login en curso\n`;
                        statusMessage += `• Completa la autenticación en la ventana abierta\n`;
                        statusMessage += `• Si no ves la ventana, escribe \`logout\` y luego \`login\`\n`;
                        
                        // Información de timeout si está disponible
                        const timeoutInfo = activeStates.authTimeouts?.find(t => t.userId === userId);
                        if (timeoutInfo) {
                            const remainingMinutes = Math.ceil(timeoutInfo.remaining / 60);
                            statusMessage += `• Tiempo restante: ${remainingMinutes} minuto${remainingMinutes !== 1 ? 's' : ''}\n`;
                        }
                    }
                }
            }
            
            statusMessage += `\n📊 **Estadísticas de sesión:**\n`;
            statusMessage += `• Conexión OAuth: ${this.connectionName}\n`;
            statusMessage += `• Logouts totales: ${this.logoutStats.totalLogouts}\n`;
            statusMessage += `• Último logout: ${this.logoutStats.lastLogout || 'N/A'}\n`;
            
            // NUEVO: Añadir información de solución de problemas
            statusMessage += `\n🔧 **Solución de Problemas:**\n`;
            statusMessage += `• **Proceso colgado:** \`logout\` + \`login\`\n`;
            statusMessage += `• **Ventana cerrada:** Vuelve a escribir \`login\`\n`;
            statusMessage += `• **Timeout:** Completa la autenticación en 5 minutos\n`;
            
            await innerDc.context.sendActivity(statusMessage);
            return null;
            
        } catch (error) {
            console.error('LogoutDialog: Error en handleAuthStatus:', error.message);
            await innerDc.context.sendActivity('❌ Error al obtener estado de autenticación.');
            return null;
        }
    }

    /**
     * Handles bot information commands
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @private
     */
    async handleBotInfo(innerDc) {
        try {
            const botInfo = `
🤖 **Alfa Bot - Información del Sistema**

**📋 Descripción:**
Asistente inteligente para empleados de Alfa Corporation con integración de OpenAI y gestión avanzada de vacaciones.

**🔧 Funcionalidades Principales:**
• Sistema de autenticación OAuth seguro
• Gestión inteligente de solicitudes de vacaciones
• Consulta de información de empleados
• Acceso a recibos de nómina
• Búsqueda vectorial en documentos corporativos
• Integración con ServiceNow para incidentes
• Directorio de empleados
• Menú del comedor corporativo

**⚙️ Tecnologías:**
• Microsoft Bot Framework
• OpenAI GPT-4 Turbo
• Azure Cognitive Search
• CosmosDB para persistencia
• OAuth 2.0 para autenticación

**🔗 Canales Soportados:**
• Microsoft Teams
• Web Chat
• Bot Framework Emulator

**📊 Estado del Sistema:**
• Conexión OAuth: ${this.connectionName}
• Autenticaciones totales: ${this.logoutStats.totalLogouts}
• Última actividad: ${new Date().toISOString()}

**🆔 Versión:** 2.0.0 - Sistema Estricto de Vacaciones
**👨‍💻 Desarrollado para:** Alfa Corporation
**📅 Última actualización:** ${new Date().toLocaleDateString('es-MX')}

💡 **¿Necesitas ayuda?** Escribe \`ayuda\` para ver todos los comandos disponibles.
            `;
            
            await innerDc.context.sendActivity(botInfo.trim());
            return null;
            
        } catch (error) {
            console.error('LogoutDialog: Error en handleBotInfo:', error.message);
            await innerDc.context.sendActivity('❌ Error al obtener información del bot.');
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
     * Checks if user is authenticated with enhanced verification
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
                    // Verificar si el token no ha expirado (opcional)
                    if (userAuthData.lastAuthenticated) {
                        const lastAuth = new Date(userAuthData.lastAuthenticated);
                        const now = new Date();
                        const hoursSinceAuth = (now - lastAuth) / (1000 * 60 * 60);
                        
                        // Si han pasado más de 24 horas, considerar no autenticado
                        if (hoursSinceAuth > 24) {
                            console.log(`LogoutDialog: Token expirado para usuario ${userId} (${hoursSinceAuth.toFixed(1)} horas)`);
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
     * Gets comprehensive user authentication info for debugging
     * @param {DialogContext} innerDc - The dialog context for the current turn of conversation.
     * @returns {Object} - Authentication info
     */
    async getAuthenticationInfo(innerDc) {
        try {
            const userId = innerDc.context.activity.from.id;
            const isAuthenticated = await this.isUserAuthenticated(innerDc);
            
            const info = {
                userId,
                isAuthenticated,
                connectionName: this.connectionName,
                hasUserTokenClient: !!innerDc.context.turnState.get(innerDc.context.adapter.UserTokenClientKey),
                hasBot: !!innerDc.context.turnState.get('bot'),
                hasUserState: !!innerDc.context.turnState.get('UserState'),
                timestamp: new Date().toISOString()
            };
            
            // Información adicional del bot si está disponible
            const bot = innerDc.context.turnState.get('bot');
            if (bot) {
                info.botInfo = {
                    hasAuthenticatedUsers: !!(bot.authenticatedUsers),
                    userInMemory: bot.authenticatedUsers ? bot.authenticatedUsers.has(userId) : false,
                    totalAuthenticatedUsers: bot.authenticatedUsers ? bot.authenticatedUsers.size : 0
                };
            }
            
            // Información del estado persistente
            try {
                const userState = innerDc.context.turnState.get('UserState');
                if (userState) {
                    const authState = userState.createProperty('AuthState');
                    const authData = await authState.get(innerDc.context, {});
                    const userAuthData = authData[userId];
                    
                    info.persistentState = {
                        hasAuthData: !!userAuthData,
                        lastAuthenticated: userAuthData?.lastAuthenticated,
                        email: userAuthData?.email,
                        name: userAuthData?.name
                    };
                }
            } catch (stateError) {
                info.persistentStateError = stateError.message;
            }
            
            return info;
        } catch (error) {
            console.error('LogoutDialog: Error obteniendo información de autenticación:', error.message);
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Gets logout statistics for monitoring
     * @returns {Object} - Logout statistics
     */
    getLogoutStats() {
        return {
            ...this.logoutStats,
            activeInterruptions: Array.from(this.logoutStats.activeInterruptions),
            connectionName: this.connectionName,
            dialogId: this.id
        };
    }

    /**
     * Resets logout statistics
     */
    resetLogoutStats() {
        this.logoutStats = {
            totalLogouts: 0,
            successfulLogouts: 0,
            failedLogouts: 0,
            lastLogout: null,
            activeInterruptions: new Set()
        };
        
        console.log('LogoutDialog: Estadísticas de logout reiniciadas');
    }

    /**
     * Forces cleanup of active interruptions (maintenance)
     * @returns {number} - Number of interruptions cleared
     */
    clearActiveInterruptions() {
        const count = this.logoutStats.activeInterruptions.size;
        this.logoutStats.activeInterruptions.clear();
        console.log(`LogoutDialog: Limpiadas ${count} interrupciones activas`);
        return count;
    }
}

module.exports.LogoutDialog = LogoutDialog;