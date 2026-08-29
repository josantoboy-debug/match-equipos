(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const COUNTER_STORAGE_PREFIX = 'matchEquipos.registryProcessCounters';

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

  function safePart(value, fallback = 'SIN-DATO', maxLength = 42) {
    const text = String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    return (text || fallback).slice(0, maxLength);
  }

  function uniqueValues(rows, key) {
    return [...new Set(rows.map(row => String(row?.[key] ?? '').trim()).filter(Boolean))];
  }

  function compactDescriptor(values, singlePrefix, multiLabel) {
    if (!values.length) return `${singlePrefix}-SIN-DATO`;
    if (values.length === 1) return `${singlePrefix}-${safePart(values[0])}`;
    return `${multiLabel}-${values.length}`;
  }

  function operatorName() {
    return window.OperatorSession?.getCurrentOperator?.()?.name || '';
  }

  function operatorId() {
    const operator = window.OperatorSession?.getCurrentOperator?.();
    return safePart(operator?.id || operator?.name || 'DEFAULT', 'DEFAULT', 48);
  }

  function normalizeProcessBase(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 'SIN PROCESO';
    return raw.replace(/\s*#\s*\d+\s*$/i, '').trim() || 'SIN PROCESO';
  }

  function explicitProcessNumber(value) {
    const match = String(value ?? '').trim().match(/#\s*(\d+)\s*$/i);
    if (!match) return 0;
    const n = Number(match[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }

  function counterStorageKey() {
    return `${COUNTER_STORAGE_PREFIX}.${operatorId()}`;
  }

  function readCounters() {
    try {
      const parsed = JSON.parse(localStorage.getItem(counterStorageKey()) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCounters(counters) {
    try {
      localStorage.setItem(counterStorageKey(), JSON.stringify(counters));
    } catch {}
  }

  function processCounterKey(processName) {
    return safePart(normalizeProcessBase(processName), 'SIN-PROCESO', 80);
  }

  function reserveProcessSequence(processName) {
    const counters = readCounters();
    const key = processCounterKey(processName);
    const stored = Number(counters[key]) || 0;
    const explicit = explicitProcessNumber(processName);
    const next = Math.max(stored, explicit) + 1;
    counters[key] = next;
    writeCounters(counters);
    return next;
  }

  function sequenceLabel(number) {
    return `#${String(number).padStart(3, '0')}`;
  }

  function primaryProcess(rows) {
    const processes = uniqueValues(rows, 'ASIGNACIÓN / PROCESO');
    if (processes.length === 1) return processes[0];
    if (processes.length > 1) return `VARIOS PROCESOS ${processes.length}`;
    const current = window.EquipmentProcess?.getCurrent?.();
    return String(current || '').trim() || 'SIN PROCESO';
  }

  function buildOrganizedExportName(extension, rows, sequence = null) {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

    const processRaw = primaryProcess(rows);
    const processBase = normalizeProcessBase(processRaw);
    const processPart = safePart(processBase, 'SIN-PROCESO', 42);
    const seq = sequence ?? Math.max(1, explicitProcessNumber(processRaw));

    const lots = uniqueValues(rows, 'LOTE');
    const boxes = uniqueValues(rows, 'CAJA');
    const lotPart = compactDescriptor(lots, 'LOTE', 'VARIOS-LOTES');
    const boxPart = compactDescriptor(boxes, 'CAJA', 'VARIAS-CAJAS');
    const countPart = `${rows.length}-EQ`;

    return `${processPart}_${sequenceLabel(seq)}_${lotPart}_${boxPart}_${countPart}_${date}_${time}.${extension}`;
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
      'ASIGNACIÓN / PROCESO': row.process ?? '',
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
      HTMLElement.prototype.click.call(link);
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function downloadText(text, mime, filename) {
    nativeDownload(new Blob(['\uFEFF', text], {type: mime}), filename);
  }

  function buildXlsxBlob(rows) {
    if (typeof XLSX === 'undefined') {
      throw new Error('El módulo Excel no está disponible. Recarga la página con conexión a internet.');
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      {wch: 7}, {wch: 20}, {wch: 30}, {wch: 18}, {wch: 24},
      {wch: 16}, {wch: 12}, {wch: 24}, {wch: 30}, {wch: 24}
    ];
    ws['!autofilter'] = {ref: ws['!ref'] || 'A1:J1'};

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

    const bytes = XLSX.write(wb, {bookType: 'xlsx', type: 'array', compression: true});
    return new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  function exportRegistry() {
    const button = $('#equipmentExportBtn');
    const select = $('#equipmentExportFormat');
    const rows = rowsForExport();

    if (!button || !select) return null;
    if (!rows.length) {
      showToast('Sin registros', 'Agrega o carga equipos antes de descargar.', 'warn');
      return null;
    }

    const format = String(select.value || 'xlsx').toLowerCase();
    if (!['xlsx', 'csv', 'json', 'txt'].includes(format)) {
      showToast('Formato no compatible', format, 'error');
      return null;
    }

    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = 'Descargando…';

    try {
      let payload;
      let mime = '';

      if (format === 'xlsx') {
        payload = buildXlsxBlob(rows);
      } else if (format === 'json') {
        payload = JSON.stringify({
          operador: operatorName(),
          generado: new Date().toISOString(),
          total: rows.length,
          registros: rows
        }, null, 2);
        mime = 'application/json;charset=utf-8';
      } else if (format === 'txt') {
        const headers = Object.keys(rows[0]);
        payload = [
          headers.join('\t'),
          ...rows.map(row => headers.map(header => String(row[header] ?? '')).join('\t'))
        ].join('\r\n');
        mime = 'text/plain;charset=utf-8';
      } else {
        const headers = Object.keys(rows[0]);
        payload = [
          headers.map(csvEscape).join(','),
          ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))
        ].join('\r\n');
        mime = 'text/csv;charset=utf-8';
      }

      const processName = primaryProcess(rows);
      const sequence = reserveProcessSequence(processName);
      const filename = buildOrganizedExportName(format, rows, sequence);

      if (format === 'xlsx') nativeDownload(payload, filename);
      else downloadText(payload, mime, filename);

      window.OperatorSession?.saveNow?.();
      document.dispatchEvent(new CustomEvent('equipment:registry-exported', {
        detail: {filename, format, count: rows.length, process: normalizeProcessBase(processName), sequence}
      }));
      showToast('Registro descargado', `${filename} · ${rows.length} equipos.`, 'ok');
      return {filename, format, count: rows.length, process: normalizeProcessBase(processName), sequence};
    } catch (error) {
      console.error('[registry-export]', error);
      showToast('Error al descargar registro', error?.message || String(error), 'error');
      return null;
    } finally {
      button.disabled = false;
      button.textContent = previousText || 'Descargar registro';
    }
  }

  function temporarilySuppressLegacyDownload() {
    const savedAnchorClick = HTMLAnchorElement.prototype.click;
    const savedWriteFile = typeof XLSX !== 'undefined' ? XLSX.writeFile : null;

    HTMLAnchorElement.prototype.click = function() {};
    if (typeof XLSX !== 'undefined' && typeof XLSX.writeFile === 'function') {
      XLSX.writeFile = function() {};
    }

    setTimeout(() => {
      HTMLAnchorElement.prototype.click = savedAnchorClick;
      if (typeof XLSX !== 'undefined' && savedWriteFile) XLSX.writeFile = savedWriteFile;
      window.MatchEquiposAuditFixes?.restoreNativeAnchorClick?.();
    }, 0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = $('#equipmentExportBtn');
    if (!button) return;

    button.addEventListener('click', event => {
      event.preventDefault();
      const result = exportRegistry();
      if (!result) {
        event.stopImmediatePropagation();
        return;
      }

      temporarilySuppressLegacyDownload();
      setTimeout(() => {
        showToast('Registro descargado', `${result.filename} · ${result.count} equipos.`, 'ok');
      }, 20);
    }, true);

    window.RegistryExport = {
      exportRegistry,
      buildOrganizedExportName,
      getProcessCounters: readCounters
    };
  });
})();