// openaiService.js - Versión optimizada y confiable

const OpenAI = require('openai');
const { DateTime } = require('luxon');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { CardFactory } = require('botbuilder');
require('dotenv').config();

/**
 * Servicio OpenAI optimizado con herramientas esenciales
 */
class OpenAIService {
    constructor() {
        this.initializeOpenAI();
        this.initializeAzureSearch();
        this.tools = this.defineTools();
        this.apiActions = this.defineApiActions();
        
        console.log('OpenAIService inicializado correctamente');
    }

    /**
     * Inicializa cliente OpenAI
     */
    initializeOpenAI() {
        try {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.warn('OpenAI API key no configurada');
                this.openaiAvailable = false;
                return;
            }
            
            this.openai = new OpenAI({ apiKey });
            this.openaiAvailable = true;
            console.log('Cliente OpenAI inicializado');
            
        } catch (error) {
            console.error('Error inicializando OpenAI:', error.message);
            this.openaiAvailable = false;
        }
    }

    /**
     * Inicializa Azure Search
     */
    initializeAzureSearch() {
        try {
            const serviceEndpoint = process.env.SERVICE_ENDPOINT;
            const apiKey = process.env.API_KEY;
            const indexName = process.env.INDEX_NAME || 'alfa_bot';
            
            if (!serviceEndpoint || !apiKey) {
                console.warn('Azure Search no configurado');
                this.searchAvailable = false;
                return;
            }
            
            this.searchClient = new SearchClient(
                serviceEndpoint,
                indexName,
                new AzureKeyCredential(apiKey)
            );
            this.searchAvailable = true;
            console.log('Cliente Azure Search inicializado');
            
        } catch (error) {
            console.error('Error inicializando Azure Search:', error.message);
            this.searchAvailable = false;
        }
    }

    /**
     * Define herramientas disponibles (simplificadas)
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
     * Define acciones de API para tarjetas
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
     * Procesa mensaje con OpenAI
     */
    async procesarMensaje(mensaje, historial = []) {
        try {
            if (!this.openaiAvailable) {
                return {
                    type: 'text',
                    content: 'El servicio de OpenAI no está disponible actualmente.'
                };
            }

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

            const response = await this.openai.chat.completions.create(requestConfig);
            const messageResponse = response.choices[0].message;

            // Procesar llamadas a herramientas
            if (messageResponse.tool_calls) {
                return await this.procesarHerramientas(messageResponse, mensajes);
            }

            return {
                type: 'text',
                content: messageResponse.content
            };

        } catch (error) {
            console.error('Error en OpenAI:', error.message);
            return this.manejarErrorOpenAI(error);
        }
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
     * Procesa llamadas a herramientas
     */
    async procesarHerramientas(messageResponse, mensajes) {
        const resultados = [];

        for (const call of messageResponse.tool_calls) {
            const { function: fnCall, id } = call;
            const { name, arguments: args } = fnCall;
            
            try {
                const parametros = JSON.parse(args);
                console.log(`Ejecutando herramienta: ${name}`, parametros);
                
                const resultado = await this.ejecutarHerramienta(name, parametros);
                
                if (resultado && resultado.card) {
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
                console.error(`Error ejecutando herramienta ${name}:`, error);
                resultados.push({
                    tool_call_id: id,
                    content: `Error: ${error.message}`
                });
            }
        }

        // Obtener respuesta final del agente
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
            content: finalResponse.choices[0].message.content
        };
    }

    /**
     * Ejecuta herramienta específica
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
     * Genera tarjeta de vacaciones
     */
    generarTarjetaVacaciones(tipo) {
        const action = this.apiActions.vacaciones.solicitar;
        
        // Modificar campos según el tipo
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

    /**
     * Genera tarjeta de matrimonio
     */
    generarTarjetaMatrimonio() {
        const action = this.apiActions.matrimonio.solicitar;
        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `💍 **Vacaciones por Matrimonio**\n\nSolicita tus días especiales:`,
            card: card
        };
    }

    /**
     * Genera tarjeta de nacimiento
     */
    generarTarjetaNacimiento() {
        const action = this.apiActions.nacimiento.solicitar;
        const card = this.crearTarjetaAdaptativa(action);
        
        return {
            textContent: `👶 **Vacaciones por Nacimiento**\n\nSolicita tus días de paternidad/maternidad:`,
            card: card
        };
    }

    /**
     * Consulta solicitudes del usuario
     */
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

    /**
     * Busca en documentos usando Azure Search
     */
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

    /**
     * Consulta menú del comedor
     */
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

    /**
     * Busca empleado en directorio
     */
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
     * Crea tarjeta adaptativa
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

        // Agregar campos
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

    /**
     * Crea elemento de input
     */
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
     * Maneja errores de OpenAI
     */
    manejarErrorOpenAI(error) {
        if (error.code === 'rate_limit_exceeded') {
            return {
                type: 'text',
                content: 'He alcanzado el límite de consultas. Espera un momento e intenta de nuevo.'
            };
        } else if (error.code === 'insufficient_quota') {
            return {
                type: 'text',
                content: 'El servicio ha alcanzado su límite de uso. Contacta al administrador.'
            };
        } else {
            return {
                type: 'text',
                content: 'Error procesando solicitud. Intenta nuevamente en unos momentos.'
            };
        }
    }
}

module.exports = new OpenAIService();