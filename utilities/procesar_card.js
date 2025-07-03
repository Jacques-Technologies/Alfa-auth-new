// utilities/procesar_card.js - Utilidades para procesamiento de tarjetas adaptativas

const axios = require('axios');
const { convertToISODate } = require('./date_utils');
const { executeHttpRequest } = require('./http_utils');
const { formatApiResponse } = require('./response_formatter');

/**
 * Maneja submits específicos de la tarjeta guía de vacaciones
 * @param {TurnContext} context - Contexto del turno
 * @param {Object} submitData - Datos del submit
 * @param {Object} openaiService - Servicio OpenAI
 * @returns {boolean} - Si se manejó el submit
 */
async function handleVacationGuideSubmit(context, submitData, openaiService) {
  const { vacation_type, action } = submitData;
  
  if (!vacation_type) {
    return false; // No es un submit de la guía de vacaciones
  }
  
  try {
    let openaiResponse;
    
    switch (vacation_type) {
      case 'regular':
        const regularPrompt = "El usuario seleccionó vacaciones regulares. Genera la tarjeta para solicitar vacaciones regulares.";
        openaiResponse = await openaiService.procesarMensaje(regularPrompt, []);
        break;
        
      case 'matrimonio':
        const matrimonioPrompt = "El usuario seleccionó vacaciones por matrimonio. Genera la tarjeta para vacaciones por matrimonio.";
        openaiResponse = await openaiService.procesarMensaje(matrimonioPrompt, []);
        break;
        
      case 'nacimiento':
        const nacimientoPrompt = "El usuario seleccionó vacaciones por nacimiento. Genera la tarjeta para vacaciones por nacimiento.";
        openaiResponse = await openaiService.procesarMensaje(nacimientoPrompt, []);
        break;
        
      default:
        await context.sendActivity('⚠️ Tipo de vacación no reconocido. Por favor, selecciona una opción válida.');
        return true;
    }
    
    // Enviar respuesta generada por OpenAI
    if (openaiResponse) {
      if (openaiResponse.type === 'card') {
        if (openaiResponse.content) {
          await context.sendActivity(openaiResponse.content);
        }
        
        if (Array.isArray(openaiResponse.card)) {
          for (const card of openaiResponse.card) {
            await context.sendActivity({ attachments: [card] });
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          await context.sendActivity({ attachments: [openaiResponse.card] });
        }
      } else {
        await context.sendActivity(openaiResponse.content || openaiResponse);
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('Error manejando selección de vacaciones:', error);
    await context.sendActivity('❌ Error al procesar tu selección de vacaciones. Por favor, intenta nuevamente.');
    return true;
  }
}

/**
 * Maneja el submit de las tarjetas adaptativas
 * @param {TurnContext} context - Contexto del turno
 * @param {Object} submitData - Datos enviados desde la tarjeta
 * @param {Function} getUserOAuthToken - Función para obtener token OAuth
 * @param {Function} handleTokenExpiration - Función para manejar expiración
 * @param {Function} isTokenValid - Función para validar token
 * @param {Object} openaiService - Servicio OpenAI
 */
async function handleCardSubmit(context, submitData, getUserOAuthToken, handleTokenExpiration, isTokenValid, openaiService) {
  try {
    // Verificar si es un submit de la guía de vacaciones
    if (submitData.vacation_type) {
      const handled = await handleVacationGuideSubmit(context, submitData, openaiService);
      if (handled) {
        return;
      }
    }

    const { action, method, url, ...fieldData } = submitData;
    const userId = context.activity.from.id;
    
    // Validar que tengamos los datos básicos necesarios
    if (!action || !method || !url) {
      await context.sendActivity('❌ **Error**: Datos incompletos en la solicitud. Por favor, intenta nuevamente.');
      return;
    }

    // Enviar indicador de que se está procesando
    await context.sendActivity({ type: 'typing' });
    await context.sendActivity(`⏳ **Ejecutando acción**: ${action}...`);

    // Obtener token OAuth del usuario autenticado
    const oauthToken = await getUserOAuthToken(context, userId);
    
    if (!oauthToken) {
      await handleTokenExpiration(context, userId);
      return;
    }

    // Verificar si el token es válido
    const isValid = await isTokenValid(oauthToken);
    if (!isValid) {
      await handleTokenExpiration(context, userId);
      return;
    }

    // Procesar fechas en los datos de campo
    const processedFieldData = processDateFields(fieldData);

    // Procesar URL con parámetros dinámicos
    const { processedUrl, remainingData } = processUrlParameters(url, processedFieldData);
    
    if (!processedUrl) {
      await context.sendActivity('❌ **Error**: Faltan parámetros requeridos para esta acción.');
      return;
    }

    // Configurar y ejecutar petición HTTP con token OAuth
    const response = await executeHttpRequest(method, processedUrl, oauthToken, remainingData);

    // Formatear y enviar respuesta usando OpenAI para mejorar estilo
    const payload = (method.toUpperCase() === 'POST' && response && typeof response === 'object' && response.message)
      ? response.message
      : response;
    
    let formattedResponse;
    try {
      const prompt = `Por favor formatea de manera amigable y con emojis la respuesta de la acción "${action}":\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
      const openaiResponse = await openaiService.procesarMensaje(prompt, []);
      formattedResponse = openaiResponse.type === 'text' ? openaiResponse.content : openaiResponse;
    } catch (e) {
      // Si falla OpenAI, usar formato manual
      if (typeof payload === 'string') {
        formattedResponse = `✅ **${action}** ejecutada exitosamente:\n\n${payload}`;
      } else {
        formattedResponse = formatApiResponse(action, response);
      }
    }
    await context.sendActivity(formattedResponse);

  } catch (error) {
    await handleApiError(context, error, submitData.action || 'Desconocida', handleTokenExpiration);
  }
}

/**
 * Procesa los campos de fecha para convertirlos al formato ISO 8601
 * @param {Object} fieldData - Datos de los campos
 * @returns {Object} - Datos con fechas procesadas
 */
function processDateFields(fieldData) {
  const processed = { ...fieldData };
  
  // Campos que típicamente contienen fechas
  const dateFields = [
    'fechaInicio', 'fechaFin', 'fechaMatrimonio', 'fechaNacimiento',
    'fecha', 'startDate', 'endDate', 'marriageDate', 'birthDate'
  ];
  
  for (const [key, value] of Object.entries(processed)) {
    // Detectar campos de fecha por nombre o contenido
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
 * Procesa los parámetros de URL reemplazando placeholders
 * @param {string} url - URL con placeholders
 * @param {Object} fieldData - Datos de campos
 * @returns {Object} - URL procesada y datos restantes
 */
function processUrlParameters(url, fieldData) {
  let processedUrl = url;
  const remainingData = { ...fieldData };

  // Extraer parámetros de la URL (entre llaves)
  const urlPattern = /\{([^}]+)\}/g;
  const matches = [...url.matchAll(urlPattern)];

  for (const match of matches) {
    const paramName = match[1];
    const value = remainingData[paramName];

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
 * Maneja errores de API de forma amigable
 * @param {TurnContext} context - Contexto del turno
 * @param {Error} error - Error ocurrido
 * @param {string} action - Acción que causó el error
 * @param {Function} handleTokenExpiration - Función para manejar expiración
 */
async function handleApiError(context, error, action, handleTokenExpiration) {
  console.error(`Error en acción "${action}":`, error);
  
  let errorMessage = `❌ **Error en ${action}**:\n\n`;
  
  if (error.response) {
    const status = error.response.status;
    const statusText = error.response.statusText;
    
    errorMessage += `**Código**: ${status} - ${statusText}\n`;
    
    if (error.response.data) {
      if (typeof error.response.data === 'object') {
        const errorData = error.response.data;
        if (errorData.message) {
          errorMessage += `**Mensaje**: ${errorData.message}\n`;
        } else {
          errorMessage += `**Detalles**: ${JSON.stringify(errorData, null, 2)}\n`;
        }
      } else {
        errorMessage += `**Detalles**: ${error.response.data}\n`;
      }
    }

    // Sugerencias basadas en el código de error
    if (status === 401) {
      errorMessage += '\n💡 **Sugerencia**: Tu sesión ha expirado. Escribe `login` para autenticarte nuevamente.';
      await handleTokenExpiration(context, context.activity.from.id);
    } else if (status === 403) {
      errorMessage += '\n💡 **Sugerencia**: No tienes permisos suficientes para esta operación.';
    } else if (status === 404) {
      errorMessage += '\n💡 **Sugerencia**: El recurso solicitado no existe. Verifica los parámetros.';
    } else if (status >= 500) {
      errorMessage += '\n💡 **Sugerencia**: Error del servidor. Intenta nuevamente en unos momentos.';
    }
    
  } else if (error.request) {
    errorMessage += '**Problema**: No se pudo conectar con el servidor.\n';
    errorMessage += '💡 **Sugerencia**: Verifica tu conexión a internet e intenta nuevamente.';
  } else {
    errorMessage += `**Detalles**: ${error.message}`;
  }

  await context.sendActivity(errorMessage);
}

module.exports = {
  handleCardSubmit,
  handleVacationGuideSubmit,
  processDateFields,
  processUrlParameters,
  handleApiError
};