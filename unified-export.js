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

  function runExport(format) {
    const safeFormat = String(format || '').toLowerCase();
    try {
      if (safeFormat === 'xlsx') {
        const legacy = $('#exportBtn');
        if (!legacy) throw new Error('El exportador XLSX no está disponible.');
        legacy.click();
        return;
      }
      if (safeFormat === 'txt') {
        const legacy = $('#exportMatchesTxtBtn');
        if (!legacy) throw new Error('El exportador TXT no está disponible.');
        legacy.click();
        return;
      }

      const rows = buildRows();
      if (safeFormat === 'csv') exportCsv(rows);
      else if (safeFormat === 'json') exportJson(rows);
      else throw new Error(`Formato no compatible: ${safeFormat}`);
    } catch (error) {
      console.error('[unified-export]', error);
      showToast('Error al exportar', error?.message || String(error), 'error');
    }
  }

  function ensureStyles() {
    if ($('#operationalMenuStyles')) return;
    const style = document.createElement('style');
    style.id = 'operationalMenuStyles';
    style.textContent = `
      .operational-actions{position:relative;max-width:none!important}
      .operational-actions > .mini-badge,
      .operational-actions > #newSessionBtn,
      .operational-actions > #importBtn,
      .operational-actions > #exportMatchesTxtBtn,
      .operational-actions > #exportBtn,
      .operational-actions > .global-export-group{display:none!important}
      .op-menu-wrap{position:relative;margin-left:auto}
      .op-menu-trigger{width:36px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:transparent;color:#c9d4e2;font-size:20px;line-height:1;cursor:pointer}
      .op-menu-trigger:hover,.op-menu-trigger[aria-expanded="true"]{background:#162132;border-color:#426aa3;color:#fff}
      .op-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;width:210px;padding:7px;border:1px solid var(--line2);border-radius:12px;background:#0d1520;box-shadow:0 18px 45px rgba(0,0,0,.45)}
      .op-menu[hidden],.op-export-panel[hidden]{display:none!important}
      .op-menu button{width:100%;border:0;border-radius:8px;background:transparent;color:#dbe7f4;text-align:left;padding:10px 11px;font-size:10px;font-weight:750;cursor:pointer}
      .op-menu button:hover{background:#182538}
      .op-menu .danger{color:#fca5a5}
      .op-menu-divider{height:1px;background:var(--line);margin:5px 2px}
      .op-export-panel{display:grid;gap:5px;padding:4px 0 1px}
      .op-export-title{padding:4px 11px 2px;color:#7f91a8;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .op-format-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .op-format-grid button{text-align:center;border:1px solid #2b3a50;background:#101a28;padding:9px 6px}
      .op-format-grid button:hover{border-color:#4f8cff;background:#17315a}
      @media(max-width:900px){.op-menu{right:-4px;width:200px}}
    `;
    document.head.appendChild(style);
  }

  function closeMenu() {
    const menu = $('#operationalMenu');
    const trigger = $('#operationalMenuBtn');
    const panel = $('#operationalExportPanel');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (panel) panel.hidden = true;
  }

  function createMenu() {
    const actions = $('.register-panel-head .operational-actions');
    if (!actions) return false;
    ensureStyles();
    if ($('#operationalMenuBtn')) return true;

    const wrap = document.createElement('div');
    wrap.className = 'op-menu-wrap';
    wrap.innerHTML = `
      <button id="operationalMenuBtn" class="op-menu-trigger" type="button" aria-label="Abrir acciones" aria-haspopup="menu" aria-expanded="false">⋯</button>
      <div id="operationalMenu" class="op-menu" role="menu" hidden>
        <button type="button" data-op-action="new" class="danger">Nueva sesión</button>
        <button type="button" data-op-action="import">Importar archivo</button>
        <button type="button" data-op-action="export">Exportar</button>
        <div id="operationalExportPanel" class="op-export-panel" hidden>
          <div class="op-menu-divider"></div>
          <div class="op-export-title">Selecciona formato</div>
          <div class="op-format-grid">
            <button type="button" data-export-format="xlsx">XLSX</button>
            <button type="button" data-export-format="txt">TXT</button>
            <button type="button" data-export-format="csv">CSV</button>
            <button type="button" data-export-format="json">JSON</button>
          </div>
        </div>
      </div>`;
    actions.appendChild(wrap);

    const trigger = $('#operationalMenuBtn');
    const menu = $('#operationalMenu');
    const exportPanel = $('#operationalExportPanel');

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
      if (!opening) exportPanel.hidden = true;
    });

    menu.addEventListener('click', event => {
      event.stopPropagation();
      const action = event.target.closest('[data-op-action]')?.dataset.opAction;
      const format = event.target.closest('[data-export-format]')?.dataset.exportFormat;
      if (format) {
        closeMenu();
        runExport(format);
        return;
      }
      if (action === 'new') {
        closeMenu();
        $('#newSessionBtn')?.click();
      } else if (action === 'import') {
        closeMenu();
        $('#importBtn')?.click();
      } else if (action === 'export') {
        exportPanel.hidden = !exportPanel.hidden;
      }
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });
    return true;
  }

  function boot() {
    if (!createMenu()) setTimeout(createMenu, 100);
    window.UnifiedExport = {
      run: format => runExport(format || 'xlsx'),
      buildRows,
      createMenu,
      closeMenu
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();