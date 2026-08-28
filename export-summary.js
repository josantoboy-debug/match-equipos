(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function textOf(element) {
    return String(element?.textContent ?? '').trim().replace(/\s+/g, ' ');
  }

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function operatorName() {
    return window.OperatorSession?.getCurrentOperator?.()?.name || 'Sin operador';
  }

  function exportName(extension) {
    const named = window.OperatorSession?.nextExportName?.('BUSQUEDA', extension);
    if (named) return named;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `BUSQUEDA_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extension}`;
  }

  function summary() {
    const read = id => Number(String($(id)?.textContent || '0').replace(/[^0-9-]/g, '')) || 0;
    return {
      'TOTAL REGISTRADOS': read('#kTotal'),
      'CARCASAS': read('#kCarcasas'),
      'EQUIPOS': read('#kEquipos'),
      'MATCH REALIZADOS': read('#kMatches'),
      'MATCH OK': read('#kOk'),
      'MATCH REVISAR': read('#kReview'),
      'CARCASAS PENDIENTES': read('#kPC'),
      'EQUIPOS PENDIENTES': read('#kPE')
    };
  }

  function collectFoundRows() {
    const workspace = $('#workspaceBody');
    const foundTab = $('.tabs button[data-view="found"]');
    const activeTab = $('.tabs button.active');
    const allFilter = $('.filters button[data-filter="Todos"]');
    const activeFilter = $('.filters button.active');
    if (!workspace || !foundTab) return [];

    const previousVisibility = workspace.style.visibility;
    workspace.style.visibility = 'hidden';
    try {
      if (allFilter && activeFilter !== allFilter) allFilter.click();
      if (activeTab !== foundTab) foundTab.click();
      return $$('table tbody tr', workspace).map(row => {
        const cells = $$('td', row).map(td => textOf(td));
        if (cells.length < 6) return null;
        return {
          host: cells[0],
          uaCarcasa: cells[1],
          uaEquipo: cells[2],
          resultado: cells[3],
          fecha: cells[4],
          origen: cells[5]
        };
      }).filter(Boolean);
    } finally {
      if (activeFilter && allFilter && activeFilter !== allFilter) activeFilter.click();
      if (activeTab && activeTab !== foundTab) activeTab.click();
      workspace.style.visibility = previousVisibility;
    }
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function references(value) {
    const query = String(value ?? '').trim();
    if (!query) return [];
    try {
      return unique(window.FileIndexSearch?.findReferences?.(query) || []);
    } catch {
      return [];
    }
  }

  function detailRows() {
    return collectFoundRows().map((row, index) => ({
      N: index + 1,
      'HOST SN': row.host || '',
      'UA CARCASA': row.uaCarcasa || '',
      'UA EQUIPO': row.uaEquipo || '',
      RESULTADO: row.resultado || '',
      FECHA: row.fecha || '',
      ORIGEN: row.origen || '',
      'UBICACION HOST': references(row.host).join(' || '),
      'UBICACION UA CARCASA': references(row.uaCarcasa).join(' || '),
      'UBICACION UA EQUIPO': references(row.uaEquipo).join(' || '),
      OPERADOR: operatorName()
    }));
  }

  function nativeDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    try {
      HTMLElement.prototype.click.call(link);
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const stats = summary();
    const rows = detailRows();
    const lines = [
      'RESUMEN,VALOR',
      ...Object.entries(stats).map(([key, value]) => `${csvEscape(key)},${csvEscape(value)}`),
      `OPERADOR,${csvEscape(operatorName())}`,
      `GENERADO,${csvEscape(new Date().toLocaleString('es-PA'))}`,
      ''
    ];

    if (rows.length) {
      const headers = Object.keys(rows[0]);
      lines.push(headers.map(csvEscape).join(','));
      rows.forEach(row => lines.push(headers.map(header => csvEscape(row[header])).join(',')));
    }

    const filename = exportName('csv');
    nativeDownload(new Blob(['\uFEFF', lines.join('\r\n')], {type:'text/csv;charset=utf-8'}), filename);
    window.OperatorSession?.saveNow?.();
    showToast('CSV exportado', `${filename} · resumen incluido.`, 'ok');
  }

  function exportJson() {
    const rows = detailRows();
    const filename = exportName('json');
    const payload = {
      tipo: 'BUSQUEDA',
      operador: operatorName(),
      generado: new Date().toISOString(),
      resumen: summary(),
      total_resultados: rows.length,
      registros: rows
    };
    nativeDownload(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'}), filename);
    window.OperatorSession?.saveNow?.();
    showToast('JSON exportado', `${filename} · resumen incluido.`, 'ok');
  }

  function exportTxt() {
    const stats = summary();
    const rows = detailRows();
    const lines = [
      'VERIFICACIÓN Y MATCH DE EQUIPOS',
      'REPORTE DE BÚSQUEDA / MATCHES',
      '======================================================================',
      `OPERADOR: ${operatorName()}`,
      `GENERADO: ${new Date().toLocaleString('es-PA')}`,
      '',
      'RESUMEN',
      '----------------------------------------------------------------------',
      ...Object.entries(stats).map(([key, value]) => `${key.padEnd(24, ' ')}: ${value}`),
      '',
      'RESULTADOS Y UBICACIONES',
      '======================================================================'
    ];

    if (!rows.length) {
      lines.push('Sin equipos encontrados/matches en la sesión actual.');
    } else {
      rows.forEach((row, index) => {
        lines.push('');
        lines.push(`RESULTADO ${String(index + 1).padStart(4, '0')}`);
        lines.push(`Host SN      : ${row['HOST SN'] || '—'}`);
        lines.push(`UA Carcasa   : ${row['UA CARCASA'] || '—'}`);
        lines.push(`UA Equipo    : ${row['UA EQUIPO'] || '—'}`);
        lines.push(`Resultado    : ${row.RESULTADO || '—'}`);
        lines.push(`Fecha        : ${row.FECHA || '—'}`);
        lines.push(`Origen       : ${row.ORIGEN || '—'}`);
        lines.push(`Ubic. Host   : ${row['UBICACION HOST'] || 'Sin ubicación indexada'}`);
        lines.push(`Ubic. Carcasa: ${row['UBICACION UA CARCASA'] || 'Sin ubicación indexada'}`);
        lines.push(`Ubic. Equipo : ${row['UBICACION UA EQUIPO'] || 'Sin ubicación indexada'}`);
      });
    }

    const filename = exportName('txt');
    nativeDownload(new Blob(['\uFEFF', lines.join('\r\n')], {type:'text/plain;charset=utf-8'}), filename);
    window.OperatorSession?.saveNow?.();
    showToast('TXT exportado', `${filename} · resumen incluido.`, 'ok');
  }

  function appendSummarySheet(workbook) {
    if (!workbook || typeof XLSX === 'undefined') return;
    const name = 'Resumen';
    if (workbook.SheetNames?.includes(name)) return;
    const stats = summary();
    const rows = [
      ['RESUMEN DE OPERACIÓN', 'VALOR'],
      ...Object.entries(stats).map(([key, value]) => [key, value]),
      ['OPERADOR', operatorName()],
      ['GENERADO', new Date().toLocaleString('es-PA')]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:28}, {wch:28}];
    XLSX.utils.book_append_sheet(workbook, ws, name);
    workbook.SheetNames = [name, ...workbook.SheetNames.filter(sheet => sheet !== name)];
  }

  function exportXlsxThroughLegacy() {
    if (typeof XLSX === 'undefined' || typeof XLSX.writeFile !== 'function') {
      showToast('Excel no disponible', 'Recarga la página con conexión a internet.', 'error');
      return;
    }
    const legacy = $('#exportBtn');
    if (!legacy) {
      showToast('Exportador no disponible', 'No se encontró el exportador XLSX.', 'error');
      return;
    }

    const originalWriteFile = XLSX.writeFile;
    XLSX.writeFile = function(workbook, filename, options) {
      appendSummarySheet(workbook);
      return originalWriteFile.call(XLSX, workbook, filename, options);
    };
    try {
      legacy.click();
    } finally {
      XLSX.writeFile = originalWriteFile;
    }
  }

  function install() {
    const button = $('#globalExportBtn');
    const selector = $('#globalExportFormat');
    if (!button || !selector || button.dataset.summaryExportInstalled === '1') return false;
    button.dataset.summaryExportInstalled = '1';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const format = String(selector.value || 'xlsx').toLowerCase();
      if (format === 'xlsx') exportXlsxThroughLegacy();
      else if (format === 'txt') exportTxt();
      else if (format === 'csv') exportCsv();
      else if (format === 'json') exportJson();
      else showToast('Formato no compatible', format, 'error');
    }, true);
    return true;
  }

  function boot() {
    if (!install()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (install() || attempts > 30) clearInterval(timer);
      }, 100);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.ExportSummary = {summary, detailRows, install};
})();