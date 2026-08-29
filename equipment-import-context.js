(() => {
  'use strict';

  const MAX_PER_BOX = 64;
  const $ = selector => document.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();

  let waitingForImport = false;
  let restoreTimer = null;
  let lastFileName = '';
  let observer = null;
  let fileContext = null;
  let importedProcessMap = new Map();

  function rows() {
    const value = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(value) ? value : [];
  }

  function normalizeHeader(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[_\-\/\\.]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const aliases = {
    process: ['asignacion proceso', 'asignacion', 'proceso', 'process', 'assignment'],
    lot: ['lote', 'lot', 'batch'],
    box: ['caja', 'box', 'carton'],
    quantity: ['cantidad asignada', 'cantidad', 'quantity', 'assigned quantity', 'numero de equipos', 'n de equipos'],
    serial: ['serial', 'serial no', 'serial number', 'sn', 'host sn', 'host'],
    ua: ['ua', 'unit address', 'unitaddress', 'ua unit address', 'ua original']
  };

  function valueFromObject(obj, names) {
    const keys = Object.keys(obj || {});
    const key = keys.find(item => names.includes(normalizeHeader(item)));
    return key ? obj[key] : '';
  }

  function normalizeQuantity(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PER_BOX ? n : 0;
  }

  function normalizedRecord(obj) {
    return {
      process: norm(valueFromObject(obj, aliases.process)),
      lot: norm(valueFromObject(obj, aliases.lot)),
      box: norm(valueFromObject(obj, aliases.box)),
      quantity: normalizeQuantity(valueFromObject(obj, aliases.quantity)),
      serial: upper(valueFromObject(obj, aliases.serial)).replace(/\s+/g, ''),
      ua: norm(valueFromObject(obj, aliases.ua)).replace(/[-\s]/g, '')
    };
  }

  function rowKey(row) {
    return [row?.lot, row?.serial, row?.ua, row?.box]
      .map(value => upper(value))
      .join('\u0001');
  }

  function contextFromParsedRecords(records) {
    const usable = records.filter(row => row.lot && row.box);
    if (!usable.length) return null;
    const last = usable[usable.length - 1];
    const sameBox = usable.filter(row => upper(row.lot) === upper(last.lot) && upper(row.box) === upper(last.box));
    const count = sameBox.length;
    const sameBoxProcess = [...sameBox].reverse().find(row => row.process)?.process;
    const process = sameBoxProcess || [...usable].reverse().find(row => row.process)?.process || '';
    const quantity = [...sameBox].reverse().find(row => row.quantity)?.quantity || 0;
    return {lot:last.lot, box:last.box, process:norm(process), quantity, count, total:usable.length};
  }

  function buildProcessMap(records) {
    const map = new Map();
    records.forEach(row => {
      if (!row.process || !row.lot || !row.box || !row.serial) return;
      map.set(rowKey(row), row.process);
    });
    return map;
  }

  function parseDelimited(text, delimiter) {
    const matrix = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        row.push(field); field = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(value => norm(value))) matrix.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(value => norm(value))) matrix.push(row);
    if (matrix.length < 2) return [];
    const headers = matrix[0];
    return matrix.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  async function recordsFromSelectedFile(file) {
    const ext = String(file?.name || '').toLowerCase().split('.').pop();
    if (!file) return [];

    if (['xlsx', 'xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') return [];
      const workbook = XLSX.read(await file.arrayBuffer(), {type:'array', cellText:true, cellDates:false});
      const list = [];
      workbook.SheetNames.forEach(name => {
        const objects = XLSX.utils.sheet_to_json(workbook.Sheets[name], {raw:false, defval:''});
        objects.forEach(item => list.push(normalizedRecord(item)));
      });
      return list;
    }

    const text = await file.text();
    if (ext === 'json') {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.registros) ? parsed.registros
        : Array.isArray(parsed?.equipos) ? parsed.equipos
        : [];
      const records = list.map(normalizedRecord);

      if (parsed?.contexto_integrado && records.length) {
        const context = parsed.contexto_integrado;
        const process = norm(context.proceso || context.process);
        const lot = norm(context.lote || context.lot);
        const quantity = normalizeQuantity(context.cantidad_por_caja || context.cantidad || context.quantity);
        records.forEach(row => {
          if (!row.process && process) row.process = process;
          if (!row.lot && lot) row.lot = lot;
          if (!row.quantity && quantity) row.quantity = quantity;
        });
      }
      return records;
    }

    if (['csv', 'tsv', 'txt'].includes(ext)) {
      const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
      const delimiter = ext === 'tsv' || firstLine.includes('\t') ? '\t'
        : firstLine.includes('|') ? '|'
        : firstLine.includes(';') ? ';' : ',';
      return parseDelimited(text, delimiter).map(normalizedRecord);
    }

    return [];
  }

  async function captureFileContext(file) {
    try {
      const parsedRows = await recordsFromSelectedFile(file);
      importedProcessMap = buildProcessMap(parsedRows);
      fileContext = contextFromParsedRecords(parsedRows);
    } catch (error) {
      console.warn('[equipment-import-context] No se pudo leer el contexto del archivo', error);
      importedProcessMap = new Map();
      fileContext = null;
    }
  }

  function setInput(selector, value) {
    const input = $(selector);
    if (!input) return;
    input.value = value ?? '';
    input.classList.remove('field-invalid');
    if (String(value ?? '').trim()) input.classList.add('field-valid');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setMessage(context) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    panel.className = 'equipment-validation ok';
    panel.innerHTML = `<span class="equipment-validation-icon">✓</span><div><strong>Registro cargado y contexto restaurado</strong><small>Caja ${escapeHtml(context.box)}: ${context.count}/${context.quantity} equipos · Lote ${escapeHtml(context.lot)}${context.process ? ` · ${escapeHtml(context.process)}` : ''}. Puedes continuar desde SERIAL.</small></div>`;
  }

  function showToast(context) {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = 'toast show ok';
    toast.innerHTML = `<strong>Contexto restaurado</strong><span>${escapeHtml(lastFileName || 'Registro cargado')} · Caja ${escapeHtml(context.box)} · ${context.count}/${context.quantity} equipos.</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4800);
  }

  function contextFromRows(source) {
    if (!source.length) return null;
    const last = source[source.length - 1];
    const lot = norm(last?.lot);
    const box = norm(last?.box);
    if (!lot || !box) return null;
    const activeRows = source.filter(row => upper(row?.lot) === upper(lot) && upper(row?.box) === upper(box));
    const process = [...source].reverse().find(row => norm(row?.process))?.process || '';
    const quantity = normalizeQuantity([...activeRows].reverse().find(row => row?.assignedQuantity)?.assignedQuantity);
    return {lot, box, process:norm(process), quantity, count:activeRows.length, total:source.length};
  }

  function restoreProcesses(source) {
    if (!importedProcessMap.size || typeof window.EquipmentProcess?.setForRow !== 'function') return;
    source.forEach(row => {
      const process = importedProcessMap.get(rowKey(row));
      if (process) window.EquipmentProcess.setForRow(row.id, process);
    });
  }

  function applyContext() {
    if (!waitingForImport) return false;
    const source = rows();
    if (!source.length) return false;

    restoreProcesses(source);

    const rowContext = contextFromRows(source);
    if (!rowContext) return false;
    const context = {
      ...rowContext,
      process: norm(fileContext?.process) || norm(rowContext.process),
      quantity: normalizeQuantity(fileContext?.quantity) || normalizeQuantity(rowContext.quantity) || Math.min(MAX_PER_BOX, Math.max(1, rowContext.count))
    };

    if (fileContext?.lot && fileContext?.box) {
      const matching = source.filter(row => upper(row.lot) === upper(fileContext.lot) && upper(row.box) === upper(fileContext.box));
      if (matching.length) {
        context.lot = fileContext.lot;
        context.box = fileContext.box;
        context.count = matching.length;
        context.quantity = normalizeQuantity(fileContext.quantity) || Math.min(MAX_PER_BOX, Math.max(1, matching.length));
      }
    }

    setInput('#equipmentLot', context.lot);
    setInput('#equipmentBox', context.box);
    setInput('#equipmentQuantity', context.quantity);

    if (context.process) {
      if (typeof window.EquipmentRegistry?.setCurrentProcess === 'function') {
        window.EquipmentRegistry.setCurrentProcess(context.process);
        $('#equipmentProcess')?.dispatchEvent(new Event('input', {bubbles:true}));
      } else {
        setInput('#equipmentProcess', context.process);
      }
    }

    const currentCount = $('#equipmentCurrentBoxCount');
    if (currentCount) currentCount.textContent = `${context.count} / ${context.quantity}`;
    const currentLabel = $('#equipmentCurrentBoxLabel');
    if (currentLabel) currentLabel.textContent = `${upper(context.lot)} · ${upper(context.box)}${context.process ? ` · ${context.process}` : ''}`;

    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    if (serial) {
      serial.value = '';
      serial.classList.remove('field-valid', 'field-invalid');
    }
    if (ua) {
      ua.value = '';
      ua.classList.remove('field-valid', 'field-invalid');
    }

    window.EquipmentCapacity?.refresh?.();
    window.EquipmentBoxPrint?.refresh?.();
    window.OperatorSession?.saveNow?.();
    setMessage(context);
    showToast(context);

    waitingForImport = false;
    setTimeout(() => serial?.focus({preventScroll:true}), 80);
    return true;
  }

  function scheduleRestore(delay = 450) {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!applyContext() && waitingForImport) scheduleRestore(350);
    }, delay);
  }

  function install() {
    const input = $('#equipmentImportFile');
    const button = $('#equipmentImportBtn');
    const body = $('#equipmentRegisterBody');
    if (!input || !button || !body || !window.EquipmentRegistry) {
      setTimeout(install, 50);
      return;
    }
    if (input.dataset.contextRestoreInstalled === '1') return;
    input.dataset.contextRestoreInstalled = '1';

    button.addEventListener('click', () => {
      waitingForImport = true;
      lastFileName = '';
      fileContext = null;
      importedProcessMap = new Map();
    }, true);

    input.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      waitingForImport = true;
      lastFileName = file.name || '';
      captureFileContext(file).finally(() => scheduleRestore(/\.accdb$/i.test(lastFileName) ? 900 : 500));
    });

    observer = new MutationObserver(() => {
      if (waitingForImport) scheduleRestore(240);
    });
    observer.observe(body, {childList:true, subtree:true});

    window.EquipmentImportContext = {
      restore: () => { waitingForImport = true; return applyContext(); },
      getContext: () => fileContext || contextFromRows(rows())
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();