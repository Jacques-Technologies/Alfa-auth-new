// http_utils.js - Utilidades HTTP optimizadas con reintentos y manejo robusto

const axios = require('axios');

/**
 * Configuración por defecto para peticiones HTTP
 */
const DEFAULT_CONFIG = {
    timeout: 30000, // 30 segundos
    maxRetries: 3,
    retryDelay: 1000, // 1 segundo
    validateStatus: (status) => status < 500 // Solo reintentar errores 5xx
};

/**
 * Ejecuta petición HTTP con configuración optimizada
 */
async function executeHttpRequest(method, url, oauthToken, data = {}) {
    const config = createAxiosConfig(oauthToken);
    config.method = method.toLowerCase();
    config.url = url;

    // Configurar datos según método
    if (method.toUpperCase() === 'GET') {
        if (Object.keys(data).length > 0) {
            config.params = data;
        }
    } else {
        if (Object.keys(data).length > 0) {
            config.data = data;
        }
    }

    return await executeWithRetry(config);
}

/**
 * Ejecuta petición con reintentos automáticos
 */
async function executeWithRetry(config, maxRetries = DEFAULT_CONFIG.maxRetries) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`HTTP Request (intento ${attempt}): ${config.method.toUpperCase()} ${config.url}`);
            
            const response = await axios(config);
            
            console.log(`HTTP Response: ${response.status} ${response.statusText}`);
            return response.data;
            
        } catch (error) {
            lastError = error;
            
            // Log del error
            const status = error.response?.status || 'NO_RESPONSE';
            const message = error.response?.data?.message || error.message;
            console.warn(`HTTP Error (intento ${attempt}/${maxRetries}): ${status} - ${message}`);
            
            // Decidir si reintentar
            if (!shouldRetry(error, attempt, maxRetries)) {
                break;
            }
            
            // Esperar antes del siguiente intento
            if (attempt < maxRetries) {
                const delay = calculateRetryDelay(attempt);
                console.log(`Reintentando en ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    
    // Si llegamos aquí, todos los intentos fallaron
    throw enhanceError(lastError);
}

/**
 * Determina si se debe reintentar una petición
 */
function shouldRetry(error, attempt, maxRetries) {
    // No reintentar si ya alcanzamos el máximo
    if (attempt >= maxRetries) {
        return false;
    }
    
    // No reintentar errores de cliente (4xx) excepto algunos específicos
    if (error.response) {
        const status = error.response.status;
        
        // Siempre reintentar errores de servidor (5xx)
        if (status >= 500) {
            return true;
        }
        
        // Reintentar algunos errores específicos de cliente
        if ([408, 429].includes(status)) {
            return true;
        }
        
        // No reintentar otros errores de cliente
        return false;
    }
    
    // Reintentar errores de red/timeout
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ENOTFOUND' ||
        error.message.includes('timeout')) {
        return true;
    }
    
    return false;
}

/**
 * Calcula delay para reintentos con backoff exponencial
 */
function calculateRetryDelay(attempt) {
    const baseDelay = DEFAULT_CONFIG.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    
    return Math.min(exponentialDelay + jitter, 10000); // Máximo 10 segundos
}

/**
 * Verifica si un token OAuth es válido
 */
async function isTokenValid(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }
    
    try {
        const response = await axios.get(
            'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
            {
                headers: {
                    'Authorization': formatAuthHeader(token)
                },
                timeout: 10000,
                validateStatus: (status) => status < 500
            }
        );
        
        const isValid = response.status === 200;
        console.log(`Token validation: ${isValid ? 'VALID' : 'INVALID'} (${response.status})`);
        return isValid;
        
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('Token validation: INVALID (401 Unauthorized)');
            return false;
        }
        
        // Para otros errores, asumir que el token podría ser válido
        console.warn('Token validation error (assuming valid):', error.message);
        return true;
    }
}

/**
 * Crea configuración base para axios
 */
function createAxiosConfig(token, timeout = DEFAULT_CONFIG.timeout) {
    return {
        headers: {
            'Authorization': formatAuthHeader(token),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Alfa-Teams-Bot/1.0'
        },
        timeout,
        validateStatus: (status) => status < 500,
        maxRedirects: 3
    };
}

/**
 * Formatea header de autorización
 */
function formatAuthHeader(token) {
    if (!token) {
        throw new Error('Token es requerido');
    }
    
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

/**
 * Mejora información de error
 */
function enhanceError(error) {
    const enhancedError = new Error();
    
    if (error.response) {
        // Error de respuesta HTTP
        enhancedError.name = 'HttpResponseError';
        enhancedError.message = `HTTP ${error.response.status}: ${error.response.statusText}`;
        enhancedError.status = error.response.status;
        enhancedError.statusText = error.response.statusText;
        enhancedError.data = error.response.data;
        enhancedError.headers = error.response.headers;
    } else if (error.request) {
        // Error de red
        enhancedError.name = 'NetworkError';
        enhancedError.message = 'No se pudo conectar con el servidor';
        enhancedError.code = error.code;
    } else {
        // Error de configuración
        enhancedError.name = 'ConfigurationError';
        enhancedError.message = error.message;
    }
    
    enhancedError.originalError = error;
    return enhancedError;
}

/**
 * Valida parámetros de petición HTTP
 */
function validateRequestParams(method, url, token) {
    const errors = [];
    
    if (!method || typeof method !== 'string') {
        errors.push('Método HTTP es requerido');
    }
    
    if (!url || typeof url !== 'string') {
        errors.push('URL es requerida');
    }
    
    if (!token || typeof token !== 'string') {
        errors.push('Token de autorización es requerido');
    }
    
    try {
        new URL(url);
    } catch (urlError) {
        errors.push('URL no es válida');
    }
    
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!validMethods.includes(method.toUpperCase())) {
        errors.push(`Método HTTP no soportado: ${method}`);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Crea petición GET simplificada
 */
async function httpGet(url, token, params = {}) {
    return await executeHttpRequest('GET', url, token, params);
}

/**
 * Crea petición POST simplificada
 */
async function httpPost(url, token, data = {}) {
    return await executeHttpRequest('POST', url, token, data);
}

/**
 * Crea petición PUT simplificada
 */
async function httpPut(url, token, data = {}) {
    return await executeHttpRequest('PUT', url, token, data);
}

/**
 * Crea petición DELETE simplificada
 */
async function httpDelete(url, token, data = {}) {
    return await executeHttpRequest('DELETE', url, token, data);
}

/**
 * Obtiene información de salud de un endpoint
 */
async function healthCheck(url, token) {
    try {
        const startTime = Date.now();
        await httpGet(url, token);
        const responseTime = Date.now() - startTime;
        
        return {
            status: 'healthy',
            responseTime,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Helper para sleep/delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parsea error de axios a formato simple
 */
function parseAxiosError(error) {
    if (error.response) {
        return {
            type: 'response',
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            message: `HTTP ${error.response.status}: ${error.response.statusText}`
        };
    } else if (error.request) {
        return {
            type: 'network',
            code: error.code,
            message: 'Error de red - no se pudo conectar'
        };
    } else {
        return {
            type: 'config',
            message: error.message
        };
    }
}

module.exports = {
    executeHttpRequest,
    executeWithRetry,
    isTokenValid,
    createAxiosConfig,
    formatAuthHeader,
    validateRequestParams,
    httpGet,
    httpPost,
    httpPut,
    httpDelete,
    healthCheck,
    sleep,
    parseAxiosError,
    DEFAULT_CONFIG
};