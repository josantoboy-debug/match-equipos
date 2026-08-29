(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const UNKNOWN_UA = '0000000000000000';
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
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 5200);
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
    lot: [
      'lote', 'lot', 'batch', 'lote no', 'lote numero', 'numero lote',
      'lot no', 'lot number', 'batch no', 'batch number'
    ],
    serial: [
      'serial', 'serial no', 'serial number', 'serialnumber', 'sr', 'sn',
      'host', 'host sn', 'hostsn', 'host serial', 'host serial number'
    ],
    ua: [
      'ua', 'unit address', 'unitaddress', 'ua unit address', 'ua original',
      'unit addr', 'unit address no', 'unit address number'
    ],
    box: [
      'caja', 'box', 'carton', 'caja no', 'caja numero', 'numero caja',
      'box no', 'box number', 'carton no', 'carton number'
    ],
    process: [
      'process', 'proceso', 'asignacion', 'asignacion proceso', 'assignment',
      'tipo proceso', 'proceso actual', 'asignacion actual'
    ]
  };

  function resolveColumns(columnNames) {
    const normalized = columnNames.map(name => ({name, normalized: normalizeHeader(name)}));
    const find = names => normalized.find(item => names.includes(item.normalized))?.name || null;
    const mapping = {
      lot: find(aliases.lot),
      serial: find(aliases.serial),
      ua: find(aliases.ua),
      box: find(aliases.box),
      process: find(aliases.process)
    };
    return mapping.lot && mapping.serial && mapping.ua && mapping.box ? mapping : null;
  }

  function cellValue(row, column) {
    if (!column || !row) return '';
    return row[column] ?? '';
  }

  function normalizeUA(value) {
    if (value === null || value === undefined || String(value).trim() === '') return UNKNOWN_UA;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const text = String(Math.trunc(value));
      return /^\d{1,16}$/.test(text) ? text.padStart(16, '0') : text;
    }
    const raw = String(value).trim().replace(/[-\s]/g, '');
    if (/^\d{1,16}$/.test(raw)) return raw.padStart(16, '0');
    return raw;
  }

  function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
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

    const records = [];
    const compatibleTables = [];
    const skippedTables = [];

    for (const tableName of tableNames) {
      try {
        const table = reader.getTable(tableName);
        const columns = table.getColumnNames();
        const mapping = resolveColumns(columns);
        if (!mapping) {
          skippedTables.push(tableName);
          continue;
        }

        const data = table.getData();
        compatibleTables.push(tableName);
        data.forEach(row => {
          records.push({
            lot: normalizeText(cellValue(row, mapping.lot)),
            serial: normalizeText(cellValue(row, mapping.serial)).replace(/\s+/g, '').toUpperCase(),
            ua: normalizeUA(cellValue(row, mapping.ua)),
            box: normalizeText(cellValue(row, mapping.box)),
            proceso: normalizeText(cellValue(row, mapping.process)),
            tabla_access: tableName
          });
        });
      } catch (error) {
        console.warn(`[ACCDB] No se pudo leer la tabla ${tableName}`, error);
        skippedTables.push(tableName);
      }
    }

    if (!compatibleTables.length) {
      throw new Error(
        `No encontré una tabla con las columnas requeridas: LOTE, SERIAL/HOST SN, UA/UNIT ADDRESS y CAJA. Tablas revisadas: ${tableNames.join(', ')}.`
      );
    }
    if (!records.length) {
      throw new Error(`Las tablas compatibles (${compatibleTables.join(', ')}) no contienen registros.`);
    }

    return {records, compatibleTables, skippedTables};
  }

  function replaceWithJson(input, sourceFile, parsed) {
    const base = sourceFile.name.replace(/\.accdb$/i, '');
    const payload = {
      origen: sourceFile.name,
      formato: 'Microsoft Access ACCDB',
      tablas: parsed.compatibleTables,
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
    setMessage('warn', 'Leyendo archivo Access', `${file.name} · analizando tablas y columnas…`);

    try {
      const parsed = await readAccdb(file);
      showToast(
        'ACCDB leído',
        `${parsed.records.length} filas encontradas en ${parsed.compatibleTables.length} tabla${parsed.compatibleTables.length === 1 ? '' : 's'} compatible${parsed.compatibleTables.length === 1 ? '' : 's'}.`,
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
    if (button) button.title = 'Importar XLSX, XLS, CSV, TSV, TXT, JSON o Microsoft Access (.ACCDB)';

    if (input.dataset.accdbImportInstalled === '1') return;
    input.dataset.accdbImportInstalled = '1';
    input.addEventListener('change', interceptAccessImport, true);

    window.EquipmentAccessImport = {
      readAccdb,
      supportedExtension: '.accdb'
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();