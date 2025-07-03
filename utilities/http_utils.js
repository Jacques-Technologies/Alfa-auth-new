// utilities/http_utils.js - Utilidades para peticiones HTTP

const axios = require('axios');

/**
 * Ejecuta la petición HTTP con la configuración adecuada
 * @param {string} method - Método HTTP
 * @param {string} url - URL procesada
 * @param {string} oauthToken - Token OAuth del usuario
 * @param {Object} data - Datos adicionales
 * @returns {Object} - Respuesta de la API
 */
async function executeHttpRequest(method, url, oauthToken, data) {
  const axiosConfig = {
    method: method.toLowerCase(),
    url: url,
    headers: {
      'Authorization': oauthToken.startsWith('Bearer ') ? oauthToken : `Bearer ${oauthToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: 30000 // 30 segundos timeout
  };

  // Configurar datos según el método HTTP
  if (method.toUpperCase() === 'GET') {
    if (Object.keys(data).length > 0) {
      axiosConfig.params = data;
    }
  } else {
    if (Object.keys(data).length > 0) {
      axiosConfig.data = data;
    }
  }

  const response = await axios(axiosConfig);
  return response.data;
}

/**
 * Verifica si el token OAuth es válido haciendo una llamada de prueba
 * @param {string} token - Token OAuth a verificar
 * @returns {boolean} - Si el token es válido
 */
async function isTokenValid(token) {
  if (!token) return false;
  
  try {
    const response = await axios.get(
      'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
      {
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
        },
        timeout: 5000
      }
    );
    
    return response.status === 200;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      return false;
    }
    // Para otros errores, asumimos que el token podría ser válido
    return true;
  }
}

/**
 * Crea una configuración base para axios
 * @param {string} token - Token OAuth
 * @param {number} timeout - Timeout en milisegundos
 * @returns {Object} - Configuración de axios
 */
function createAxiosConfig(token, timeout = 30000) {
  return {
    headers: {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout
  };
}

/**
 * Maneja errores de peticiones HTTP
 * @param {Error} error - Error de axios
 * @returns {Object} - Información estructurada del error
 */
function handleHttpError(error) {
  const errorInfo = {
    type: 'unknown',
    status: null,
    message: error.message,
    data: null
  };

  if (error.response) {
    // Error de respuesta HTTP
    errorInfo.type = 'response';
    errorInfo.status = error.response.status;
    errorInfo.statusText = error.response.statusText;
    errorInfo.data = error.response.data;
  } else if (error.request) {
    // Error de red
    errorInfo.type = 'network';
    errorInfo.message = 'No se pudo conectar con el servidor';
  } else {
    // Error de configuración
    errorInfo.type = 'config';
  }

  return errorInfo;
}

module.exports = {
  executeHttpRequest,
  isTokenValid,
  createAxiosConfig,
  handleHttpError
};