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
            text: 'Este paso es necesario para autenticarte',
            title: 'Iniciar Sesión',
            timeout: 300000
        }));
        
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));
        
        // Simplificar el flujo a solo dos pasos: prompt y login
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
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
        
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(context);
        const results = await dialogContext.continueDialog();
        
        if (results.status === DialogTurnStatus.empty) {
            console.log('DialogContext vacío, iniciando MainDialog');
            await dialogContext.beginDialog(this.id);
        } else {
            console.log(`Continuando diálogo existente, estado: ${results.status}`);
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
            console.log('No se encontró el bot en el contexto del turno. Verificando si está disponible globalmente...');
            
            // Intentar usar una referencia global si está disponible
            if (global.botInstance) {
                console.log('Usando instancia global del bot');
                context.turnState.set('bot', global.botInstance);
            } else {
                console.log('No se pudo encontrar una instancia del bot. Esto puede causar problemas con la autenticación.');
            }
        } else {
            console.log('Bot encontrado correctamente en el contexto');
        }
    }

    /**
     * Prompts the user to sign in.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        console.log('Iniciando promptStep para autenticación OAuth');
        return await stepContext.beginDialog(OAUTH_PROMPT);
    }

    /**
     * Handles the login step.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        console.log('loginStep ejecutado, respuesta: ', stepContext.result ? 'token obtenido' : 'sin token');
        const tokenResponse = stepContext.result;
        
        if (tokenResponse) {
            // Intentar obtener el bot del contexto
            const bot = stepContext.context.turnState.get('bot');
            
            if (bot) {
                // Registrar al usuario como autenticado
                let userData = {
                    token: tokenResponse.token,
                    context: stepContext.context,
                    email: 'usuario@empresa.com',
                    name: 'Usuario Autenticado'
                };
                
                try {
                    // Marcar al usuario como autenticado en el bot
                    await bot.setUserAuthenticated(
                        stepContext.context.activity.from.id,
                        stepContext.context.activity.conversation.id,
                        userData
                    );
                    
                    // Mensaje de bienvenida al usuario
                    await stepContext.context.sendActivity('¡Has iniciado sesión exitosamente! Ahora puedes hacer preguntas y el agente de OpenAI te responderá. ¿En qué puedo ayudarte hoy?');
                } catch (error) {
                    console.error(`Error al procesar autenticación: ${error.message}`);
                    console.error(error.stack);
                    await stepContext.context.sendActivity('Ocurrió un error durante la autenticación. Por favor, intenta nuevamente.');
                }
            } else {
                console.error('No se encontró la instancia del bot en el contexto');
                
                // Aunque no tengamos el bot, podemos intentar marcar al usuario como autenticado en el estado
                try {
                    // Intentar guardar el estado de autenticación directamente
                    const userState = stepContext.context.turnState.get('UserState');
                    if (userState) {
                        const authState = userState.createProperty('AuthState');
                        const authData = await authState.get(stepContext.context, {});
                        const userId = stepContext.context.activity.from.id;
                        
                        authData[userId] = {
                            authenticated: true,
                            email: 'usuario@empresa.com',
                            name: 'Usuario Autenticado',
                            lastAuthenticated: new Date().toISOString()
                        };
                        
                        await authState.set(stepContext.context, authData);
                        await userState.saveChanges(stepContext.context);
                        
                        await stepContext.context.sendActivity('¡Has iniciado sesión exitosamente! Ahora puedes hacer preguntas y el agente de OpenAI te responderá. ¿En qué puedo ayudarte hoy?');
                    } else {
                        await stepContext.context.sendActivity('Ocurrió un error en la configuración. Por favor, contacta al administrador.');
                    }
                } catch (err) {
                    console.error(`Error al guardar estado de autenticación: ${err.message}`);
                    await stepContext.context.sendActivity('Ocurrió un error en la configuración. Por favor, contacta al administrador.');
                }
            }
            
            return await stepContext.endDialog();
        }
        
        await stepContext.context.sendActivity('No se pudo completar la autenticación. Por favor, intenta escribiendo "login" nuevamente.');
        return await stepContext.endDialog();
    }
}

module.exports.MainDialog = MainDialog;