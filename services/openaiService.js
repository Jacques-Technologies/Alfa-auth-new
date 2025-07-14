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
                                enum: ["solicitar", "verificar", "consultar"],
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
            },
            {
                type: "function",
                function: {
                    name: "cancelar_solicitud_vacaciones",
                    description: "USAR SIEMPRE que el usuario quiera cancelar, anular o eliminar una solicitud de vacaciones. Funciona con fechas como referencia. Ejemplos: 'cancelar solicitud', 'quiero cancelar mi solicitud del 22 de julio', 'eliminar mi solicitud de vacaciones'.",
                    parameters: {
                        type: "object",
                        properties: {
                            fechaReferencia: {
                                type: "string",
                                description: "Fecha de referencia mencionada por el usuario para identificar la solicitud (formato YYYY-MM-DD)"
                            },
                            idSolicitud: {
                                type: "string",
                                description: "ID específico de la solicitud a cancelar si se conoce"
                            }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "consultar_solicitudes_dependientes",
                    description: "Consulta las solicitudes de vacaciones pendientes de aprobación de tus reportes directos. Usar cuando pregunten sobre solicitudes para aprobar, solicitudes pendientes de sus empleados, o cuando necesiten revisar solicitudes como jefe/supervisor.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "autorizar_solicitud_dependiente",
                    description: "Autoriza/aprueba una solicitud de vacaciones de un reporte directo. Usar cuando el usuario quiera aprobar, autorizar o dar visto bueno a una solicitud.",
                    parameters: {
                        type: "object",
                        properties: {
                            idSolicitud: {
                                type: "string",
                                description: "ID de la solicitud a autorizar"
                            },
                            nombreEmpleado: {
                                type: "string",
                                description: "Nombre del empleado mencionado por el usuario para identificar la solicitud"
                            }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "rechazar_solicitud_dependiente",
                    description: "Rechaza/deniega una solicitud de vacaciones de un reporte directo. Usar cuando el usuario quiera rechazar, denegar o no aprobar una solicitud.",
                    parameters: {
                        type: "object",
                        properties: {
                            idSolicitud: {
                                type: "string",
                                description: "ID de la solicitud a rechazar"
                            },
                            nombreEmpleado: {
                                type: "string",
                                description: "Nombre del empleado mencionado por el usuario para identificar la solicitud"
                            }
                        }
                    }
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
                        { id: 'simular', type: 'choice', label: '¿Solo verificar?', value: 'true', choices: ['true', 'false'], required: true }
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
            console.log(`📬 Mensaje del usuario: "${mensaje}"`);
            
            const mensajes = this.formatearHistorial(historial);
            mensajes.push({ role: "user", content: mensaje });
            console.log(`📚 Total de mensajes enviados: ${mensajes.length}`);

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
                console.log(`🔧 Herramientas disponibles: ${this.tools.length}`);
                this.tools.forEach(tool => {
                    console.log(`  - ${tool.function.name}: ${tool.function.description}`);
                });
            } else {
                console.log('💬 Comando básico detectado, sin herramientas');
            }

            console.log('🤖 Enviando request a OpenAI...');
            const response = await this.openai.chat.completions.create(requestConfig);
            
            if (!response || !response.choices || response.choices.length === 0) {
                throw new Error('Respuesta vacía de OpenAI');
            }
            
            const messageResponse = response.choices[0].message;

            // Procesar llamadas a herramientas
            if (messageResponse.tool_calls) {
                console.log(`🔧 OpenAI quiere ejecutar ${messageResponse.tool_calls.length} herramienta(s):`);
                messageResponse.tool_calls.forEach(call => {
                    console.log(`  - ${call.function.name} con argumentos: ${call.function.arguments}`);
                });
                return await this.procesarHerramientas(messageResponse, mensajes, context, userId);
            } else {
                console.log('ℹ️ OpenAI no solicitó ejecutar herramientas');
            }

            console.log('✅ Respuesta de OpenAI recibida exitosamente');
            console.log(`💬 Respuesta: ${messageResponse.content ? messageResponse.content.substring(0, 200) + '...' : 'Sin contenido'}`);
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
- Verificar disponibilidad de días

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
                    console.log('🔒 Retornando tarjeta de autenticación');
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
        // Validar autenticación si la herramienta la requiere
        if (context && userId) {
            const bot = global.botInstance;
            if (bot && typeof bot.getUserOAuthToken === 'function' && typeof bot.isTokenValid === 'function') {
                const authResult = await checkAuthenticationForTool(
                    nombre, 
                    context, 
                    userId, 
                    bot.getUserOAuthToken.bind(bot), 
                    bot.isTokenValid.bind(bot)
                );
                
                if (!authResult.canExecute) {
                    console.log(`🔒 Herramienta ${nombre} requiere autenticación - activando OAuth`);
                    return authResult.response;
                }
            }
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

            case 'cancelar_solicitud_vacaciones':
                console.log(`🗑️ Ejecutando cancelar_solicitud_vacaciones con parámetros:`, parametros);
                return await this.cancelarSolicitudVacaciones(parametros, context, userId);

            case 'consultar_solicitudes_dependientes':
                console.log(`📊 Ejecutando consultar_solicitudes_dependientes`);
                return await this.consultarSolicitudesDependientes(context, userId);

            case 'autorizar_solicitud_dependiente':
                console.log(`✅ Ejecutando autorizar_solicitud_dependiente con parámetros:`, parametros);
                return await this.autorizarSolicitudDependiente(parametros, context, userId);

            case 'rechazar_solicitud_dependiente':
                console.log(`❌ Ejecutando rechazar_solicitud_dependiente con parámetros:`, parametros);
                return await this.rechazarSolicitudDependiente(parametros, context, userId);

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
        
        // Siempre verificar disponibilidad primero (no mostrar la opción al usuario)
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
            
            // Crear tarjeta con tabla de solicitudes
            const solicitudesCard = this.crearTarjetaSolicitudes(response.data);
            
            return {
                textContent: `📋 **Mis Solicitudes de Vacaciones**\n\nAquí tienes el resumen de tus solicitudes:`,
                card: solicitudesCard
            };
            
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

    /**
     * Crea tarjeta adaptativa con tabla de solicitudes de vacaciones
     */
    crearTarjetaSolicitudes(solicitudes) {
        // Procesar datos de solicitudes
        const solicitudesProcessed = solicitudes.map(solicitud => {
            // Formatear fechas
            const fechaSalida = new Date(solicitud.fechaSalida).toLocaleDateString('es-MX', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            const fechaRegreso = new Date(solicitud.fechaRegreso).toLocaleDateString('es-MX', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            
            // Determinar color del estado
            let colorEstado = 'default';
            let iconoEstado = '⏳';
            
            if (solicitud.estatus === 'AUTORIZADA') {
                colorEstado = 'good';
                iconoEstado = '✅';
            } else if (solicitud.estatus === 'PENDIENTE') {
                colorEstado = 'attention';
                iconoEstado = '⏳';
            } else if (solicitud.estatus === 'RECHAZADA') {
                colorEstado = 'danger';
                iconoEstado = '❌';
            }
            
            return {
                tipo: solicitud.tipoSolicitud,
                fechaSalida,
                fechaRegreso,
                dias: solicitud.cantidadDias,
                estatus: solicitud.estatus,
                colorEstado,
                iconoEstado
            };
        });

        // Crear elementos de la tabla
        const tablaItems = [];
        
        // Encabezado
        tablaItems.push({
            type: 'ColumnSet',
            columns: [
                {
                    type: 'Column',
                    width: 'stretch',
                    items: [{
                        type: 'TextBlock',
                        text: '**Tipo**',
                        size: 'small',
                        weight: 'bolder'
                    }]
                },
                {
                    type: 'Column',
                    width: 'stretch',
                    items: [{
                        type: 'TextBlock',
                        text: '**Fechas**',
                        size: 'small',
                        weight: 'bolder'
                    }]
                },
                {
                    type: 'Column',
                    width: 'auto',
                    items: [{
                        type: 'TextBlock',
                        text: '**Días**',
                        size: 'small',
                        weight: 'bolder'
                    }]
                },
                {
                    type: 'Column',
                    width: 'auto',
                    items: [{
                        type: 'TextBlock',
                        text: '**Estado**',
                        size: 'small',
                        weight: 'bolder'
                    }]
                }
            ]
        });

        // Separador
        tablaItems.push({
            type: 'TextBlock',
            text: '___',
            spacing: 'small'
        });

        // Filas de datos
        solicitudesProcessed.forEach(solicitud => {
            tablaItems.push({
                type: 'ColumnSet',
                columns: [
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [{
                            type: 'TextBlock',
                            text: solicitud.tipo,
                            size: 'small',
                            wrap: true
                        }]
                    },
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [{
                            type: 'TextBlock',
                            text: `${solicitud.fechaSalida}\n${solicitud.fechaRegreso}`,
                            size: 'small',
                            wrap: true
                        }]
                    },
                    {
                        type: 'Column',
                        width: 'auto',
                        items: [{
                            type: 'TextBlock',
                            text: `${solicitud.dias}`,
                            size: 'small',
                            horizontalAlignment: 'center'
                        }]
                    },
                    {
                        type: 'Column',
                        width: 'auto',
                        items: [{
                            type: 'TextBlock',
                            text: `${solicitud.iconoEstado} ${solicitud.estatus}`,
                            size: 'small',
                            color: solicitud.colorEstado,
                            horizontalAlignment: 'center'
                        }]
                    }
                ],
                spacing: 'small'
            });
        });

        // Resumen estadístico
        const autorizadas = solicitudesProcessed.filter(s => s.estatus === 'AUTORIZADA').length;
        const pendientes = solicitudesProcessed.filter(s => s.estatus === 'PENDIENTE').length;
        const rechazadas = solicitudesProcessed.filter(s => s.estatus === 'RECHAZADA').length;

        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.3',
            body: [
                {
                    type: 'TextBlock',
                    text: '📋 Mis Solicitudes de Vacaciones',
                    size: 'large',
                    weight: 'bolder',
                    color: 'accent'
                },
                ...tablaItems,
                {
                    type: 'TextBlock',
                    text: '___',
                    spacing: 'medium'
                },
                {
                    type: 'ColumnSet',
                    columns: [
                        {
                            type: 'Column',
                            width: 'stretch',
                            items: [{
                                type: 'TextBlock',
                                text: `**Resumen:** ${solicitudesProcessed.length} solicitudes`,
                                size: 'small',
                                weight: 'bolder'
                            }]
                        },
                        {
                            type: 'Column',
                            width: 'auto',
                            items: [{
                                type: 'TextBlock',
                                text: `✅ ${autorizadas} | ⏳ ${pendientes} | ❌ ${rechazadas}`,
                                size: 'small',
                                horizontalAlignment: 'right'
                            }]
                        }
                    ]
                }
            ]
        };

        return CardFactory.adaptiveCard(card);
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
     * Cancela una solicitud de vacaciones específica
     * @param {Object} parametros - Parámetros de la función
     * @param {Object} context - Contexto del bot
     * @param {string} userId - ID del usuario
     * @returns {string} - Resultado de la cancelación
     */
    async cancelarSolicitudVacaciones(parametros, context, userId) {
        try {
            console.log('🗑️ Cancelando solicitud de vacaciones...', parametros);
            
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
                throw new Error('TOKEN_REQUIRED');
            }
            
            let idSolicitud = parametros.idSolicitud;
            
            // Si no se proporcionó ID, buscar por fecha de referencia
            if (!idSolicitud && parametros.fechaReferencia) {
                console.log(`🔍 Buscando solicitud por fecha de referencia: ${parametros.fechaReferencia}`);
                idSolicitud = await this.buscarSolicitudPorFecha(parametros.fechaReferencia, userToken);
            }
            
            // Si aún no tenemos ID, consultar todas las solicitudes
            if (!idSolicitud) {
                console.log('📋 Consultando todas las solicitudes para encontrar la correcta...');
                const solicitudes = await this.obtenerSolicitudesUsuario(userToken);
                
                if (solicitudes.length === 0) {
                    return '❌ **No tienes solicitudes de vacaciones para cancelar**';
                }
                
                if (solicitudes.length === 1) {
                    idSolicitud = solicitudes[0].id;
                    console.log(`✅ Solo una solicitud encontrada, usando ID: ${idSolicitud}`);
                } else {
                    // Múltiples solicitudes - mostrar lista para que el usuario elija
                    let listaSolicitudes = '📋 **Tienes varias solicitudes de vacaciones:**\n\n';
                    solicitudes.forEach((solicitud, index) => {
                        const fechaSalida = new Date(solicitud.fechaSalida).toLocaleDateString('es-MX');
                        const fechaRegreso = new Date(solicitud.fechaRegreso).toLocaleDateString('es-MX');
                        listaSolicitudes += `${index + 1}. **${fechaSalida} - ${fechaRegreso}** (${solicitud.diasSolicitados} días) - ${solicitud.estado}\n`;
                    });
                    listaSolicitudes += '\n💡 **Especifica las fechas** de la solicitud que deseas cancelar (ejemplo: "cancelar mi solicitud del 15 de enero")';
                    
                    return listaSolicitudes;
                }
            }
            
            if (!idSolicitud) {
                return '❌ **No se pudo identificar la solicitud a cancelar**\n\n' +
                       '💡 Especifica las fechas de la solicitud que deseas cancelar';
            }
            
            // Realizar la cancelación
            console.log(`📤 Enviando petición de cancelación para solicitud ID: ${idSolicitud}`);
            const authHeader = `Bearer ${userToken}`;
            const cancelUrl = `https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/${idSolicitud}/cancelar`;
            console.log(`🎯 URL de cancelación: ${cancelUrl}`);
            
            const response = await axios.put(
                cancelUrl,
                {},
                {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Solicitud cancelada exitosamente (status: ${response.status})`);
            console.log(`📊 Respuesta de cancelación:`, JSON.stringify(response.data, null, 2));
            
            // Formatear respuesta
            if (response.data && response.data.message) {
                return `✅ **Solicitud cancelada exitosamente**\n\n${response.data.message}`;
            } else {
                return `✅ **Solicitud cancelada exitosamente**\n\nTu solicitud de vacaciones ha sido cancelada.`;
            }
            
        } catch (error) {
            console.error('❌ Error cancelando solicitud:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                config: {
                    method: error.config?.method,
                    url: error.config?.url,
                    headers: error.config?.headers ? 'INCLUIDOS' : 'NO INCLUIDOS'
                }
            });
            
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            if (error.response?.status === 400) {
                const errorData = error.response.data;
                let errorMessage = `❌ **No se puede cancelar la solicitud**\n\n`;
                
                if (errorData && errorData.message) {
                    errorMessage += `**Razón**: ${errorData.message}\n\n`;
                    
                    // Agregar información contextual basada en el mensaje
                    if (errorData.message.includes('autorizada')) {
                        errorMessage += `📝 **Explicación**: Las solicitudes autorizadas no pueden ser canceladas por el sistema.\n\n`;
                        errorMessage += `📞 **Solución**: Contacta directamente a Recursos Humanos para solicitar la cancelación.\n\n`;
                        errorMessage += `📊 **Tip**: Puedes consultar tus solicitudes para ver cuáles están pendientes y pueden ser canceladas.`;
                    }
                } else {
                    errorMessage += `**Razón**: Datos inválidos en la petición\n\n`;
                    errorMessage += `**Posibles causas**:\n`;
                    errorMessage += `• La solicitud no puede ser cancelada (ya procesada, muy próxima, etc.)\n`;
                    errorMessage += `• El ID de la solicitud es inválido\n`;
                    errorMessage += `• La fecha de cancelación ha expirado\n\n`;
                    errorMessage += `**Solución**: Contacta a Recursos Humanos para ayuda`;
                }
                
                return errorMessage;
            }
            
            if (error.response?.status === 401) {
                return `❌ **Error de autenticación (401)**\n\n` +
                       `**Problema**: Token de usuario inválido o expirado\n` +
                       `**Solución**: Intenta hacer logout y login nuevamente`;
            }
            
            if (error.response?.status === 404) {
                return `❌ **Solicitud no encontrada (404)**\n\n` +
                       `La solicitud que intentas cancelar no existe o ya fue procesada.`;
            }
            
            return `❌ **Error al cancelar solicitud**: ${error.message}`;
        }
    }
    
    /**
     * Busca una solicitud por fecha de referencia
     * @param {string} fechaReferencia - Fecha de referencia
     * @param {string} userToken - Token del usuario
     * @returns {string|null} - ID de la solicitud o null
     */
    async buscarSolicitudPorFecha(fechaReferencia, userToken) {
        try {
            console.log(`🔍 Obteniendo solicitudes para buscar por fecha: ${fechaReferencia}`);
            const solicitudes = await this.obtenerSolicitudesUsuario(userToken);
            console.log(`📋 Total de solicitudes encontradas: ${solicitudes.length}`);
            
            if (solicitudes.length === 0) {
                console.log('⚠️ No hay solicitudes para buscar');
                return null;
            }
            
            // Mostrar todas las solicitudes para debugging
            solicitudes.forEach((solicitud, index) => {
                console.log(`📝 Solicitud ${index + 1}:`, {
                    id: solicitud.id,
                    fechaSalida: solicitud.fechaSalida,
                    fechaRegreso: solicitud.fechaRegreso,
                    estado: solicitud.estado
                });
            });
            
            // Buscar solicitud que contenga la fecha de referencia
            const fechaRef = new Date(fechaReferencia);
            console.log(`🎯 Buscando solicitud que contenga la fecha: ${fechaRef.toISOString()}`);
            
            // Encontrar todas las solicitudes que contengan la fecha
            const solicitudesEncontradas = solicitudes.filter(solicitud => {
                const fechaSalida = new Date(solicitud.fechaSalida);
                const fechaRegreso = new Date(solicitud.fechaRegreso);
                
                const enRango = fechaRef >= fechaSalida && fechaRef <= fechaRegreso;
                
                console.log(`🔍 Comparando con solicitud ${solicitud.id}:`, {
                    tipo: solicitud.tipoSolicitud,
                    estatus: solicitud.estatus,
                    fechaSalida: fechaSalida.toISOString(),
                    fechaRegreso: fechaRegreso.toISOString(),
                    enRango: enRango
                });
                
                return enRango;
            });
            
            console.log(`📊 Solicitudes encontradas para la fecha: ${solicitudesEncontradas.length}`);
            
            if (solicitudesEncontradas.length === 0) {
                console.log('❌ No se encontraron solicitudes para la fecha especificada');
                return null;
            }
            
            // Priorizar solicitudes PENDIENTES sobre AUTORIZADAS
            const solicitudPendiente = solicitudesEncontradas.find(s => s.estatus === 'PENDIENTE');
            const solicitudEncontrada = solicitudPendiente || solicitudesEncontradas[0];
            
            console.log(`🎯 Solicitud seleccionada:`, {
                id: solicitudEncontrada.id,
                tipo: solicitudEncontrada.tipoSolicitud,
                estatus: solicitudEncontrada.estatus,
                razon: solicitudPendiente ? 'Seleccionada por ser PENDIENTE' : 'Primera encontrada'
            });
            
            if (solicitudEncontrada) {
                console.log(`✅ Solicitud encontrada: ${solicitudEncontrada.id}`);
                return solicitudEncontrada.id;
            } else {
                console.log('❌ No se encontró solicitud para la fecha especificada');
                return null;
            }
            
        } catch (error) {
            console.error('❌ Error buscando solicitud por fecha:', error.message);
            return null;
        }
    }
    
    /**
     * Obtiene todas las solicitudes del usuario
     * @param {string} userToken - Token del usuario
     * @returns {Array} - Lista de solicitudes
     */
    async obtenerSolicitudesUsuario(userToken) {
        try {
            console.log('📡 Consultando solicitudes del usuario...');
            const authHeader = `Bearer ${userToken}`;
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
                {
                    headers: {
                        'Authorization': authHeader
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Respuesta de API de solicitudes (status: ${response.status})`);
            console.log(`📊 Datos recibidos:`, JSON.stringify(response.data, null, 2));
            
            return response.data || [];
            
        } catch (error) {
            console.error('❌ Error obteniendo solicitudes:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            return [];
        }
    }

    /**
     * Consulta solicitudes pendientes de aprobación de dependientes
     * @param {Object} context - Contexto del bot
     * @param {string} userId - ID del usuario
     * @returns {Object} - Resultado con tarjeta de solicitudes dependientes
     */
    async consultarSolicitudesDependientes(context, userId) {
        try {
            console.log('📈 Consultando solicitudes de dependientes...');
            
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
                throw new Error('TOKEN_REQUIRED');
            }
            
            const authHeader = `Bearer ${userToken}`;
            console.log(`📡 Consultando solicitudes de dependientes...`);
            
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/dependientes',
                {
                    headers: {
                        'Authorization': authHeader
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Respuesta de API de dependientes (status: ${response.status})`);
            console.log(`📊 Datos recibidos:`, JSON.stringify(response.data, null, 2));
            
            if (!response.data || response.data.length === 0) {
                return `📊 **No tienes solicitudes pendientes de aprobación**\n\n` +
                       `ℹ️ No hay solicitudes de vacaciones de tus reportes directos esperando tu aprobación.`;
            }
            
            // Crear tarjeta con tabla de solicitudes dependientes
            const solicitudesCard = this.crearTarjetaSolicitudesDependientes(response.data);
            
            return {
                textContent: `📈 **Solicitudes Pendientes de Aprobación**\n\nTus reportes directos tienen las siguientes solicitudes esperando tu decisión:`,
                card: solicitudesCard
            };
            
        } catch (error) {
            console.error('❌ Error consultando solicitudes de dependientes:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            if (error.response?.status === 401) {
                return `❌ **Error de autenticación (401)**\n\n` +
                       `**Problema**: Token de usuario inválido o expirado\n` +
                       `**Solución**: Intenta hacer logout y login nuevamente`;
            }
            
            if (error.response?.status === 403) {
                return `❌ **Sin permisos (403)**\n\n` +
                       `**Problema**: No tienes permisos para consultar solicitudes de dependientes\n` +
                       `**Posible causa**: No eres supervisor o jefe de área`;
            }
            
            return `❌ **Error al consultar solicitudes de dependientes**: ${error.message}`;
        }
    }

    /**
     * Autoriza una solicitud de vacaciones de un dependiente
     * @param {Object} parametros - Parámetros de la función
     * @param {Object} context - Contexto del bot
     * @param {string} userId - ID del usuario
     * @returns {string} - Resultado de la autorización
     */
    async autorizarSolicitudDependiente(parametros, context, userId) {
        try {
            console.log('✅ Autorizando solicitud de dependiente...', parametros);
            
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
                throw new Error('TOKEN_REQUIRED');
            }
            
            let idSolicitud = parametros.idSolicitud;
            
            // Si no se proporcionó ID, buscar por nombre del empleado
            if (!idSolicitud && parametros.nombreEmpleado) {
                console.log(`🔍 Buscando solicitud por nombre: ${parametros.nombreEmpleado}`);
                idSolicitud = await this.buscarSolicitudDependientePorNombre(parametros.nombreEmpleado, userToken);
            }
            
            if (!idSolicitud) {
                return `❌ **No se pudo identificar la solicitud a autorizar**\n\n` +
                       `💡 Especifica el ID de la solicitud o el nombre del empleado`;
            }
            
            // Realizar la autorización
            console.log(`📤 Enviando autorización para solicitud ID: ${idSolicitud}`);
            const authHeader = `Bearer ${userToken}`;
            const autorizarUrl = `https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/${idSolicitud}/autorizar`;
            console.log(`🎯 URL de autorización: ${autorizarUrl}`);
            
            const response = await axios.put(
                autorizarUrl,
                {},
                {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Solicitud autorizada exitosamente (status: ${response.status})`);
            console.log(`📊 Respuesta de autorización:`, JSON.stringify(response.data, null, 2));
            
            // Formatear respuesta
            if (response.data && response.data.message) {
                return `✅ **Solicitud autorizada exitosamente**\n\n${response.data.message}`;
            } else {
                return `✅ **Solicitud autorizada exitosamente**\n\nLa solicitud de vacaciones ha sido aprobada.`;
            }
            
        } catch (error) {
            console.error('❌ Error autorizando solicitud:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            return this.manejarErrorAprobacion(error, 'autorizar');
        }
    }

    /**
     * Rechaza una solicitud de vacaciones de un dependiente
     * @param {Object} parametros - Parámetros de la función
     * @param {Object} context - Contexto del bot
     * @param {string} userId - ID del usuario
     * @returns {string} - Resultado del rechazo
     */
    async rechazarSolicitudDependiente(parametros, context, userId) {
        try {
            console.log('❌ Rechazando solicitud de dependiente...', parametros);
            
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
                throw new Error('TOKEN_REQUIRED');
            }
            
            let idSolicitud = parametros.idSolicitud;
            
            // Si no se proporcionó ID, buscar por nombre del empleado
            if (!idSolicitud && parametros.nombreEmpleado) {
                console.log(`🔍 Buscando solicitud por nombre: ${parametros.nombreEmpleado}`);
                idSolicitud = await this.buscarSolicitudDependientePorNombre(parametros.nombreEmpleado, userToken);
            }
            
            if (!idSolicitud) {
                return `❌ **No se pudo identificar la solicitud a rechazar**\n\n` +
                       `💡 Especifica el ID de la solicitud o el nombre del empleado`;
            }
            
            // Realizar el rechazo
            console.log(`📤 Enviando rechazo para solicitud ID: ${idSolicitud}`);
            const authHeader = `Bearer ${userToken}`;
            const rechazarUrl = `https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/${idSolicitud}/rechazar`;
            console.log(`🎯 URL de rechazo: ${rechazarUrl}`);
            
            const response = await axios.put(
                rechazarUrl,
                {},
                {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`✅ Solicitud rechazada exitosamente (status: ${response.status})`);
            console.log(`📊 Respuesta de rechazo:`, JSON.stringify(response.data, null, 2));
            
            // Formatear respuesta
            if (response.data && response.data.message) {
                return `❌ **Solicitud rechazada**\n\n${response.data.message}`;
            } else {
                return `❌ **Solicitud rechazada**\n\nLa solicitud de vacaciones ha sido rechazada.`;
            }
            
        } catch (error) {
            console.error('❌ Error rechazando solicitud:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            if (error.message === 'TOKEN_REQUIRED') {
                throw error;
            }
            
            return this.manejarErrorAprobacion(error, 'rechazar');
        }
    }

    /**
     * Busca una solicitud de dependiente por nombre del empleado
     * @param {string} nombreEmpleado - Nombre del empleado
     * @param {string} userToken - Token del usuario
     * @returns {string|null} - ID de la solicitud o null
     */
    async buscarSolicitudDependientePorNombre(nombreEmpleado, userToken) {
        try {
            console.log(`🔍 Buscando solicitud de dependiente por nombre: ${nombreEmpleado}`);
            
            const authHeader = `Bearer ${userToken}`;
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/dependientes',
                {
                    headers: {
                        'Authorization': authHeader
                    },
                    timeout: 10000
                }
            );
            
            const solicitudes = response.data || [];
            console.log(`📊 Solicitudes de dependientes encontradas: ${solicitudes.length}`);
            
            // Buscar por nombre (comparación flexible)
            const solicitudEncontrada = solicitudes.find(solicitud => 
                solicitud.nombreSocio && 
                solicitud.nombreSocio.toLowerCase().includes(nombreEmpleado.toLowerCase())
            );
            
            if (solicitudEncontrada) {
                console.log(`✅ Solicitud encontrada: ${solicitudEncontrada.id} para ${solicitudEncontrada.nombreSocio}`);
                return solicitudEncontrada.id;
            } else {
                console.log(`❌ No se encontró solicitud para el empleado: ${nombreEmpleado}`);
                return null;
            }
            
        } catch (error) {
            console.error('❌ Error buscando solicitud por nombre:', error.message);
            return null;
        }
    }

    /**
     * Maneja errores de aprobación/rechazo
     * @param {Error} error - Error ocurrido
     * @param {string} accion - Acción que se estaba realizando
     * @returns {string} - Mensaje de error formateado
     */
    manejarErrorAprobacion(error, accion) {
        if (error.response?.status === 400) {
            const errorData = error.response.data;
            let errorMessage = `❌ **No se puede ${accion} la solicitud**\n\n`;
            
            if (errorData && errorData.message) {
                errorMessage += `**Razón**: ${errorData.message}\n\n`;
            }
            
            errorMessage += `**Posibles causas**:\n`;
            errorMessage += `• La solicitud ya fue procesada\n`;
            errorMessage += `• No tienes permisos para ${accion} esta solicitud\n`;
            errorMessage += `• La solicitud no está en estado pendiente\n\n`;
            errorMessage += `**Solución**: Verifica el estado de la solicitud`;
            
            return errorMessage;
        }
        
        if (error.response?.status === 401) {
            return `❌ **Error de autenticación (401)**\n\n` +
                   `**Problema**: Token de usuario inválido o expirado\n` +
                   `**Solución**: Intenta hacer logout y login nuevamente`;
        }
        
        if (error.response?.status === 403) {
            return `❌ **Sin permisos (403)**\n\n` +
                   `**Problema**: No tienes permisos para ${accion} esta solicitud\n` +
                   `**Posible causa**: No eres el supervisor directo del empleado`;
        }
        
        if (error.response?.status === 404) {
            return `❌ **Solicitud no encontrada (404)**\n\n` +
                   `La solicitud que intentas ${accion} no existe o ya fue procesada.`;
        }
        
        return `❌ **Error al ${accion} solicitud**: ${error.message}`;
    }

    /**
     * Crea tarjeta adaptativa con tabla de solicitudes de dependientes
     * @param {Array} solicitudes - Lista de solicitudes
     * @returns {Object} - Tarjeta adaptativa
     */
    crearTarjetaSolicitudesDependientes(solicitudes) {
        const { CardFactory } = require('botbuilder');
        
        // Crear filas de la tabla
        const filas = solicitudes.map(solicitud => {
            const fechaSalida = new Date(solicitud.fechaSalida).toLocaleDateString('es-MX', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            const fechaRegreso = new Date(solicitud.fechaRegreso).toLocaleDateString('es-MX', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            
            return {
                type: 'TableRow',
                cells: [
                    {
                        type: 'TableCell',
                        items: [{
                            type: 'TextBlock',
                            text: solicitud.nombreSocio || 'N/A',
                            size: 'Small',
                            weight: 'Bolder'
                        }]
                    },
                    {
                        type: 'TableCell',
                        items: [{
                            type: 'TextBlock',
                            text: solicitud.tipoSolicitud || 'Vacaciones',
                            size: 'Small'
                        }]
                    },
                    {
                        type: 'TableCell',
                        items: [{
                            type: 'TextBlock',
                            text: `${fechaSalida} - ${fechaRegreso}`,
                            size: 'Small'
                        }]
                    },
                    {
                        type: 'TableCell',
                        items: [{
                            type: 'TextBlock',
                            text: `${solicitud.cantidadDias} días`,
                            size: 'Small',
                            horizontalAlignment: 'Center'
                        }]
                    },
                    {
                        type: 'TableCell',
                        items: [{
                            type: 'ActionSet',
                            actions: [
                                {
                                    type: 'Action.Submit',
                                    title: '✅ Aprobar',
                                    data: {
                                        action: 'autorizar_solicitud',
                                        idSolicitud: solicitud.id,
                                        nombreEmpleado: solicitud.nombreSocio
                                    },
                                    style: 'positive'
                                },
                                {
                                    type: 'Action.Submit',
                                    title: '❌ Rechazar',
                                    data: {
                                        action: 'rechazar_solicitud',
                                        idSolicitud: solicitud.id,
                                        nombreEmpleado: solicitud.nombreSocio
                                    },
                                    style: 'destructive'
                                }
                            ]
                        }]
                    }
                ]
            };
        });
        
        const adaptiveCard = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.3',
            body: [
                {
                    type: 'TextBlock',
                    text: '📈 Solicitudes Pendientes de Aprobación',
                    size: 'Large',
                    weight: 'Bolder',
                    color: 'Accent'
                },
                {
                    type: 'Table',
                    columns: [
                        { width: 2 },
                        { width: 1 },
                        { width: 2 },
                        { width: 1 },
                        { width: 2 }
                    ],
                    rows: [
                        {
                            type: 'TableRow',
                            style: 'accent',
                            cells: [
                                {
                                    type: 'TableCell',
                                    items: [{
                                        type: 'TextBlock',
                                        text: 'Empleado',
                                        weight: 'Bolder',
                                        size: 'Small'
                                    }]
                                },
                                {
                                    type: 'TableCell',
                                    items: [{
                                        type: 'TextBlock',
                                        text: 'Tipo',
                                        weight: 'Bolder',
                                        size: 'Small'
                                    }]
                                },
                                {
                                    type: 'TableCell',
                                    items: [{
                                        type: 'TextBlock',
                                        text: 'Fechas',
                                        weight: 'Bolder',
                                        size: 'Small'
                                    }]
                                },
                                {
                                    type: 'TableCell',
                                    items: [{
                                        type: 'TextBlock',
                                        text: 'Días',
                                        weight: 'Bolder',
                                        size: 'Small',
                                        horizontalAlignment: 'Center'
                                    }]
                                },
                                {
                                    type: 'TableCell',
                                    items: [{
                                        type: 'TextBlock',
                                        text: 'Acciones',
                                        weight: 'Bolder',
                                        size: 'Small',
                                        horizontalAlignment: 'Center'
                                    }]
                                }
                            ]
                        },
                        ...filas
                    ]
                }
            ]
        };
        
        return CardFactory.adaptiveCard(adaptiveCard);
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