// utilities/date_utils.js - Utilidades para manejo de fechas

/**
 * Convierte una fecha en diferentes formatos al formato ISO 8601
 * @param {string} dateString - Fecha en formato string
 * @returns {string|null} - Fecha en formato ISO o null si no se puede convertir
 */
function convertToISODate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  // Si ya está en formato ISO, validar y devolver
  if (dateString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/)) {
    return dateString.endsWith('Z') ? dateString : dateString + 'Z';
  }

  // Si es solo una fecha YYYY-MM-DD, agregar tiempo
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateString + 'T00:00:00.000Z';
  }

  let date = null;

  // Formato dd-MM-yyyy o dd/MM/yyyy (más común en México)
  const ddMMyyyyMatch = dateString.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddMMyyyyMatch) {
    const day = ddMMyyyyMatch[1].padStart(2, '0');
    const month = ddMMyyyyMatch[2].padStart(2, '0');
    const year = ddMMyyyyMatch[3];
    
    // Validar rangos de fecha
    if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
        parseInt(day) >= 1 && parseInt(day) <= 31) {
      date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    }
  }

  // Formato yyyy-MM-dd
  if (!date) {
    const yyyyMMddMatch = dateString.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (yyyyMMddMatch) {
      const year = yyyyMMddMatch[1];
      const month = yyyyMMddMatch[2].padStart(2, '0');
      const day = yyyyMMddMatch[3].padStart(2, '0');
      
      if (parseInt(month) >= 1 && parseInt(month) <= 12 && 
          parseInt(day) >= 1 && parseInt(day) <= 31) {
        date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      }
    }
  }

  // Intentar con Date.parse como último recurso
  if (!date) {
    try {
      date = new Date(dateString);
      if (isNaN(date.getTime())) {
        date = null;
      }
    } catch (error) {
      return null;
    }
  }

  // Convertir a ISO string si es válida
  if (date && !isNaN(date.getTime())) {
    return date.toISOString();
  }

  return null;
}

/**
 * Valida si una fecha está en un rango válido
 * @param {Date} date - Fecha a validar
 * @param {Date} minDate - Fecha mínima (opcional)
 * @param {Date} maxDate - Fecha máxima (opcional)
 * @returns {boolean} - Si la fecha es válida
 */
function isValidDateRange(date, minDate = null, maxDate = null) {
  if (!date || isNaN(date.getTime())) {
    return false;
  }

  if (minDate && date < minDate) {
    return false;
  }

  if (maxDate && date > maxDate) {
    return false;
  }

  return true;
}

/**
 * Formatea una fecha para mostrar al usuario
 * @param {Date|string} date - Fecha a formatear
 * @param {string} locale - Locale para formateo (default: 'es-MX')
 * @returns {string} - Fecha formateada
 */
function formatDateForDisplay(date, locale = 'es-MX') {
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return 'Fecha inválida';
    }

    return dateObj.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return 'Fecha inválida';
  }
}

/**
 * Calcula la diferencia en días entre dos fechas
 * @param {Date|string} startDate - Fecha de inicio
 * @param {Date|string} endDate - Fecha de fin
 * @returns {number} - Diferencia en días
 */
function calculateDaysDifference(startDate, endDate) {
  try {
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 0;
    }

    const timeDiff = end.getTime() - start.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  } catch (error) {
    return 0;
  }
}

module.exports = {
  convertToISODate,
  isValidDateRange,
  formatDateForDisplay,
  calculateDaysDifference
};