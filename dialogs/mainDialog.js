const { ConfirmPrompt, DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');
const { CardFactory } = require('botbuilder');

const CONFIRM_PROMPT = 'ConfirmPrompt';
const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class extends LogoutDialog to handle the main dialog flow.
 */
class MainDialog extends LogoutDialog {
    /**
     * Creates an instance of MainDialog.
     */
    constructor() {
        // Obtener connectionName desde las variables de entorno
        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        
        if (!connectionName) {
            console.error('ERROR: El nombre de conexión OAuth no está configurado');
        }
        
        super(MAIN_DIALOG, connectionName);
        console.log(`MainDialog inicializado con connectionName: ${connectionName}`);

        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            text: 'Por favor, inicia sesión para continuar',
            title: 'Iniciar Sesión',
            timeout: 300000,
            endOnInvalidMessage: true
        }));
        
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));
        
        // Simplificar el flujo a solo dos pasos: prompt y login
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
        
        // Conjunto para rastrear usuarios que ya completaron el diálogo
        this.completedUsers = new Set();
    }

    /**
     * The run method handles the incoming activity (in the form of a DialogContext) and passes it through the dialog system.
     * If no dialog is active, it will start the default dialog.
     * @param {TurnContext} context - The context object for the turn.
     * @param {StatePropertyAccessor} accessor - The state property accessor for the dialog state.
     */
    async run(context, accessor) {
        console.log('MainDialog.run() llamado');
        
        // Asegurarse de que el bot esté disponible en el contexto
        this._ensureBotInContext(context);
        
        // Verificar si el usuario ya está autenticado
        const userId = context.activity.from.id;
        const bot = context.turnState.get('bot');
        
        // Verificar estado de autenticación
        let isAuthenticated = false;
        try {
            const authData = await bot?.authState?.get(context, {});
            isAuthenticated = authData && authData[userId]?.authenticated === true;
        } catch (error) {
            console.warn('Error verificando estado de autenticación:', error.message);
        }
        
        // Si el usuario ya está autenticado, no iniciar el diálogo
        if (isAuthenticated) {
            console.log(`Usuario ${userId} ya está autenticado, no iniciando diálogo de autenticación`);
            return;
        }
        
        // Verificar si este usuario ya completó el diálogo recientemente
        if (this.completedUsers.has(userId)) {
            console.log(`Usuario ${userId} ya completó el diálogo recientemente`);
            return;
        }
        
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(context);
        const results = await dialogContext.continueDialog();
        
        if (results.status === DialogTurnStatus.empty) {
            console.log('DialogContext vacío, iniciando MainDialog');
            await dialogContext.beginDialog(this.id);
        } else {
            console.log(`Estado del diálogo: ${results.status}`);
            
            // Si el diálogo está completo, marcar al usuario como completado
            if (results.status === DialogTurnStatus.complete) {
                this.completedUsers.add(userId);
                console.log(`Usuario ${userId} completó el diálogo de autenticación`);
            }
        }
    }

    /**
     * Asegura que la instancia del bot esté disponible en el contexto
     * @param {TurnContext} context - El contexto del turno actual
     * @private
     */
    _ensureBotInContext(context) {
        // Verificar si el bot ya está en el contexto
        const bot = context.turnState.get('bot');
        if (!bot) {
            console.log('Bot no encontrado en el contexto. Verificando instancia global...');
            
            // Intentar usar una referencia global si está disponible
            if (global.botInstance) {
                console.log('Usando instancia global del bot');
                context.turnState.set('bot', global.botInstance);
            } else {
                console.warn('No se pudo encontrar una instancia del bot. Esto puede causar problemas con la autenticación.');
            }
        }
    }

    /**
     * Prompts the user to sign in.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        console.log('Iniciando promptStep para autenticación OAuth');
        
        try {
            return await stepContext.beginDialog(OAUTH_PROMPT);
        } catch (error) {
            console.error('Error en promptStep:', error);
            await stepContext.context.sendActivity('❌ Error al iniciar el proceso de autenticación. Por favor, intenta de nuevo.');
            return await stepContext.endDialog();
        }
    }

    /**
     * Handles the login step.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        console.log('loginStep ejecutado');
        const tokenResponse = stepContext.result;
        const userId = stepContext.context.activity.from.id;
        
        if (!tokenResponse || !tokenResponse.token) {
            console.log('No se recibió token de autenticación');
            await stepContext.context.sendActivity('❌ No se pudo completar la autenticación. Por favor, intenta escribiendo `login` nuevamente.');
            return await stepContext.endDialog();
        }
        
        console.log('Token de autenticación recibido exitosamente');
        
        try {
            // Intentar obtener el bot del contexto
            const bot = stepContext.context.turnState.get('bot');
            
            if (bot && typeof bot.setUserAuthenticated === 'function') {
                // Preparar datos de usuario
                const userData = {
                    token: tokenResponse.token,
                    context: stepContext.context,
                    email: 'usuario@empresa.com', // Esto se puede mejorar obteniendo info del token
                    name: 'Usuario Autenticado'
                };
                
                // Marcar al usuario como autenticado en el bot
                const success = await bot.setUserAuthenticated(
                    userId,
                    stepContext.context.activity.conversation.id,
                    userData
                );
                
                if (success) {
                    // Marcar este usuario como completado
                    this.completedUsers.add(userId);
                    
                    // Mensaje de bienvenida personalizado
                    const welcomeMessage = `
✅ **¡Autenticación exitosa!**

🎉 ¡Bienvenido! Ya puedes usar todas las funciones del bot:

💬 **Asistente de OpenAI**: Haz cualquier pregunta y te ayudaré
🔧 **Acciones de API**: Escribe \`acciones\` para ver las operaciones disponibles
📚 **Ayuda**: Escribe \`ayuda\` para ver todos los comandos

¿En qué puedo ayudarte hoy?`;
                    
                    await stepContext.context.sendActivity(welcomeMessage.trim());
                } else {
                    await stepContext.context.sendActivity('❌ Error al procesar la autenticación. Por favor, intenta nuevamente.');
                }
            } else {
                console.error('No se encontró la instancia del bot o el método setUserAuthenticated');
                
                // Intentar guardar el estado de autenticación directamente
                await this._saveAuthenticationState(stepContext, userId, tokenResponse.token);
                
                // Marcar como completado
                this.completedUsers.add(userId);
                
                await stepContext.context.sendActivity('✅ ¡Autenticación exitosa! Ya puedes usar el asistente de OpenAI. ¿En qué puedo ayudarte?');
            }
            
        } catch (error) {
            console.error(`Error al procesar autenticación: ${error.message}`);
            console.error(error.stack);
            await stepContext.context.sendActivity('❌ Ocurrió un error durante la autenticación. Por favor, intenta nuevamente escribiendo `login`.');
        }
        
        return await stepContext.endDialog();
    }

    /**
     * Guarda el estado de autenticación directamente en el UserState
     * @param {WaterfallStepContext} stepContext - Contexto del paso
     * @param {string} userId - ID del usuario
     * @param {string} token - Token de autenticación
     * @private
     */
    async _saveAuthenticationState(stepContext, userId, token) {
        try {
            const userState = stepContext.context.turnState.get('UserState');
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(stepContext.context, {});
                
                authData[userId] = {
                    authenticated: true,
                    email: 'usuario@empresa.com',
                    name: 'Usuario Autenticado',
                    token: token,
                    lastAuthenticated: new Date().toISOString()
                };
                
                await authState.set(stepContext.context, authData);
                await userState.saveChanges(stepContext.context);
                
                console.log(`Estado de autenticación guardado para usuario ${userId}`);
            } else {
                console.error('UserState no encontrado en el contexto');
            }
        } catch (error) {
            console.error(`Error al guardar estado de autenticación: ${error.message}`);
            throw error;
        }
    }

    /**
     * Limpia el estado de usuarios completados (puede ser llamado periódicamente)
     */
    clearCompletedUsers() {
        this.completedUsers.clear();
        console.log('Lista de usuarios completados limpiada');
    }

    /**
     * Verifica si un usuario ya completó el diálogo
     * @param {string} userId - ID del usuario
     * @returns {boolean}
     */
    hasUserCompleted(userId) {
        return this.completedUsers.has(userId);
    }
}

module.exports.MainDialog = MainDialog;