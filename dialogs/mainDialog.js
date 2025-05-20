const { ConfirmPrompt, DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');
const { CardFactory } = require('botbuilder');

const CONFIRM_PROMPT = 'ConfirmPrompt';
const MAIN_DIALOG = 'MainDialog';
const MAIN_WATERFALL_DIALOG = 'MainWaterfallDialog';
const OAUTH_PROMPT = 'OAuthPrompt';

/**
 * MainDialog class that extends LogoutDialog to handle the main dialog flow.
 */
class MainDialog extends LogoutDialog {
    /**
     * Creates an instance of MainDialog.
     */
    constructor() {
        // Obtener el connectionName desde las variables de entorno
        const connectionName = process.env.connectionName || process.env.OAUTH_CONNECTION_NAME;
        
        if (!connectionName) {
            console.error('ERROR: El nombre de conexión OAuth no está configurado');
        }
        
        super(MAIN_DIALOG, connectionName);
        
        console.log(`MainDialog inicializado con connectionName: ${connectionName}`);

        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: connectionName,
            text: 'Este paso es necesario para el módulo de RH',
            title: 'Iniciar sesión',
            timeout: 300000
        }));
        
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));
        
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.finalStep.bind(this)
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
            const bot = stepContext.context.turnState.get('bot');
            
            if (bot) {
                // Obtener información del token
                let userData = {
                    token: tokenResponse.token,
                    context: stepContext.context
                };
                
                // Intentar obtener información de usuario desde el token
                try {
                    // Aquí podría usar el token para obtener datos de MS Graph
                    // Por ahora, usar datos de ejemplo
                    userData.email = 'usuario@dominio.com';
                    userData.name = 'Usuario Autenticado';
                    
                    // Marcar al usuario como autenticado
                    await bot.setUserAuthenticated(
                        stepContext.context.activity.from.id,
                        stepContext.context.activity.conversation.id,
                        userData
                    );
                } catch (error) {
                    console.error(`Error al procesar datos de usuario: ${error.message}`);
                }
            }
            
            await stepContext.context.sendActivity('¡Has iniciado sesión exitosamente! Ahora puedes hacer preguntas y el agente de OpenAI te responderá. ¿En qué puedo ayudarte hoy?');
            
            return await stepContext.next();
        }
        
        await stepContext.context.sendActivity('No se pudo completar la autenticación. Por favor, intenta nuevamente escribiendo "login".');
        return await stepContext.endDialog();
    }

    /**
     * Final step in the waterfall. Ends the dialog.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async finalStep(stepContext) {
        console.log('finalStep ejecutado, finalizando diálogo');
        
        return await stepContext.endDialog();
    }
}

module.exports.MainDialog = MainDialog;