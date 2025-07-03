// ============================================================================
// FUNCIONES ELIMINADAS DEL OPENAI SERVICE - PARA USO FUTURO
// ============================================================================
// Estas funciones fueron removidas temporalmente pero pueden ser reintegradas
// cuando sea necesario activar estas funcionalidades.

// ============================================================================
// 1. HERRAMIENTAS PARA AGREGAR AL MÉTODO defineTools()
// ============================================================================

// Agregar estas herramientas al array 'tools' en defineTools():

/*
// HERRAMIENTAS DE EMPLEADO Y RECIBOS
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

// HERRAMIENTAS DE SERVICENOW
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
*/

// ============================================================================
// 2. ACCIONES DE API PARA AGREGAR AL MÉTODO defineApiActions()
// ============================================================================

// Agregar estas acciones al objeto de retorno en defineApiActions():

/*
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
*/

// ============================================================================
// 3. CASOS PARA AGREGAR AL MÉTODO ejecutarHerramienta()
// ============================================================================

// Agregar estos casos al switch statement en ejecutarHerramienta():

/*
// TARJETAS ELIMINADAS
case 'generar_tarjeta_empleado':
    return this.generarTarjetaEmpleado();

case 'generar_tarjeta_recibos':
    return this.generarTarjetaRecibos();

// HERRAMIENTAS DE SERVICENOW
case 'get_incident':
    return await this.ejecutarGetIncident(parametros.number);

case 'get_incident_key_list':
    return await this.ejecutarGetIncidentKeyList(parametros.query);

case 'create_incident_by_ci':
    return await this.ejecutarCreateIncidentByCI(parametros);
*/

// ============================================================================
// 4. MÉTODOS DE IMPLEMENTACIÓN
// ============================================================================

/**
 * Genera tarjeta para información del empleado
 * @returns {Object} - Resultado con tarjeta
 */
function generarTarjetaEmpleado() {
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
function generarTarjetaRecibos() {
    const card = this.createAdaptiveCard(this.apiActions.recibos.periodos);
    
    return {
        textContent: `📅 **Consulta de Recibos**\n\nRevisa los periodos de pago disponibles:`,
        card: card
    };
}

/**
 * Ejecuta consulta de incidente
 * @param {string} number - Número de incidente
 * @returns {Object} - Datos del incidente
 */
async function ejecutarGetIncident(number) {
    try {
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
async function ejecutarGetIncidentKeyList(query) {
    try {
        if (!process.env.TOKEN_API) {
            return { error: "El servicio de incidentes no está configurado" };
        }
        
        console.log(`Buscando incidentes con query: ${query}`);
        
        const res = await axios.get(
            'https://api.supporttsmx.com.mx/TSMX/SNOW/Incident/GetIncidentKeyList',
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
async function ejecutarCreateIncidentByCI(parametros) {
    try {
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

// ============================================================================
// INSTRUCCIONES PARA REINTEGRAR ESTAS FUNCIONES:
// ============================================================================

/*
PASOS PARA REINTEGRAR:

1. **Herramientas**: Copiar las herramientas comentadas arriba y agregarlas al array 'tools' en el método defineTools()

2. **Acciones API**: Copiar las acciones comentadas arriba y agregarlas al objeto de retorno en defineApiActions()

3. **Casos Switch**: Agregar los casos comentados arriba al switch statement en ejecutarHerramienta()

4. **Métodos**: Copiar los métodos de implementación (generarTarjetaEmpleado, generarTarjetaRecibos, ejecutarGetIncident, etc.) 
   como métodos de la clase OpenAIService

5. **Condición ServiceNow**: Asegurar que la sección de herramientas ServiceNow en defineTools() esté condicionada con:
   if (process.env.TOKEN_API) { ... }

6. **Imports**: Verificar que los imports necesarios estén presentes (axios, https están ya incluidos)

7. **Variables de Entorno**: Asegurar que TOKEN_API esté configurado para ServiceNow

NOTAS:
- Las funciones están listas para ser reintegradas
- Mantener la estructura de condicionales para tokens de API
- Verificar que los endpoints de API sigan siendo válidos
- Testear cada función después de reintegrarla
*/