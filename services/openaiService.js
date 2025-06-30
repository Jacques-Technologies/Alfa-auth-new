const OpenAI = require('openai');
const { DateTime } = require('luxon');
const axios = require('axios');
const https = require('https');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { CardFactory } = require('botbuilder');
require('dotenv').config();

/**
 * Clase para gestionar la integración con OpenAI y herramientas (incluye tarjetas dinámicas)
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

        // Definir herramientas disponibles para el agente (incluye tarjetas dinámicas)
        this.tools = this.defineTools();
        
        // Configuración de acciones de API para las tarjetas
        this.apiActions = this.defineApiActions();
    }

    /**
     * Define las herramientas disponibles para el Agente (incluye generación de tarjetas)
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
            },
            // NUEVAS HERRAMIENTAS PARA TARJETAS DINÁMICAS
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_vacaciones",
                    description: "Genera tarjetas para solicitudes de vacaciones cuando el usuario quiere solicitar, consultar o gestionar sus vacaciones. Usar cuando mencionen: vacaciones, días libres, permisos, ausentarse, tiempo libre, descanso.",
                    parameters: {
                        type: "object",
                        properties: {
                            tipo_solicitud: {
                                type: "string",
                                enum: ["consultar", "solicitar", "simular", "todas"],
                                description: "Tipo de operación de vacaciones solicitada"
                            }
                        },
                        required: ["tipo_solicitud"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_empleado",
                    description: "Genera tarjeta para consultar información del empleado cuando pregunten sobre sus datos personales, información laboral, perfil, datos de usuario o información personal.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_recibos",
                    description: "Genera tarjeta para consultar recibos de nómina cuando pregunten sobre periodos de pago, recibos, nómina, pagos o comprobantes de sueldo.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_matrimonio",
                    description: "Genera tarjeta para solicitar vacaciones por matrimonio cuando mencionen boda, matrimonio, casarse, luna de miel o permisos por matrimonio.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_nacimiento",
                    description: "Genera tarjeta para solicitar vacaciones por nacimiento cuando mencionen bebé, nacimiento, paternidad, maternidad o permisos por hijo.",
                    parameters: {
                        type: "object",
                        properties: {}
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generar_tarjeta_autorizacion",
                    description: "Genera tarjetas para autorizar, rechazar o cancelar solicitudes cuando mencionen aprobar, autorizar, rechazar, cancelar solicitudes o gestión de solicitudes.",
                    parameters: {
                        type: "object",
                        properties: {
                            accion: {
                                type: "string",
                                enum: ["autorizar", "rechazar", "cancelar"],
                                description: "Acción a realizar en la solicitud"
                            }
                        },
                        required: ["accion"]
                    }
                }
            }
        ];
        
        // Añadir herramientas existentes
        if (this.searchAvailable) {
            tools.push({
                type: "function",
                function: {
                    name: "referencias",
                    description: "USAR SOLO cuando el usuario pida explícitamente buscar en documentos, políticas específicas, procedimientos detallados o manuales.",
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
        
        // Añadir otras herramientas existentes (comedor, directorio, etc.)
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
        
        // Añadir herramientas de ServiceNow
        if (process.env.TOKEN_API) {
            tools.push(
                {
                    type: "function",
                    function: {
                        name: "get_incident",
                        description: "Obtiene información de un incidente específico por su número.",
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
                        description: "Busca incidentes que coincidan con criterios específicos.",
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
                        description: "Crea un nuevo incidente en ServiceNow.",
                        parameters: {
                            type: "object",
                            properties: {
                                category: { type: "string", description: "Categoría del incidente" },
                                cmdb_ci: { type: "string", description: "Item de configuración afectado" },
                                company: { type: "string", description: "Empresa reportante" },
                                description: { type: "string", description: "Descripción detallada del problema" },
                                impact: { type: "string", description: "Nivel de impacto del incidente" },
                                short_description: { type: "string", description: "Resumen breve del problema" },
                                subcategory: { type: "string", description: "Subcategoría específica" }
                            },
                            required: ["category", "cmdb_ci", "company", "description", "impact", "short_description", "subcategory"]
                        }
                    }
                }
            );
        }
        
        return tools;
    }

    /**
     * Define las acciones de API disponibles para las tarjetas
     * @returns {Object} Configuración de acciones
     */
    defineApiActions() {
        return {
            vacaciones: {
                consultar_solicitudes: {
                    title: 'Mis Solicitudes de Vacaciones',
                    description: 'Consulta todas tus solicitudes de vacaciones',
                    method: 'GET',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/empleado',
                    fields: [],
                    icon: '🏖️'
                },
                solicitar_vacaciones: {
                    title: 'Solicitar Vacaciones',
                    description: 'Simula o solicita vacaciones para un rango de fechas',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{fechaInicio}/{fechaFin}/{medioDia}/{simular}',
                    fields: [
                        { 
                            id: 'fechaInicio', 
                            type: 'date', 
                            label: 'Fecha de inicio', 
                            placeholder: 'Ej: 2025-06-18',
                            required: true 
                        },
                        { 
                            id: 'fechaFin', 
                            type: 'date', 
                            label: 'Fecha de fin', 
                            placeholder: 'Ej: 2025-06-25',
                            required: true 
                        },
                        { 
                            id: 'medioDia', 
                            type: 'choice', 
                            label: '¿Medio día?', 
                            value: 'false', 
                            choices: ['true', 'false'], 
                            required: true 
                        },
                        { 
                            id: 'simular', 
                            type: 'choice', 
                            label: '¿Solo simular?', 
                            value: 'true', 
                            choices: ['true', 'false'], 
                            required: true 
                        }
                    ],
                    icon: '🎯'
                },
                consultar_por_id: {
                    title: 'Consultar Solicitud por ID',
                    description: 'Consulta una solicitud específica por su ID',
                    method: 'GET',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}',
                    fields: [
                        { 
                            id: 'idSolicitud', 
                            type: 'text', 
                            label: 'ID de Solicitud', 
                            placeholder: 'Ej: 12345', 
                            required: true 
                        }
                    ],
                    icon: '🔍'
                },
                dependientes: {
                    title: 'Solicitudes de Dependientes',
                    description: 'Consulta las solicitudes de vacaciones de tus dependientes',
                    method: 'GET',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/dependientes',
                    fields: [],
                    icon: '👨‍👩‍👧‍👦'
                }
            },
            empleado: {
                informacion: {
                    title: 'Mi Información',
                    description: 'Consulta tu información básica de empleado',
                    method: 'GET',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/empleado',
                    fields: [],
                    icon: '👤'
                }
            },
            recibos: {
                periodos: {
                    title: 'Mis Periodos de Pago',
                    description: 'Consulta los periodos de nómina disponibles',
                    method: 'GET',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/recibo/periodos',
                    fields: [],
                    icon: '📅'
                }
            },
            matrimonio: {
                solicitar: {
                    title: 'Vacaciones por Matrimonio',
                    description: 'Solicita vacaciones por matrimonio con fecha específica',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/matrimonio/{fechaMatrimonio}',
                    fields: [
                        { 
                            id: 'fechaMatrimonio', 
                            type: 'date', 
                            label: 'Fecha de Matrimonio',
                            placeholder: 'Ej: 2025-06-18',
                            required: true 
                        }
                    ],
                    icon: '💍'
                }
            },
            nacimiento: {
                solicitar: {
                    title: 'Vacaciones por Nacimiento',
                    description: 'Solicita vacaciones por nacimiento con fecha específica',
                    method: 'POST',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/nacimiento/{fechaNacimiento}',
                    fields: [
                        { 
                            id: 'fechaNacimiento', 
                            type: 'date', 
                            label: 'Fecha de Nacimiento',
                            placeholder: 'Ej: 2025-06-18',
                            required: true 
                        }
                    ],
                    icon: '👶'
                }
            },
            autorizacion: {
                autorizar: {
                    title: 'Autorizar Solicitud',
                    description: 'Autoriza una solicitud de vacaciones por ID',
                    method: 'PUT',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/autorizar',
                    fields: [
                        {
                            id: 'idSolicitud',
                            type: 'text',
                            label: 'ID de Solicitud',
                            placeholder: 'Ej: 12345',
                            required: true
                        }
                    ],
                    icon: '✅'
                },
                rechazar: {
                    title: 'Rechazar Solicitud',
                    description: 'Rechaza una solicitud de vacaciones por ID',
                    method: 'PUT',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/rechazar',
                    fields: [
                        {
                            id: 'idSolicitud',
                            type: 'text',
                            label: 'ID de Solicitud',
                            placeholder: 'Ej: 12345',
                            required: true
                        }
                    ],
                    icon: '❌'
                },
                cancelar: {
                    title: 'Cancelar Solicitud',
                    description: 'Cancela una solicitud de vacaciones por ID',
                    method: 'PUT',
                    url: 'https://botapiqas-alfacorp.msappproxy.net/api/externas/sirh2bot_qas/bot/vac/solicitudes/{idSolicitud}/cancelar',
                    fields: [
                        { 
                            id: 'idSolicitud', 
                            type: 'text', 
                            label: 'ID de Solicitud', 
                            placeholder: 'Ej: 12345', 
                            required: true 
                        }
                    ],
                    icon: '🚫'
                }
            }
        };
    }

    /**
     * Detecta si el mensaje requiere uso de herramientas específicas
     * @param {string} mensaje - Mensaje del usuario
     * @returns {boolean} - Si debe evitar usar herramientas
     */
    _shouldAvoidTools(mensaje) {
        const mensajeLower = mensaje.toLowerCase();
        
        // Evitar herramientas para comandos del bot básicos
        const comandosBot = [
            'login', 'logout', 'ayuda', 'help', 
            'token', 'autenticar', 'iniciar sesion', 'cerrar sesion',
            'commands', 'comandos'
        ];
        
        // Si contiene comandos del bot básicos, evitar herramientas
        if (comandosBot.some(comando => mensajeLower.includes(comando))) {
            return true;
        }
        
        return false;
    }

    /**
     * Procesa una consulta con el agente de OpenAI (ahora incluye respuestas con tarjetas)
     * @param {string} mensaje - Mensaje del usuario
     * @param {Array} historial - Historial de conversación
     * @returns {Object} - Respuesta del agente (puede incluir tarjetas)
     */
    async procesarMensaje(mensaje, historial) {
        try {
            // Verificar que OpenAI esté disponible
            if (!this.openaiAvailable) {
                console.error('OpenAI no está configurado correctamente');
                return {
                    type: 'text',
                    content: "Lo siento, el servicio de OpenAI no está disponible en este momento. Por favor, contacta al administrador."
                };
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
                
                // Verificar si alguna herramienta devolvió una tarjeta
                const cardResult = toolResults.find(result => result.card);
                if (cardResult) {
                    return {
                        type: 'card',
                        content: cardResult.textContent || "Aquí tienes la acción que necesitas:",
                        card: cardResult.card
                    };
                }
                
                // Enviar resultados de herramientas al agente para completar respuesta
                const finalMessages = [
                    ...mensajes,
                    messageResponse,
                    ...toolResults.map(result => ({
                        role: "tool",
                        tool_call_id: result.tool_call_id,
                        content: result.content
                    }))
                ];

                // Obtener respuesta final
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

            // Si no se requieren herramientas, devolver respuesta directa
            return {
                type: 'text',
                content: messageResponse.content
            };
        } catch (error) {
            console.error(`Error al procesar mensaje con OpenAI: ${error.message}`);
            console.error(error.stack);
            
            // Respuestas más específicas según el tipo de error
            if (error.code === 'rate_limit_exceeded') {
                return {
                    type: 'text',
                    content: "He alcanzado el límite de consultas por minuto. Por favor, espera un momento e intenta de nuevo."
                };
            } else if (error.code === 'insufficient_quota') {
                return {
                    type: 'text',
                    content: "El servicio ha alcanzado su límite de uso. Por favor, contacta al administrador."
                };
            } else {
                return {
                    type: 'text',
                    content: "Lo siento, hubo un error al procesar tu solicitud. Por favor, inténtalo de nuevo en unos momentos."
                };
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

INSTRUCCIONES PARA TARJETAS DINÁMICAS:
- Cuando el usuario mencione vacaciones, días libres, solicitar permisos: USA generar_tarjeta_vacaciones
- Cuando pregunten por su información personal, perfil: USA generar_tarjeta_empleado  
- Cuando pregunten por recibos, nómina, periodos: USA generar_tarjeta_recibos
- Cuando mencionen matrimonio, boda, casarse: USA generar_tarjeta_matrimonio
- Cuando mencionen bebé, nacimiento, paternidad: USA generar_tarjeta_nacimiento
- Cuando quieran autorizar, rechazar, cancelar solicitudes: USA generar_tarjeta_autorizacion

EJEMPLOS DE USO DE TARJETAS:
- "quiero solicitar vacaciones" → generar_tarjeta_vacaciones(tipo_solicitud: "solicitar")
- "ver mis vacaciones" → generar_tarjeta_vacaciones(tipo_solicitud: "consultar")  
- "mi información personal" → generar_tarjeta_empleado()
- "mis recibos de pago" → generar_tarjeta_recibos()
- "permiso por matrimonio" → generar_tarjeta_matrimonio()
- "autorizar una solicitud" → generar_tarjeta_autorizacion(accion: "autorizar")

INSTRUCCIONES PARA OTRAS HERRAMIENTAS:
- Solo usa "referencias" cuando pidan buscar en documentos específicos
- Solo usa "comedor" cuando pregunten por menú del día
- Solo usa "directorio" cuando busquen contactos de empleados

SOBRE COMANDOS DEL BOT:
- Si mencionan "login", "ayuda", "token": responde directamente SIN usar herramientas
- Para "acciones": explica que ahora las acciones aparecen automáticamente según lo que necesiten

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
     * Procesa llamadas a herramientas desde OpenAI (incluye generación de tarjetas)
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
                
                // Si el resultado incluye una tarjeta, devolverla especialmente
                if (resultado && resultado.card) {
                    resultados.push({
                        tool_call_id: id,
                        content: resultado.textContent || "Tarjeta generada",
                        card: resultado.card,
                        textContent: resultado.textContent
                    });
                } else {
                    // Agregar resultado normal al mensaje
                    resultados.push({
                        tool_call_id: id,
                        content: typeof resultado === 'object' ? JSON.stringify(resultado, null, 2) : String(resultado)
                    });
                }
            } catch (error) {
                console.error(`Error ejecutando herramienta ${name}: ${error.message}`);
                resultados.push({
                    tool_call_id: id,
                    content: `Error: No se pudo ejecutar la herramienta ${name}. ${error.message}`
                });
            }
        }

        return resultados;
    }

    /**
     * Ejecuta una herramienta específica (incluye generación de tarjetas)
     * @param {string} nombre - Nombre de la herramienta
     * @param {Object} parametros - Parámetros para la herramienta
     * @returns {any} - Resultado de la ejecución
     */
    async ejecutarHerramienta(nombre, parametros) {
        switch (nombre) {
            case 'FechaHoy':
                return DateTime.now().setZone('America/Mexico_City').toISODate();
                
            // NUEVAS HERRAMIENTAS PARA TARJETAS DINÁMICAS
            case 'generar_tarjeta_vacaciones':
                return this.generarTarjetaVacaciones(parametros.tipo_solicitud);
                
            case 'generar_tarjeta_empleado':
                return this.generarTarjetaEmpleado();
                
            case 'generar_tarjeta_recibos':
                return this.generarTarjetaRecibos();
                
            case 'generar_tarjeta_matrimonio':
                return this.generarTarjetaMatrimonio();
                
            case 'generar_tarjeta_nacimiento':
                return this.generarTarjetaNacimiento();
                
            case 'generar_tarjeta_autorizacion':
                return this.generarTarjetaAutorizacion(parametros.accion);
                
            // HERRAMIENTAS EXISTENTES
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

    // MÉTODOS PARA GENERAR TARJETAS DINÁMICAS

    /**
     * Genera tarjetas para solicitudes de vacaciones
     * @param {string} tipoSolicitud - Tipo de solicitud de vacaciones
     * @returns {Object} - Resultado con tarjeta(s)
     */
    generarTarjetaVacaciones(tipoSolicitud) {
        const actions = [];
        
        switch (tipoSolicitud) {
            case 'consultar':
                actions.push(this.apiActions.vacaciones.consultar_solicitudes);
                actions.push(this.apiActions.vacaciones.consultar_por_id);
                actions.push(this.apiActions.vacaciones.dependientes);
                break;
                
            case 'solicitar':
                actions.push(this.apiActions.vacaciones.solicitar_vacaciones);
                break;
                
            case 'simular':
                actions.push({
                    ...this.apiActions.vacaciones.solicitar_vacaciones,
                    title: 'Simular Solicitud de Vacaciones',
                    description: 'Simula una solicitud para ver días disponibles',
                    fields: this.apiActions.vacaciones.solicitar_vacaciones.fields.map(field => 
                        field.id === 'simular' ? { ...field, value: 'true' } : field
                    )
                });
                break;
                
            case 'todas':
            default:
                actions.push(this.apiActions.vacaciones.consultar_solicitudes);
                actions.push(this.apiActions.vacaciones.solicitar_vacaciones);
                actions.push(this.apiActions.vacaciones.consultar_por_id);
                break;
        }
        
        const cards = actions.map(action => this.createAdaptiveCard(action));
        
        return {
            textContent: `🏖️ **Gestión de Vacaciones**\n\nHe preparado las acciones que necesitas para gestionar tus vacaciones:`,
            card: cards.length === 1 ? cards[0] : cards
        };
    }

    /**
     * Genera tarjeta para información del empleado
     * @returns {Object} - Resultado con tarjeta
     */
    generarTarjetaEmpleado() {
        const card = this.createAdaptiveCard(this.apiActions.empleado.informacion);
        
        return {
            textContent: `👤 **Mi Información Personal**\n\nConsulta tus datos como empleado:`,
            card: card
        };
    }

    /**
     * Genera tarjeta para recibos de nómina
     * @returns {Object} - Resultado con tarjeta
     */
    generarTarjetaRecibos() {
        const card = this.createAdaptiveCard(this.apiActions.recibos.periodos);
        
        return {
            textContent: `📅 **Consulta de Recibos**\n\nRevisa los periodos de pago disponibles:`,
            card: card
        };
    }

    /**
     * Genera tarjeta para vacaciones por matrimonio
     * @returns {Object} - Resultado con tarjeta
     */
    generarTarjetaMatrimonio() {
        const card = this.createAdaptiveCard(this.apiActions.matrimonio.solicitar);
        
        return {
            textContent: `💍 **Vacaciones por Matrimonio**\n\nSolicita tus días por matrimonio:`,
            card: card
        };
    }

    /**
     * Genera tarjeta para vacaciones por nacimiento
     * @returns {Object} - Resultado con tarjeta
     */
    generarTarjetaNacimiento() {
        const card = this.createAdaptiveCard(this.apiActions.nacimiento.solicitar);
        
        return {
            textContent: `👶 **Vacaciones por Nacimiento**\n\nSolicita tus días por paternidad/maternidad:`,
            card: card
        };
    }

    /**
     * Genera tarjetas para autorización de solicitudes
     * @param {string} accion - Acción a realizar (autorizar, rechazar, cancelar)
     * @returns {Object} - Resultado con tarjeta
     */
    generarTarjetaAutorizacion(accion) {
        const actionConfig = this.apiActions.autorizacion[accion];
        const card = this.createAdaptiveCard(actionConfig);
        
        return {
            textContent: `🔧 **Gestión de Solicitudes**\n\nEjecuta la acción "${actionConfig.title}":`,
            card: card
        };
    }

    /**
     * Crea una tarjeta adaptativa individual
     * @param {Object} action - Configuración de la acción
     * @returns {Object} - Tarjeta adaptativa
     */
    createAdaptiveCard(action) {
        // Crear elementos del cuerpo de la tarjeta
        const bodyElements = [
            // TÍTULO PRINCIPAL
            {
                type: 'TextBlock',
                text: `${action.icon || '🔧'} ${action.title}`,
                size: 'Large',
                weight: 'Bolder',
                color: 'Accent',
                wrap: true,
                horizontalAlignment: 'Center'
            },
            // Separador visual
            {
                type: 'TextBlock',
                text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                size: 'Small',
                color: 'Accent',
                horizontalAlignment: 'Center',
                spacing: 'Small'
            },
            // Descripción
            {
                type: 'TextBlock',
                text: action.description,
                wrap: true,
                spacing: 'Medium',
                color: 'Default'
            },
            // Información del método
            {
                type: 'FactSet',
                facts: [
                    {
                        title: 'Método:',
                        value: action.method
                    },
                    {
                        title: 'Endpoint:',
                        value: action.url.split('/').pop() || 'API'
                    }
                ],
                spacing: 'Medium'
            }
        ];

        // Agregar campos específicos de la acción
        if (action.fields && action.fields.length > 0) {
            bodyElements.push({
                type: 'TextBlock',
                text: '📝 Parámetros adicionales:',
                weight: 'Bolder',
                spacing: 'Large'
            });

            action.fields.forEach(field => {
                // Agregar etiqueta del campo
                bodyElements.push({
                    type: 'TextBlock',
                    text: `${this._getFieldIcon(field.type)} ${field.label}${field.required ? ' *' : ''}:`,
                    weight: 'Bolder',
                    spacing: 'Medium'
                });

                // Agregar input del campo
                const inputElement = this._createInputElement(field);
                bodyElements.push(inputElement);
            });
        } else {
            // Si no hay campos, agregar nota informativa
            bodyElements.push({
                type: 'TextBlock',
                text: '✅ Esta acción no requiere parámetros adicionales',
                isSubtle: true,
                spacing: 'Large',
                horizontalAlignment: 'Center'
            });
        }

        // Crear la tarjeta adaptativa
        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.3',
            body: bodyElements,
            actions: [
                {
                    type: 'Action.Submit',
                    title: `${action.icon || '▶️'} Ejecutar`,
                    data: {
                        action: action.title,
                        method: action.method,
                        url: action.url
                    },
                    style: 'positive'
                }
            ],
            speak: `Acción disponible: ${action.title}. ${action.description}`
        };

        return CardFactory.adaptiveCard(card);
    }

    /**
     * Obtiene el icono apropiado para un tipo de campo
     * @param {string} fieldType - Tipo de campo
     * @returns {string} - Icono emoji
     * @private
     */
    _getFieldIcon(fieldType) {
        switch (fieldType) {
            case 'date': return '📅';
            case 'choice': return '📝';
            case 'text': return '✏️';
            default: return '📄';
        }
    }

    /**
     * Crea un elemento de input para un campo específico
     * @param {Object} field - Configuración del campo
     * @returns {Object} - Elemento de input
     * @private
     */
    _createInputElement(field) {
        const baseInput = {
            id: field.id,
            isRequired: field.required || false,
            spacing: 'Small'
        };

        if (field.type === 'date') {
            return {
                ...baseInput,
                type: 'Input.Date',
                placeholder: field.placeholder || field.label
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
                placeholder: field.placeholder || field.label,
                value: field.value || ''
            };
        }
    }

    // MÉTODOS EXISTENTES (sin cambios)

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

            /* 3. Formatear resultados */
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