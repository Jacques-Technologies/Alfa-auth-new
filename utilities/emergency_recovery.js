// utilities/emergency_recovery.js - Utilidad de recuperación de emergencia

class EmergencyRecovery {
    constructor() {
        this.recoveryHistory = [];
        this.maxHistorySize = 50;
    }

    /**
     * Ejecuta recuperación de emergencia para un usuario específico
     * @param {string} userId - ID del usuario bloqueado
     * @returns {Object} - Resultado de la recuperación
     */
    async executeEmergencyRecovery(userId) {
        const recoveryResult = {
            userId,
            timestamp: new Date().toISOString(),
            actionsExecuted: [],
            success: false,
            errors: []
        };

        console.log(`🚨 RECUPERACIÓN DE EMERGENCIA INICIADA para usuario: ${userId}`);

        try {
            // 1. Limpiar bot instance
            const bot = global.botInstance;
            if (bot) {
                console.log(`[${userId}] Limpiando estados del bot...`);
                
                // Limpiar procesos activos
                if (bot.activeProcesses && bot.activeProcesses.has(userId)) {
                    bot.activeProcesses.delete(userId);
                    recoveryResult.actionsExecuted.push('bot_active_process_cleared');
                }
                
                // Limpiar diálogos activos
                if (bot.activeDialogs && bot.activeDialogs.has(`auth-${userId}`)) {
                    bot.activeDialogs.delete(`auth-${userId}`);
                    recoveryResult.actionsExecuted.push('bot_active_dialog_cleared');
                }
                
                // Limpiar timeout de autenticación
                if (bot.authTimeoutManager) {
                    bot.authTimeoutManager.clearAuthTimeout(userId);
                    recoveryResult.actionsExecuted.push('auth_timeout_cleared');
                }
                
                // Limpiar usuario autenticado (opcional)
                if (bot.authenticatedUsers && bot.authenticatedUsers.has(userId)) {
                    bot.authenticatedUsers.delete(userId);
                    recoveryResult.actionsExecuted.push('authenticated_user_cleared');
                }
                
                console.log(`[${userId}] Estados del bot limpiados`);
            } else {
                recoveryResult.errors.push('Bot instance no encontrada');
            }

            // 2. Limpiar MainDialog
            const mainDialog = global.mainDialogInstance;
            if (mainDialog) {
                console.log(`[${userId}] Limpiando estados del MainDialog...`);
                
                const cleanupResult = mainDialog.emergencyUserCleanup(userId);
                recoveryResult.actionsExecuted.push(...cleanupResult.actionsExecuted.map(action => `main_dialog_${action}`));
                
                console.log(`[${userId}] Estados del MainDialog limpiados`);
            } else {
                recoveryResult.errors.push('MainDialog instance no encontrada');
            }

            // 3. Limpiar estados obsoletos generales
            if (bot && typeof bot.cleanupStaleProcesses === 'function') {
                const staleProcesses = bot.cleanupStaleProcesses();
                if (staleProcesses > 0) {
                    recoveryResult.actionsExecuted.push(`stale_processes_cleaned_${staleProcesses}`);
                }
            }

            if (mainDialog && typeof mainDialog.cleanupStaleDialogs === 'function') {
                const staleDialogs = mainDialog.cleanupStaleDialogs();
                if (staleDialogs > 0) {
                    recoveryResult.actionsExecuted.push(`stale_dialogs_cleaned_${staleDialogs}`);
                }
            }

            // 4. Registrar recuperación exitosa
            recoveryResult.success = recoveryResult.errors.length === 0;
            
            this.recordRecovery(recoveryResult);
            
            console.log(`✅ RECUPERACIÓN DE EMERGENCIA COMPLETADA para usuario: ${userId}`);
            console.log(`Acciones ejecutadas: ${recoveryResult.actionsExecuted.join(', ')}`);
            
            if (recoveryResult.errors.length > 0) {
                console.warn(`⚠️ Errores durante la recuperación: ${recoveryResult.errors.join(', ')}`);
            }

        } catch (error) {
            console.error(`❌ ERROR CRÍTICO en recuperación de emergencia para ${userId}:`, error);
            recoveryResult.success = false;
            recoveryResult.errors.push(`Error crítico: ${error.message}`);
        }

        return recoveryResult;
    }

    /**
     * Ejecuta recuperación completa del sistema
     * @returns {Object} - Resultado de la recuperación completa
     */
    async executeFullSystemRecovery() {
        const recoveryResult = {
            timestamp: new Date().toISOString(),
            actionsExecuted: [],
            success: false,
            errors: [],
            affectedUsers: 0
        };

        console.log(`🚨 RECUPERACIÓN COMPLETA DEL SISTEMA INICIADA`);

        try {
            // 1. Limpiar bot instance completamente
            const bot = global.botInstance;
            if (bot) {
                console.log(`Limpiando todos los estados del bot...`);
                
                // Limpiar todos los procesos activos
                if (bot.activeProcesses) {
                    const processCount = bot.activeProcesses.size;
                    bot.activeProcesses.clear();
                    recoveryResult.actionsExecuted.push(`all_active_processes_cleared_${processCount}`);
                    recoveryResult.affectedUsers += processCount;
                }
                
                // Limpiar todos los diálogos activos
                if (bot.activeDialogs) {
                    const dialogCount = bot.activeDialogs.size;
                    bot.activeDialogs.clear();
                    recoveryResult.actionsExecuted.push(`all_active_dialogs_cleared_${dialogCount}`);
                }
                
                // Limpiar todos los timeouts
                if (bot.authTimeoutManager) {
                    const timeoutResult = bot.authTimeoutManager.clearAllTimeouts();
                    recoveryResult.actionsExecuted.push(`all_auth_timeouts_cleared_${timeoutResult.cleared}`);
                }
                
                console.log(`Estados del bot limpiados completamente`);
            } else {
                recoveryResult.errors.push('Bot instance no encontrada');
            }

            // 2. Limpiar MainDialog completamente
            const mainDialog = global.mainDialogInstance;
            if (mainDialog) {
                console.log(`Limpiando todos los estados del MainDialog...`);
                
                const cleanupResult = mainDialog.forceCleanup();
                recoveryResult.actionsExecuted.push(`main_dialog_force_cleanup_${cleanupResult.activeAuthDialogsCleared}_${cleanupResult.processingUsersCleared}`);
                recoveryResult.affectedUsers += cleanupResult.activeAuthDialogsCleared;
                
                console.log(`Estados del MainDialog limpiados completamente`);
            } else {
                recoveryResult.errors.push('MainDialog instance no encontrada');
            }

            // 3. Registrar recuperación exitosa
            recoveryResult.success = recoveryResult.errors.length === 0;
            
            this.recordRecovery(recoveryResult);
            
            console.log(`✅ RECUPERACIÓN COMPLETA DEL SISTEMA COMPLETADA`);
            console.log(`Usuarios afectados: ${recoveryResult.affectedUsers}`);
            console.log(`Acciones ejecutadas: ${recoveryResult.actionsExecuted.join(', ')}`);
            
            if (recoveryResult.errors.length > 0) {
                console.warn(`⚠️ Errores durante la recuperación: ${recoveryResult.errors.join(', ')}`);
            }

        } catch (error) {
            console.error(`❌ ERROR CRÍTICO en recuperación completa del sistema:`, error);
            recoveryResult.success = false;
            recoveryResult.errors.push(`Error crítico: ${error.message}`);
        }

        return recoveryResult;
    }

    /**
     * Diagnostica el estado actual del sistema
     * @returns {Object} - Reporte de diagnóstico del sistema
     */
    diagnoseSystemState() {
        const report = {
            timestamp: new Date().toISOString(),
            botInstance: null,
            mainDialog: null,
            blockedUsers: [],
            recommendations: []
        };

        try {
            // Diagnosticar bot instance
            const bot = global.botInstance;
            if (bot) {
                report.botInstance = {
                    exists: true,
                    activeProcesses: bot.activeProcesses ? Array.from(bot.activeProcesses.keys()) : [],
                    activeDialogs: bot.activeDialogs ? Array.from(bot.activeDialogs) : [],
                    authenticatedUsers: bot.authenticatedUsers ? Array.from(bot.authenticatedUsers.keys()) : [],
                    authTimeouts: bot.authTimeoutManager ? bot.authTimeoutManager.getActiveTimeouts() : null
                };
            } else {
                report.botInstance = { exists: false };
            }

            // Diagnosticar MainDialog
            const mainDialog = global.mainDialogInstance;
            if (mainDialog) {
                const stats = mainDialog.getDialogStats();
                report.mainDialog = {
                    exists: true,
                    stats: stats
                };
            } else {
                report.mainDialog = { exists: false };
            }

            // Identificar usuarios bloqueados
            const activeDialogUsers = report.mainDialog?.stats?.activeDialogs || [];
            const processingUsers = report.mainDialog?.stats?.processingUsersList || [];
            const activeProcessUsers = report.botInstance?.activeProcesses || [];
            
            const allBlockedUsers = new Set([
                ...activeDialogUsers.map(d => d.replace('auth-dialog-', '')),
                ...processingUsers,
                ...activeProcessUsers
            ]);
            
            report.blockedUsers = Array.from(allBlockedUsers);

            // Generar recomendaciones
            if (report.blockedUsers.length > 0) {
                report.recommendations.push({
                    priority: 'HIGH',
                    issue: `${report.blockedUsers.length} usuarios bloqueados detectados`,
                    solution: 'Ejecutar recuperación de emergencia para usuarios específicos'
                });
            }

            if (!report.botInstance?.exists) {
                report.recommendations.push({
                    priority: 'CRITICAL',
                    issue: 'Bot instance no encontrada',
                    solution: 'Verificar inicialización del bot'
                });
            }

            if (!report.mainDialog?.exists) {
                report.recommendations.push({
                    priority: 'CRITICAL',
                    issue: 'MainDialog instance no encontrada',
                    solution: 'Verificar inicialización del MainDialog'
                });
            }

        } catch (error) {
            report.error = error.message;
        }

        return report;
    }

    /**
     * Registra una recuperación en el historial
     * @param {Object} recoveryResult - Resultado de la recuperación
     * @private
     */
    recordRecovery(recoveryResult) {
        this.recoveryHistory.push(recoveryResult);
        
        if (this.recoveryHistory.length > this.maxHistorySize) {
            this.recoveryHistory.shift();
        }
    }

    /**
     * Obtiene el historial de recuperaciones
     * @returns {Array} - Historial de recuperaciones
     */
    getRecoveryHistory() {
        return [...this.recoveryHistory];
    }

    /**
     * Formatea un reporte de diagnóstico para mostrar
     * @param {Object} report - Reporte de diagnóstico
     * @returns {string} - Reporte formateado
     */
    formatDiagnosticReport(report) {
        let formatted = `🔍 **Diagnóstico del Sistema**\n\n`;
        formatted += `**Hora**: ${new Date(report.timestamp).toLocaleString('es-MX')}\n\n`;
        
        // Estado del bot
        formatted += `**Bot Instance**: ${report.botInstance?.exists ? '✅ Disponible' : '❌ No encontrada'}\n`;
        if (report.botInstance?.exists) {
            formatted += `• Procesos activos: ${report.botInstance.activeProcesses.length}\n`;
            formatted += `• Diálogos activos: ${report.botInstance.activeDialogs.length}\n`;
            formatted += `• Usuarios autenticados: ${report.botInstance.authenticatedUsers.length}\n`;
        }
        
        // Estado del MainDialog
        formatted += `**MainDialog**: ${report.mainDialog?.exists ? '✅ Disponible' : '❌ No encontrada'}\n`;
        if (report.mainDialog?.exists) {
            formatted += `• Diálogos de auth activos: ${report.mainDialog.stats.activeAuthDialogs}\n`;
            formatted += `• Usuarios procesando: ${report.mainDialog.stats.processingUsers}\n`;
        }
        
        // Usuarios bloqueados
        formatted += `\n**Usuarios Bloqueados**: ${report.blockedUsers.length}\n`;
        if (report.blockedUsers.length > 0) {
            formatted += `• ${report.blockedUsers.slice(0, 3).join(', ')}`;
            if (report.blockedUsers.length > 3) {
                formatted += ` y ${report.blockedUsers.length - 3} más`;
            }
            formatted += '\n';
        }
        
        // Recomendaciones
        if (report.recommendations.length > 0) {
            formatted += `\n**Recomendaciones**:\n`;
            report.recommendations.forEach(rec => {
                const emoji = rec.priority === 'CRITICAL' ? '🚨' : rec.priority === 'HIGH' ? '⚠️' : '💡';
                formatted += `${emoji} ${rec.issue}\n`;
                formatted += `   _Solución_: ${rec.solution}\n\n`;
            });
        }
        
        return formatted;
    }
}

// Crear instancia única y funciones de conveniencia
const emergencyRecovery = new EmergencyRecovery();

// Funciones de acceso rápido
const unblockUser = async (userId) => {
    console.log(`🚨 DESBLOQUEANDO USUARIO: ${userId}`);
    return await emergencyRecovery.executeEmergencyRecovery(userId);
};

const resetSystem = async () => {
    console.log(`🚨 REINICIANDO SISTEMA COMPLETO`);
    return await emergencyRecovery.executeFullSystemRecovery();
};

const checkSystem = () => {
    console.log(`🔍 VERIFICANDO ESTADO DEL SISTEMA`);
    const report = emergencyRecovery.diagnoseSystemState();
    console.log(emergencyRecovery.formatDiagnosticReport(report));
    return report;
};

// Exportar todo
module.exports = {
    EmergencyRecovery,
    emergencyRecovery,
    unblockUser,
    resetSystem,
    checkSystem
};