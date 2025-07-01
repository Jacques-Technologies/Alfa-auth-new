const { ConfirmPrompt, DialogSet, DialogTurnStatus, OAuthPrompt, WaterfallDialog } = require('botbuilder-dialogs');
const { LogoutDialog } = require('./logoutDialog');

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
     * @param {string} id - The dialog ID.
     * @param {string} connectionName - The connection name for the OAuth provider.
     */
    constructor() {
        super(MAIN_DIALOG, process.env.connectionName);

        this.addDialog(new OAuthPrompt(OAUTH_PROMPT, {
            connectionName: process.env.connectionName,
            text: 'Este paso es necesario para el módulo de RH',
            title: 'Iniciar sesión',
            timeout: 300000
        }));
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.promptStep.bind(this),
            this.loginStep.bind(this),
            this.displayTokenPhase1.bind(this)
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
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(context);
        const results = await dialogContext.continueDialog();
        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    /**
     * Prompts the user to sign in.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async promptStep(stepContext) {
        return await stepContext.beginDialog(OAUTH_PROMPT);
    }

    /**
     * Handles the login step.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async loginStep(stepContext) {
        const tokenResponse = stepContext.result;
        if (tokenResponse && tokenResponse.token) {
            // Obtener información del usuario del token si es posible
            const userId = stepContext.context.activity.from.id;
            const conversationId = stepContext.context.activity.conversation.id;
            
            // Intentar obtener información del usuario desde el token
            let userName = 'Usuario';
            try {
                // Decodificar el token JWT para obtener información básica
                const tokenParts = tokenResponse.token.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                    userName = payload.name || payload.preferred_username || 'Usuario';
                }
            } catch (error) {
                console.log('No se pudo extraer información del token:', error.message);
            }

            // Marcar usuario como autenticado en el bot
            const bot = stepContext.context.turnState.get('bot');
            if (bot && typeof bot.setUserAuthenticated === 'function') {
                const authSuccess = await bot.setUserAuthenticated(userId, conversationId, {
                    email: userName,
                    name: userName,
                    token: tokenResponse.token,
                    context: stepContext.context
                });
                
                if (authSuccess) {
                    console.log(`Usuario ${userId} autenticado exitosamente en MainDialog`);
                }
            }

            await stepContext.context.sendActivity('✅ **¡Autenticación exitosa!**\n\nBienvenido a Alfa. Ya puedes usar todas las funciones del asistente.');
            return await stepContext.prompt(CONFIRM_PROMPT, '¿Quieres ver tu token de acceso?');
        }
        
        await stepContext.context.sendActivity('❌ **Error de autenticación**\n\nNo se pudo completar el inicio de sesión. Por favor, intenta nuevamente escribiendo `login`.');
        return await stepContext.endDialog();
    }

    /**
     * Displays the token if the user confirms.
     * @param {WaterfallStepContext} stepContext - The waterfall step context.
     */
    async displayTokenPhase1(stepContext) {
        const result = stepContext.result;
        
        if (result) {
            // El usuario quiere ver el token
            // Obtener el token del bot o del estado
            const userId = stepContext.context.activity.from.id;
            const bot = stepContext.context.turnState.get('bot');
            
            let token = null;
            
            // Intentar obtener el token del bot
            if (bot && typeof bot._getUserOAuthToken === 'function') {
                try {
                    token = await bot._getUserOAuthToken(stepContext.context, userId);
                } catch (error) {
                    console.error('Error obteniendo token del bot:', error.message);
                }
            }
            
            // Si no se pudo obtener del bot, intentar obtener del UserTokenClient
            if (!token) {
                try {
                    const userTokenClient = stepContext.context.turnState.get(stepContext.context.adapter.UserTokenClientKey);
                    const connectionName = process.env.connectionName;
                    
                    if (userTokenClient && connectionName) {
                        const tokenResponse = await userTokenClient.getUserToken(
                            userId,
                            connectionName,
                            stepContext.context.activity.channelId
                        );
                        
                        if (tokenResponse && tokenResponse.token) {
                            token = tokenResponse.token;
                        }
                    }
                } catch (error) {
                    console.error('Error obteniendo token del UserTokenClient:', error.message);
                }
            }
            
            if (token) {
                // Mostrar solo una parte del token por seguridad
                const tokenPreview = token.substring(0, 50) + '...' + token.substring(token.length - 20);
                await stepContext.context.sendActivity(`🔐 **Tu token de acceso**:\n\n\`${tokenPreview}\`\n\n⚠️ *Por seguridad, solo se muestra una vista previa del token.*`);
            } else {
                await stepContext.context.sendActivity('❌ No se pudo obtener el token de acceso.');
            }
        } else {
            await stepContext.context.sendActivity('👍 **Perfecto**\n\n¡Ya estás listo para usar el asistente! Puedes preguntarme sobre vacaciones, consultar tu información, buscar documentos y mucho más.');
        }
        
        return await stepContext.endDialog();
    }
}

module.exports.MainDialog = MainDialog;