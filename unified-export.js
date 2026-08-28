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

  function fallbackName(extension) {
    const d = new Date();
    const p = value => String(value).padStart(2, '0');
    return `Busqueda_Matches_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extension}`;
  }

  function exportName(extension) {
    return window.OperatorSession?.nextExportName?.('BUSQUEDA', extension) || fallbackName(extension);
  }

  function operatorName() {
    return window.OperatorSession?.getCurrentOperator?.()?.name || 'Sin operador';
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
    } catch (error) {
      console.warn('[unified-export] No se pudieron obtener referencias', query, error);
      return [];
    }
  }

  function buildRows() {
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

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv(rows) {
    if (!rows.length) {
      showToast('Sin equipos encontrados', 'No hay matches o encontrados para exportar a CSV.', 'warn');
      return;
    }
    const headers = Object.keys(rows[0]);
    const content = [
      headers.map(csvEscape).join(','),
      ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))
    ].join('\r\n');
    const filename = exportName('csv');
    nativeDownload(new Blob(['\uFEFF', content], {type:'text/csv;charset=utf-8'}), filename);
    window.OperatorSession?.saveNow?.();
    showToast('CSV exportado', `${filename} · ${rows.length} registros.`, 'ok');
  }

  function exportJson(rows) {
    if (!rows.length) {
      showToast('Sin equipos encontrados', 'No hay matches o encontrados para exportar a JSON.', 'warn');
      return;
    }
    const filename = exportName('json');
    const payload = {
      tipo: 'BUSQUEDA',
      operador: operatorName(),
      generado: new Date().toISOString(),
      total: rows.length,
      registros: rows
    };
    nativeDownload(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'}), filename);
    window.OperatorSession?.saveNow?.();
    showToast('JSON exportado', `${filename} · ${rows.length} registros.`, 'ok');
  }

  function runUnifiedExport() {
    const selector = $('#globalExportFormat');
    const button = $('#globalExportBtn');
    if (!selector || !button) return;

    const format = String(selector.value || 'xlsx').toLowerCase();
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = 'Exportando…';

    try {
      if (format === 'xlsx') {
        const legacy = $('#exportBtn');
        if (!legacy) throw new Error('El exportador XLSX no está disponible.');
        legacy.click();
        return;
      }
      if (format === 'txt') {
        const legacy = $('#exportMatchesTxtBtn');
        if (!legacy) throw new Error('El exportador TXT no está disponible.');
        legacy.click();
        return;
      }

      const rows = buildRows();
      if (format === 'csv') exportCsv(rows);
      else if (format === 'json') exportJson(rows);
      else throw new Error(`Formato no compatible: ${format}`);
    } catch (error) {
      console.error('[unified-export]', error);
      showToast('Error al exportar', error?.message || String(error), 'error');
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = previousText || 'Exportar';
      }, 100);
    }
  }

  function createControls() {
    if ($('#globalExportBtn')) return true;
    const txtButton = $('#exportMatchesTxtBtn');
    const xlsxButton = $('#exportBtn');
    const parent = xlsxButton?.parentElement || txtButton?.parentElement;
    if (!parent || !txtButton || !xlsxButton) return false;

    txtButton.hidden = true;
    xlsxButton.hidden = true;
    txtButton.style.display = 'none';
    xlsxButton.style.display = 'none';

    if (!$('#unifiedExportStyles')) {
      const style = document.createElement('style');
      style.id = 'unifiedExportStyles';
      style.textContent = `
        .global-export-group{display:inline-flex;align-items:center;gap:6px}
        .global-export-format{height:34px;min-width:78px;border:1px solid var(--line2);border-radius:9px;background:#0c141f;color:var(--text);padding:0 28px 0 9px;font-size:10px;font-weight:800;outline:none}
        .global-export-format:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(79,140,255,.12)}
        .global-export-btn{min-width:92px}
        @media(max-width:900px){.global-export-group{flex:1 1 220px}.global-export-format{flex:0 0 86px}.global-export-btn{flex:1}}
      `;
      document.head.appendChild(style);
    }

    const group = document.createElement('div');
    group.className = 'global-export-group';
    group.setAttribute('aria-label', 'Exportar búsqueda y matches');
    group.innerHTML = `
      <select id="globalExportFormat" class="global-export-format" aria-label="Formato de exportación">
        <option value="xlsx">XLSX</option>
        <option value="txt">TXT</option>
        <option value="csv">CSV</option>
        <option value="json">JSON</option>
      </select>
      <button id="globalExportBtn" class="primary compact-action global-export-btn" type="button">Exportar</button>`;

    parent.insertBefore(group, txtButton);
    $('#globalExportBtn')?.addEventListener('click', runUnifiedExport);
    return true;
  }

  function boot() {
    if (!createControls()) {
      setTimeout(createControls, 100);
    }
    window.UnifiedExport = {run: runUnifiedExport, buildRows, createControls};
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();