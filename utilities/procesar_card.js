// procesar_card.js - Procesamiento optimizado de tarjetas adaptativas

const axios = require('axios');
const { executeHttpRequest } = require('./http_utils');

/**
 * Maneja el submit de tarjetas adaptativas de forma optimizada
 */
async function handleCardSubmit(context, submitData, getUserOAuthToken, handleTokenExpiration, isTokenValid, openaiService) {
    const userId = context.activity.from.id;
    
    try {
        console.log(`[${userId}] Procesando submit de tarjeta:`, Object.keys(submitData));

        // Verificar si es un submit de guía de vacaciones
        if (submitData.vacation_type) {
            return await handleVacationGuideSubmit(context, submitData, openaiService);
        }
        
        // Verificar si es confirmación o cancelación de vacaciones
        if (submitData.action === 'Confirmar Vacaciones' || submitData.action === 'Cancelar Vacaciones') {
            return await handleVacationConfirmation(context, submitData, getUserOAuthToken, isTokenValid);
        }

        // Validar datos básicos
        const { action, method, url, ...fieldData } = submitData;
        
        if (!action || !method || !url) {
            await context.sendActivity('❌ **Error**: Datos incompletos en la solicitud.');
            return;
        }

        // Mostrar progreso
        await context.sendActivity({ type: 'typing' });
        await context.sendActivity(`⏳ **Ejecutando**: ${action}...`);

        // Obtener y validar token OAuth
        const oauthToken = await getUserOAuthToken(context, userId);
        if (!oauthToken) {
            console.log(`[${userId}] Token OAuth no disponible`);
            await handleTokenExpiration(context, userId);
            return;
        }

        const tokenIsValid = await isTokenValid(oauthToken);
        if (!tokenIsValid) {
            console.log(`[${userId}] Token OAuth inválido`);
            await handleTokenExpiration(context, userId);
            return;
        }

        // Procesar URL y datos
        const { processedUrl, processedData } = processRequestData(url, fieldData);
        
        if (!processedUrl) {
            await context.sendActivity('❌ **Error**: Faltan parámetros requeridos.');
            return;
        }

        // Si es solicitud de vacaciones, forzar simulación primero
        let finalUrl = processedUrl;
        if (action === 'Solicitar Vacaciones' && url.includes('/vac/solicitudes/')) {
            // Siempre simular primero
            finalUrl = processedUrl.replace(/{simular}/g, 'true').replace(/\/false$/g, '/true');
        }

        // Ejecutar petición HTTP
        const response = await executeHttpRequest(method, finalUrl, oauthToken, processedData);

        // Para solicitudes de vacaciones, manejar confirmación
        if (action === 'Solicitar Vacaciones' && response) {
            await handleVacationSimulationResponse(context, response, url, fieldData, oauthToken);
            return;
        }

        // Para otras acciones, enviar respuesta normal
        await sendFormattedResponse(context, action, response, openaiService);

    } catch (error) {
        console.error(`[${userId}] Error en handleCardSubmit:`, error.message);
        await handleApiError(context, error, submitData.action || 'Desconocida');
    }
}

/**
 * Maneja submits de la tarjeta guía de vacaciones
 */
async function handleVacationGuideSubmit(context, submitData, openaiService) {
    const { vacation_type, action } = submitData;
    const userId = context.activity.from.id;
    
    console.log(`[${userId}] Manejo de guía de vacaciones:`, vacation_type);
    
    try {
        let prompt;
        
        switch (vacation_type) {
            case 'regular':
                prompt = "El usuario seleccionó vacaciones regulares. Genera la tarjeta correspondiente.";
                break;
            case 'matrimonio':
                prompt = "El usuario seleccionó vacaciones por matrimonio. Genera la tarjeta correspondiente.";
                break;
            case 'nacimiento':
                prompt = "El usuario seleccionó vacaciones por nacimiento. Genera la tarjeta correspondiente.";
                break;
            default:
                await context.sendActivity('⚠️ Tipo de vacación no reconocido.');
                return;
        }
        
        const response = await openaiService.procesarMensaje(prompt, []);
        await sendOpenAIResponse(context, response);
        
    } catch (error) {
        console.error(`[${userId}] Error en vacation guide submit:`, error.message);
        await context.sendActivity('❌ Error procesando selección de vacaciones.');
    }
}

/**
 * Procesa datos de la petición (URL y campos)
 */
function processRequestData(url, fieldData) {
    // Procesar fechas
    const processedData = processDateFields(fieldData);
    
    // Procesar parámetros de URL
    const { processedUrl, remainingData } = processUrlParameters(url, processedData);
    
    return {
        processedUrl,
        processedData: remainingData
    };
}

/**
 * Procesa campos de fecha al formato ISO 8601
 */
function processDateFields(fieldData) {
    const processed = { ...fieldData };
    
    const dateFields = [
        'fechaInicio', 'fechaFin', 'fechaMatrimonio', 'fechaNacimiento',
        'fecha', 'startDate', 'endDate', 'marriageDate', 'birthDate'
    ];
    
    for (const [key, value] of Object.entries(processed)) {
        const isDateField = key.toLowerCase().includes('fecha') || 
                           key.toLowerCase().includes('date') || 
                           dateFields.includes(key);
        
        if (isDateField && value && typeof value === 'string') {
            const convertedDate = convertToISODate(value);
            if (convertedDate) {
                processed[key] = convertedDate;
            }
        }
    }
    
    return processed;
}

/**
 * Convierte fecha a formato ISO
 */
function convertToISODate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        return null;
    }

    // Si ya está en formato ISO
    if (dateString.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/)) {
        return dateString.includes('T') ? dateString : dateString + 'T00:00:00.000Z';
    }

    try {
        // Formato dd/MM/yyyy o dd-MM-yyyy
        const ddMMyyyyMatch = dateString.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (ddMMyyyyMatch) {
            const day = ddMMyyyyMatch[1].padStart(2, '0');
            const month = ddMMyyyyMatch[2].padStart(2, '0');
            const year = ddMMyyyyMatch[3];
            
            if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
                parseInt(day) >= 1 && parseInt(day) <= 31) {
                return `${year}-${month}-${day}T00:00:00.000Z`;
            }
        }

        // Intentar parse directo
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
    } catch (error) {
        console.warn('Error convirtiendo fecha:', dateString, error.message);
    }

    return null;
}

/**
 * Procesa parámetros de URL reemplazando placeholders
 */
function processUrlParameters(url, fieldData) {
    let processedUrl = url;
    const remainingData = { ...fieldData };

    // Extraer y reemplazar parámetros {param}
    const urlPattern = /\{([^}]+)\}/g;
    const matches = [...url.matchAll(urlPattern)];

    for (const match of matches) {
        const paramName = match[1];
        let value = remainingData[paramName];

        // Para vacaciones, si falta simular, usar 'true' por defecto
        if (paramName === 'simular' && value === undefined && url.includes('/vac/solicitudes/')) {
            value = 'true';
        }

        if (value !== undefined && value !== '') {
            processedUrl = processedUrl.replace(`{${paramName}}`, encodeURIComponent(value));
            delete remainingData[paramName];
        } else {
            console.error(`Parámetro faltante en URL: ${paramName}`);
            return { processedUrl: null, remainingData: null };
        }
    }

    return { processedUrl, remainingData };
}

/**
 * Envía respuesta formateada
 */
async function sendFormattedResponse(context, action, response, openaiService) {
    try {
        // Intentar formatear con OpenAI para mejor presentación
        const payload = (response && typeof response === 'object' && response.message) 
            ? response.message 
            : response;
        
        const prompt = `Formatea amigablemente con emojis la respuesta de "${action}":\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
        
        const openaiResponse = await openaiService.procesarMensaje(prompt, []);
        const formattedResponse = openaiResponse.type === 'text' ? openaiResponse.content : openaiResponse;
        
        await context.sendActivity(formattedResponse);
        
    } catch (formatError) {
        console.warn('Error formateando con OpenAI, usando formato manual:', formatError.message);
        
        // Fallback a formato manual
        const fallbackMessage = typeof response === 'string' 
            ? `✅ **${action}** ejecutada:\n\n${response}`
            : `✅ **${action}** ejecutada exitosamente:\n\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``;
            
        await context.sendActivity(fallbackMessage);
    }
}

/**
 * Envía respuesta de OpenAI
 */
async function sendOpenAIResponse(context, response) {
    if (response.type === 'card') {
        if (response.content) {
            await context.sendActivity(response.content);
        }
        
        if (Array.isArray(response.card)) {
            for (const card of response.card) {
                await context.sendActivity({ attachments: [card] });
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            await context.sendActivity({ attachments: [response.card] });
        }
    } else {
        await context.sendActivity(response.content || response);
    }
}

/**
 * Maneja errores de API
 */
async function handleApiError(context, error, action) {
    console.error(`Error en acción "${action}":`, error.message);
    
    let errorMessage = `❌ **Error en ${action}**:\n\n`;
    
    if (error.response) {
        const status = error.response.status;
        errorMessage += `**Código**: ${status}\n`;
        
        if (error.response.data) {
            const errorData = error.response.data;
            if (typeof errorData === 'object' && errorData.message) {
                errorMessage += `**Mensaje**: ${errorData.message}\n`;
            } else {
                errorMessage += `**Detalles**: ${JSON.stringify(errorData).substring(0, 200)}...\n`;
            }
        }

        // Sugerencias por código de error
        switch (status) {
            case 401:
                errorMessage += '\n💡 Tu sesión expiró. Escribe `login` para autenticarte.';
                break;
            case 403:
                errorMessage += '\n💡 No tienes permisos para esta operación.';
                break;
            case 404:
                errorMessage += '\n💡 Recurso no encontrado. Verifica los parámetros.';
                break;
            case 429:
                errorMessage += '\n💡 Demasiadas peticiones. Intenta en unos momentos.';
                break;
            case 500:
            case 502:
            case 503:
                errorMessage += '\n💡 Error del servidor. Intenta nuevamente.';
                break;
            default:
                errorMessage += '\n💡 Intenta nuevamente o contacta soporte.';
        }
        
    } else if (error.request) {
        errorMessage += '**Problema**: Sin conexión al servidor.\n';
        errorMessage += '💡 Verifica tu conexión e intenta nuevamente.';
    } else {
        errorMessage += `**Detalles**: ${error.message}`;
    }

    await context.sendActivity(errorMessage);
}

/**
 * Valida estructura de datos del submit
 */
function validateSubmitData(submitData) {
    if (!submitData || typeof submitData !== 'object') {
        return { valid: false, error: 'Datos de submit inválidos' };
    }

    // Validar campos requeridos básicos
    const requiredFields = ['action'];
    for (const field of requiredFields) {
        if (!submitData[field]) {
            return { valid: false, error: `Campo requerido faltante: ${field}` };
        }
    }

    return { valid: true };
}

/**
 * Sanitiza datos de entrada
 */
function sanitizeInputData(data) {
    const sanitized = {};
    
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            // Remover caracteres potencialmente peligrosos
            sanitized[key] = value.replace(/[<>\"']/g, '').trim();
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
}

/**
 * Maneja la respuesta de simulación de vacaciones
 */
async function handleVacationSimulationResponse(context, response, originalUrl, fieldData, oauthToken) {
    const { CardFactory } = require('botbuilder');
    
    try {
        // Analizar respuesta
        let message = '';
        let isSuccess = false;
        
        if (typeof response === 'object' && response !== null) {
            // Usar statusCode para determinar éxito/error
            message = response.message || JSON.stringify(response, null, 2);
            
            if (response.statusCode !== undefined) {
                // Si hay statusCode, usarlo como fuente de verdad
                isSuccess = response.statusCode >= 200 && response.statusCode < 300;
                console.log(`📊 StatusCode recibido: ${response.statusCode}, isSuccess: ${isSuccess}`);
            } else {
                // Fallback a lógica anterior para respuestas sin statusCode
                isSuccess = response.success === true || 
                           response.resultado?.toLowerCase() === 'exitoso' ||
                           response.status === 'success' ||
                           response.status === 200;
            }
        } else if (typeof response === 'string') {
            message = response;
            // Para strings, usar lógica de palabras clave más simple
            const lowerResponse = response.toLowerCase();
            isSuccess = lowerResponse.includes('exitoso') || 
                       lowerResponse.includes('aprobado') ||
                       lowerResponse.includes('disponible') ||
                       lowerResponse.includes('días disponibles') ||
                       lowerResponse.includes('saldo suficiente');
        } else {
            message = String(response);
            isSuccess = false;
        }
        
        if (!isSuccess) {
            await context.sendActivity(`❌ **Simulación rechazada**\n\n${message}`);
            return;
        }
        
        // Mostrar detalles de la simulación
        await context.sendActivity(`✅ **Simulación exitosa**\n\n${message}`);
        
        // Crear tarjeta de confirmación
        const confirmCard = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.3',
            body: [
                {
                    type: 'TextBlock',
                    text: '🤔 ¿Deseas confirmar esta solicitud de vacaciones?',
                    size: 'Large',
                    weight: 'Bolder',
                    wrap: true
                },
                {
                    type: 'TextBlock',
                    text: 'La simulación fue exitosa. Al confirmar, se enviará la solicitud oficial.',
                    wrap: true,
                    spacing: 'Medium'
                }
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: '✅ Sí, confirmar',
                    data: {
                        action: 'Confirmar Vacaciones',
                        method: 'POST',
                        url: originalUrl,
                        confirmed: true,
                        ...fieldData
                    },
                    style: 'positive'
                },
                {
                    type: 'Action.Submit',
                    title: '❌ No, cancelar',
                    data: {
                        action: 'Cancelar Vacaciones',
                        cancelled: true
                    },
                    style: 'destructive'
                }
            ]
        };
        
        await context.sendActivity({
            attachments: [CardFactory.adaptiveCard(confirmCard)]
        });
        
    } catch (error) {
        console.error('Error en handleVacationSimulationResponse:', error);
        await context.sendActivity('❌ Error procesando respuesta de simulación');
    }
}

/**
 * Maneja confirmación de vacaciones
 */
async function handleVacationConfirmation(context, submitData, getUserOAuthToken, isTokenValid) {
    const userId = context.activity.from.id;
    
    try {
        if (submitData.cancelled) {
            await context.sendActivity('❌ **Solicitud cancelada**\n\nNo se envió la solicitud de vacaciones.');
            return;
        }
        
        if (!submitData.confirmed) {
            return;
        }
        
        // Obtener token
        const oauthToken = await getUserOAuthToken(context, userId);
        if (!oauthToken || !await isTokenValid(oauthToken)) {
            await context.sendActivity('❌ Error de autenticación. Intenta nuevamente.');
            return;
        }
        
        // Procesar datos y URL con simular=false
        const { processedUrl, processedData } = processRequestData(submitData.url, submitData);
        const finalUrl = processedUrl.replace(/{simular}/g, 'false').replace(/\/true$/g, '/false');
        
        await context.sendActivity('📤 **Enviando solicitud oficial...**');
        
        // Ejecutar petición real
        const response = await executeHttpRequest(submitData.method, finalUrl, oauthToken, processedData);
        
        // Evaluar si la respuesta indica éxito
        let isSuccess = false;
        let message = '';
        
        if (response) {
            if (typeof response === 'string') {
                message = response;
                const lowerResponse = response.toLowerCase();
                isSuccess = lowerResponse.includes('exitosamente') ||
                           lowerResponse.includes('enviado') ||
                           lowerResponse.includes('registrada') ||
                           lowerResponse.includes('aprobada') ||
                           lowerResponse.includes('procesada') ||
                           lowerResponse.includes('completada') ||
                           (lowerResponse.includes('solicitud') && lowerResponse.includes('envió'));
            } else if (typeof response === 'object') {
                message = response.message || JSON.stringify(response, null, 2);
                isSuccess = response.success === true || 
                           response.resultado === 'exitoso' ||
                           response.status === 'success' ||
                           response.status === 200 ||
                           (response.message && (
                               response.message.toLowerCase().includes('exitosamente') ||
                               response.message.toLowerCase().includes('enviado') ||
                               response.message.toLowerCase().includes('registrada')
                           ));
            }
        }
        
        if (isSuccess) {
            await context.sendActivity(`✅ **¡Solicitud enviada exitosamente!**\n\n${message}`);
        } else {
            await context.sendActivity(`❌ **Error al enviar solicitud**\n\n${message || 'Intenta nuevamente más tarde.'}`);
        }
        
    } catch (error) {
        console.error('Error en handleVacationConfirmation:', error);
        await context.sendActivity('❌ Error procesando confirmación de vacaciones');
    }
}

module.exports = {
    handleCardSubmit,
    handleVacationGuideSubmit,
    processDateFields,
    processUrlParameters,
    handleApiError,
    validateSubmitData,
    sanitizeInputData
};