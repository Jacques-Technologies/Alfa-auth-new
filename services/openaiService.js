// openaiService.js - Versión corregida con mejor diagnóstico y manejo de errores

const OpenAI = require('openai');
const { DateTime } = require('luxon');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { CardFactory } = require('botbuilder');
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
                    description: "Consulta las solicitudes de vacaciones del usuario",
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
                    description: "Busca información en documentos corporativos",
                    parameters: {
                        type: "object",
                        properties: {
                            consulta: {
                                type: "string",
                                description: "Texto a buscar en documentos"
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
    async procesarMensaje(mensaje, historial = []) {
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
                max_tokens: 1500
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
                return await this.procesarHerramientas(messageResponse, mensajes);
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
            content: `Eres un asistente corporativo para Alfa Corporation. Ayudas con:

🏖️ VACACIONES:
- Solicitar vacaciones regulares, por matrimonio o nacimiento
- Consultar estado de solicitudes
- Simular disponibilidad de días

📚 INFORMACIÓN:
- Buscar en documentos corporativos
- Consultar directorio de empleados
- Revisar menú del comedor

INSTRUCCIONES:
- Responde en español de manera profesional
- Usa herramientas apropiadas según la consulta
- Para vacaciones: determina tipo específico antes de generar tarjetas
- Para búsquedas: usa herramientas de búsqueda disponibles

Fecha actual: ${DateTime.now().setZone('America/Mexico_City').toFormat('dd/MM/yyyy')}`
        }];

        // Agregar historial reciente (últimos 10 mensajes)
        if (historial && historial.length > 0) {
            const recientes = historial.slice(-10);
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
    async procesarHerramientas(messageResponse, mensajes) {
        const resultados = [];

        console.log(`🔧 Procesando ${messageResponse.tool_calls.length} herramienta(s)...`);

        for (const call of messageResponse.tool_calls) {
            const { function: fnCall, id } = call;
            const { name, arguments: args } = fnCall;
            
            try {
                const parametros = JSON.parse(args);
                console.log(`🛠️ Ejecutando herramienta: ${name}`, parametros);
                
                const resultado = await this.ejecutarHerramienta(name, parametros);
                
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
            max_tokens: 1500
        });

        return {
            type: 'text',
            content: finalResponse.choices[0].message.content || 'Respuesta final vacía'
        };
    }

    /**
     * Ejecuta herramienta específica (igual que antes)
     */
    async ejecutarHerramienta(nombre, parametros) {
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
                return await this.consultarMisSolicitudes();

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
        const action = this.apiActions.vacaciones.solicitar;
        
        if (tipo === 'simular') {
            action.fields = action.fields.map(field => 
                field.id === 'simular' ? { ...field, value: 'true' } : field
            );
            action.title = 'Simular Vacaciones';
            action.description = 'Simula una solicitud para verificar disponibilidad';
        }

        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `🏖️ **${action.title}**\n\nCompleta los datos para tu solicitud:`,
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

    async consultarMisSolicitudes() {
        try {
            const response = await axios.get(
                'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.TOKEN_SIRH || 'TOKEN_NO_CONFIGURADO'}`
                    },
                    timeout: 10000
                }
            );
            
            return `📋 **Mis Solicitudes de Vacaciones**\n\n${JSON.stringify(response.data, null, 2)}`;
            
        } catch (error) {
            console.error('Error consultando solicitudes:', error.message);
            return `❌ Error al consultar solicitudes: ${error.message}`;
        }
    }

    async buscarEnDocumentos(consulta) {
        try {
            if (!this.searchAvailable) {
                return "El servicio de búsqueda no está disponible.";
            }

            const embedding = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: consulta,
                dimensions: 1024
            });
            
            const vectorQuery = {
                vector: embedding.data[0].embedding,
                kNearestNeighbors: 3,
                fields: 'Embedding'
            };
            
            const searchResults = await this.searchClient.search(undefined, {
                vectorQueries: [vectorQuery],
                select: ['Chunk', 'FileName'],
                top: 3
            });

            const resultados = [];
            for await (const result of searchResults.results) {
                const doc = result.document;
                resultados.push(`**${doc.FileName}**: ${doc.Chunk}`);
                if (resultados.length >= 3) break;
            }
            
            return resultados.length > 0 ? 
                `📚 **Resultados encontrados:**\n\n${resultados.join('\n\n')}` :
                "No se encontraron documentos relevantes.";
                
        } catch (error) {
            console.error('Error en búsqueda:', error.message);
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