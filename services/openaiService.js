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
        // Inicializar cliente de OpenAI si está configurado
        try {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.warn('No se ha configurado OPENAI_API_KEY');
                this.openaiAvailable = false;
            } else {
                this.openai = new OpenAI({ apiKey });
                this.openaiAvailable = true;
                console.log('OpenAIService: Cliente de OpenAI inicializado correctamente');
            }
        } catch (error) {
            console.error(`Error al inicializar OpenAI: ${error.message}`);
            this.openaiAvailable = false;
        }

        // Inicializar cliente de Azure Cognitive Search si está configurado
        try {
            const serviceEndpoint = process.env.SERVICE_ENDPOINT;
            const apiKey = process.env.API_KEY;
            const indexName = process.env.INDEX_NAME || 'alfa_bot';
            
            if (!serviceEndpoint || !apiKey) {
                console.warn('No se ha configurado Azure Search correctamente');
                this.searchAvailable = false;
            } else {
                this.searchClient = new SearchClient(
                    serviceEndpoint,
                    indexName,
                    new AzureKeyCredential(apiKey)
                );
                this.searchAvailable = true;
                console.log('OpenAIService: Cliente de Azure Search inicializado correctamente');
            }
        } catch (error) {
            console.error(`Error al inicializar Azure Search: ${error.message}`);
            this.searchAvailable = false;
        }

        // Definir herramientas disponibles para el agente
        this.tools = this.defineTools();
    }

    /**
     * Define las herramientas disponibles para el Agente
     * @returns {Array} Lista de herramientas en formato OpenAI
     */
    defineTools() {
        const tools = [
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
            }
        ];
        
        // Añadir herramienta de búsqueda si Azure Search está disponible
        if (this.searchAvailable) {
            tools.push({
                type: "function",
                function: {
                    name: "referencias",
                    description: "USAR SOLO cuando el usuario pida explícitamente buscar en documentos, políticas específicas, procedimientos detallados o manuales. NO usar para preguntas generales o explicaciones básicas. Ejemplos de uso: 'busca en documentos sobre...', 'necesito la política de...', 'dónde puedo encontrar el procedimiento de...'",
                    parameters: {
                        type: "object",
                        properties: {
                            consulta: { 
                                type: "string", 
                                description: "Texto específico a buscar en documentos" 
                            }
                        },
                        required: ["consulta"]
                    }
                }
            });
        }
        
        // Añadir otras herramientas si las APIs correspondientes están configuradas
        if (process.env.TOKEN_BUBBLE) {
            tools.push(
                {
                    type: "function",
                    function: {
                        name: "comedor",
                        description: "Consulta el menú del comedor para un día específico. Solo usar cuando el usuario pregunta explícitamente por el menú o comida.",
                        parameters: {
                            type: "object",
                            properties: {
                                filtro_dia: { 
                                    type: "string", 
                                    description: "Día a consultar (formato: YYYY-MM-DD o día de la semana)" 
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
                        description: "Obtiene datos personales de un empleado. Solo usar cuando el usuario específicamente solicita información de un empleado.",
                        parameters: {
                            type: "object",
                            properties: {
                                email: { 
                                    type: "string", 
                                    description: "Correo institucional del empleado" 
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
                        description: "Busca empleados en el directorio corporativo. Solo usar cuando el usuario busca contactos o información de empleados.",
                        parameters: {
                            type: "object",
                            properties: {
                                nombre: { 
                                    type: "string", 
                                    description: "Nombre del empleado" 
                                },
                                apellido: { 
                                    type: "string", 
                                    description: "Apellido del empleado" 
                                }
                            },
                            required: ["nombre", "apellido"]
                        }
                    }
                }
            );
        }
        
        // Añadir herramientas de ServiceNow si la API está configurada
        if (process.env.TOKEN_API) {
            tools.push(
                {
                    type: "function",
                    function: {
                        name: "get_incident",
                        description: "Obtiene información de un incidente específico por su número. Solo usar cuando el usuario proporciona un número de incidente específico.",
                        parameters: {
                            type: "object",
                            properties: {
                                number: { 
                                    type: "string", 
                                    description: "Número exacto del incidente" 
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
                        description: "Busca incidentes que coincidan con criterios específicos. Solo usar cuando el usuario busca incidentes por descripción o estado.",
                        parameters: {
                            type: "object",
                            properties: {
                                query: { 
                                    type: "string", 
                                    description: "Criterios de búsqueda para incidentes" 
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
                        description: "Crea un nuevo incidente en ServiceNow. Solo usar cuando el usuario solicita explícitamente crear un incidente nuevo.",
                        parameters: {
                            type: "object",
                            properties: {
                                category: { 
                                    type: "string",
                                    description: "Categoría del incidente"
                                },
                                cmdb_ci: { 
                                    type: "string",
                                    description: "Item de configuración afectado"
                                },
                                company: { 
                                    type: "string",
                                    description: "Empresa reportante"
                                },
                                description: { 
                                    type: "string",
                                    description: "Descripción detallada del problema"
                                },
                                impact: { 
                                    type: "string",
                                    description: "Nivel de impacto del incidente"
                                },
                                short_description: { 
                                    type: "string",
                                    description: "Resumen breve del problema"
                                },
                                subcategory: { 
                                    type: "string",
                                    description: "Subcategoría específica"
                                }
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
            );
        }
        
        return tools;
    }

    /**
     * Detecta si el mensaje requiere uso de herramientas específicas
     * @param {string} mensaje - Mensaje del usuario
     * @returns {boolean} - Si debe evitar usar herramientas
     */
    _shouldAvoidTools(mensaje) {
        const mensajeLower = mensaje.toLowerCase();
        
        // Evitar herramientas para comandos del bot
        const comandosBot = [
            'login', 'logout', 'acciones', 'ayuda', 'help', 
            'token', 'autenticar', 'iniciar sesion', 'cerrar sesion',
            'commands', 'comandos', 'menu', 'menú', 'opciones'
        ];
        
        // Si contiene comandos del bot, evitar herramientas
        if (comandosBot.some(comando => mensajeLower.includes(comando))) {
            return true;
        }
        
        // Preguntas generales que no requieren herramientas específicas
        const preguntasGenerales = [
            '¿qué es', '¿que es', 'qué es', 'que es',
            '¿cómo', '¿como', 'cómo', 'como',
            'explica', 'explicame', 'explícame',
            'cuéntame', 'cuentame', 'dime sobre',
            'información sobre', 'informacion sobre'
        ];
        
        // Si es una pregunta general simple, evitar herramientas
        const esPreguntaGeneral = preguntasGenerales.some(patron => mensajeLower.includes(patron));
        if (esPreguntaGeneral && mensajeLower.length < 50) {
            return true;
        }
        
        return false;
    }

    /**
     * Procesa una consulta con el agente de OpenAI
     * @param {string} mensaje - Mensaje del usuario
     * @param {Array} historial - Historial de conversación
     * @returns {String} - Respuesta del agente
     */
    async procesarMensaje(mensaje, historial) {
        try {
            // Verificar que OpenAI esté disponible
            if (!this.openaiAvailable) {
                console.error('OpenAI no está configurado correctamente');
                return "Lo siento, el servicio de OpenAI no está disponible en este momento. Por favor, contacta al administrador.";
            }
            
            // Verificar si debemos evitar usar herramientas
            const evitarHerramientas = this._shouldAvoidTools(mensaje);
            
            // Convertir historial al formato esperado por OpenAI
            const mensajes = this.formatearHistorial(historial);
            
            // Agregar mensaje actual del usuario
            mensajes.push({
                role: "user",
                content: mensaje
            });

            // Configuración para la llamada a OpenAI
            const requestConfig = {
                model: "gpt-4-turbo",
                messages: mensajes,
                temperature: 0.7,
                max_tokens: 1500
            };

            // Solo agregar herramientas si no debemos evitarlas y hay herramientas disponibles
            if (!evitarHerramientas && this.tools.length > 0) {
                requestConfig.tools = this.tools;
                requestConfig.tool_choice = "auto";
            }

            // Crear el agente de OpenAI
            const response = await this.openai.chat.completions.create(requestConfig);

            // Obtener respuesta
            const messageResponse = response.choices[0].message;

            // Verificar si el agente quiere ejecutar herramientas
            if (messageResponse.tool_calls && !evitarHerramientas) {
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
                    messages: finalMessages,
                    temperature: 0.7,
                    max_tokens: 1500
                });

                return finalResponse.choices[0].message.content;
            }

            // Si no se requieren herramientas, devolver respuesta directa
            return messageResponse.content;
        } catch (error) {
            console.error(`Error al procesar mensaje con OpenAI: ${error.message}`);
            console.error(error.stack);
            
            // Respuestas más específicas según el tipo de error
            if (error.code === 'rate_limit_exceeded') {
                return "He alcanzado el límite de consultas por minuto. Por favor, espera un momento e intenta de nuevo.";
            } else if (error.code === 'insufficient_quota') {
                return "El servicio ha alcanzado su límite de uso. Por favor, contacta al administrador.";
            } else {
                return "Lo siento, hubo un error al procesar tu solicitud. Por favor, inténtalo de nuevo en unos momentos.";
            }
        }
    }

    /**
     * Formatea historial de conversación al formato de OpenAI
     * @param {Array} historial - Historial desde CosmosDB o memoria
     * @returns {Array} - Mensajes en formato OpenAI
     */
    formatearHistorial(historial) {
        // Mensaje de sistema inicial con instrucciones más claras
        const mensajes = [{
            role: "system",
            content: `Eres un asistente inteligente que ayuda a los empleados de Alfa Corporation. 

INSTRUCCIONES CRÍTICAS SOBRE HERRAMIENTAS:
- NO uses herramientas para preguntas generales o explicaciones básicas
- Solo usa herramientas cuando el usuario ESPECÍFICAMENTE pida:
  * "buscar en documentos" o "buscar información sobre"
  * "necesito la política de..." o "dónde está el procedimiento de..."
  * "consultar el menú" o "qué hay de comer"
  * "buscar empleado" o "información de contacto"
  * "crear incidente" o "consultar ticket"

EJEMPLOS - NO usar herramientas:
- "días por nacimiento" → Explica directamente el proceso
- "¿cómo solicito vacaciones?" → Da información general
- "¿qué es el SIRH?" → Explica directamente

EJEMPLOS - SÍ usar herramientas:
- "busca en documentos la política de vacaciones"
- "necesito consultar el menú del comedor"
- "buscar información de Juan Pérez en el directorio"

SOBRE COMANDOS DEL BOT:
- Si mencionan "login", "acciones", "ayuda", "token": responde directamente
- Para "acciones": explica que escriban "acciones" para ver tarjetas
- NO confundas acciones de API con tus herramientas

Siempre responde en español de manera amable y profesional.
                     
Fecha actual: ${DateTime.now().setZone('America/Mexico_City').toFormat('dd/MM/yyyy')}`
        }];

        // Convertir mensajes del historial, limitando la cantidad para evitar tokens excesivos
        if (historial && historial.length > 0) {
            // Tomar solo los últimos 10 mensajes para evitar exceder límites de tokens
            const recentHistory = historial.slice(-10);
            
            recentHistory.forEach(item => {
                if (item.message && item.message.trim()) {
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
                // Intentar parsear los argumentos
                let parsedArgs;
                try {
                    parsedArgs = JSON.parse(args);
                } catch (parseError) {
                    console.error(`Error al parsear argumentos para ${name}: ${parseError.message}`);
                    parsedArgs = {};
                }
                
                console.log(`OpenAI: Ejecutando herramienta ${name} con argumentos:`, parsedArgs);
                
                // Ejecutar la herramienta correspondiente
                const resultado = await this.ejecutarHerramienta(name, parsedArgs);
                
                // Agregar resultado al mensaje
                resultados.push({
                    role: "tool",
                    tool_call_id: id,
                    content: typeof resultado === 'object' ? JSON.stringify(resultado, null, 2) : String(resultado)
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
            // Verificar que el servicio de búsqueda esté disponible
            if (!this.searchAvailable || !this.searchClient) {
                return "El servicio de búsqueda en documentos no está disponible en este momento.";
            }
            
            console.log(`Buscando referencias para: "${consulta}"`);
            
            /* 1. Embedding del texto */
            const emb = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: consulta,
                dimensions: 1024
            });
            
            /* 2. Consulta vectorial */
            const vectorQuery = {
                vector: emb.data[0].embedding,
                kNearestNeighbors: 5,
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
                filter: filterFolders,
                top: 5
            });

            /* 3. Formatear resultados - Método corregido */
            const chunks = [];
            
            // Usar el método correcto para iterar sobre resultados de Azure Search
            const searchResults = await results.results;
            
            // Si searchResults es un array, usar for...of normal
            if (Array.isArray(searchResults)) {
                for (const result of searchResults) {
                    const document = result.document;
                    chunks.push(
                        `DOCUMENTO: ${document.FileName || 'Sin nombre'}\n` +
                        `CONTENIDO: ${document.Chunk || 'Sin contenido'}\n` +
                        `NOTAS: ${document.Adicional || 'N/A'}\n` +
                        `---`
                    );
                    if (chunks.length >= 5) break;
                }
            } else {
                // Si no es un array, intentar iterar como antes pero con manejo de errores
                try {
                    for await (const result of results) {
                        const document = result.document || result;
                        chunks.push(
                            `DOCUMENTO: ${document.FileName || 'Sin nombre'}\n` +
                            `CONTENIDO: ${document.Chunk || 'Sin contenido'}\n` +
                            `NOTAS: ${document.Adicional || 'N/A'}\n` +
                            `---`
                        );
                        if (chunks.length >= 5) break;
                    }
                } catch (iterError) {
                    console.error('Error iterando resultados de búsqueda:', iterError.message);
                    
                    // Intentar método alternativo usando .next()
                    try {
                        let result = await results.next();
                        while (!result.done && chunks.length < 5) {
                            const document = result.value.document || result.value;
                            chunks.push(
                                `DOCUMENTO: ${document.FileName || 'Sin nombre'}\n` +
                                `CONTENIDO: ${document.Chunk || 'Sin contenido'}\n` +
                                `NOTAS: ${document.Adicional || 'N/A'}\n` +
                                `---`
                            );
                            result = await results.next();
                        }
                    } catch (nextError) {
                        console.error('Error usando .next():', nextError.message);
                        return `Error al procesar resultados de búsqueda: ${nextError.message}`;
                    }
                }
            }
            
            if (chunks.length === 0) {
                return "No se encontraron documentos relevantes para esta consulta en la base de conocimientos.";
            }
            
            return `Encontré ${chunks.length} referencias relevantes:\n\n` + chunks.join('\n');
        } catch (error) {
            console.error(`Error en referencias: ${error.message}`);
            console.error('Stack trace:', error.stack);
            return `No se pudo realizar la búsqueda en documentos. Error: ${error.message}`;
        }
    }

    /**
     * Ejecuta consulta de menú de comedor
     * @param {string} filtro_dia - Día a consultar
     * @returns {Object} - Menú del día
     */
    async ejecutarComedor(filtro_dia) {
        try {
            // Verificar que el token de Bubble esté configurado
            if (!process.env.TOKEN_BUBBLE) {
                return { error: "El servicio de comedor no está configurado" };
            }
            
            console.log(`Consultando menú del comedor para: ${filtro_dia}`);
            
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/comedor',
                { dia: filtro_dia },
                { 
                    headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` },
                    timeout: 10000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en comedor: ${error.message}`);
            return { error: `Error al consultar menú del comedor: ${error.message}` };
        }
    }

    /**
     * Ejecuta consulta de información personal
     * @param {string} email - Correo del empleado
     * @returns {Object} - Datos personales
     */
    async ejecutarInformacionPersonal(email) {
        try {
            // Verificar que el token de Bubble esté configurado
            if (!process.env.TOKEN_BUBBLE) {
                return { error: "El servicio de información personal no está configurado" };
            }
            
            console.log(`Consultando información personal para: ${email}`);
            
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/datos-personales',
                { email },
                { 
                    headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` },
                    timeout: 10000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en informacion_personal: ${error.message}`);
            return { error: `Error al consultar información personal: ${error.message}` };
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
            // Verificar que el token de Bubble esté configurado
            if (!process.env.TOKEN_BUBBLE) {
                return { error: "El servicio de directorio no está configurado" };
            }
            
            console.log(`Buscando en directorio: ${nombre} ${apellido}`);
            
            const res = await axios.post(
                'https://alfa-48373.bubbleapps.io/api/1.1/wf/directorio',
                { Nombre: nombre, Apellido: apellido },
                { 
                    headers: { Authorization: `Bearer ${process.env.TOKEN_BUBBLE}` },
                    timeout: 10000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en directorio: ${error.message}`);
            return { error: `Error al buscar en directorio: ${error.message}` };
        }
    }

    /**
     * Ejecuta consulta de incidente
     * @param {string} number - Número de incidente
     * @returns {Object} - Datos del incidente
     */
    async ejecutarGetIncident(number) {
        try {
            // Verificar que el token de API esté configurado
            if (!process.env.TOKEN_API) {
                return { error: "El servicio de incidentes no está configurado" };
            }
            
            console.log(`Consultando incidente: ${number}`);
            
            const res = await axios.get(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/GetIncident',
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_API}` },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    params: { number },
                    timeout: 15000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en get_incident: ${error.message}`);
            return { error: `Error al consultar incidente: ${error.message}` };
        }
    }

    /**
     * Ejecuta búsqueda de incidentes
     * @param {string} query - Texto de búsqueda
     * @returns {Object} - Lista de incidentes
     */
    async ejecutarGetIncidentKeyList(query) {
        try {
            // Verificar que el token de API esté configurado
            if (!process.env.TOKEN_API) {
                return { error: "El servicio de incidentes no está configurado" };
            }
            
            console.log(`Buscando incidentes con query: ${query}`);
            
            const res = await axios.get(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/GetIncidentKeyListQuery',
                {
                    headers: { Authorization: `Bearer ${process.env.TOKEN_API}` },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    params: { query },
                    timeout: 15000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en get_incident_key_list: ${error.message}`);
            return { error: `Error al buscar incidentes: ${error.message}` };
        }
    }

    /**
     * Ejecuta creación de incidente
     * @param {Object} parametros - Parámetros para el incidente
     * @returns {Object} - Resultado de la creación
     */
    async ejecutarCreateIncidentByCI(parametros) {
        try {
            // Verificar que el token de API esté configurado
            if (!process.env.TOKEN_API) {
                return { error: "El servicio de incidentes no está configurado" };
            }
            
            console.log(`Creando incidente con parámetros:`, parametros);
            
            const res = await axios.post(
                'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/CreateIncidentbyCI',
                parametros,
                {
                    headers: { 
                        Authorization: `Bearer ${process.env.TOKEN_API}`,
                        'Content-Type': 'application/json'
                    },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                    timeout: 15000
                }
            );
            return res.data;
        } catch (error) {
            console.error(`Error en create_incident_by_ci: ${error.message}`);
            return { error: `Error al crear incidente: ${error.message}` };
        }
    }
}

module.exports = new OpenAIService();