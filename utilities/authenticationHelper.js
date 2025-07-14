// authenticationHelper.js - Helper para autenticación bajo demanda

const { CardFactory } = require('botbuilder');

/**
 * Herramientas que requieren token de autenticación
 */
const TOOLS_REQUIRING_AUTH = [
    'consultar_mis_solicitudes',
    'consultar_informacion_empleado',
    'cancelar_solicitud_vacaciones'
];

/**
 * Verifica si una herramienta requiere autenticación
 * @param {string} toolName - Nombre de la herramienta
 * @returns {boolean} - true si requiere autenticación
 */
function requiresAuthentication(toolName) {
    return TOOLS_REQUIRING_AUTH.includes(toolName);
}

/**
 * Valida si el usuario tiene un token válido para usar herramientas que requieren auth
 * @param {Object} context - Context del bot
 * @param {string} userId - ID del usuario
 * @param {Function} getUserOAuthToken - Función para obtener token OAuth
 * @param {Function} isTokenValid - Función para validar token
 * @returns {Promise<Object>} - {isValid, token, error}
 */
async function validateUserToken(context, userId, getUserOAuthToken, isTokenValid) {
    try {
        console.log(`🔐 Validando token para usuario ${userId}...`);
        
        // Intentar obtener el token
        const token = await getUserOAuthToken(context, userId);
        
        if (!token) {
            console.log(`❌ No se encontró token para usuario ${userId}`);
            return {
                isValid: false,
                token: null,
                error: 'NO_TOKEN'
            };
        }
        
        // Validar el token
        const tokenIsValid = await isTokenValid(token);
        
        if (!tokenIsValid) {
            console.log(`❌ Token inválido para usuario ${userId}`);
            return {
                isValid: false,
                token: null,
                error: 'INVALID_TOKEN'
            };
        }
        
        console.log(`✅ Token válido para usuario ${userId}`);
        return {
            isValid: true,
            token: token,
            error: null
        };
        
    } catch (error) {
        console.error(`❌ Error validando token para usuario ${userId}:`, error);
        return {
            isValid: false,
            token: null,
            error: 'VALIDATION_ERROR'
        };
    }
}

/**
 * Genera una tarjeta OAuth que se muestra directamente al usuario
 * @param {string} toolName - Nombre de la herramienta que requiere auth
 * @param {string} toolDescription - Descripción de la herramienta
 * @returns {Object} - Respuesta con tarjeta OAuth para el usuario
 */
function generateLoginCard(toolName, toolDescription) {
    // Mapeo de descripciones amigables para herramientas
    const toolDescriptions = {
        'consultar_mis_solicitudes': 'consultar tus solicitudes de vacaciones',
        'consultar_informacion_empleado': 'obtener tu información como empleado',
        'cancelar_solicitud_vacaciones': 'cancelar una solicitud de vacaciones'
    };
    
    const friendlyDescription = toolDescriptions[toolName] || toolDescription || toolName;
    
    const loginCard = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
            {
                type: 'TextBlock',
                text: '🔐 Autenticación Requerida',
                size: 'Large',
                weight: 'Bolder',
                color: 'Attention'
            },
            {
                type: 'TextBlock',
                text: `Para **${friendlyDescription}**, necesitas autenticarte primero.`,
                wrap: true,
                spacing: 'Medium'
            },
            {
                type: 'TextBlock',
                text: 'Haz clic en el botón para iniciar sesión con tu cuenta corporativa.',
                wrap: true,
                spacing: 'Small'
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: '🔑 Iniciar Sesión',
                data: {
                    msteams: {
                        type: 'messageBack',
                        text: 'login',
                        displayText: 'login'
                    }
                },
                style: 'positive'
            }
        ]
    };

    return {
        type: 'card',
        content: `🔐 **Autenticación requerida**\n\nPara **${friendlyDescription}**, necesitas autenticarte primero.`,
        card: CardFactory.adaptiveCard(loginCard)
    };
}

/**
 * Genera mensaje de error de autenticación
 * @param {string} toolName - Nombre de la herramienta
 * @param {string} error - Tipo de error
 * @returns {Object} - Respuesta de error
 */
function generateAuthErrorMessage(toolName, error) {
    let message = '❌ **Error de autenticación**\n\n';
    
    switch (error) {
        case 'NO_TOKEN':
            message += '**Problema**: No se encontró token de autenticación\n';
            message += '**Solución**: Escribe `login` para autenticarte';
            break;
        case 'INVALID_TOKEN':
            message += '**Problema**: Tu token de autenticación ha expirado\n';
            message += '**Solución**: Escribe `logout` y luego `login` para renovar tu sesión';
            break;
        case 'VALIDATION_ERROR':
            message += '**Problema**: Error validando tu autenticación\n';
            message += '**Solución**: Intenta hacer `logout` y `login` nuevamente';
            break;
        default:
            message += '**Problema**: Error desconocido de autenticación\n';
            message += '**Solución**: Contacta al administrador del sistema';
    }
    
    return {
        type: 'text',
        content: message
    };
}

/**
 * Procesa el resultado de validación de token y genera respuesta apropiada
 * @param {Object} validationResult - Resultado de validateUserToken
 * @param {string} toolName - Nombre de la herramienta
 * @param {string} toolDescription - Descripción de la herramienta
 * @returns {Object} - Respuesta apropiada (login card o error)
 */
function handleAuthValidationResult(validationResult, toolName, toolDescription) {
    const { isValid, error } = validationResult;
    
    if (isValid) {
        return null; // No hay error, continuar con la ejecución
    }
    
    // Si no hay token o es inválido, mostrar tarjeta de login
    if (error === 'NO_TOKEN' || error === 'INVALID_TOKEN') {
        return generateLoginCard(toolName, toolDescription);
    }
    
    // Para otros errores, mostrar mensaje de error
    return generateAuthErrorMessage(toolName, error);
}

/**
 * Middleware para validar autenticación antes de ejecutar herramientas
 * @param {string} toolName - Nombre de la herramienta
 * @param {Object} context - Context del bot
 * @param {string} userId - ID del usuario
 * @param {Function} getUserOAuthToken - Función para obtener token OAuth
 * @param {Function} isTokenValid - Función para validar token
 * @returns {Promise<Object>} - {canExecute, token, response}
 */
async function checkAuthenticationForTool(toolName, context, userId, getUserOAuthToken, isTokenValid) {
    // Si la herramienta no requiere autenticación, permitir ejecución
    if (!requiresAuthentication(toolName)) {
        return {
            canExecute: true,
            token: null,
            response: null
        };
    }
    
    console.log(`🔍 Herramienta ${toolName} requiere autenticación, validando...`);
    
    // Validar token
    const validationResult = await validateUserToken(context, userId, getUserOAuthToken, isTokenValid);
    
    if (validationResult.isValid) {
        return {
            canExecute: true,
            token: validationResult.token,
            response: null
        };
    }
    
    // Generar respuesta de autenticación
    const authResponse = handleAuthValidationResult(validationResult, toolName, 'esta función');
    
    return {
        canExecute: false,
        token: null,
        response: authResponse
    };
}

module.exports = {
    requiresAuthentication,
    validateUserToken,
    generateLoginCard,
    generateAuthErrorMessage,
    handleAuthValidationResult,
    checkAuthenticationForTool,
    TOOLS_REQUIRING_AUTH
};