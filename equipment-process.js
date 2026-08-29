(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const processByRowId = new Map();
  let originalGetRows = null;
  let pendingImportedProcesses = new Map();
  let editingId = null;
  let observer = null;

  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');

  function rowKey(row) {
    return [row?.lot, row?.serial, row?.ua, row?.box].map(value => norm(value).toUpperCase()).join('\u0001');
  }

  function currentProcess() {
    return norm($('#equipmentProcess')?.value);
  }

  function installStyles() {
    if ($('#equipmentProcessStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentProcessStyles';
    style.textContent = `
      .equipment-process-row{padding:12px 16px 0;display:flex;align-items:end;gap:12px}
      .equipment-process-field{display:grid;gap:6px;width:min(100%,720px);color:#bdc9d8;font-size:10px;font-weight:750}
      .equipment-process-field>span{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .equipment-process-field small{color:#71839a;font-weight:500}
      .equipment-process-input{height:44px!important;font-family:inherit!important;font-weight:700!important;letter-spacing:.01em}
      .equipment-process-cell{min-width:170px;max-width:300px;white-space:normal;line-height:1.3}
      @media(max-width:900px){.equipment-process-row{padding:12px 12px 0}.equipment-process-field{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function installField() {
    if ($('#equipmentProcess')) return;
    const grid = $('.equipment-entry-grid');
    if (!grid?.parentNode) return;
    const row = document.createElement('div');
    row.id = 'equipmentProcessRow';
    row.className = 'equipment-process-row';
    row.innerHTML = `
      <label class="equipment-process-field">
        <span>ASIGNACIÓN / PROCESO ACTUAL <small>Se guarda con cada equipo</small></span>
        <input id="equipmentProcess" class="equipment-code equipment-process-input" autocomplete="off" maxlength="120" placeholder="Ej. Verificación, reparación, despacho, instalación…">
      </label>`;
    grid.parentNode.insertBefore(row, grid);
  }

  function rawRows() {
    try {
      if (originalGetRows) return originalGetRows();
      const rows = window.EquipmentRegistry?.getRows?.();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function installTableHeader() {
    const headRow = $('.equipment-table thead tr');
    if (!headRow || headRow.querySelector('[data-equipment-process-col]')) return;
    const th = document.createElement('th');
    th.dataset.equipmentProcessCol = '1';
    th.textContent = 'Asignación / Proceso';
    const lotTh = headRow.children[1];
    if (lotTh?.nextSibling) headRow.insertBefore(th, lotTh.nextSibling);
    else headRow.appendChild(th);
  }

  function processForRow(row) {
    if (processByRowId.has(row.id)) return processByRowId.get(row.id) || '';
    const imported = pendingImportedProcesses.get(rowKey(row));
    const value = imported !== undefined ? imported : norm(row.process) || currentProcess();
    processByRowId.set(row.id, value);
    return value;
  }

  function decorateRows() {
    installTableHeader();
    const rows = rawRows();
    const liveIds = new Set(rows.map(row => row.id));
    [...processByRowId.keys()].forEach(id => { if (!liveIds.has(id)) processByRowId.delete(id); });

    rows.forEach(row => {
      const process = processForRow(row);
      const tr = document.querySelector(`[data-equipment-row="${CSS.escape(String(row.id))}"]`);
      if (!tr) return;
      let cell = tr.querySelector('[data-equipment-process-cell]');
      if (!cell) {
        cell = document.createElement('td');
        cell.dataset.equipmentProcessCell = '1';
        cell.className = 'equipment-process-cell';
        const lotCell = tr.children[1];
        if (lotCell?.nextSibling) tr.insertBefore(cell, lotCell.nextSibling);
        else tr.appendChild(cell);
      }
      const display = process || '—';
      if (cell.textContent !== display) cell.textContent = display;
      cell.title = process || 'Sin asignación / proceso';
    });

    $$('.equipment-empty').forEach(cell => cell.setAttribute('colspan', '9'));
    updateCurrentBoxLabel();
  }

  function updateCurrentBoxLabel() {
    const label = $('#equipmentCurrentBoxLabel');
    const lot = norm($('#equipmentLot')?.value).toUpperCase();
    const box = norm($('#equipmentBox')?.value).toUpperCase();
    if (!label || !box) return;
    const process = currentProcess();
    const next = `${lot || 'Sin lote'} · ${box}${process ? ` · ${process}` : ''}`;
    if (label.textContent !== next) label.textContent = next;
  }

  function patchRegistryApi() {
    const api = window.EquipmentRegistry;
    if (!api || api.__processPatched) return false;
    if (typeof api.getRows !== 'function') return false;

    originalGetRows = api.getRows.bind(api);
    api.getRows = () => originalGetRows().map(row => ({
      ...row,
      process: processByRowId.has(row.id) ? processByRowId.get(row.id) : norm(row.process)
    }));
    api.getCurrentProcess = currentProcess;
    api.setCurrentProcess = value => {
      const input = $('#equipmentProcess');
      if (input) input.value = norm(value);
      updateCurrentBoxLabel();
    };
    api.__processPatched = true;
    return true;
  }

  function extractProcess(item) {
    if (!item || typeof item !== 'object') return '';
    const keys = Object.keys(item);
    const key = keys.find(name => /^(process|proceso|asignaci[oó]n|asignaci[oó]n\s*\/\s*proceso|assignment)$/i.test(String(name).trim()));
    return key ? norm(item[key]) : norm(item.process);
  }

  function cacheImportedProcesses(file) {
    if (!file || !/\.json$/i.test(file.name || '')) return;
    file.text().then(text => {
      try {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed
          : Array.isArray(parsed?.registros) ? parsed.registros
          : Array.isArray(parsed?.equipos) ? parsed.equipos
          : [];
        const map = new Map();
        list.forEach(item => {
          const process = extractProcess(item);
          if (!process) return;
          map.set(rowKey({
            lot: item.lot ?? item.LOTE,
            serial: item.serial ?? item.SERIAL,
            ua: item.ua ?? item['UA / UNIT ADDRESS'] ?? item.UA,
            box: item.box ?? item.CAJA
          }), process);
        });
        pendingImportedProcesses = map;
        setTimeout(() => {
          rawRows().forEach(row => {
            const imported = map.get(rowKey(row));
            if (imported !== undefined) processByRowId.set(row.id, imported);
          });
          if (!currentProcess()) {
            const last = rawRows().at(-1);
            if (last) {
              const value = processByRowId.get(last.id) || '';
              if (value && $('#equipmentProcess')) $('#equipmentProcess').value = value;
            }
          }
          decorateRows();
        }, 120);
      } catch (error) {
        console.warn('[equipment-process] No se pudo leer proceso desde JSON importado', error);
      }
    }).catch(() => {});
  }

  function installEvents() {
    const processInput = $('#equipmentProcess');
    processInput?.addEventListener('input', updateCurrentBoxLabel);

    $('#equipmentImportFile')?.addEventListener('change', event => {
      cacheImportedProcesses(event.target.files?.[0]);
    }, true);

    document.addEventListener('click', event => {
      const editButton = event.target.closest?.('[data-equipment-edit]');
      if (editButton) {
        editingId = editButton.dataset.equipmentEdit || null;
        const value = processByRowId.get(editingId) || '';
        if (processInput) processInput.value = value;
        updateCurrentBoxLabel();
        return;
      }

      if (event.target.closest?.('#equipmentAddBtn') && editingId) {
        processByRowId.set(editingId, currentProcess());
        setTimeout(() => {
          editingId = null;
          decorateRows();
        }, 0);
      }
    }, true);

    ['#equipmentLot', '#equipmentBox'].forEach(selector => {
      $(selector)?.addEventListener('input', () => setTimeout(updateCurrentBoxLabel, 0));
    });
  }

  function startObserver() {
    const body = $('#equipmentRegisterBody');
    if (!body || observer) return;
    observer = new MutationObserver(() => {
      decorateRows();
      if (!currentProcess()) {
        const rows = rawRows();
        const last = rows.at(-1);
        const value = last ? processByRowId.get(last.id) : '';
        if (value && $('#equipmentProcess')) $('#equipmentProcess').value = value;
      }
    });
    observer.observe(body, {childList: true, subtree: true});
  }

  function install() {
    installStyles();
    installField();
    if (!patchRegistryApi()) {
      setTimeout(install, 30);
      return;
    }
    installEvents();
    startObserver();
    decorateRows();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.EquipmentProcess = {
    getCurrent: currentProcess,
    getForRow: id => processByRowId.get(id) || '',
    setForRow: (id, value) => { processByRowId.set(id, norm(value)); decorateRows(); },
    clear: () => {
      processByRowId.clear();
      const input = $('#equipmentProcess');
      if (input) input.value = '';
      decorateRows();
    }
  };
})();