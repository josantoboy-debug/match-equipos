(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function fallbackName(extension) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `Registro_Equipos_Cajas_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extension}`;
  }

  function exportName(extension) {
    return window.OperatorSession?.nextExportName?.('REGISTRO', extension) || fallbackName(extension);
  }

  function operatorName() {
    return window.OperatorSession?.getCurrentOperator?.()?.name || '';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-PA');
  }

  function rowsForExport() {
    const source = window.EquipmentRegistry?.getRows?.();
    if (!Array.isArray(source)) return [];
    const operator = operatorName();
    return source.map((row, index) => ({
      N: index + 1,
      LOTE: row.lot ?? '',
      SERIAL: row.serial ?? '',
      'UA / UNIT ADDRESS': row.ua ?? '',
      CAJA: row.box ?? '',
      'N EN CAJA': row.boxPosition ?? '',
      'FECHA/HORA': formatDate(row.at),
      ORIGEN: row.origin ?? '',
      OPERADOR: operator
    }));
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function nativeDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);

    try {
      // Usa el método nativo de HTMLElement para evitar cualquier interceptor
      // instalado sobre HTMLAnchorElement.prototype.click.
      HTMLElement.prototype.click.call(link);
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function downloadText(text, mime, filename) {
    nativeDownload(new Blob(['\uFEFF', text], {type: mime}), filename);
  }

  function exportXlsx(rows, filename) {
    if (typeof XLSX === 'undefined') {
      throw new Error('El módulo Excel no está disponible. Recarga la página con conexión a internet.');
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      {wch: 7}, {wch: 20}, {wch: 18}, {wch: 24}, {wch: 16},
      {wch: 12}, {wch: 24}, {wch: 30}, {wch: 24}
    ];
    ws['!autofilter'] = {ref: ws['!ref'] || 'A1:I1'};

    // Fuerza Serial y UA como texto para conservar ceros a la izquierda.
    Object.keys(ws).forEach(address => {
      if (address.startsWith('!')) return;
      const cell = ws[address];
      if (cell && typeof cell.v === 'string') cell.t = 's';
    });

    const wb = XLSX.utils.book_new();
    const operator = operatorName();
    wb.Props = {
      Title: 'Registro de equipos por caja',
      Subject: 'Registro de equipos',
      Author: operator || 'Match Equipos',
      LastAuthor: operator || 'Match Equipos',
      Comments: operator ? `REGISTRO generado por ${operator}` : 'REGISTRO generado por Match Equipos'
    };
    XLSX.utils.book_append_sheet(wb, ws, 'Registro equipos');

    // No usa XLSX.writeFile: genera el archivo en memoria y descarga con el
    // método nativo para evitar conflictos con wrappers de terceros.
    const bytes = XLSX.write(wb, {bookType: 'xlsx', type: 'array', compression: true});
    nativeDownload(
      new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
      filename
    );
  }

  function exportRegistry() {
    const button = $('#equipmentExportBtn');
    const select = $('#equipmentExportFormat');
    const rows = rowsForExport();

    if (!button || !select) return;
    if (!rows.length) {
      showToast('Sin registros', 'Agrega o carga equipos antes de descargar.', 'warn');
      return;
    }

    const format = String(select.value || 'xlsx').toLowerCase();
    if (!['xlsx', 'csv', 'json', 'txt'].includes(format)) {
      showToast('Formato no compatible', format, 'error');
      return;
    }

    const filename = exportName(format);
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = 'Descargando…';

    try {
      if (format === 'xlsx') {
        exportXlsx(rows, filename);
      } else if (format === 'json') {
        downloadText(
          JSON.stringify({
            operador: operatorName(),
            generado: new Date().toISOString(),
            total: rows.length,
            registros: rows
          }, null, 2),
          'application/json;charset=utf-8',
          filename
        );
      } else if (format === 'txt') {
        const headers = Object.keys(rows[0]);
        const text = [
          headers.join('\t'),
          ...rows.map(row => headers.map(header => String(row[header] ?? '')).join('\t'))
        ].join('\r\n');
        downloadText(text, 'text/plain;charset=utf-8', filename);
      } else {
        const headers = Object.keys(rows[0]);
        const csv = [
          headers.map(csvEscape).join(','),
          ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))
        ].join('\r\n');
        downloadText(csv, 'text/csv;charset=utf-8', filename);
      }

      window.OperatorSession?.saveNow?.();
      document.dispatchEvent(new CustomEvent('equipment:registry-exported', {
        detail: {filename, format, count: rows.length}
      }));
      showToast('Registro descargado', `${filename} · ${rows.length} equipos.`, 'ok');
    } catch (error) {
      console.error('[registry-export]', error);
      showToast('Error al descargar registro', error?.message || String(error), 'error');
    } finally {
      button.disabled = false;
      button.textContent = previousText || 'Descargar registro';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = $('#equipmentExportBtn');
    if (!button) return;

    // Captura antes del listener antiguo y evita dos descargas.
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      exportRegistry();
    }, true);

    window.RegistryExport = {exportRegistry};
  });
})();