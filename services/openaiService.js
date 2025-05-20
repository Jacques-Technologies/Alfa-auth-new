const OpenAI = require('openai');
const { DateTime } = require('luxon');
const axios = require('axios');
const https = require('https');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

/**
 * Clase para gestionar la integración con OpenAI y herramientas
 */
class OpenAIService {
    constructor() {
        // Inicializar cliente de OpenAI
        this.openai = new OpenAI({ 
            apiKey: process.env.OPENAI_API_KEY 
        });

        // Cliente de Azure Cognitive Search
        this.searchClient = new SearchClient(
            process.env.SERVICE_ENDPOINT,
            process.env.INDEX_NAME || 'alfa_bot',
            new AzureKeyCredential(process.env.API_KEY)
        );

        // Definir herramientas disponibles para el agente
        this.tools = this.defineTools();
    }

    /**
     * Define las herramientas disponibles para el Agente
     * @returns {Array} Lista de herramientas en formato OpenAI
     */
    defineTools() {
        return [
            {
                type: "function",
                function: {
                    name: "FechaHoy",
                    description: "Devuelve la fecha actual (zona horaria MX) en formato ISO.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "referencias",
                    description: "Devuelve fragmentos de documentos relevantes desde Azure AI Search.",
                    parameters: {
                        type: "object",
                        properties: {
                            consulta: { 
                                type: "string", 
                                description: "Texto de búsqueda" 
                            }
                        },
                        required: ["consulta"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "comedor",
                    description: "Consulta el menú del comedor.",
                    parameters: {
                        type: "object",
                        properties: {
                            filtro_dia: { 
                                type: "string", 
                                description: "Día a consultar" 
                            }
                        },
                        required: ["filtro_dia"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "informacion_personal",
                    description: "Datos personales de un empleado.",
                    parameters: {
                        type: "object",
                        properties: {
                            email: { 
                                type: "string", 
                                description: "Correo institucional" 
                            }
                        },
                        required: ["email"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "directorio",
                    description: "Búsqueda en directorio.",
                    parameters: {
                        type: "object",
                        properties: {
                            nombre: { 
                                type: "string", 
                                description: "Nombre" 
                            },
                            apellido: { 
                                type: "string", 
                                description: "Apellido" 
                            }
                        },
                        required: ["nombre", "apellido"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_incident",
                    description: "Obtiene un incidente por número.",
                    parameters: {
                        type: "object",
                        properties: {
                            number: { 
                                type: "string", 
                                description: "Número de incidente" 
                            }
                        },
                        required: ["number"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_incident_key_list",
                    description: "Lista incidentes que cumplen un query.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { 
                                type: "string", 
                                description: "Texto de búsqueda" 
                            }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_incident_by_ci",
                    description: "Crea un incidente.",
                    parameters: {
                        type: "object",
                        properties: {
                            category: { type: "string" },
                            cmdb_ci: { type: "string" },
                            company: { type: "string" },
                            description: { type: "string" },
                            impact: { type: "string" },
                            short_description: { type: "string" },
                            subcategory: { type: "string" }
                        },
                        required: [
                            "category",
                            "cmdb_ci",
                            "company",
                            "description",
                            "impact",
                            "short_description",
                            "subcategory"
                        ]
                    }
                }
            }
        ];
    }

    /**
     * Procesa una consulta con el agente de OpenAI
     * @param {string} mensaje - Mensaje del usuario
     * @param {Array} historial - Historial de conversación
     * @returns {Object} - Respuesta del agente
     */
    async procesarMensaje(mensaje, historial) {
        try {
            // Convertir historial al formato esperado por OpenAI
            const mensajes = this.formatearHistorial(historial);
            
            // Agregar mensaje actual del usuario
            mensajes.push({
                role: "user",
                content: mensaje
            });

            // Crear el agente de OpenAI con las herramientas
            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo",
                messages: mensajes,
                tools: this.tools,
                tool_choice: "auto"
            });

            // Obtener respuesta
            const messageResponse = response.choices[0].message;

            // Verificar si el agente quiere ejecutar herramientas
            if (messageResponse.tool_calls) {
                // Procesar llamadas a herramientas
                const toolResults = await this.procesarLlamadasHerramientas(messageResponse.tool_calls);
                
                // Enviar resultados de herramientas al agente para completar respuesta
                const finalMessages = [
                    ...mensajes,
                    messageResponse,
                    ...toolResults
                ];

                // Obtener respuesta final
                const finalResponse = await this.openai.chat.completions.create({
                    model: "gpt-4-turbo",
                    messages: finalMessages
                });

                return finalResponse.choices[0].message.content;
            }

            // Si no se requieren herramientas, devolver respuesta directa
            return messageResponse.content;
        } catch (error) {
            console.error(`Error al procesar mensaje con OpenAI: ${error.message}`);
            return "Lo siento, hubo un error al procesar tu solicitud. Por favor, inténtalo de nuevo.";
        }
    }

    /**
     * Formatea historial de conversación al formato de OpenAI
     * @param {Array} historial - Historial desde CosmosDB
     * @returns {Array} - Mensajes en formato OpenAI
     */
    formatearHistorial(historial) {
        // Mensaje de sistema inicial
        const mensajes = [{
            role: "system",
            content: `Eres un asistente inteligente que ayuda a los empleados de Alfa. 
                     Tienes acceso a diversas herramientas para proporcionar información sobre:
                     - Menú del comedor
                     - Directorio de empleados
                     - Información personal (con autenticación)
                     - Gestión de incidentes de ServiceNow
                     - Búsqueda en documentos internos
                     
                     Siempre eres amable, profesional y eficiente. Hablas en español y te diriges
                     a los usuarios formalmente. Puedes usar las herramientas disponibles para
                     responder mejor a las preguntas del usuario.
                     
                     Fecha actual: ${DateTime.now().setZone('America/Mexico_City').toFormat('dd/MM/yyyy')}`
        }];

        // Convertir mensajes del historial
        if (historial && historial.length > 0) {
            historial.forEach(item => {
                if (item.message) {
                    if (item.type === 'user') {
                        mensajes.push({
                            role: "user",
                            content: item.message
                        });
                    } else if (item.type === 'assistant') {
                        mensajes.push({
                            role: "assistant",
                            content: item.message
                        });
                    }
                }
            });
        }

        return mensajes;
    }

    /**
     * Procesa llamadas a herramientas desde OpenAI
     * @param {Array} toolCalls - Llamadas a herramientas solicitadas
     * @returns {Array} - Mensajes con resultados para OpenAI
     */
    async procesarLlamadasHerramientas(toolCalls) {
        const resultados = [];

        for (const call of toolCalls) {
            const { function: fnCall, id } = call;
            const { name, arguments: args } = fnCall;
            
            try {
                // Ejecutar la herramienta correspondiente
                const resultado = await this.ejecutarHerramienta(name, JSON.parse(args));
                
                // Agregar resultado al mensaje
                resultados.push({
                    role: "tool",
                    tool_call_id: id,
                    content: typeof resultado === 'object' ? JSON.stringify(resultado) : resultado
                });
            } catch (error) {
                console.error(`Error ejecutando herramienta ${name}: ${error.message}`);
                resultados.push({
                    role: "tool",
                    tool_call_id: id,
                    content: `Error: No se pudo ejecutar la herramienta ${name}. ${error.message}`
                });
            }
        }

        return resultados;
    }

    /**
     * Ejecuta una herramienta específica
     * @param {string} nombre - Nombre de la herramienta
     * @param {Object} parametros - Parámetros para la herramienta
     * @returns {any} - Resultado de la ejecución
     */
    async ejecutarHerramienta(nombre, parametros) {
        switch (nombre) {
            case 'FechaHoy':
                return DateTime.now().setZone('America/Mexico_City').toISODate();
                
            case 'referencias':
                return await this.ejecutarReferencias(parametros.consulta);
                
            case 'comedor':
                return await this.ejecutarComedor(parametros.filtro_dia);
                
            case 'informacion_personal':
                return await this.ejecutarInformacionPersonal(parametros.email);
                
            case 'directorio':
                return await this.ejecutarDirectorio(parametros.nombre, parametros.apellido);
                
            case 'get_incident':
                return await this.ejecutarGetIncident(parametros.number);
                
            case 'get_incident_key_list':
                return await this.ejecutarGetIncidentKeyList(parametros.query);
                
            case 'create_incident_by_ci':
                return await this.ejecutarCreateIncidentByCI(parametros);
                
            default:
                throw new Error(`Herramienta desconocida: ${nombre}`);
        }
    }

    /**
     * Ejecuta búsqueda de referencias en documentos
     * @param {string} consulta - Texto de búsqueda
     * @returns {string} - Resultados formateados
     */
    async ejecutarReferencias(consulta) {
        try {
            /* 1. Embedding del texto */
            const emb = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: consulta,
                dimensions: 1024
            });
            
            /* 2. Consulta vectorial */
            const vectorQuery = {
                vector: emb.data[0].embedding,
                kNearestNeighbors: 7,
                fields: 'Embedding'
            };
            
            const filterFolders = [
                '1727468181184x887443586264191900',
                '1721838331185x391888654169602750',
                '1721838293918x578567098933541200',
                '1721838273084x997249294344777400',
                '1724297146467x528248112589696500',
                '1724297132046x157473295543779870',
                '1724297122954x246675696308903400',
                '1724297114861x824556494556945700',
                '1724297105904x395803296537081500',
                '1724297093236x840642798817826400',
                '1727468160291x847487420923683800',
                '1739992558603x917158177162499100',
                '1739218698126x647518027570958500'
            ]
                .map((f) => `Folder eq '${f}'`)
                .join(' or ');

            const results = await this.searchClient.search(undefined, {
                vectorQueries: [vectorQuery],
                select: ['Chunk', 'Adicional', 'FileName'],
                filter: filterFolders
            });

            /* 3. Formatear resultados */
            const chunks = [];
            for await (const r of results) {
                chunks.push(
                    `INICIA UN NUEVO EXTRACTO.\n` +
                    `Nombre del documento: ${r.FileName}\n` +
                    `Instrucciones adicionales: ${r.Adicional}\n` +
                    `Contenido: ${r.Chunk}\n` +
                    `TERMINA EXTRACTO`
                );
                if (chunks.length >= 8) break;
            }
            return chunks.join('\n');
        } catch (error) {
            return `Error en referencias: ${error.message}`;
        }
    }

    /**
     * Ejecuta consulta de menú de comedor
     * @param {string} filtro_dia - Día a consultar
     * @returns {Object} - Menú del día
     */
    async ejecutarComedor(filtro_dia) {
        try {
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/comedor',
                { dia: filtro_dia },
                { headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` } }
            );
            return res.data;
        } catch (error) {
            return { error: `Error en comedor: ${error.message}` };
        }
    }

    /**
     * Ejecuta consulta de información personal
     * @param {string} email - Correo del empleado
     * @returns {Object} - Datos personales
     */
    async ejecutarInformacionPersonal(email) {
        try {
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/datos-personales',
                { email },
                { headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` } }
            );
            return res.data;
        } catch (error) {
            return { error: `Error en informacion_personal: ${error.message}` };
        }
    }

    /**
     * Ejecuta búsqueda en directorio
     * @param {string} nombre - Nombre del empleado
     * @param {string} apellido - Apellido del empleado
     * @returns {Object} - Resultados de la búsqueda
     */
    async ejecutarDirectorio(nombre, apellido) {
        try {
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/directorio',
                { Nombre: nombre, Apellido: apellido },
                { headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` } }
            );
            return res.data;
        } catch (error) {
            return { error: `Error en directorio: ${error.message}` };
        }
    }

    /**
     * Ejecuta consulta de incidente
     * @param {string} number - Número de incidente
     * @returns {Object} - Datos del incidente
     */
    async ejecutarGetIncident(number) {
        try {
            const res = await axios.get(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/GetIncident',
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_API}` },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    data: { number }
                }
            );
            return res.data;
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Ejecuta búsqueda de incidentes
     * @param {string} query - Texto de búsqueda
     * @returns {Object} - Lista de incidentes
     */
    async ejecutarGetIncidentKeyList(query) {
        try {
            const res = await axios.get(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/GetIncidentKeyListQuery',
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_API}` },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    data: { query }
                }
            );
            return res.data;
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Ejecuta creación de incidente
     * @param {Object} parametros - Parámetros para el incidente
     * @returns {Object} - Resultado de la creación
     */
    async ejecutarCreateIncidentByCI(parametros) {
        try {
            const res = await axios.post(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/CreateIncidentbyCI',
                parametros,
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_API}` },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false })
                }
            );
            return res.data;
        } catch (error) {
            return { error: error.message };
        }
    }
}

module.exports = new OpenAIService();