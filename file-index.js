(() => {
  'use strict';

  const indexState = {
    entries: [],
    sources: new Map()
  };

  const textExtensions = new Set(['txt', 'csv', 'tsv', 'log']);
  const excelExtensions = new Set(['xlsx', 'xls']);

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const compact = value => String(value ?? '').toUpperCase().replace(/[-\s]/g, '');

  function extensionOf(name) {
    const parts = String(name || '').toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function detectCodes(text) {
    const upper = String(text ?? '').toUpperCase();
    const hosts = [...new Set(upper.match(/\bM[A-Z0-9]{11}\b/g) || [])];
    const uaCandidates = upper.match(/0000(?:[\s-]*\d){12}/g) || [];
    const uas = [...new Set(uaCandidates.map(v => v.replace(/[-\s]/g, '')).filter(v => /^0000\d{12}$/.test(v)))];
    return { hosts, uas };
  }

  function removeSource(fileName) {
    indexState.entries = indexState.entries.filter(entry => entry.file !== fileName);
    indexState.sources.delete(fileName);
  }

  function addEntry({file, location, rowNumber, raw, kind}) {
    const text = String(raw ?? '').trim();
    if (!text) return;
    const codes = detectCodes(text);
    indexState.entries.push({
      file,
      location,
      rowNumber,
      kind,
      raw: text,
      searchText: text.toUpperCase(),
      compactText: compact(text),
      hosts: codes.hosts,
      uas: codes.uas
    });
  }

  function updateStatus() {
    const status = document.querySelector('#fileIndexStatus');
    if (!status) return;
    const sourceCount = indexState.sources.size;
    const entryCount = indexState.entries.length;
    if (!sourceCount) {
      status.className = 'file-index-status';
      status.innerHTML = '<span class="file-index-dot"></span><span>Sin archivos indexados</span>';
      return;
    }
    const names = [...indexState.sources.keys()];
    const visible = names.length === 1 ? names[0] : `${names.length} archivos`;
    status.className = 'file-index-status ready';
    status.innerHTML = `<span class="file-index-dot"></span><span><strong>${esc(visible)}</strong> · ${entryCount.toLocaleString('es-PA')} filas/líneas indexadas</span>`;
    status.title = names.join('\n');
  }

  async function indexTextFile(file) {
    removeSource(file.name);
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => addEntry({
      file: file.name,
      location: 'Texto',
      rowNumber: i + 1,
      raw: line,
      kind: 'TEXT'
    }));
    indexState.sources.set(file.name, {type: 'Texto', entries: lines.length});
    updateStatus();
    return indexState.entries.filter(e => e.file === file.name).length;
  }

  async function indexExcelFile(file) {
    if (typeof XLSX === 'undefined') throw new Error('El módulo Excel no está disponible.');
    removeSource(file.name);
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type: 'array', cellText: true, cellDates: false});
    let rowsIndexed = 0;

    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: false, defval: ''});
      rows.forEach((row, i) => {
        const raw = (Array.isArray(row) ? row : [row])
          .map(value => String(value ?? '').trim())
          .filter(Boolean)
          .join(' | ');
        if (!raw) return;
        addEntry({
          file: file.name,
          location: sheetName,
          rowNumber: i + 1,
          raw,
          kind: 'EXCEL'
        });
        rowsIndexed++;
      });
    });

    indexState.sources.set(file.name, {type: 'Excel', entries: rowsIndexed, sheets: wb.SheetNames.length});
    updateStatus();
    return rowsIndexed;
  }

  function preview(text, query) {
    const value = String(text || '');
    if (value.length <= 170) return esc(value);
    const upper = value.toUpperCase();
    const idx = upper.indexOf(String(query || '').toUpperCase());
    const start = idx > 60 ? idx - 55 : 0;
    const slice = value.slice(start, start + 170);
    return `${start ? '…' : ''}${esc(slice)}${start + 170 < value.length ? '…' : ''}`;
  }

  function appendResults(query, resultsElement) {
    if (!resultsElement) return;
    resultsElement.querySelectorAll('.file-index-section').forEach(node => node.remove());

    const rawQuery = String(query ?? '').trim();
    if (!rawQuery || !indexState.entries.length) return;

    const qUpper = rawQuery.toUpperCase();
    const qCompact = compact(rawQuery);
    const found = [];

    for (const entry of indexState.entries) {
      const hit = entry.searchText.includes(qUpper) || (qCompact.length >= 3 && entry.compactText.includes(qCompact));
      if (hit) found.push(entry);
      if (found.length >= 50) break;
    }

    if (!found.length) return;

    resultsElement.querySelectorAll('.empty').forEach(node => {
      if (/no encontrado/i.test(node.textContent || '')) node.remove();
    });

    const totalApprox = indexState.entries.reduce((count, entry) => {
      const hit = entry.searchText.includes(qUpper) || (qCompact.length >= 3 && entry.compactText.includes(qCompact));
      return count + (hit ? 1 : 0);
    }, 0);

    const html = found.map(entry => {
      const codes = [];
      if (entry.hosts.length) codes.push(`<span class="file-code host">Host: ${esc(entry.hosts.slice(0, 3).join(', '))}</span>`);
      if (entry.uas.length) codes.push(`<span class="file-code ua">UA: ${esc(entry.uas.slice(0, 3).join(', '))}</span>`);
      return `<div class="search-card file-search-card">
        <div class="file-search-head"><span class="mini-badge file-badge">ARCHIVO</span><strong>${esc(entry.file)}</strong></div>
        <div class="file-location">${entry.kind === 'EXCEL' ? 'Hoja' : 'Origen'}: <strong>${esc(entry.location)}</strong> · ${entry.kind === 'EXCEL' ? 'Fila' : 'Línea'} ${entry.rowNumber}</div>
        ${codes.length ? `<div class="file-codes">${codes.join('')}</div>` : ''}
        <div class="file-preview">${preview(entry.raw, rawQuery)}</div>
      </div>`;
    }).join('');

    resultsElement.insertAdjacentHTML('beforeend', `<div class="file-index-section">
      <div class="file-index-heading"><span>EN ARCHIVOS INDEXADOS</span><strong>${totalApprox}${totalApprox > 50 ? '+' : ''} coincidencia${totalApprox === 1 ? '' : 's'}</strong></div>
      ${html}
      ${totalApprox > 50 ? '<div class="file-index-more">Mostrando las primeras 50 coincidencias. Refina la búsqueda para reducir resultados.</div>' : ''}
    </div>`);
  }

  function showIndexError(message) {
    const status = document.querySelector('#fileIndexStatus');
    if (!status) return;
    status.className = 'file-index-status error';
    status.innerHTML = `<span class="file-index-dot"></span><span>${esc(message)}</span>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.querySelector('#fileInput');
    if (!fileInput) return;

    const originalChangeHandler = fileInput.onchange;

    fileInput.onchange = async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const ext = extensionOf(file.name);

      try {
        if (textExtensions.has(ext)) {
          const count = await indexTextFile(file);
          fileInput.value = '';
          if (window.MatchSearchModes && typeof window.MatchSearchModes.executeSearch === 'function') {
            window.MatchSearchModes.executeSearch();
          }
          const status = document.querySelector('#fileIndexStatus');
          if (status) status.title = `${file.name}\n${count} líneas útiles indexadas`;
          return;
        }

        if (excelExtensions.has(ext)) {
          await indexExcelFile(file);
          if (window.MatchSearchModes && typeof window.MatchSearchModes.executeSearch === 'function') {
            window.MatchSearchModes.executeSearch();
          }
          if (typeof originalChangeHandler === 'function') {
            return originalChangeHandler.call(fileInput, event);
          }
          return;
        }

        showIndexError('Formato no compatible para indexación.');
        fileInput.value = '';
      } catch (error) {
        showIndexError(`No se pudo indexar: ${error.message || error}`);
        if (excelExtensions.has(ext) && typeof originalChangeHandler === 'function') {
          return originalChangeHandler.call(fileInput, event);
        }
        fileInput.value = '';
      }
    };

    updateStatus();
  });

  window.FileIndexSearch = {
    appendResults,
    getStats: () => ({sources: indexState.sources.size, entries: indexState.entries.length}),
    clear: () => {
      indexState.entries = [];
      indexState.sources.clear();
      updateStatus();
    }
  };
})();