(() => {
  'use strict';

  const registry = {
    rows: [],
    seq: 1,
    editingId: null,
    dirty: false,
    captureMode: 'manual'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const normSerial = value => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const normUA = value => String(value ?? '').trim().replace(/[-\s]/g, '');
  const UNKNOWN_UA = '0000000000000000';
  const normText = value => String(value ?? '').trim();
  const fmt = value => new Date(value).toLocaleString('es-PA');

  function validateLot(value) {
    const normalized = normText(value);
    return {valid: normalized.length > 0, value: normalized, message: normalized ? '' : 'El LOTE es obligatorio.'};
  }

  function validateSerial(value) {
    const normalized = normSerial(value);
    if (!normalized) return {valid:false, value:normalized, message:'El SERIAL es obligatorio.'};
    if (!normalized.startsWith('M')) return {valid:false, value:normalized, message:'El SERIAL debe iniciar únicamente con M.'};
    if (normalized.length !== 12) return {valid:false, value:normalized, message:`El SERIAL debe tener exactamente 12 caracteres; tiene ${normalized.length}.`};
    if (!/^M[A-Z0-9]{11}$/.test(normalized)) return {valid:false, value:normalized, message:'El SERIAL solo puede contener letras y números después de M.'};
    return {valid:true, value:normalized, message:''};
  }

  function validateUA(value) {
    const normalized = normUA(value);
    if (!normalized) return {valid:false, value:normalized, message:'El UA / Unit Address es obligatorio.'};
    if (!/^\d+$/.test(normalized)) return {valid:false, value:normalized, message:'El UA / Unit Address solo puede contener dígitos.'};
    if (!normalized.startsWith('0000')) return {valid:false, value:normalized, message:'El UA / Unit Address debe iniciar con 0000.'};
    if (normalized.length !== 16) return {valid:false, value:normalized, message:`El UA / Unit Address debe tener exactamente 16 dígitos; tiene ${normalized.length}.`};
    return {valid:true, value:normalized, message:''};
  }

  function validateBox(value) {
    const normalized = normText(value);
    return {valid: normalized.length > 0, value: normalized, message: normalized ? '' : 'La CAJA es obligatoria.'};
  }

  function fieldState(input, validation) {
    if (!input) return;
    input.classList.remove('field-valid', 'field-invalid');
    if (!input.value.trim()) return;
    input.classList.add(validation.valid ? 'field-valid' : 'field-invalid');
  }

  function setMessage(tone, title, detail) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    panel.className = `equipment-validation ${tone || 'neutral'}`;
    panel.innerHTML = `<span class="equipment-validation-icon">${tone === 'error' ? '×' : tone === 'warn' ? '!' : '✓'}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`;
  }

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function setupCaptureModeControl() {
    if ($('#equipmentRegisterModeBtn')) return;
    const addButton = $('#equipmentAddBtn');
    if (!addButton?.parentNode) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'equipment-capture-mode';
    wrapper.innerHTML = `
      <span>MODO REGISTRO</span>
      <button id="equipmentRegisterModeBtn" class="equipment-mode-toggle manual" type="button" aria-pressed="false">
        <strong>MANUAL</strong>
        <small>Toca para automático</small>
      </button>`;
    addButton.parentNode.insertBefore(wrapper, addButton);
    $('#equipmentRegisterModeBtn').addEventListener('click', () => {
      setCaptureMode(registry.captureMode === 'manual' ? 'automatic' : 'manual');
    });
    updateCaptureModeUI();
  }

  function updateCaptureModeUI() {
    const button = $('#equipmentRegisterModeBtn');
    if (!button) return;
    const automatic = registry.captureMode === 'automatic';
    button.classList.toggle('automatic', automatic);
    button.classList.toggle('manual', !automatic);
    button.setAttribute('aria-pressed', automatic ? 'true' : 'false');
    button.innerHTML = automatic
      ? '<strong>AUTOMÁTICO</strong><small>UA + ENTER registra</small>'
      : '<strong>MANUAL</strong><small>Usa Agregar equipo</small>';
    const addButton = $('#equipmentAddBtn');
    if (addButton && !registry.editingId) {
      addButton.textContent = automatic ? 'Agregar ahora' : 'Agregar equipo';
    }
  }

  function setCaptureMode(mode) {
    registry.captureMode = mode === 'automatic' ? 'automatic' : 'manual';
    updateCaptureModeUI();
    const automatic = registry.captureMode === 'automatic';
    if (automatic) {
      const lotOk = validateLot($('#equipmentLot')?.value).valid;
      const boxOk = validateBox($('#equipmentBox')?.value).valid;
      setMessage(
        lotOk && boxOk ? 'ok' : 'warn',
        'Registro automático activado',
        lotOk && boxOk
          ? 'Lote y Caja están listos. Escanea SERIAL → ENTER → UA → ENTER y se agregará automáticamente.'
          : 'Confirma primero LOTE y CAJA. Después cada equipo se registrará con SERIAL → ENTER → UA → ENTER.'
      );
    } else {
      setMessage('ok', 'Registro manual activado', 'Completa los cuatro campos y utiliza Agregar equipo para guardar el registro.');
    }
    $('#equipmentSerial')?.focus();
  }

  function duplicateCheck(serial, ua, excludeId = null) {
    const active = registry.rows.filter(row => row.id !== excludeId);
    const sameSerial = active.find(row => row.serial === serial);
    if (sameSerial) return `El SERIAL ${serial} ya está registrado en Lote ${sameSerial.lot}, Caja ${sameSerial.box}.`;
    if (ua !== UNKNOWN_UA) {
      const sameUA = active.find(row => row.ua === ua);
      if (sameUA) return `El UA ${ua} ya está registrado con el Serial ${sameUA.serial}.`;
    }
    return '';
  }

  function validateAll() {
    const lot = validateLot($('#equipmentLot')?.value);
    const serial = validateSerial($('#equipmentSerial')?.value);
    const ua = validateUA($('#equipmentUA')?.value);
    const box = validateBox($('#equipmentBox')?.value);
    fieldState($('#equipmentLot'), lot);
    fieldState($('#equipmentSerial'), serial);
    fieldState($('#equipmentUA'), ua);
    fieldState($('#equipmentBox'), box);
    return {lot, serial, ua, box};
  }

  function confirmField(input, validation, nextInput) {
    fieldState(input, validation);
    if (!validation.valid) {
      setMessage('error', 'Campo no confirmado', validation.message);
      input.focus();
      input.select?.();
      return false;
    }
    input.value = validation.value;
    setMessage('ok', 'Campo confirmado', `${input.previousElementSibling?.textContent?.trim() || 'Dato'} válido. Puedes continuar.`);
    nextInput?.focus();
    nextInput?.select?.();
    return true;
  }

  function boxKey(row) {
    return `${row.lot.toUpperCase()}\u0000${row.box.toUpperCase()}`;
  }

  function recalcBoxPositions() {
    const counters = new Map();
    registry.rows.forEach(row => {
      const key = boxKey(row);
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      row.boxPosition = next;
    });
  }

  function counts() {
    const lots = new Set(registry.rows.map(row => row.lot.toUpperCase()));
    const boxes = new Set(registry.rows.map(row => boxKey(row)));
    const currentLot = normText($('#equipmentLot')?.value).toUpperCase();
    const currentBox = normText($('#equipmentBox')?.value).toUpperCase();
    const currentCount = currentLot && currentBox
      ? registry.rows.filter(row => row.lot.toUpperCase() === currentLot && row.box.toUpperCase() === currentBox).length
      : 0;
    return {total: registry.rows.length, lots: lots.size, boxes: boxes.size, currentCount, currentLot, currentBox};
  }

  function renderSummary() {
    const c = counts();
    $('#equipmentTotalCount').textContent = c.total;
    $('#equipmentLotCount').textContent = c.lots;
    $('#equipmentBoxCount').textContent = c.boxes;
    $('#equipmentCurrentBoxCount').textContent = c.currentCount;
    $('#equipmentCurrentBoxLabel').textContent = c.currentBox ? `${c.currentLot || 'Sin lote'} · ${c.currentBox}` : 'Sin caja seleccionada';
  }

  function renderRows() {
    const body = $('#equipmentRegisterBody');
    if (!body) return;
    if (!registry.rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="equipment-empty">Sin equipos registrados.</td></tr>';
      renderSummary();
      return;
    }
    body.innerHTML = registry.rows.map((row, index) => `
      <tr data-equipment-row="${row.id}">
        <td>${index + 1}</td>
        <td>${esc(row.lot)}</td>
        <td class="equipment-mono">${esc(row.serial)}</td>
        <td class="equipment-mono">${esc(row.ua)}</td>
        <td>${esc(row.box)}</td>
        <td><span class="equipment-box-count">${row.boxPosition}</span></td>
        <td>${esc(fmt(row.at))}</td>
        <td class="equipment-row-actions"><button type="button" data-equipment-edit="${row.id}">Editar</button><button class="delete" type="button" data-equipment-delete="${row.id}">Eliminar</button></td>
      </tr>`).join('');
    $$('[data-equipment-edit]').forEach(button => button.addEventListener('click', () => startEdit(button.dataset.equipmentEdit)));
    $$('[data-equipment-delete]').forEach(button => button.addEventListener('click', () => deleteRow(button.dataset.equipmentDelete)));
    renderSummary();
  }

  function markDirty() {
    registry.dirty = true;
  }

  function resetCapture({keepLot = true, keepBox = true} = {}) {
    const lot = $('#equipmentLot');
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    const box = $('#equipmentBox');
    if (!keepLot) lot.value = '';
    if (!keepBox) box.value = '';
    serial.value = '';
    ua.value = '';
    [lot, serial, ua, box].forEach(input => input.classList.remove('field-valid', 'field-invalid'));
    if (keepLot && lot.value) lot.classList.add('field-valid');
    if (keepBox && box.value) box.classList.add('field-valid');
    registry.editingId = null;
    updateCaptureModeUI();
    const automatic = registry.captureMode === 'automatic';
    setMessage(
      'ok',
      'Listo para el siguiente equipo',
      automatic
        ? `Lote ${lot.value || '—'} y Caja ${box.value || '—'} se mantienen. Escanea SERIAL → ENTER → UA → ENTER.`
        : `Lote ${lot.value || '—'} y Caja ${box.value || '—'} se mantienen. Escanea el siguiente SERIAL.`
    );
    renderSummary();
    serial.focus();
  }

  function addOrSave() {
    const v = validateAll();
    const ordered = [
      ['LOTE', $('#equipmentLot'), v.lot],
      ['SERIAL', $('#equipmentSerial'), v.serial],
      ['UA / Unit Address', $('#equipmentUA'), v.ua],
      ['CAJA', $('#equipmentBox'), v.box]
    ];
    const invalid = ordered.find(([, , result]) => !result.valid);
    if (invalid) {
      const [name, input, result] = invalid;
      setMessage('error', `${name} inválido`, result.message);
      input.focus();
      input.select?.();
      return false;
    }

    const dup = duplicateCheck(v.serial.value, v.ua.value, registry.editingId);
    if (dup) {
      setMessage('error', 'Registro duplicado bloqueado', dup);
      showToast('No se agregó', dup, 'error');
      return false;
    }

    if (registry.editingId) {
      const row = registry.rows.find(item => item.id === registry.editingId);
      if (!row) return false;
      row.lot = v.lot.value;
      row.serial = v.serial.value;
      row.ua = v.ua.value;
      row.box = v.box.value;
      row.editedAt = new Date().toISOString();
      recalcBoxPositions();
      markDirty();
      renderRows();
      showToast('Registro actualizado', `${row.serial} · ${row.box}`, 'ok');
      resetCapture({keepLot:true, keepBox:true});
      return true;
    }

    const row = {
      id: `BOXREG-${String(registry.seq++).padStart(6, '0')}`,
      lot: v.lot.value,
      serial: v.serial.value,
      ua: v.ua.value,
      box: v.box.value,
      boxPosition: 0,
      at: new Date().toISOString(),
      origin: registry.captureMode === 'automatic' ? 'Captura automática' : 'Captura manual'
    };
    registry.rows.push(row);
    recalcBoxPositions();
    markDirty();
    renderRows();
    showToast(
      registry.captureMode === 'automatic' ? 'Equipo registrado automáticamente' : 'Equipo agregado',
      `${row.serial} · ${row.box} · equipo ${row.boxPosition}`,
      'ok'
    );
    resetCapture({keepLot:true, keepBox:true});
    return true;
  }

  function startEdit(id) {
    const row = registry.rows.find(item => item.id === id);
    if (!row) return;
    registry.editingId = id;
    $('#equipmentLot').value = row.lot;
    $('#equipmentSerial').value = row.serial;
    $('#equipmentUA').value = row.ua;
    $('#equipmentBox').value = row.box;
    validateAll();
    $('#equipmentAddBtn').textContent = 'Guardar cambios';
    setMessage('warn', 'Editando registro', `${row.id} · la edición siempre requiere pulsar Guardar cambios.`);
    $('#equipmentLot').focus();
    $('#equipmentRegisterPanel').scrollIntoView({behavior:'smooth', block:'start'});
  }

  function deleteRow(id) {
    const row = registry.rows.find(item => item.id === id);
    if (!row) return;
    if (!confirm(`¿Eliminar este equipo del registro?\n\n${row.serial}\n${row.ua}\nLote ${row.lot} · Caja ${row.box}`)) return;
    registry.rows = registry.rows.filter(item => item.id !== id);
    if (registry.editingId === id) registry.editingId = null;
    recalcBoxPositions();
    markDirty();
    renderRows();
    updateCaptureModeUI();
    showToast('Equipo eliminado', row.serial, 'warn');
  }

  function headerName(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  }

  const aliases = {
    lot: ['lote', 'lot', 'batch'],
    serial: ['serial', 'serial no', 'serial number', 'sr', 'sn', 'host sn', 'host'],
    ua: ['ua', 'unit address', 'unitaddress', 'ua / unit address', 'ua original'],
    box: ['caja', 'box', 'carton', 'cartón']
  };

  function findColumns(row) {
    const normalized = row.map(headerName);
    const find = names => normalized.findIndex(value => names.includes(value));
    const cols = {lot: find(aliases.lot), serial: find(aliases.serial), ua: find(aliases.ua), box: find(aliases.box)};
    return Object.values(cols).every(index => index >= 0) ? cols : null;
  }

  function matrixToRecords(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    let headerIndex = -1;
    let cols = null;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      cols = findColumns(Array.isArray(rows[i]) ? rows[i] : []);
      if (cols) { headerIndex = i; break; }
    }
    if (!cols) {
      cols = {lot:0, serial:1, ua:2, box:3};
      headerIndex = -1;
    }
    return rows.slice(headerIndex + 1).map(row => ({
      lot: row?.[cols.lot],
      serial: row?.[cols.serial],
      ua: row?.[cols.ua],
      box: row?.[cols.box]
    }));
  }

  function objectToRecord(obj) {
    const keys = Object.keys(obj || {});
    const get = names => {
      const key = keys.find(k => names.includes(headerName(k)));
      return key ? obj[key] : '';
    };
    return {lot:get(aliases.lot), serial:get(aliases.serial), ua:get(aliases.ua), box:get(aliases.box)};
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
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
        if (row.some(value => String(value).trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(value => String(value).trim())) rows.push(row);
    return rows;
  }

  async function recordsFromFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (['xlsx', 'xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') throw new Error('El módulo Excel no está disponible.');
      const wb = XLSX.read(await file.arrayBuffer(), {type:'array', cellText:true, cellDates:false});
      const records = [];
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:false, defval:''});
        records.push(...matrixToRecords(rows));
      });
      return records;
    }
    const text = await file.text();
    if (ext === 'json') {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.registros) ? parsed.registros : Array.isArray(parsed.equipos) ? parsed.equipos : [];
      return list.map(objectToRecord);
    }
    if (ext === 'csv') return matrixToRecords(parseDelimited(text, ','));
    if (ext === 'tsv') return matrixToRecords(parseDelimited(text, '\t'));
    if (ext === 'txt') {
      const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
      const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : firstLine.includes(';') ? ';' : ',';
      return matrixToRecords(parseDelimited(text, delimiter));
    }
    throw new Error('Formato no compatible. Usa XLSX, XLS, CSV, TSV, TXT o JSON.');
  }

  function importRecords(records, fileName) {
    let added = 0, invalid = 0, duplicates = 0;
    records.forEach(source => {
      const lot = validateLot(source.lot);
      const serial = validateSerial(source.serial);
      const ua = validateUA(source.ua);
      const box = validateBox(source.box);
      if (![lot, serial, ua, box].every(item => item.valid)) { invalid++; return; }
      if (duplicateCheck(serial.value, ua.value)) { duplicates++; return; }
      registry.rows.push({
        id:`BOXREG-${String(registry.seq++).padStart(6, '0')}`,
        lot:lot.value,
        serial:serial.value,
        ua:ua.value,
        box:box.value,
        boxPosition:0,
        at:new Date().toISOString(),
        origin:`Importado: ${fileName}`
      });
      added++;
    });
    recalcBoxPositions();
    if (added) markDirty();
    renderRows();
    setMessage(added ? 'ok' : 'warn', 'Carga de registro completada', `${added} agregados · ${invalid} inválidos bloqueados · ${duplicates} duplicados omitidos.`);
    showToast('Registro cargado', `${added} agregados · ${invalid} inválidos · ${duplicates} duplicados`, added ? 'ok' : 'warn');
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const records = await recordsFromFile(file);
      importRecords(records, file.name);
    } catch (error) {
      setMessage('error', 'No se pudo cargar el registro', error.message || String(error));
      showToast('Error de carga', error.message || String(error), 'error');
    } finally {
      $('#equipmentImportFile').value = '';
    }
  }

  function exportRows() {
    return registry.rows.map((row, index) => ({
      N: index + 1,
      LOTE: row.lot,
      SERIAL: row.serial,
      'UA / UNIT ADDRESS': row.ua,
      CAJA: row.box,
      'N EN CAJA': row.boxPosition,
      'FECHA/HORA': fmt(row.at),
      ORIGEN: row.origin
    }));
  }

  function downloadBlob(content, mime, extension) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `Registro_Equipos_Cajas_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.${extension}`;
    const blob = content instanceof Blob ? content : new Blob(['\uFEFF', content], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportRegistry() {
    if (!registry.rows.length) {
      showToast('Sin registros', 'Agrega o carga equipos antes de descargar.', 'warn');
      return;
    }
    const format = $('#equipmentExportFormat').value;
    const rows = exportRows();
    let filename = '';
    if (format === 'xlsx') {
      if (typeof XLSX === 'undefined') { showToast('XLSX no disponible', 'Recarga la página con conexión para usar Excel.', 'error'); return; }
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch:7},{wch:18},{wch:18},{wch:24},{wch:16},{wch:12},{wch:23},{wch:28}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Registro equipos');
      const now = new Date(), pad = n => String(n).padStart(2,'0');
      filename = `Registro_Equipos_Cajas_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
      XLSX.writeFile(wb, filename, {compression:true});
    } else if (format === 'json') {
      filename = downloadBlob(JSON.stringify({registros:rows}, null, 2), 'application/json;charset=utf-8', 'json');
    } else if (format === 'txt') {
      const headers = Object.keys(rows[0]);
      const text = [headers.join('\t'), ...rows.map(row => headers.map(header => String(row[header] ?? '')).join('\t'))].join('\r\n');
      filename = downloadBlob(text, 'text/plain;charset=utf-8', 'txt');
    } else {
      const headers = Object.keys(rows[0]);
      const csv = [headers.map(csvEscape).join(','), ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))].join('\r\n');
      filename = downloadBlob(csv, 'text/csv;charset=utf-8', 'csv');
    }
    registry.dirty = false;
    setMessage('ok', 'Registro descargado', `${filename} · ${registry.rows.length} equipos.`);
    showToast('Registro descargado', filename, 'ok');
  }

  function liveValidate() {
    const lot = validateLot($('#equipmentLot').value);
    const serial = validateSerial($('#equipmentSerial').value);
    const ua = validateUA($('#equipmentUA').value);
    const box = validateBox($('#equipmentBox').value);
    fieldState($('#equipmentLot'), lot);
    fieldState($('#equipmentSerial'), serial);
    fieldState($('#equipmentUA'), ua);
    fieldState($('#equipmentBox'), box);
    renderSummary();
  }

  function wireEnterFlow() {
    $('#equipmentLot').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      confirmField($('#equipmentLot'), validateLot($('#equipmentLot').value), $('#equipmentSerial'));
    });

    $('#equipmentSerial').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      confirmField($('#equipmentSerial'), validateSerial($('#equipmentSerial').value), $('#equipmentUA'));
    });

    $('#equipmentUA').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const uaResult = validateUA($('#equipmentUA').value);
      if (!confirmField($('#equipmentUA'), uaResult, null)) return;

      if (registry.captureMode === 'automatic' && !registry.editingId) {
        const lotResult = validateLot($('#equipmentLot').value);
        const boxResult = validateBox($('#equipmentBox').value);
        fieldState($('#equipmentLot'), lotResult);
        fieldState($('#equipmentBox'), boxResult);
        if (!lotResult.valid) {
          setMessage('error', 'LOTE no confirmado', lotResult.message);
          $('#equipmentLot').focus();
          return;
        }
        if (!boxResult.valid) {
          setMessage('warn', 'Falta confirmar CAJA', 'Es la primera captura de esta caja. Ingresa CAJA y presiona ENTER; después el registro será automático.');
          $('#equipmentBox').focus();
          return;
        }
        addOrSave();
        return;
      }

      $('#equipmentBox').focus();
      $('#equipmentBox').select?.();
    });

    $('#equipmentBox').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const result = validateBox($('#equipmentBox').value);
      if (!confirmField($('#equipmentBox'), result, null)) return;
      if (registry.captureMode === 'automatic' && !registry.editingId) {
        addOrSave();
      } else {
        setMessage('ok', 'CAJA confirmada', 'Modo manual: pulsa Agregar equipo para guardar el registro.');
        $('#equipmentAddBtn').focus();
      }
    });
  }

  function appendRegistrySearchResults(query, resultsElement) {
    const old = resultsElement.querySelector('.equipment-registry-search-section');
    old?.remove();
    const raw = String(query ?? '').trim();
    if (!raw) return;
    const qSerial = normSerial(raw);
    const qUA = normUA(raw);
    const qText = raw.toUpperCase();
    const matches = registry.rows.filter(row =>
      row.serial.includes(qSerial) || row.ua.includes(qUA) || row.lot.toUpperCase().includes(qText) || row.box.toUpperCase().includes(qText)
    ).slice(0, 30);
    if (!matches.length) return;
    const html = matches.map(row => `<div class="search-card"><div><span class="mini-badge">REGISTRO CAJA</span> <b class="mono">${esc(row.serial)}</b></div><div class="mono muted">${esc(row.ua)}</div><div>Lote: <strong>${esc(row.lot)}</strong> · Caja: <strong>${esc(row.box)}</strong> · #${row.boxPosition}</div></div>`).join('');
    resultsElement.insertAdjacentHTML('beforeend', `<div class="equipment-registry-search-section"><div class="file-index-heading"><span>EN REGISTRO POR CAJAS</span><strong>${matches.length} coincidencia${matches.length === 1 ? '' : 's'}</strong></div>${html}</div>`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const required = ['#equipmentLot','#equipmentSerial','#equipmentUA','#equipmentBox','#equipmentAddBtn','#equipmentImportBtn','#equipmentImportFile','#equipmentExportBtn'];
    if (required.some(selector => !$(selector))) return;

    setupCaptureModeControl();
    ['#equipmentLot','#equipmentSerial','#equipmentUA','#equipmentBox'].forEach(selector => $(selector).addEventListener('input', liveValidate));
    $('#equipmentSerial').addEventListener('input', event => { event.target.value = normSerial(event.target.value); });
    $('#equipmentAddBtn').addEventListener('click', addOrSave);
    $('#equipmentImportBtn').addEventListener('click', () => $('#equipmentImportFile').click());
    $('#equipmentImportFile').addEventListener('change', event => importFile(event.target.files?.[0]));
    $('#equipmentExportBtn').addEventListener('click', exportRegistry);
    wireEnterFlow();
    renderRows();
    updateCaptureModeUI();

    window.addEventListener('beforeunload', event => {
      if (registry.dirty) { event.preventDefault(); event.returnValue = ''; }
    });

    window.EquipmentRegistry = {
      appendSearchResults: appendRegistrySearchResults,
      getRows: () => registry.rows.map(row => ({...row})),
      getStats: () => counts(),
      getCaptureMode: () => registry.captureMode,
      setCaptureMode
    };
  });
})();