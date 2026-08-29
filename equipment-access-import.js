(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const UNKNOWN_UA = '0000000000000000';
  const MAX_PER_BOX = 64;
  let converting = false;

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 5600);
  }

  function setMessage(tone, title, detail) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    const icon = tone === 'error' ? '×' : tone === 'warn' ? '!' : '✓';
    panel.className = `equipment-validation ${tone || 'neutral'}`;
    panel.innerHTML = `<span class="equipment-validation-icon">${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
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
    serial: [
      'serial', 'serial no', 'serial number', 'serialnumber', 'sr', 'sn',
      'host', 'host sn', 'hostsn', 'host serial', 'host serial number'
    ],
    ua: [
      'ua', 'unit address', 'unitaddress', 'ua unit address', 'ua original',
      'unit addr', 'unit address no', 'unit address number', 'unit andress'
    ]
  };

  const normalizeSerial = value => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();

  function normalizeUA(value) {
    if (value === null || value === undefined || String(value).trim() === '') return UNKNOWN_UA;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const text = String(Math.trunc(value));
      return /^\d{1,16}$/.test(text) ? text.padStart(16, '0') : text;
    }
    const raw = String(value).trim().replace(/[-\s]/g, '').replace(/&$/, '');
    if (/^\d{1,16}$/.test(raw)) return raw.padStart(16, '0');
    return raw;
  }

  function normalizeText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function validSerial(value) {
    return /^M[A-Z0-9]{11}$/.test(normalizeSerial(value));
  }

  function validUA(value) {
    const ua = normalizeUA(value);
    return /^0000\d{12}$/.test(ua);
  }

  function currentContext() {
    const process = normalizeText(window.EquipmentProcess?.getCurrent?.() || $('#equipmentProcess')?.value);
    const lot = normalizeText($('#equipmentLot')?.value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const box = normalizeText($('#equipmentBox')?.value);
    const quantityRaw = normalizeText($('#equipmentQuantity')?.value);
    const quantity = /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : 0;
    return {process, lot, box, quantity};
  }

  function validateContext() {
    const context = currentContext();
    const missing = [];
    if (!context.process) missing.push('ASIGNACIÓN / PROCESO');
    if (!context.lot) missing.push('LOTE');
    if (!context.box) missing.push('CAJA');
    if (!Number.isSafeInteger(context.quantity) || context.quantity < 1 || context.quantity > MAX_PER_BOX) missing.push(`CANTIDAD (1-${MAX_PER_BOX})`);
    if (missing.length) {
      throw new Error(`Antes de importar Access completa: ${missing.join(', ')}.`);
    }
    return context;
  }

  function incrementBoxName(value) {
    const original = normalizeText(value);
    if (!original) return '1';
    const match = original.match(/^(.*?)(\d+)$/);
    if (!match) return `${original}-2`;
    return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, '0')}`;
  }

  function allocationCounts(lot) {
    const counts = new Map();
    const rows = window.EquipmentRegistry?.getRows?.() || [];
    rows.forEach(row => {
      if (normalizeText(row.lot).toUpperCase() !== lot.toUpperCase()) return;
      const key = normalizeText(row.box).toUpperCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function assignBox(context, counts) {
    let candidate = context.box;
    let guard = 0;
    while ((counts.get(candidate.toUpperCase()) || 0) >= context.quantity && guard < 10000) {
      candidate = incrementBoxName(candidate);
      guard++;
    }
    if (guard >= 10000) throw new Error('No se pudo calcular la siguiente caja disponible.');
    const key = candidate.toUpperCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    return candidate;
  }

  function namedMapping(columnNames) {
    const normalized = columnNames.map(name => ({name, normalized: normalizeHeader(name)}));
    const find = names => normalized.find(item => names.includes(item.normalized))?.name || null;
    return {serial: find(aliases.serial), ua: find(aliases.ua)};
  }

  function inferColumn(columnNames, data, predicate, excluded = null) {
    let best = null;
    let bestScore = 0;
    columnNames.forEach(column => {
      if (column === excluded) return;
      const values = data.map(row => row?.[column]).filter(value => value !== null && value !== undefined && String(value).trim() !== '').slice(0, 120);
      if (!values.length) return;
      const matches = values.filter(predicate).length;
      const score = matches / values.length;
      if (score > bestScore) {
        best = column;
        bestScore = score;
      }
    });
    return bestScore >= 0.55 ? best : null;
  }

  function resolveColumns(columnNames, data) {
    const mapping = namedMapping(columnNames);
    if (!mapping.serial) mapping.serial = inferColumn(columnNames, data, validSerial, mapping.ua);
    if (!mapping.ua) mapping.ua = inferColumn(columnNames, data, validUA, mapping.serial);

    if (!mapping.serial || !mapping.ua || mapping.serial === mapping.ua) {
      const serial = inferColumn(columnNames, data, validSerial, null);
      const ua = inferColumn(columnNames, data, validUA, serial);
      if (serial && ua) return {serial, ua};
    }
    return mapping.serial && mapping.ua && mapping.serial !== mapping.ua ? mapping : null;
  }

  async function loadAccessReader() {
    try {
      const [bufferModule, readerModule] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/buffer@6/+esm'),
        import('https://cdn.jsdelivr.net/npm/mdb-reader@3.2.0/+esm')
      ]);
      const MDBReader = readerModule.default;
      const BufferClass = bufferModule.Buffer;
      if (!MDBReader || !BufferClass) throw new Error('No se pudo inicializar el lector de Access.');
      return {MDBReader, BufferClass};
    } catch (error) {
      throw new Error(`No se pudo cargar el lector ACCDB. Verifica la conexión a internet. ${error?.message || error}`);
    }
  }

  async function readAccdb(file) {
    const context = validateContext();
    const {MDBReader, BufferClass} = await loadAccessReader();
    const bytes = await file.arrayBuffer();
    let reader;
    try {
      reader = new MDBReader(BufferClass.from(bytes));
    } catch (error) {
      throw new Error(`Access no pudo abrir la base de datos. ${error?.message || error}`);
    }

    const tableNames = reader.getTableNames().filter(name => !/^MSys/i.test(String(name)));
    if (!tableNames.length) throw new Error('La base Access no contiene tablas de usuario legibles.');

    const rawRecords = [];
    const compatibleTables = [];
    const skippedTables = [];

    for (const tableName of tableNames) {
      try {
        const table = reader.getTable(tableName);
        const columns = table.getColumnNames();
        const data = table.getData();
        const mapping = resolveColumns(columns, data);
        if (!mapping) {
          skippedTables.push(tableName);
          continue;
        }

        compatibleTables.push(tableName);
        data.forEach(row => {
          const serial = normalizeSerial(row?.[mapping.serial]);
          const ua = normalizeUA(row?.[mapping.ua]);
          if (!serial && !ua) return;
          rawRecords.push({serial, ua, tabla_access: tableName});
        });
      } catch (error) {
        console.warn(`[ACCDB] No se pudo leer la tabla ${tableName}`, error);
        skippedTables.push(tableName);
      }
    }

    if (!compatibleTables.length) {
      throw new Error(`No encontré una tabla con columnas de SERIAL y UA. Tablas revisadas: ${tableNames.join(', ')}.`);
    }
    if (!rawRecords.length) {
      throw new Error(`Las tablas compatibles (${compatibleTables.join(', ')}) no contienen registros.`);
    }

    const counts = allocationCounts(context.lot);
    const records = rawRecords.map(source => ({
      lot: context.lot,
      serial: source.serial,
      ua: source.ua || UNKNOWN_UA,
      box: assignBox(context, counts),
      proceso: context.process,
      tabla_access: source.tabla_access
    }));

    return {records, compatibleTables, skippedTables, context};
  }

  function replaceWithJson(input, sourceFile, parsed) {
    const base = sourceFile.name.replace(/\.accdb$/i, '');
    const payload = {
      origen: sourceFile.name,
      formato: 'Microsoft Access ACCDB · Serial + UA',
      tablas: parsed.compatibleTables,
      contexto_integrado: {
        proceso: parsed.context.process,
        lote: parsed.context.lot,
        caja_inicial: parsed.context.box,
        cantidad_por_caja: parsed.context.quantity
      },
      registros: parsed.records
    };
    const jsonFile = new File(
      [JSON.stringify(payload)],
      `${base}.access.json`,
      {type: 'application/json', lastModified: sourceFile.lastModified || Date.now()}
    );
    const transfer = new DataTransfer();
    transfer.items.add(jsonFile);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }

  async function interceptAccessImport(event) {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file || !/\.accdb$/i.test(file.name)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (converting) return;
    converting = true;

    const importButton = $('#equipmentImportBtn');
    const oldText = importButton?.textContent || 'Cargar registro';
    if (importButton) {
      importButton.disabled = true;
      importButton.textContent = 'Leyendo Access…';
    }
    setMessage('warn', 'Leyendo archivo Access', `${file.name} · detectando SERIAL y UA…`);

    try {
      const parsed = await readAccdb(file);
      const boxes = [...new Set(parsed.records.map(row => row.box))];
      showToast(
        'ACCDB leído',
        `${parsed.records.length} equipos · Lote ${parsed.context.lot} · Caja${boxes.length === 1 ? '' : 's'} ${boxes.join(', ')} · ${parsed.context.quantity} por caja.`,
        'ok'
      );
      replaceWithJson(input, file, parsed);
    } catch (error) {
      console.error('[equipment-access-import]', error);
      input.value = '';
      setMessage('error', 'No se pudo importar ACCDB', error?.message || String(error));
      showToast('Error ACCDB', error?.message || String(error), 'error');
    } finally {
      converting = false;
      if (importButton) {
        importButton.disabled = false;
        importButton.textContent = oldText;
      }
    }
  }

  function install() {
    const input = $('#equipmentImportFile');
    const button = $('#equipmentImportBtn');
    if (!input) {
      setTimeout(install, 50);
      return;
    }

    if (!String(input.accept || '').toLowerCase().includes('.accdb')) {
      input.accept = `${input.accept ? `${input.accept},` : ''}.accdb,application/msaccess,application/x-msaccess,application/vnd.ms-access`;
    }
    if (button) button.title = `ACCDB: toma Serial + UA del archivo y completa Proceso, Lote, Caja y CANTIDAD desde la pantalla. Máximo ${MAX_PER_BOX}.`;

    if (input.dataset.accdbImportInstalled === '1') return;
    input.dataset.accdbImportInstalled = '1';
    input.addEventListener('change', interceptAccessImport, true);

    window.EquipmentAccessImport = {
      readAccdb,
      supportedExtension: '.accdb',
      getContext: currentContext
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();