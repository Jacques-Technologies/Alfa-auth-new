// openaiService.js - Versión corregida con mejor diagnóstico y manejo de errores

const OpenAI = require('openai');
const { DateTime } = require('luxon');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { CardFactory } = require('botbuilder');
const { checkAuthenticationForTool } = require('../utilities/authenticationHelper');
require('dotenv').config();

/**
 * Servicio OpenAI corregido con mejor manejo de errores
 */
class OpenAIService {
    constructor() {
        this.initialized = false;
        this.initializationError = null;
        
        console.log('🚀 Inicializando OpenAI Service...');
        this.diagnoseConfiguration();
        this.initializeOpenAI();
        this.initializeAzureSearch();
        this.tools = this.defineTools();
        this.apiActions = this.defineApiActions();
        
        console.log(`✅ OpenAI Service inicializado - Disponible: ${this.openaiAvailable}`);
    }

    /**
     * Diagnostica la configuración antes de inicializar
     */
    diagnoseConfiguration() {
        console.log('🔍 Diagnosticando configuración...');
        
        // Verificar variables de entorno críticas
        const requiredEnvVars = {
            'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
            'SERVICE_ENDPOINT': process.env.SERVICE_ENDPOINT,
            'API_KEY': process.env.API_KEY,
            'INDEX_NAME': process.env.INDEX_NAME
        };

        console.log('📊 Estado de variables de entorno:');
        for (const [key, value] of Object.entries(requiredEnvVars)) {
            const status = value ? '✅ Configurada' : '❌ Faltante';
            const preview = value ? `(${value.substring(0, 10)}...)` : '(no configurada)';
            console.log(`   ${key}: ${status} ${preview}`);
        }

        // Verificar archivo .env
        try {
            const fs = require('fs');
            const path = require('path');
            const envPath = path.join(process.cwd(), '.env');
            
            if (fs.existsSync(envPath)) {
                console.log('✅ Archivo .env encontrado');
                const envContent = fs.readFileSync(envPath, 'utf8');
                const hasOpenAIKey = envContent.includes('OPENAI_API_KEY');
                console.log(`   OPENAI_API_KEY en .env: ${hasOpenAIKey ? '✅ Presente' : '❌ Ausente'}`);
            } else {
                console.log('⚠️ Archivo .env no encontrado en:', envPath);
            }
        } catch (error) {
            console.log('⚠️ Error verificando archivo .env:', error.message);
        }
    }

    /**
     * Inicializa cliente OpenAI con mejor manejo de errores
     */
    initializeOpenAI() {
        try {
            const apiKey = process.env.OPENAI_API_KEY;
            
            if (!apiKey) {
                this.initializationError = 'OPENAI_API_KEY no está configurada en las variables de entorno';
                console.error('❌ OpenAI Error:', this.initializationError);
                console.log('💡 Solución: Agrega OPENAI_API_KEY=tu_api_key_aqui en tu archivo .env');
                this.openaiAvailable = false;
                return;
            }

            if (apiKey.length < 20) {
                this.initializationError = 'OPENAI_API_KEY parece ser inválida (muy corta)';
                console.error('❌ OpenAI Error:', this.initializationError);
                this.openaiAvailable = false;
                return;
            }
            
            console.log('🔑 Inicializando cliente OpenAI...');
            this.openai = new OpenAI({ 
                apiKey: apiKey,
                timeout: 30000, // 30 segundos timeout
                maxRetries: 2
            });
            
            this.openaiAvailable = true;
            this.initialized = true;
            
            console.log('✅ Cliente OpenAI inicializado correctamente');
            console.log(`   API Key: ${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}`);
            
            // Hacer una prueba rápida
            this.testOpenAIConnection();
            
        } catch (error) {
            this.initializationError = `Error inicializando OpenAI: ${error.message}`;
            console.error('❌ Error inicializando OpenAI:', error);
            this.openaiAvailable = false;
        }
    }

    /**
     * Prueba la conexión con OpenAI
     */
    async testOpenAIConnection() {
        try {
            console.log('🧪 Probando conexión con OpenAI...');
            
            const testResponse = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: "Test" }],
                max_tokens: 5
            });
            
            if (testResponse && testResponse.choices && testResponse.choices[0]) {
                console.log('✅ Prueba de OpenAI exitosa');
                this.connectionTested = true;
            }
            
        } catch (error) {
            console.warn('⚠️ Prueba de OpenAI falló (pero continuando):', error.message);
            
            // Si es error de cuota o rate limit, aún marcar como disponible
            if (error.code === 'insufficient_quota' || error.code === 'rate_limit_exceeded') {
                console.log('💡 OpenAI está configurado correctamente, solo hay limitaciones de uso');
                this.openaiAvailable = true;
            } else {
                this.openaiAvailable = false;
                this.initializationError = `Falla en prueba de conexión: ${error.message}`;
            }
        }
    }

    /**
     * Inicializa Azure Search con mejor logging
     */
    initializeAzureSearch() {
        try {
            const serviceEndpoint = process.env.SERVICE_ENDPOINT;
            const apiKey = process.env.API_KEY;
            const indexName = process.env.INDEX_NAME || 'alfa_bot';
            
            if (!serviceEndpoint || !apiKey) {
                console.log('⚠️ Azure Search no configurado completamente');
                console.log(`   SERVICE_ENDPOINT: ${serviceEndpoint ? '✅' : '❌'}`);
                console.log(`   API_KEY: ${apiKey ? '✅' : '❌'}`);
                this.searchAvailable = false;
                return;
            }
            
            console.log('🔍 Inicializando Azure Search...');
            this.searchClient = new SearchClient(
                serviceEndpoint,
                indexName,
                new AzureKeyCredential(apiKey)
            );
            this.searchAvailable = true;
            console.log('✅ Cliente Azure Search inicializado');
            
        } catch (error) {
            console.error('❌ Error inicializando Azure Search:', error.message);
            this.searchAvailable = false;
        }
    }

    /**
     * Define herramientas disponibles (igual que antes)
     */
    defineTools() {
        const tools = [
            {
                type: "function",
                function: {
                    name: "FechaHoy",
                    description: "Devuelve la fecha actual en zona horaria de México",
                    parameters: { type: "object", properties: {} }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_vacaciones",
                    description: "Genera tarjeta para solicitar vacaciones regulares",
                    parameters: {
                        type: "object",
                        properties: {
                            tipo: {
                                type: "string",
                                enum: ["solicitar", "simular", "consultar"],
                                description: "Tipo de operación de vacaciones"
                            }
                        },
                        required: ["tipo"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_matrimonio",
                    description: "Genera tarjeta para vacaciones por matrimonio",
                    parameters: { type: "object", properties: {} }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_nacimiento", 
                    description: "Genera tarjeta para vacaciones por nacimiento",
                    parameters: { type: "object", properties: {} }
                }
            },
            {
                type: "function",
                function: {
                    name: "consultar_mis_solicitudes",
                    description: "Consulta las solicitudes de vacaciones del usuario, así como días disponibles de vacaciones adicionales",
                    parameters: { type: "object", properties: {} }
                }
            },
            {
                type: "function",
                function: {
                    name: "consultar_informacion_empleado",
                    description: "Consulta información completa del empleado incluyendo días de vacaciones disponibles, datos personales, información laboral y perfil del usuario. Usa esta herramienta cuando pregunten sobre datos del empleado, días disponibles, información personal o laboral.",
                    parameters: { type: "object", properties: {} }
                }
            }
        ];

        // Agregar búsqueda si está disponible
        if (this.searchAvailable) {
            tools.push({
                type: "function",
                function: {
                    name: "buscar_documentos",
                    description: "HERRAMIENTA PRINCIPAL - Busca información en documentos corporativos oficiales de Alfa. Úsala para: políticas, procedimientos, códigos de conducta, beneficios, prestaciones, reglamentos, normativas, manuales, guías y cualquier información corporativa. SIEMPRE usa esta herramienta antes de responder preguntas sobre la empresa.",
                    parameters: {
                        type: "object",
                        properties: {
                            consulta: {
                                type: "string",
                                description: "Texto a buscar en documentos (ej: 'código vestimenta', 'política vacaciones', 'horario trabajo', 'beneficios', etc.)"
                            }
                        },
                        required: ["consulta"]
                    }
                }
            });
        }

        // Agregar herramientas Bubble si están disponibles
        if (process.env.TOKEN_BUBBLE) {
            tools.push(
                {
                    type: "function",
                    function: {
                        name: "consultar_menu_comedor",
                        description: "Consulta el menú del comedor para un día específico",
                        parameters: {
                            type: "object",
                            properties: {
                                dia: {
                                    type: "string",
                                    description: "Día a consultar (YYYY-MM-DD)"
                                }
                            },
                            required: ["dia"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "buscar_empleado",
                        description: "Busca empleados en el directorio",
                        parameters: {
                            type: "object",
                            properties: {
                                nombre: { type: "string", description: "Nombre del empleado" },
                                apellido: { type: "string", description: "Apellido del empleado" }
                            },
                            required: ["nombre"]
                        }
                    }
                }
            );
        }

        return tools;
    }

    /**
     * Define acciones de API para tarjetas (igual que antes)
     */
    defineApiActions() {
        return {
            vacaciones: {
                solicitar: {
                    title: 'Solicitar Vacaciones',
                    description: 'Solicita vacaciones para un rango de fechas',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{fechaInicio}/{fechaFin}/{medioDia}/{simular}',
                    fields: [
                        { id: 'fechaInicio', type: 'date', label: 'Fecha de inicio', required: true },
                        { id: 'fechaFin', type: 'date', label: 'Fecha de fin', required: true },
                        { id: 'medioDia', type: 'choice', label: '¿Medio día?', value: 'false', choices: ['true', 'false'], required: true },
                        { id: 'simular', type: 'choice', label: '¿Solo simular?', value: 'true', choices: ['true', 'false'], required: true }
                    ],
                    icon: '🏖️'
                }
            },
            matrimonio: {
                solicitar: {
                    title: 'Vacaciones por Matrimonio',
                    description: 'Solicita vacaciones por matrimonio',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/matrimonio/{fechaMatrimonio}',
                    fields: [
                        { id: 'fechaMatrimonio', type: 'date', label: 'Fecha de Matrimonio', required: true }
                    ],
                    icon: '💍'
                }
            },
            nacimiento: {
                solicitar: {
                    title: 'Vacaciones por Nacimiento',
                    description: 'Solicita vacaciones por nacimiento',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/nacimiento/{fechaNacimiento}',
                    fields: [
                        { id: 'fechaNacimiento', type: 'date', label: 'Fecha de Nacimiento', required: true }
                    ],
                    icon: '👶'
                }
            }
        };
    }

    /**
     * Procesa mensaje con OpenAI - VERSIÓN CORREGIDA
     */
    async procesarMensaje(mensaje, historial = [], context = null, userId = null) {
        try {
            // Verificar disponibilidad con mejor diagnóstico
            if (!this.openaiAvailable) {
                return this.createUnavailableResponse();
            }

            if (!this.initialized) {
                console.warn('OpenAI no inicializado, reintentando...');
                this.initializeOpenAI();
                
                if (!this.openaiAvailable) {
                    return this.createUnavailableResponse();
                }
            }

            console.log('📝 Procesando mensaje con OpenAI...');
            
            const mensajes = this.formatearHistorial(historial);
            mensajes.push({ role: "user", content: mensaje });

            const requestConfig = {
                model: "gpt-4-turbo",
                messages: mensajes,
                temperature: 0.7,
                max_tokens: 3000  // Incrementar para permitir más resultados de búsqueda
            };

            // Agregar herramientas si no es comando básico
            if (!this.esComandoBasico(mensaje)) {
                requestConfig.tools = this.tools;
                requestConfig.tool_choice = "auto";
            }

            console.log('🤖 Enviando request a OpenAI...');
            const response = await this.openai.chat.completions.create(requestConfig);
            
            if (!response || !response.choices || response.choices.length === 0) {
                throw new Error('Respuesta vacía de OpenAI');
            }
            
            const messageResponse = response.choices[0].message;

            // Procesar llamadas a herramientas
            if (messageResponse.tool_calls) {
                console.log('🔧 Procesando herramientas...');
                return await this.procesarHerramientas(messageResponse, mensajes, context, userId);
            }

            console.log('✅ Respuesta de OpenAI recibida exitosamente');
            return {
                type: 'text',
                content: messageResponse.content || 'Respuesta vacía de OpenAI'
            };

        } catch (error) {
            console.error('❌ Error en procesarMensaje:', error);
            return this.manejarErrorOpenAI(error);
        }
    }

    /**
     * Crea respuesta cuando OpenAI no está disponible
     */
    createUnavailableResponse() {
        let message = '🚫 **El servicio de OpenAI no está disponible actualmente.**\n\n';
        
        if (this.initializationError) {
            message += `**Problema detectado**: ${this.initializationError}\n\n`;
        }
        
        message += '**Posibles soluciones:**\n';
        message += '• Verificar que OPENAI_API_KEY esté configurada\n';
        message += '• Verificar que el archivo .env existe y tiene la configuración correcta\n';
        message += '• Verificar que la API key de OpenAI sea válida\n';
        message += '• Contactar al administrador del sistema\n\n';
        
        message += '**Funciones disponibles sin IA:**\n';
        message += '• Escribir `login` para autenticarse\n';
        message += '• Escribir `logout` para cerrar sesión\n';
        message += '• Las tarjetas de solicitud seguirán funcionando\n';

        return {
            type: 'text',
            content: message
        };
    }

    /**
     * Verifica si es un comando básico del bot
     */
    esComandoBasico(mensaje) {
        const comandos = ['login', 'logout', 'ayuda', 'help'];
        return comandos.some(cmd => mensaje.toLowerCase().includes(cmd));
    }

    /**
     * Formatea historial para OpenAI
     */
    formatearHistorial(historial) {
        const mensajes = [{
            role: "system",
            content: `Eres un asistente corporativo para Alfa Corporativo. Ayudas con:

📚 INFORMACIÓN CORPORATIVA (PRIORIDAD):
- SIEMPRE busca primero en documentos corporativos antes de responder
- Usa buscar_documentos para políticas, procedimientos, beneficios, códigos de conducta, etc.
- Si alguien pregunta sobre cualquier tema corporativo, BUSCA en documentos primero
- No respondas de memoria, siempre verifica en documentos oficiales

🏖️ VACACIONES:
- Solicitar vacaciones regulares, por matrimonio o nacimiento
- Consultar estado de solicitudes
- Simular disponibilidad de días

👥 DIRECTORIO Y SERVICIOS:
- Buscar empleados en directorio
- Consultar menú del comedor

REGLAS IMPORTANTES:
1. Para CUALQUIER pregunta sobre políticas, procedimientos o información corporativa → USA buscar_documentos
2. Ejemplos donde DEBES buscar en documentos:
   - Código de vestimenta
   - Políticas de trabajo remoto
   - Beneficios y prestaciones
   - Procedimientos administrativos
   - Reglamentos internos
   - Horarios de trabajo
   - Políticas de vacaciones
   - Cualquier normativa corporativa
3. Solo responde sin buscar si es un saludo o pregunta personal
4. Si no encuentras información en documentos, indícalo claramente

Fecha actual: ${DateTime.now().setZone('America/Mexico_City').toFormat('dd/MM/yyyy')}`
        }];

        // Agregar ejemplo de uso correcto si el historial está vacío
        if (!historial || historial.length === 0) {
            mensajes.push(
                { role: "user", content: "¿Cuál es el código de vestimenta?" },
                { role: "assistant", content: "Voy a buscar la información sobre el código de vestimenta en los documentos oficiales.", tool_calls: [{
                    id: "example1",
                    type: "function",
                    function: { name: "buscar_documentos", arguments: JSON.stringify({ consulta: "código de vestimenta" }) }
                }]},
                { role: "tool", tool_call_id: "example1", content: "IT-AC-RH-01 Código de Vestimenta: Business casual de lunes a jueves, casual los viernes..." },
                { role: "assistant", content: "Según el documento oficial IT-AC-RH-01, el código de vestimenta en Alfa es:\n\n📋 **Lunes a Jueves**: Business casual\n👔 **Viernes**: Casual\n\nEl documento completo especifica los detalles sobre qué prendas son apropiadas para cada día." }
            );
        }
        
        // Agregar historial reciente (últimos 8 mensajes)
        if (historial && historial.length > 0) {
            const recientes = historial.slice(-8);
            recientes.forEach(item => {
                if (item.message && item.message.trim()) {
                    mensajes.push({
                        role: item.type === 'user' ? "user" : "assistant",
                        content: item.message
                    });
                }
            });
        }

        return mensajes;
    }

    /**
     * Procesa llamadas a herramientas (igual que antes pero con mejor logging)
     */
    async procesarHerramientas(messageResponse, mensajes, context = null, userId = null) {
        const resultados = [];

        console.log(`🔧 Procesando ${messageResponse.tool_calls.length} herramienta(s)...`);

        for (const call of messageResponse.tool_calls) {
            const { function: fnCall, id } = call;
            const { name, arguments: args } = fnCall;
            
            try {
                const parametros = JSON.parse(args);
                console.log(`🛠️ Ejecutando herramienta: ${name}`, parametros);
                
                const resultado = await this.ejecutarHerramienta(name, parametros, context, userId);
                
                // Manejar respuestas de autenticación
                if (resultado && resultado.type === 'card' && resultado.card) {
                    console.log('🔒 Retornando respuesta de autenticación');
                    return resultado;
                }
                
                if (resultado && resultado.type === 'text') {
                    console.log('🔒 Retornando mensaje de autenticación');
                    return resultado;
                }
                
                if (resultado && resultado.card) {
                    console.log('🃏 Retornando respuesta con tarjeta');
                    return {
                        type: 'card',
                        content: resultado.textContent || "Aquí tienes la acción solicitada:",
                        card: resultado.card
                    };
                }
                
                resultados.push({
                    tool_call_id: id,
                    content: typeof resultado === 'object' ? 
                        JSON.stringify(resultado, null, 2) : String(resultado)
                });
                
            } catch (error) {
                console.error(`❌ Error ejecutando herramienta ${name}:`, error);
                
                // Si es un error de token requerido, intentar generar card de login
                if (error.message === 'TOKEN_REQUIRED') {
                    console.log(`🔒 Token requerido para ${name}, generando card de login`);
                    const { generateLoginCard } = require('../utilities/authenticationHelper');
                    const loginCard = generateLoginCard(name);
                    return loginCard;
                }
                
                resultados.push({
                    tool_call_id: id,
                    content: `Error: ${error.message}`
                });
            }
        }

        // Obtener respuesta final del agente
        console.log('🤖 Obteniendo respuesta final de OpenAI...');
        const finalMessages = [
            ...mensajes,
            messageResponse,
            ...resultados.map(result => ({
                role: "tool",
                tool_call_id: result.tool_call_id,
                content: result.content
            }))
        ];

        const finalResponse = await this.openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: finalMessages,
            temperature: 0.7,
            max_tokens: 3000  // Incrementar para permitir más resultados de búsqueda
        });

        return {
            type: 'text',
            content: finalResponse.choices[0].message.content || 'Respuesta final vacía'
        };
    }

    /**
     * Ejecuta herramienta específica con validación de autenticación
     */
    async ejecutarHerramienta(nombre, parametros, context = null, userId = null) {
        console.log(`🔧 ejecutarHerramienta: ${nombre}, context: ${!!context}, userId: ${!!userId}`);
        
        // Validar autenticación si la herramienta la requiere
        if (context && userId) {
            const bot = global.botInstance;
            console.log(`🔧 Bot instance disponible: ${!!bot}`);
            console.log(`🔧 Métodos disponibles: getUserOAuthToken=${typeof bot.getUserOAuthToken}, isTokenValid=${typeof bot.isTokenValid}`);
            if (bot && typeof bot.getUserOAuthToken === 'function' && typeof bot.isTokenValid === 'function') {
                console.log(`🔧 Validando autenticación para herramienta: ${nombre}`);
                const authResult = await checkAuthenticationForTool(
                    nombre, 
                    context, 
                    userId, 
                    bot.getUserOAuthToken.bind(bot), 
                    bot.isTokenValid.bind(bot)
                );
                
                console.log(`🔧 Resultado de autenticación: canExecute=${authResult.canExecute}`);
                
                if (!authResult.canExecute) {
                    console.log(`🔒 Herramienta ${nombre} bloqueada por falta de autenticación`);
                    return authResult.response;
                }
            } else {
                console.log(`🔧 Bot instance no disponible o métodos faltantes`);
            }
        } else {
            console.log(`🔧 Context o userId no disponibles - saltando validación de auth`);
        }
        
        switch (nombre) {
            case 'FechaHoy':
                return DateTime.now().setZone('America/Mexico_City').toISODate();

            case 'generar_tarjeta_vacaciones':
                return this.generarTarjetaVacaciones(parametros.tipo);

            case 'generar_tarjeta_matrimonio':
                return this.generarTarjetaMatrimonio();

            case 'generar_tarjeta_nacimiento':
                return this.generarTarjetaNacimiento();

            case 'consultar_mis_solicitudes':
                return await this.consultarMisSolicitudes(context, userId);

            case 'consultar_informacion_empleado':
                return await this.consultarInformacionEmpleado(context, userId);

            case 'buscar_documentos':
                return await this.buscarEnDocumentos(parametros.consulta);

            case 'consultar_menu_comedor':
                return await this.consultarMenuComedor(parametros.dia);

            case 'buscar_empleado':
                return await this.buscarEmpleado(parametros.nombre, parametros.apellido);

            default:
                throw new Error(`Herramienta desconocida: ${nombre}`);
        }
    }

    /**
     * Métodos para generar tarjetas (iguales que antes)
     */
    generarTarjetaVacaciones(tipo) {
        // Clonar action para no modificar el original
        const action = JSON.parse(JSON.stringify(this.apiActions.vacaciones.solicitar));
        
        // Siempre simular primero (no mostrar la opción al usuario)
        action.fields = action.fields.filter(field => field.id !== 'simular');
        action.title = 'Solicitar Vacaciones';
        action.description = 'Ingresa las fechas para verificar disponibilidad';
        
        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `🏖️ **Solicitud de Vacaciones**\n\nIngresa las fechas para verificar disponibilidad:`,
            card: card
        };
    }

    generarTarjetaMatrimonio() {
        const action = this.apiActions.matrimonio.solicitar;
        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `💍 **Vacaciones por Matrimonio**\n\nSolicita tus días especiales:`,
            card: card
        };
    }

    generarTarjetaNacimiento() {
        const action = this.apiActions.nacimiento.solicitar;
        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `👶 **Vacaciones por Nacimiento**\n\nSolicita tus días de paternidad/maternidad:`,
            card: card
        };
    }

    /**
     * Consulta información completa del empleado
     * @param {Object} context - Contexto del bot
     * @param {string} userId - ID del usuario
     * @returns {string} - Información del empleado formateada
     */
    async consultarInformacionEmpleado(context, userId) {
        try {
            console.log('👤 Consultando información del empleado...');
            
            // Obtener token del usuario autenticado
            const bot = global.botInstance;
            let userToken = null;
            
            if (bot && typeof bot.getUserOAuthToken === 'function') {
                userToken = await bot.getUserOAuthToken(context, userId);
                console.log(`🔑 Token de usuario obtenido: ${userToken ? 'SÍ' : 'NO'}`);
            } else {
                console.error('❌ No se pudo obtener instancia del bot o método getUserOAuthToken');
            }
            
            if (!userToken) {
                // Si no hay token, devolver error simple para que el sistema de auth bajo demanda funcione
                throw new Error('TOKEN_REQUIRED');
            }
            
            const authHeader = `Bearer ${userToken}`;
            console.log(`📤 Authorization header: ${authHeader.substring(0, 30)}...`);
            
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
                {
                    headers: {
                        'Authorization': authHeader
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Respuesta exitosa de SIRH API (status: ${response.status})`);
            console.log(`📊 Datos del empleado recibidos:`, JSON.stringify(response.data, null, 2));
            
            // Formatear la información para una respuesta amigable
            const empleadoData = response.data;
            let infoFormateada = `👤 **Tu Información Personal**\n\n`;
            
            // Extraer información relevante usando los nombres correctos de la API
            if (empleadoData.nombreCompleto) {
                infoFormateada += `**Nombre**: ${empleadoData.nombreCompleto}\n`;
            }
            if (empleadoData.puesto) {
                infoFormateada += `**Puesto**: ${empleadoData.puesto}\n`;
            }
            if (empleadoData.numeroSocio) {
                infoFormateada += `**Número de empleado**: ${empleadoData.numeroSocio}\n`;
            }
            if (empleadoData.estatus) {
                infoFormateada += `**Estatus**: ${empleadoData.estatus}\n`;
            }
            if (empleadoData.mailAlfa) {
                infoFormateada += `**Email corporativo**: ${empleadoData.mailAlfa}\n`;
            }
            
            // INFORMACIÓN DE VACACIONES - Lo más importante
            infoFormateada += `\n🏖️ **INFORMACIÓN DE VACACIONES**\n`;
            if (empleadoData.diasDerechoVacaciones !== undefined) {
                infoFormateada += `• **Días de derecho**: ${empleadoData.diasDerechoVacaciones}\n`;
            }
            if (empleadoData.diasVacacionesSolicitados !== undefined) {
                infoFormateada += `• **Días solicitados**: ${empleadoData.diasVacacionesSolicitados}\n`;
            }
            if (empleadoData.diasVacacionesRestantes !== undefined) {
                infoFormateada += `• **Días restantes**: ${empleadoData.diasVacacionesRestantes}\n`;
            }
            if (empleadoData.diasDescanso !== undefined) {
                infoFormateada += `• **Días de descanso disponibles**: ${empleadoData.diasDescanso}\n`;
            }
            if (empleadoData.diasDescansoRestantes !== undefined) {
                infoFormateada += `• **Días de descanso restantes**: ${empleadoData.diasDescansoRestantes}\n`;
            }
            
            // FECHAS IMPORTANTES
            if (empleadoData.fechaInicio || empleadoData.fechaFin || empleadoData.fechaAntiguedadReconocida) {
                infoFormateada += `\n📅 **FECHAS IMPORTANTES**\n`;
                if (empleadoData.fechaAntiguedadReconocida) {
                    const fecha = new Date(empleadoData.fechaAntiguedadReconocida).toLocaleDateString('es-MX');
                    infoFormateada += `• **Antigüedad reconocida**: ${fecha}\n`;
                }
                if (empleadoData.fechaInicio) {
                    const fecha = new Date(empleadoData.fechaInicio).toLocaleDateString('es-MX');
                    infoFormateada += `• **Fecha de inicio actual**: ${fecha}\n`;
                }
                if (empleadoData.fechaFin) {
                    const fecha = new Date(empleadoData.fechaFin).toLocaleDateString('es-MX');
                    infoFormateada += `• **Fecha de fin**: ${fecha}\n`;
                }
            }
            
            // RESUMEN DE SOLICITUDES RECIENTES
            if (empleadoData.solicitudesHistorial && empleadoData.solicitudesHistorial.length > 0) {
                const solicitudesRecientes = empleadoData.solicitudesHistorial.slice(-3); // Últimas 3
                infoFormateada += `\n📋 **SOLICITUDES RECIENTES**\n`;
                solicitudesRecientes.forEach(solicitud => {
                    const fechaSalida = new Date(solicitud.fechaSalida).toLocaleDateString('es-MX');
                    const fechaRegreso = new Date(solicitud.fechaRegreso).toLocaleDateString('es-MX');
                    infoFormateada += `• **${solicitud.tipoSolicitud}** (${solicitud.cantidadDias} días): ${fechaSalida} - ${fechaRegreso} [${solicitud.estatus}]\n`;
                });
            }
            
            console.log(`📤 Información formateada que se retorna:`, infoFormateada);
            return infoFormateada;
            
        } catch (error) {
            console.error('❌ Error completo consultando información del empleado:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            // Si es un error de token requerido, re-lanzarlo para que el sistema de auth bajo demanda funcione
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            if (error.response?.status === 401) {
                return `❌ **Error de autenticación (401)**\n\n` +
                       `**Problema**: Token de usuario inválido o expirado\n` +
                       `**Solución**: Intenta hacer logout y login nuevamente`;
            }
            
            return `❌ Error al consultar información del empleado: ${error.message}`;
        }
    }

    async consultarMisSolicitudes(context, userId) {
        try {
            console.log('🏖️ Consultando solicitudes de vacaciones...');
            
            // Obtener token del usuario autenticado
            const bot = global.botInstance; // TeamsBot instance
            let userToken = null;
            
            if (bot && typeof bot.getUserOAuthToken === 'function') {
                userToken = await bot.getUserOAuthToken(context, userId);
                console.log(`🔑 Token de usuario obtenido: ${userToken ? 'SÍ' : 'NO'}`);
                console.log(`🔑 Token preview: ${userToken ? userToken.substring(0, 20) + '...' : 'N/A'}`);
            } else {
                console.error('❌ No se pudo obtener instancia del bot o método getUserOAuthToken');
            }
            
            if (!userToken) {
                // Si no hay token, devolver error simple para que el sistema de auth bajo demanda funcione
                throw new Error('TOKEN_REQUIRED');
            }
            
            const authHeader = `Bearer ${userToken}`;
            console.log(`📤 Authorization header: ${authHeader.substring(0, 30)}...`);
            
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
                {
                    headers: {
                        'Authorization': authHeader
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Respuesta exitosa de SIRH API (status: ${response.status})`);
            return `📋 **Mis Solicitudes de Vacaciones**\n\n${JSON.stringify(response.data, null, 2)}`;
            
        } catch (error) {
            console.error('❌ Error completo consultando solicitudes:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                headers: error.response?.headers
            });
            
            // Si es un error de token requerido, re-lanzarlo para que el sistema de auth bajo demanda funcione
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            if (error.response?.status === 401) {
                return `❌ **Error de autenticación (401)**\n\n` +
                       `**Problema**: Token de usuario inválido o expirado\n` +
                       `**Solución**: Intenta hacer logout y login nuevamente`;
            }
            
            return `❌ Error al consultar solicitudes: ${error.message}`;
        }
    }

    async buscarEnDocumentos(consulta) {
        try {
            if (!this.searchAvailable) {
                return "El servicio de búsqueda no está disponible.";
            }

            console.log(`🔍 Buscando: "${consulta}"`);

            const embedding = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: consulta,
                dimensions: 1024
            });
            
            console.log(`✅ Embedding creado con ${embedding.data[0].embedding.length} dimensiones`);
            
            const vectorQuery = {
                vector: embedding.data[0].embedding,
                kNearestNeighbors: 10,  // Incrementar para asegurar suficientes resultados
                fields: 'Embedding'
            };
            
            // Usar búsqueda híbrida (texto + vector) ya que los filtros de carpetas están desactualizados
            const searchResults = await this.searchClient.search(consulta, {
                vectorQueries: [vectorQuery],
                select: ['Chunk', 'FileName', 'Adicional'],
                top: 15,  // Incrementar aún más para obtener más resultados
                searchMode: 'any',  // Buscar cualquier palabra de la consulta
                queryType: 'full'   // Usar búsqueda completa
            });

            console.log('🔍 Procesando resultados...');
            const resultados = [];
            const documentosProcesados = new Set(); // Para evitar duplicados del mismo archivo
            
            for await (const result of searchResults.results) {
                const doc = result.document;
                console.log(`📄 Encontrado: ${doc.FileName} (score: ${result.score})`);
                
                // Limitar chunk a 300 caracteres para legibilidad
                const chunk = doc.Chunk?.substring(0, 300) + (doc.Chunk?.length > 300 ? '...' : '');
                
                // Crear clave única para el documento
                const documentKey = `${doc.FileName}-${doc.Chunk?.substring(0, 50)}`;
                
                // Solo agregar si no es un duplicado muy similar
                if (!documentosProcesados.has(documentKey)) {
                    documentosProcesados.add(documentKey);
                    resultados.push(`**${doc.FileName}** (Score: ${result.score?.toFixed(2) || 'N/A'})\n${chunk}`);
                }
                
                if (resultados.length >= 7) break;  // Limitar a exactamente 7 resultados
            }
            
            // Si no tenemos suficientes resultados únicos, intentar búsqueda más amplia
            if (resultados.length < 7) {
                console.log(`⚠️ Solo se encontraron ${resultados.length} resultados únicos, intentando búsqueda más amplia...`);
                
                // Búsqueda adicional con términos más amplios
                const palabrasConsulta = consulta.split(' ');
                if (palabrasConsulta.length > 1) {
                    const consultaAmplia = palabrasConsulta[0]; // Usar solo la primera palabra
                    console.log(`🔍 Búsqueda amplia con: "${consultaAmplia}"`);
                    
                    const searchResultsAmplia = await this.searchClient.search(consultaAmplia, {
                        select: ['Chunk', 'FileName', 'Adicional'],
                        top: 10,
                        searchMode: 'any'
                    });
                    
                    for await (const result of searchResultsAmplia.results) {
                        const doc = result.document;
                        const chunk = doc.Chunk?.substring(0, 300) + (doc.Chunk?.length > 300 ? '...' : '');
                        const documentKey = `${doc.FileName}-${doc.Chunk?.substring(0, 50)}`;
                        
                        if (!documentosProcesados.has(documentKey)) {
                            documentosProcesados.add(documentKey);
                            resultados.push(`**${doc.FileName}** (Score: ${result.score?.toFixed(2) || 'N/A'})\n${chunk}`);
                            console.log(`📄 Agregado desde búsqueda amplia: ${doc.FileName}`);
                        }
                        
                        if (resultados.length >= 7) break;
                    }
                }
            }
            
            console.log(`📊 Total resultados encontrados: ${resultados.length}`);
            console.log(`🎯 Meta: devolver 7 resultados, obtenidos: ${resultados.length}`);
            
            return resultados.length > 0 ? 
                `📚 **Resultados encontrados (${resultados.length}):**\n\n${resultados.join('\n\n---\n\n')}` :
                "No se encontraron documentos relevantes para tu consulta.";
                
        } catch (error) {
            console.error('Error en búsqueda:', error.message);
            console.error('Stack trace:', error.stack);
            return `Error en búsqueda: ${error.message}`;
        }
    }

    async consultarMenuComedor(dia) {
        try {
            if (!process.env.TOKEN_BUBBLE) {
                return "Servicio de comedor no disponible.";
            }

            const response = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/comedor',
                { dia },
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` },
                    timeout: 10000
                }
            );
            
            return `🍽️ **Menú del ${dia}**\n\n${JSON.stringify(response.data, null, 2)}`;
            
        } catch (error) {
            console.error('Error consultando menú:', error.message);
            return `Error consultando menú: ${error.message}`;
        }
    }

    async buscarEmpleado(nombre, apellido = '') {
        try {
            if (!process.env.TOKEN_BUBBLE) {
                return "Servicio de directorio no disponible.";
            }

            const response = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/directorio',
                { Nombre: nombre, Apellido: apellido },
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` },
                    timeout: 10000
                }
            );
            
            return `👥 **Empleado encontrado**\n\n${JSON.stringify(response.data, null, 2)}`;
            
        } catch (error) {
            console.error('Error buscando empleado:', error.message);
            return `Error buscando empleado: ${error.message}`;
        }
    }

    /**
     * Crea tarjeta adaptativa (igual que antes)
     */
    crearTarjetaAdaptativa(action) {
        const bodyElements = [
            {
                type: 'TextBlock',
                text: `${action.icon} ${action.title}`,
                size: 'Large',
                weight: 'Bolder',
                color: 'Accent',
                horizontalAlignment: 'Center'
            },
            {
                type: 'TextBlock',
                text: action.description,
                wrap: true,
                spacing: 'Medium'
            }
        ];

        if (action.fields) {
            action.fields.forEach(field => {
                bodyElements.push({
                    type: 'TextBlock',
                    text: `${field.label}${field.required ? ' *' : ''}:`,
                    weight: 'Bolder',
                    spacing: 'Medium'
                });

                bodyElements.push(this.crearElementoInput(field));
            });
        }

        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.3',
            body: bodyElements,
            actions: [{
                type: 'Action.Submit',
                title: `${action.icon} Ejecutar`,
                data: {
                    action: action.title,
                    method: action.method,
                    url: action.url
                },
                style: 'positive'
            }]
        };

        return CardFactory.adaptiveCard(card);
    }

    crearElementoInput(field) {
        const baseInput = {
            id: field.id,
            isRequired: field.required || false,
            spacing: 'Small'
        };

        if (field.type === 'date') {
            return {
                ...baseInput,
                type: 'Input.Date',
                placeholder: field.label
            };
        } else if (field.type === 'choice' && field.choices) {
            return {
                ...baseInput,
                type: 'Input.ChoiceSet',
                style: 'compact',
                value: field.value || field.choices[0],
                choices: field.choices.map(choice => ({ title: choice, value: choice }))
            };
        } else {
            return {
                ...baseInput,
                type: 'Input.Text',
                placeholder: field.label,
                value: field.value || ''
            };
        }
    }

    /**
     * Maneja errores de OpenAI con mejor información
     */
    manejarErrorOpenAI(error) {
        console.error('🚨 Error detallado de OpenAI:', {
            message: error.message,
            code: error.code,
            type: error.type,
            status: error.status
        });

        let message = '❌ **Error procesando con OpenAI**\n\n';

        if (error.code === 'rate_limit_exceeded') {
            message += '**Problema**: Límite de consultas excedido\n';
            message += '**Solución**: Espera un momento e intenta de nuevo\n';
        } else if (error.code === 'insufficient_quota') {
            message += '**Problema**: Cuota de OpenAI agotada\n';
            message += '**Solución**: Contacta al administrador para renovar la suscripción\n';
        } else if (error.code === 'invalid_api_key') {
            message += '**Problema**: API key de OpenAI inválida\n';
            message += '**Solución**: Verificar configuración de OPENAI_API_KEY\n';
        } else if (error.message && error.message.includes('timeout')) {
            message += '**Problema**: Timeout de conexión\n';
            message += '**Solución**: Intenta nuevamente en unos momentos\n';
        } else {
            message += `**Problema**: ${error.message}\n`;
            message += '**Solución**: Intenta nuevamente o contacta soporte\n';
        }

        message += '\n**Funciones alternativas disponibles:**\n';
        message += '• Las tarjetas de vacaciones siguen funcionando\n';
        message += '• Los comandos básicos (login/logout) funcionan\n';

        return {
            type: 'text',
            content: message
        };
    }

    /**
     * Método para diagnosticar estado actual
     */
    getDiagnosticInfo() {
        return {
            openaiAvailable: this.openaiAvailable,
            initialized: this.initialized,
            initializationError: this.initializationError,
            searchAvailable: this.searchAvailable,
            connectionTested: this.connectionTested || false,
            envVars: {
                hasOpenAIKey: !!process.env.OPENAI_API_KEY,
                hasServiceEndpoint: !!process.env.SERVICE_ENDPOINT,
                hasAPIKey: !!process.env.API_KEY,
                hasBubbleToken: !!process.env.TOKEN_BUBBLE,
                hasSIRHToken: !!process.env.TOKEN_SIRH
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Fuerza reinicialización
     */
    async forceReinitialize() {
        console.log('🔄 Forzando reinicialización de OpenAI Service...');
        
        this.initialized = false;
        this.openaiAvailable = false;
        this.initializationError = null;
        this.connectionTested = false;
        
        this.diagnoseConfiguration();
        this.initializeOpenAI();
        
        if (this.openaiAvailable) {
            await this.testOpenAIConnection();
        }
        
        console.log(`✅ Reinicialización completada - Disponible: ${this.openaiAvailable}`);
        
        return this.getDiagnosticInfo();
    }
}

module.exports = new OpenAIService();