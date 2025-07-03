// utilities/auth_diagnostic.js - Utilidad para diagnosticar problemas de autenticación - VERSIÓN MEJORADA

class AuthDiagnostic {
    constructor() {
        this.diagnosticHistory = [];
        this.maxHistorySize = 200; // Aumentar para más historial
        this.authFlowTracking = new Map(); // Para rastrear flujos de autenticación
    }

    /**
     * Registra un evento de diagnóstico
     * @param {string} userId - ID del usuario
     * @param {string} event - Tipo de evento
     * @param {Object} details - Detalles del evento
     */
    logEvent(userId, event, details = {}) {
        const logEntry = {
            userId,
            event,
            details,
            timestamp: new Date().toISOString(),
            id: Date.now() + Math.random()
        };

        this.diagnosticHistory.push(logEntry);
        
        // Mantener solo los últimos registros
        if (this.diagnosticHistory.length > this.maxHistorySize) {
            this.diagnosticHistory.shift();
        }

        // Rastrear flujo de autenticación
        this.trackAuthFlow(userId, event, details);

        console.log(`AuthDiagnostic[${userId}]: ${event} - ${JSON.stringify(details)}`);
    }

    /**
     * Rastrea el flujo de autenticación
     * @param {string} userId - ID del usuario
     * @param {string} event - Evento
     * @param {Object} details - Detalles
     * @private
     */
    trackAuthFlow(userId, event, details) {
        if (!this.authFlowTracking.has(userId)) {
            this.authFlowTracking.set(userId, {
                startTime: null,
                steps: [],
                currentState: 'NOT_STARTED',
                lastActivity: new Date().toISOString()
            });
        }

        const flow = this.authFlowTracking.get(userId);
        flow.steps.push({ event, details, timestamp: new Date().toISOString() });
        flow.lastActivity = new Date().toISOString();

        // Actualizar estado según el evento
        switch (event) {
            case 'LOGIN_REQUESTED':
                flow.currentState = 'LOGIN_INITIATED';
                flow.startTime = new Date().toISOString();
                break;
            case 'OAUTH_STARTED':
                flow.currentState = 'OAUTH_IN_PROGRESS';
                break;
            case 'TOKEN_RECEIVED':
                flow.currentState = 'TOKEN_PROCESSING';
                break;
            case 'AUTH_SUCCESS':
                flow.currentState = 'AUTHENTICATED';
                break;
            case 'AUTH_FAILED':
            case 'AUTH_CANCELLED':
                flow.currentState = 'FAILED';
                break;
            case 'LOGOUT':
                flow.currentState = 'LOGGED_OUT';
                break;
        }

        // Limpiar flujos antiguos (más de 1 hora)
        const cutoffTime = new Date(Date.now() - 60 * 60 * 1000);
        for (const [trackingUserId, trackingFlow] of this.authFlowTracking.entries()) {
            if (new Date(trackingFlow.lastActivity) < cutoffTime) {
                this.authFlowTracking.delete(trackingUserId);
            }
        }
    }

    /**
     * Obtiene el flujo de autenticación para un usuario
     * @param {string} userId - ID del usuario
     * @returns {Object} - Flujo de autenticación
     */
    getAuthFlow(userId) {
        return this.authFlowTracking.get(userId) || null;
    }

    /**
     * Obtiene el historial de eventos para un usuario
     * @param {string} userId - ID del usuario
     * @returns {Array} - Historial de eventos
     */
    getUserHistory(userId) {
        return this.diagnosticHistory.filter(entry => entry.userId === userId);
    }

    /**
     * Diagnóstica el estado actual de autenticación
     * @param {string} userId - ID del usuario
     * @param {Object} context - Contexto del bot
     * @returns {Object} - Reporte de diagnóstico
     */
    async diagnoseAuthState(userId, context) {
        const report = {
            userId,
            timestamp: new Date().toISOString(),
            checks: {},
            authFlow: this.getAuthFlow(userId),
            recommendations: [],
            summary: ''
        };

        try {
            // 1. Verificar bot instance
            const bot = context.turnState.get('bot');
            report.checks.botInstance = {
                exists: !!bot,
                hasAuthMethods: !!(bot && bot.isUserAuthenticated && bot.setUserAuthenticated),
                authenticatedInMemory: bot ? bot.isUserAuthenticated(userId) : false,
                userInfo: bot && bot.authenticatedUsers ? bot.authenticatedUsers.get(userId) : null
            };

            // 2. Verificar estado persistente
            const userState = context.turnState.get('UserState');
            if (userState) {
                const authState = userState.createProperty('AuthState');
                const authData = await authState.get(context, {});
                report.checks.persistentState = {
                    userStateExists: true,
                    userAuthData: authData[userId] || null,
                    authenticated: authData[userId]?.authenticated === true,
                    lastAuthenticated: authData[userId]?.lastAuthenticated || null
                };
            } else {
                report.checks.persistentState = {
                    userStateExists: false,
                    error: 'UserState no encontrado'
                };
            }

            // 3. Verificar procesos activos
            if (bot) {
                const stats = bot.getStats();
                report.checks.activeProcesses = {
                    authenticatedUsers: stats.authenticatedUsers,
                    activeDialogs: stats.activeDialogs,
                    activeProcesses: stats.activeProcesses,
                    authTimeouts: stats.authTimeouts,
                    userHasActiveProcess: bot.activeProcesses ? bot.activeProcesses.has(userId) : false,
                    userHasActiveDialog: bot.activeDialogs ? bot.activeDialogs.has(`auth-${userId}`) : false
                };
            }

            // 4. Verificar mainDialog
            const mainDialog = global.mainDialogInstance;
            if (mainDialog) {
                const dialogStats = mainDialog.getDialogStats();
                report.checks.mainDialog = {
                    exists: true,
                    stats: dialogStats,
                    userInProcessing: dialogStats.processingUsersList.includes(userId),
                    userHasActiveDialog: dialogStats.activeDialogs.includes(`auth-dialog-${userId}`)
                };
            } else {
                report.checks.mainDialog = {
                    exists: false,
                    error: 'MainDialog instance no encontrada'
                };
            }

            // 5. Verificar historial de eventos
            const userHistory = this.getUserHistory(userId);
            const recentEvents = userHistory.slice(-10);
            report.checks.eventHistory = {
                totalEvents: userHistory.length,
                recentEvents: recentEvents,
                lastEvent: userHistory[userHistory.length - 1] || null,
                errorCount: userHistory.filter(e => e.event.includes('ERROR')).length,
                successCount: userHistory.filter(e => e.event.includes('SUCCESS')).length
            };

            // 6. Verificar token OAuth
            if (bot && bot.authenticatedUsers && bot.authenticatedUsers.has(userId)) {
                const userInfo = bot.authenticatedUsers.get(userId);
                report.checks.oauthToken = {
                    exists: !!userInfo.token,
                    length: userInfo.token ? userInfo.token.length : 0,
                    startsWithBearer: userInfo.token ? userInfo.token.startsWith('Bearer ') : false
                };
            }

            // 7. Generar recomendaciones
            this.generateRecommendations(report);

            // 8. Generar resumen
            this.generateSummary(report);

            this.logEvent(userId, 'DIAGNOSTIC_COMPLETE', { 
                checksCompleted: Object.keys(report.checks).length,
                recommendations: report.recommendations.length,
                authFlowState: report.authFlow?.currentState || 'UNKNOWN'
            });

        } catch (error) {
            report.error = error.message;
            report.checks.error = {
                message: error.message,
                stack: error.stack
            };
            
            this.logEvent(userId, 'DIAGNOSTIC_ERROR', { error: error.message });
        }

        return report;
    }

    /**
     * Genera recomendaciones basadas en el diagnóstico
     * @param {Object} report - Reporte de diagnóstico
     * @private
     */
    generateRecommendations(report) {
        const { checks } = report;
        const recommendations = [];

        // Verificar bot instance
        if (!checks.botInstance?.exists) {
            recommendations.push({
                priority: 'HIGH',
                issue: 'Bot instance no encontrada',
                solution: 'Verificar que el bot esté correctamente inicializado en el contexto'
            });
        }

        // Verificar autenticación inconsistente
        if (checks.botInstance?.authenticatedInMemory !== checks.persistentState?.authenticated) {
            recommendations.push({
                priority: 'MEDIUM',
                issue: 'Estado de autenticación inconsistente entre memoria y persistencia',
                solution: 'Ejecutar limpieza de estados y re-autenticar'
            });
        }

        // Verificar procesos bloqueados
        if (checks.activeProcesses?.userHasActiveProcess || checks.activeProcesses?.userHasActiveDialog) {
            recommendations.push({
                priority: 'HIGH',
                issue: 'Usuario tiene procesos activos que pueden estar bloqueando',
                solution: 'Limpiar procesos activos del usuario'
            });
        }

        // Verificar mainDialog
        if (!checks.mainDialog?.exists) {
            recommendations.push({
                priority: 'HIGH',
                issue: 'MainDialog instance no encontrada',
                solution: 'Verificar que MainDialog esté correctamente registrado globalmente'
            });
        } else if (checks.mainDialog?.userInProcessing) {
            recommendations.push({
                priority: 'MEDIUM',
                issue: 'Usuario está siendo procesado en MainDialog',
                solution: 'Puede estar causando bloqueos. Considerar limpiar estado de procesamiento'
            });
        }

        // Verificar flujo de autenticación
        if (report.authFlow) {
            const timeSinceStart = report.authFlow.startTime ? 
                Date.now() - new Date(report.authFlow.startTime).getTime() : 0;
            
            if (report.authFlow.currentState === 'OAUTH_IN_PROGRESS' && timeSinceStart > 5 * 60 * 1000) {
                recommendations.push({
                    priority: 'HIGH',
                    issue: 'Flujo OAuth lleva más de 5 minutos en progreso',
                    solution: 'Cancelar flujo actual y reiniciar proceso de autenticación'
                });
            }
        }

        // Verificar eventos recientes
        const recentEvents = checks.eventHistory?.recentEvents || [];
        const errorEvents = recentEvents.filter(e => e.event.includes('ERROR'));
        if (errorEvents.length > 2) {
            recommendations.push({
                priority: 'HIGH',
                issue: `${errorEvents.length} errores recientes detectados`,
                solution: 'Revisar logs detallados e implementar recuperación automática'
            });
        }

        // Verificar token OAuth
        if (checks.oauthToken && checks.oauthToken.exists && !checks.oauthToken.startsWithBearer) {
            recommendations.push({
                priority: 'MEDIUM',
                issue: 'Token OAuth no tiene formato Bearer correcto',
                solution: 'Verificar formato del token en las peticiones HTTP'
            });
        }

        report.recommendations = recommendations;
    }

    /**
     * Genera resumen del diagnóstico
     * @param {Object} report - Reporte de diagnóstico
     * @private
     */
    generateSummary(report) {
        const { checks, recommendations } = report;
        const issues = recommendations.filter(r => r.priority === 'HIGH').length;
        const warnings = recommendations.filter(r => r.priority === 'MEDIUM').length;

        let summary = `Diagnóstico completado para usuario ${report.userId}. `;
        
        if (issues > 0) {
            summary += `⚠️ ${issues} problema(s) crítico(s) detectado(s). `;
        }
        
        if (warnings > 0) {
            summary += `⚡ ${warnings} advertencia(s) encontrada(s). `;
        }

        if (issues === 0 && warnings === 0) {
            summary += `✅ No se encontraron problemas significativos.`;
        }

        // Estado de autenticación
        const memoryAuth = checks.botInstance?.authenticatedInMemory;
        const persistentAuth = checks.persistentState?.authenticated;
        
        if (memoryAuth && persistentAuth) {
            summary += ` Estado: Autenticado correctamente.`;
        } else if (memoryAuth || persistentAuth) {
            summary += ` Estado: Autenticación parcial (inconsistente).`;
        } else {
            summary += ` Estado: No autenticado.`;
        }

        // Flujo de autenticación
        if (report.authFlow) {
            summary += ` Flujo: ${report.authFlow.currentState}.`;
        }

        report.summary = summary;
    }

    /**
     * Ejecuta acciones de reparación automática - VERSIÓN MEJORADA
     * @param {string} userId - ID del usuario
     * @param {Object} context - Contexto del bot
     * @returns {Object} - Resultado de las reparaciones
     */
    async executeAutoFix(userId, context) {
        const fixResults = {
            userId,
            timestamp: new Date().toISOString(),
            actionsExecuted: [],
            success: true,
            errors: []
        };

        try {
            this.logEvent(userId, 'AUTO_FIX_START', {});

            // 1. Limpiar procesos obsoletos en bot
            const bot = context.turnState.get('bot');
            if (bot) {
                // Limpiar procesos específicos del usuario
                if (bot.activeProcesses && bot.activeProcesses.has(userId)) {
                    bot.activeProcesses.delete(userId);
                    fixResults.actionsExecuted.push({
                        action: 'clear_user_active_process',
                        result: 'Proceso activo del usuario eliminado'
                    });
                }

                if (bot.activeDialogs && bot.activeDialogs.has(`auth-${userId}`)) {
                    bot.activeDialogs.delete(`auth-${userId}`);
                    fixResults.actionsExecuted.push({
                        action: 'clear_user_active_dialog',
                        result: 'Diálogo activo del usuario eliminado'
                    });
                }

                // Limpiar timeout de autenticación
                if (bot.authTimeoutManager) {
                    bot.authTimeoutManager.clearAuthTimeout(userId);
                    fixResults.actionsExecuted.push({
                        action: 'clear_auth_timeout',
                        result: 'Timeout de autenticación eliminado'
                    });
                }

                // Limpiar procesos obsoletos generales
                if (typeof bot.cleanupStaleProcesses === 'function') {
                    const cleaned = bot.cleanupStaleProcesses();
                    fixResults.actionsExecuted.push({
                        action: 'cleanup_stale_processes',
                        result: `${cleaned} procesos obsoletos limpiados`
                    });
                }
            }

            // 2. Limpiar diálogos obsoletos en mainDialog
            const mainDialog = global.mainDialogInstance;
            if (mainDialog) {
                if (typeof mainDialog.endUserDialog === 'function') {
                    const hadDialog = mainDialog.endUserDialog(userId);
                    fixResults.actionsExecuted.push({
                        action: 'end_user_dialog',
                        result: hadDialog ? 'Diálogo terminado' : 'No había diálogo activo'
                    });
                }

                // Limpiar de processingUsers
                if (mainDialog.processingUsers && mainDialog.processingUsers.has(userId)) {
                    mainDialog.processingUsers.delete(userId);
                    fixResults.actionsExecuted.push({
                        action: 'clear_processing_user',
                        result: 'Usuario removido de processingUsers'
                    });
                }
            }

            // 3. Sincronizar estados de autenticación
            if (bot) {
                try {
                    const userState = context.turnState.get('UserState');
                    if (userState) {
                        const authState = userState.createProperty('AuthState');
                        const authData = await authState.get(context, {});
                        const memoryAuth = bot.isUserAuthenticated(userId);
                        const persistentAuth = authData[userId]?.authenticated === true;

                        if (memoryAuth !== persistentAuth) {
                            if (memoryAuth && !persistentAuth) {
                                const userInfo = bot.authenticatedUsers.get(userId);
                                if (userInfo) {
                                    authData[userId] = {
                                        authenticated: true,
                                        email: userInfo.email,
                                        name: userInfo.name,
                                        token: userInfo.token,
                                        lastAuthenticated: new Date().toISOString()
                                    };
                                    await authState.set(context, authData);
                                    await userState.saveChanges(context);
                                    
                                    fixResults.actionsExecuted.push({
                                        action: 'sync_auth_state',
                                        result: 'Estado persistente actualizado desde memoria'
                                    });
                                }
                            } else if (!memoryAuth && persistentAuth) {
                                delete authData[userId];
                                await authState.set(context, authData);
                                await userState.saveChanges(context);
                                
                                fixResults.actionsExecuted.push({
                                    action: 'sync_auth_state',
                                    result: 'Estado persistente limpiado'
                                });
                            }
                        }
                    }
                } catch (error) {
                    fixResults.errors.push(`Error sincronizando estados: ${error.message}`);
                }
            }

            // 4. Limpiar flujo de autenticación
            if (this.authFlowTracking.has(userId)) {
                const flow = this.authFlowTracking.get(userId);
                flow.currentState = 'CLEANED';
                flow.lastActivity = new Date().toISOString();
                
                fixResults.actionsExecuted.push({
                    action: 'clear_auth_flow_tracking',
                    result: 'Flujo de autenticación reiniciado'
                });
            }

            this.logEvent(userId, 'AUTO_FIX_COMPLETE', {
                actionsExecuted: fixResults.actionsExecuted.length,
                errors: fixResults.errors.length
            });

            fixResults.success = fixResults.errors.length === 0;

        } catch (error) {
            fixResults.success = false;
            fixResults.errors.push(`Error crítico en auto-fix: ${error.message}`);
            this.logEvent(userId, 'AUTO_FIX_ERROR', { error: error.message });
        }

        return fixResults;
    }

    /**
     * Formatea un reporte de diagnóstico para mostrar al usuario
     * @param {Object} report - Reporte de diagnóstico
     * @returns {string} - Reporte formateado
     */
    formatReportForUser(report) {
        let formatted = `🔍 **Diagnóstico de Autenticación**\n\n`;
        formatted += `**Usuario**: ${report.userId}\n`;
        formatted += `**Hora**: ${new Date(report.timestamp).toLocaleString('es-MX')}\n\n`;
        
        formatted += `**Resumen**: ${report.summary}\n\n`;

        // Flujo de autenticación
        if (report.authFlow) {
            formatted += `**Flujo de Autenticación**:\n`;
            formatted += `• Estado: ${report.authFlow.currentState}\n`;
            formatted += `• Pasos: ${report.authFlow.steps.length}\n`;
            if (report.authFlow.startTime) {
                formatted += `• Iniciado: ${new Date(report.authFlow.startTime).toLocaleString('es-MX')}\n`;
            }
            formatted += `• Última actividad: ${new Date(report.authFlow.lastActivity).toLocaleString('es-MX')}\n\n`;
        }

        if (report.recommendations.length > 0) {
            formatted += `**Recomendaciones**:\n`;
            report.recommendations.forEach((rec, index) => {
                const emoji = rec.priority === 'HIGH' ? '🚨' : '⚠️';
                formatted += `${emoji} **${rec.issue}**\n`;
                formatted += `   _Solución_: ${rec.solution}\n\n`;
            });
        }

        // Estado detallado
        formatted += `**Estado Detallado**:\n`;
        formatted += `• Bot Instance: ${report.checks.botInstance?.exists ? '✅' : '❌'}\n`;
        formatted += `• Memoria: ${report.checks.botInstance?.authenticatedInMemory ? '✅' : '❌'}\n`;
        formatted += `• Persistencia: ${report.checks.persistentState?.authenticated ? '✅' : '❌'}\n`;
        formatted += `• Proceso Activo: ${report.checks.activeProcesses?.userHasActiveProcess ? '⚠️' : '✅'}\n`;
        formatted += `• Diálogo Activo: ${report.checks.activeProcesses?.userHasActiveDialog ? '⚠️' : '✅'}\n`;
        formatted += `• Eventos Totales: ${report.checks.eventHistory?.totalEvents || 0}\n`;
        formatted += `• Errores: ${report.checks.eventHistory?.errorCount || 0}\n`;

        return formatted;
    }

    /**
     * Obtiene estadísticas generales del diagnóstico
     * @returns {Object} - Estadísticas generales
     */
    getGeneralStats() {
        const eventsByType = {};
        const userActivity = {};

        this.diagnosticHistory.forEach(entry => {
            // Contar eventos por tipo
            if (!eventsByType[entry.event]) {
                eventsByType[entry.event] = 0;
            }
            eventsByType[entry.event]++;

            // Contar actividad por usuario
            if (!userActivity[entry.userId]) {
                userActivity[entry.userId] = 0;
            }
            userActivity[entry.userId]++;
        });

        return {
            totalEvents: this.diagnosticHistory.length,
            eventsByType,
            userActivity,
            activeUsers: Object.keys(userActivity).length,
            activeAuthFlows: this.authFlowTracking.size,
            oldestEvent: this.diagnosticHistory[0]?.timestamp,
            newestEvent: this.diagnosticHistory[this.diagnosticHistory.length - 1]?.timestamp
        };
    }

    /**
     * Comando de emergencia para limpiar todo
     * @param {string} userId - ID del usuario
     * @returns {Object} - Resultado de limpieza
     */
    emergencyCleanup(userId) {
        const cleaned = {
            authFlow: false,
            diagnosticHistory: 0
        };

        // Limpiar flujo de autenticación
        if (this.authFlowTracking.has(userId)) {
            this.authFlowTracking.delete(userId);
            cleaned.authFlow = true;
        }

        // Limpiar historial de eventos del usuario
        const beforeLength = this.diagnosticHistory.length;
        this.diagnosticHistory = this.diagnosticHistory.filter(entry => entry.userId !== userId);
        cleaned.diagnosticHistory = beforeLength - this.diagnosticHistory.length;

        this.logEvent(userId, 'EMERGENCY_CLEANUP', cleaned);

        return cleaned;
    }
}

// Exportar instancia única
module.exports = new AuthDiagnostic();