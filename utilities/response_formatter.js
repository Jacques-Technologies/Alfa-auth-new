// utilities/response_formatter.js - Utilidades para formateo de respuestas

/**
 * Formatea la respuesta de la API para mostrar al usuario
 * @param {string} action - Nombre de la acción ejecutada
 * @param {*} data - Datos de respuesta
 * @returns {string} - Mensaje formateado
 */
function formatApiResponse(action, data) {
  let message = `✅ **${action}** ejecutada exitosamente:\n\n`;
  
  if (data === null || data === undefined) {
    message += '_Sin datos en la respuesta_';
  } else if (typeof data === 'object') {
    if (Array.isArray(data)) {
      message += `📊 **Resultados encontrados**: ${data.length}\n\n`;
      if (data.length > 0) {
        const itemsToShow = Math.min(data.length, 3);
        for (let i = 0; i < itemsToShow; i++) {
          message += `**Elemento ${i + 1}**:\n`;
          message += formatObjectData(data[i]) + '\n\n';
        }
        if (data.length > 3) {
          message += `_... y ${data.length - 3} elementos más_\n`;
        }
      }
    } else {
      message += formatObjectData(data);
    }
  } else {
    message += String(data);
  }
  
  return message;
}

/**
 * Formatea un objeto de datos para visualización
 * @param {Object} obj - Objeto a formatear
 * @returns {string} - Objeto formateado
 */
function formatObjectData(obj) {
  if (!obj || typeof obj !== 'object') {
    return String(obj);
  }

  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return '_Objeto vacío_';
  }

  // Si hay pocas propiedades, mostrar como lista
  if (keys.length <= 8) {
    return keys
      .map(key => `• **${key}**: ${formatValue(obj[key])}`)
      .join('\n');
  }

  // Si hay muchas propiedades, mostrar como JSON
  return `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
}

/**
 * Formatea un valor individual para visualización
 * @param {*} value - Valor a formatear
 * @returns {string} - Valor formateado
 */
function formatValue(value) {
  if (value === null || value === undefined) {
    return '_null_';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Formatea un mensaje de éxito
 * @param {string} action - Acción realizada
 * @param {string} details - Detalles adicionales
 * @returns {string} - Mensaje formateado
 */
function formatSuccessMessage(action, details = '') {
  let message = `✅ **${action}** completada exitosamente`;
  
  if (details) {
    message += `\n\n${details}`;
  }
  
  return message;
}

/**
 * Formatea un mensaje de error
 * @param {string} action - Acción que falló
 * @param {string} error - Descripción del error
 * @param {string} suggestion - Sugerencia para solucionar
 * @returns {string} - Mensaje formateado
 */
function formatErrorMessage(action, error, suggestion = '') {
  let message = `❌ **Error en ${action}**:\n\n${error}`;
  
  if (suggestion) {
    message += `\n\n💡 **Sugerencia**: ${suggestion}`;
  }
  
  return message;
}

/**
 * Formatea un mensaje de información
 * @param {string} title - Título del mensaje
 * @param {string} content - Contenido del mensaje
 * @param {string} emoji - Emoji para el mensaje (opcional)
 * @returns {string} - Mensaje formateado
 */
function formatInfoMessage(title, content, emoji = 'ℹ️') {
  return `${emoji} **${title}**\n\n${content}`;
}

/**
 * Formatea una lista de elementos
 * @param {Array} items - Lista de elementos
 * @param {string} title - Título de la lista
 * @param {string} itemPrefix - Prefijo para cada elemento
 * @returns {string} - Lista formateada
 */
function formatList(items, title = '', itemPrefix = '•') {
  if (!Array.isArray(items) || items.length === 0) {
    return title ? `${title}\n\n_Sin elementos_` : '_Sin elementos_';
  }

  let formatted = '';
  if (title) {
    formatted += `${title}\n\n`;
  }

  formatted += items
    .map(item => `${itemPrefix} ${item}`)
    .join('\n');

  return formatted;
}

module.exports = {
  formatApiResponse,
  formatObjectData,
  formatValue,
  formatSuccessMessage,
  formatErrorMessage,
  formatInfoMessage,
  formatList
};