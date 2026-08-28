(() => {
  'use strict';

  const indexState = {
    entries: [],
    sources: new Map(),
    lastQuery: ''
  };

  const spreadsheetExtensions = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods']);
  const delimitedExtensions = new Set(['csv', 'tsv']);
  const textExtensions = new Set(['txt', 'log', 'json', 'xml', 'html', 'htm', 'md', 'dat', 'ini']);
  const allCompatibleExtensions = new Set([...spreadsheetExtensions, ...delimitedExtensions, ...textExtensions]);

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
    return {hosts, uas};
  }

  function columnLetter(index) {
    let n = Number(index) + 1;
    let out = '';
    while (n > 0) {
      const mod = (n - 1) % 26;
      out = String.fromCharCode(65 + mod) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  function removeSource(fileName) {
    indexState.entries = indexState.entries.filter(entry => entry.file !== fileName);
    indexState.sources.delete(fileName);
  }

  function addEntry({file, location, rowNumber, raw, kind, cells = [], sourceType = ''}) {
    const text = String(raw ?? '').trim();
    if (!text) return;
    const codes = detectCodes(text);
    indexState.entries.push({
      id: `IDX-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      location,
      rowNumber,
      kind,
      sourceType,
      raw: text,
      cells,
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
    status.title = [...indexState.sources.entries()].map(([name, meta]) => `${name} · ${meta.type} · ${meta.entries} ubicaciones`).join('\n');
  }

  function indexWorkbook(wb, fileName, sourceType) {
    removeSource(fileName);
    let rowsIndexed = 0;

    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: false, defval: ''});
      rows.forEach((row, rowIndex) => {
        const values = Array.isArray(row) ? row : [row];
        const cells = values.map((value, columnIndex) => {
          const text = String(value ?? '').trim();
          if (!text) return null;
          const letter = columnLetter(columnIndex);
          return {
            columnIndex,
            columnNumber: columnIndex + 1,
            columnLetter: letter,
            cell: `${letter}${rowIndex + 1}`,
            value: text,
            searchText: text.toUpperCase(),
            compactText: compact(text)
          };
        }).filter(Boolean);

        const raw = cells.map(cell => cell.value).join(' | ');
        if (!raw) return;

        addEntry({
          file: fileName,
          location: sheetName,
          rowNumber: rowIndex + 1,
          raw,
          cells,
          kind: 'SHEET',
          sourceType
        });
        rowsIndexed++;
      });
    });

    indexState.sources.set(fileName, {
      type: sourceType,
      entries: rowsIndexed,
      sheets: wb.SheetNames.length
    });
    updateStatus();
    return rowsIndexed;
  }

  async function indexSpreadsheetFile(file, ext) {
    if (typeof XLSX === 'undefined') throw new Error('El módulo de hojas de cálculo no está disponible.');
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type: 'array', cellText: true, cellDates: false});
    return indexWorkbook(wb, file.name, ext.toUpperCase());
  }

  async function indexDelimitedFile(file, ext) {
    removeSource(file.name);
    const text = await file.text();

    if (typeof XLSX !== 'undefined') {
      const options = {type: 'string', raw: false};
      if (ext === 'tsv') options.FS = '\t';
      const wb = XLSX.read(text, options);
      return indexWorkbook(wb, file.name, ext.toUpperCase());
    }

    const delimiter = ext === 'tsv' ? '\t' : ',';
    const lines = text.split(/\r?\n/);
    lines.forEach((line, rowIndex) => {
      if (!line.trim()) return;
      const values = line.split(delimiter);
      const cells = values.map((value, columnIndex) => {
        const cellText = String(value ?? '').trim();
        if (!cellText) return null;
        const letter = columnLetter(columnIndex);
        return {
          columnIndex,
          columnNumber: columnIndex + 1,
          columnLetter: letter,
          cell: `${letter}${rowIndex + 1}`,
          value: cellText,
          searchText: cellText.toUpperCase(),
          compactText: compact(cellText)
        };
      }).filter(Boolean);
      addEntry({
        file: file.name,
        location: ext.toUpperCase(),
        rowNumber: rowIndex + 1,
        raw: cells.map(cell => cell.value).join(' | '),
        cells,
        kind: 'SHEET',
        sourceType: ext.toUpperCase()
      });
    });
    indexState.sources.set(file.name, {type: ext.toUpperCase(), entries: lines.length, sheets: 1});
    updateStatus();
    return indexState.entries.filter(entry => entry.file === file.name).length;
  }

  async function indexTextFile(file, ext) {
    removeSource(file.name);
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => addEntry({
      file: file.name,
      location: ext.toUpperCase() || 'TEXTO',
      rowNumber: index + 1,
      raw: line,
      kind: 'TEXT',
      sourceType: ext.toUpperCase() || 'TEXTO'
    }));
    const useful = indexState.entries.filter(entry => entry.file === file.name).length;
    indexState.sources.set(file.name, {type: ext.toUpperCase() || 'Texto', entries: useful});
    updateStatus();
    return useful;
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

  function entryMatches(entry, qUpper, qCompact) {
    return entry.searchText.includes(qUpper) || (qCompact.length >= 3 && entry.compactText.includes(qCompact));
  }

  function matchingCells(entry, rawQuery) {
    if (entry.kind !== 'SHEET' || !entry.cells?.length) return [];
    const qUpper = String(rawQuery || '').toUpperCase();
    const qCompact = compact(rawQuery);
    return entry.cells.filter(cell =>
      cell.searchText.includes(qUpper) || (qCompact.length >= 3 && cell.compactText.includes(qCompact))
    );
  }

  function normalizedTextPosition(raw, query) {
    const source = String(raw || '');
    const directQuery = String(query || '');
    if (!directQuery) return null;

    const directIndex = source.toUpperCase().indexOf(directQuery.toUpperCase());
    if (directIndex >= 0) {
      return {start: directIndex + 1, end: directIndex + directQuery.length, normalized: false};
    }

    const qCompact = compact(directQuery);
    if (!qCompact) return null;

    let normalized = '';
    const map = [];
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (/[-\s]/.test(ch)) continue;
      normalized += ch.toUpperCase();
      map.push(i);
    }

    const idx = normalized.indexOf(qCompact);
    if (idx < 0) return null;
    const startOriginal = map[idx];
    const endOriginal = map[Math.min(map.length - 1, idx + qCompact.length - 1)];
    return {start: startOriginal + 1, end: endOriginal + 1, normalized: true};
  }

  function referenceFor(entry, rawQuery) {
    if (entry.kind === 'SHEET') {
      const cells = matchingCells(entry, rawQuery);
      const locationLabel = ['CSV', 'TSV'].includes(entry.sourceType) ? 'Tabla' : 'Hoja';
      if (cells.length) {
        const first = cells[0];
        return `${entry.file} → ${locationLabel} ${entry.location} → ${first.cell} (fila ${entry.rowNumber}, columna ${first.columnLetter}/${first.columnNumber})`;
      }
      return `${entry.file} → ${locationLabel} ${entry.location} → fila ${entry.rowNumber}`;
    }
    const pos = normalizedTextPosition(entry.raw, rawQuery);
    return `${entry.file} → línea ${entry.rowNumber}${pos ? ` → caracteres ${pos.start}-${pos.end}${pos.normalized ? ' (coincidencia normalizada)' : ''}` : ''}`;
  }

  function ensureLocationModal() {
    if (document.querySelector('#fileLocationModal')) return;
    const modal = document.createElement('div');
    modal.id = 'fileLocationModal';
    modal.className = 'index-location-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="index-location-dialog" role="dialog" aria-modal="true" aria-labelledby="fileLocationTitle">
        <div class="index-location-head">
          <div><span class="mini-badge file-badge">ÍNDICE</span><h2 id="fileLocationTitle">Ubicación indexada</h2></div>
          <button id="fileLocationClose" class="index-location-close" type="button" aria-label="Cerrar">×</button>
        </div>
        <div id="fileLocationBody" class="index-location-body"></div>
        <div class="index-location-actions">
          <button id="copyFileReference" class="index-copy-btn" type="button">Copiar referencia</button>
          <button id="closeFileLocation" class="index-close-btn" type="button">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };
    modal.querySelector('#fileLocationClose').addEventListener('click', close);
    modal.querySelector('#closeFileLocation').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) close(); });
  }

  function sheetContextTable(entry, matchedCells) {
    const matchedSet = new Set(matchedCells.map(cell => cell.cell));
    const cells = entry.cells || [];
    if (!cells.length) return '<div class="index-empty-context">No hay celdas con contenido en esta fila.</div>';
    return `<div class="index-context-table-wrap"><table class="index-context-table">
      <thead><tr><th>Columna</th><th>Celda</th><th>Valor</th></tr></thead>
      <tbody>${cells.map(cell => `<tr class="${matchedSet.has(cell.cell) ? 'matched' : ''}">
        <td><strong>${cell.columnLetter}</strong> <span>(${cell.columnNumber})</span></td>
        <td class="mono">${esc(cell.cell)}</td>
        <td>${esc(cell.value)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function openEntry(entry, rawQuery) {
    ensureLocationModal();
    const modal = document.querySelector('#fileLocationModal');
    const body = document.querySelector('#fileLocationBody');
    const copyBtn = document.querySelector('#copyFileReference');
    if (!modal || !body || !copyBtn) return;

    const reference = referenceFor(entry, rawQuery);
    let details = '';

    if (entry.kind === 'SHEET') {
      const cells = matchingCells(entry, rawQuery);
      const primary = cells[0] || null;
      const locationLabel = ['CSV', 'TSV'].includes(entry.sourceType) ? 'Tabla' : 'Hoja';
      details = `
        <div class="index-location-path">
          <div><span>Archivo de origen</span><strong>${esc(entry.file)}</strong></div>
          <div><span>Formato</span><strong>${esc(entry.sourceType || 'Hoja de cálculo')}</strong></div>
          <div><span>${locationLabel}</span><strong>${esc(entry.location)}</strong></div>
          <div><span>Fila</span><strong>${entry.rowNumber}</strong></div>
          <div><span>Columna</span><strong>${primary ? `${esc(primary.columnLetter)} / ${primary.columnNumber}` : '—'}</strong></div>
          <div><span>Celda</span><strong class="mono">${primary ? esc(primary.cell) : '—'}</strong></div>
        </div>
        ${cells.length > 1 ? `<div class="index-multi-hit">La búsqueda coincide en ${cells.length} celdas: ${cells.map(c => `<span class="mono">${esc(c.cell)}</span>`).join(', ')}</div>` : ''}
        <div class="index-reference-line"><span>Referencia directa</span><strong>${esc(reference)}</strong></div>
        <div class="index-context-title">Contexto de la fila ${entry.rowNumber}</div>
        ${sheetContextTable(entry, cells)}
      `;
    } else {
      const pos = normalizedTextPosition(entry.raw, rawQuery);
      details = `
        <div class="index-location-path text-path">
          <div><span>Archivo de origen</span><strong>${esc(entry.file)}</strong></div>
          <div><span>Formato</span><strong>${esc(entry.sourceType || 'Texto')}</strong></div>
          <div><span>Línea</span><strong>${entry.rowNumber}</strong></div>
          <div><span>Posición</span><strong>${pos ? `caracteres ${pos.start}-${pos.end}${pos.normalized ? ' · normalizada' : ''}` : 'coincidencia en línea'}</strong></div>
        </div>
        <div class="index-reference-line"><span>Referencia directa</span><strong>${esc(reference)}</strong></div>
        <div class="index-context-title">Contenido de la línea ${entry.rowNumber}</div>
        <pre class="index-text-line">${esc(entry.raw)}</pre>
      `;
    }

    body.innerHTML = details;
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(reference);
        copyBtn.textContent = 'Referencia copiada ✓';
        setTimeout(() => { copyBtn.textContent = 'Copiar referencia'; }, 1600);
      } catch {
        copyBtn.textContent = 'No se pudo copiar';
        setTimeout(() => { copyBtn.textContent = 'Copiar referencia'; }, 1600);
      }
    };

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function findEntries(query, limit = 50) {
    const rawQuery = String(query ?? '').trim();
    if (!rawQuery) return [];
    const qUpper = rawQuery.toUpperCase();
    const qCompact = compact(rawQuery);
    const found = [];
    for (const entry of indexState.entries) {
      if (entryMatches(entry, qUpper, qCompact)) found.push(entry);
      if (found.length >= limit) break;
    }
    return found;
  }

  function appendResults(query, resultsElement) {
    if (!resultsElement) return;
    resultsElement.querySelectorAll('.file-index-section').forEach(node => node.remove());

    const rawQuery = String(query ?? '').trim();
    indexState.lastQuery = rawQuery;
    if (!rawQuery || !indexState.entries.length) return;

    const found = findEntries(rawQuery, 50);
    if (!found.length) return;

    resultsElement.querySelectorAll('.empty').forEach(node => {
      if (/no encontrado/i.test(node.textContent || '')) node.remove();
    });

    const qUpper = rawQuery.toUpperCase();
    const qCompact = compact(rawQuery);
    const total = indexState.entries.reduce((count, entry) => count + (entryMatches(entry, qUpper, qCompact) ? 1 : 0), 0);

    const html = found.map(entry => {
      const codes = [];
      if (entry.hosts.length) codes.push(`<span class="file-code host">Host: ${esc(entry.hosts.slice(0, 3).join(', '))}</span>`);
      if (entry.uas.length) codes.push(`<span class="file-code ua">UA: ${esc(entry.uas.slice(0, 3).join(', '))}</span>`);

      let locationHtml = '';
      if (entry.kind === 'SHEET') {
        const hits = matchingCells(entry, rawQuery);
        const cellText = hits.length ? hits.slice(0, 3).map(cell => cell.cell).join(', ') : 'fila completa';
        const columnText = hits.length ? hits.slice(0, 3).map(cell => `${cell.columnLetter}/${cell.columnNumber}`).join(', ') : '—';
        const locationLabel = ['CSV', 'TSV'].includes(entry.sourceType) ? 'Tabla' : 'Hoja';
        locationHtml = `Formato: <strong>${esc(entry.sourceType)}</strong> · ${locationLabel}: <strong>${esc(entry.location)}</strong> · Fila: <strong>${entry.rowNumber}</strong> · Celda: <strong class="mono">${esc(cellText)}</strong> · Columna: <strong>${esc(columnText)}</strong>`;
      } else {
        const pos = normalizedTextPosition(entry.raw, rawQuery);
        locationHtml = `Formato: <strong>${esc(entry.sourceType)}</strong> · Línea: <strong>${entry.rowNumber}</strong>${pos ? ` · Posición: <strong>${pos.start}-${pos.end}${pos.normalized ? ' N' : ''}</strong>` : ''}`;
      }

      return `<button class="search-card file-search-card file-search-link" type="button" data-index-entry="${esc(entry.id)}" aria-label="Abrir ubicación en ${esc(entry.file)}">
        <div class="file-search-head"><span class="mini-badge file-badge">ARCHIVO</span><strong>${esc(entry.file)}</strong><span class="file-open-hint">Abrir ubicación →</span></div>
        <div class="file-location">${locationHtml}</div>
        ${codes.length ? `<div class="file-codes">${codes.join('')}</div>` : ''}
        <div class="file-preview">${preview(entry.raw, rawQuery)}</div>
      </button>`;
    }).join('');

    resultsElement.insertAdjacentHTML('beforeend', `<div class="file-index-section">
      <div class="file-index-heading"><span>EN ARCHIVOS INDEXADOS</span><strong>${total}${total > 50 ? '+' : ''} coincidencia${total === 1 ? '' : 's'}</strong></div>
      ${html}
      ${total > 50 ? '<div class="file-index-more">Mostrando las primeras 50 coincidencias. Refina la búsqueda para reducir resultados.</div>' : ''}
    </div>`);

    resultsElement.querySelectorAll('[data-index-entry]').forEach(button => {
      button.addEventListener('click', () => {
        const entry = indexState.entries.find(item => item.id === button.dataset.indexEntry);
        if (entry) openEntry(entry, rawQuery);
      });
    });
  }

  function showIndexError(message) {
    const status = document.querySelector('#fileIndexStatus');
    if (!status) return;
    status.className = 'file-index-status error';
    status.innerHTML = `<span class="file-index-dot"></span><span>${esc(message)}</span>`;
  }

  function refreshCurrentSearch() {
    if (window.MatchSearchModes && typeof window.MatchSearchModes.executeSearch === 'function') {
      window.MatchSearchModes.executeSearch();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.querySelector('#fileInput');
    if (!fileInput) return;

    ensureLocationModal();
    const originalChangeHandler = fileInput.onchange;

    fileInput.onchange = async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const ext = extensionOf(file.name);

      if (!allCompatibleExtensions.has(ext)) {
        showIndexError(`.${ext || '?'} no es un formato compatible para búsqueda.`);
        fileInput.value = '';
        return;
      }

      try {
        let count = 0;
        if (spreadsheetExtensions.has(ext)) {
          count = await indexSpreadsheetFile(file, ext);
          refreshCurrentSearch();
          if (typeof originalChangeHandler === 'function') {
            return originalChangeHandler.call(fileInput, event);
          }
        } else if (delimitedExtensions.has(ext)) {
          count = await indexDelimitedFile(file, ext);
          refreshCurrentSearch();
          if (typeof originalChangeHandler === 'function') {
            return originalChangeHandler.call(fileInput, event);
          }
        } else {
          count = await indexTextFile(file, ext);
          fileInput.value = '';
          refreshCurrentSearch();
        }

        const status = document.querySelector('#fileIndexStatus');
        if (status) status.title = `${file.name}\n${count} ubicaciones indexadas`;
      } catch (error) {
        showIndexError(`No se pudo indexar: ${error.message || error}`);
        if ((spreadsheetExtensions.has(ext) || delimitedExtensions.has(ext)) && typeof originalChangeHandler === 'function') {
          return originalChangeHandler.call(fileInput, event);
        }
        fileInput.value = '';
      }
    };

    updateStatus();
  });

  window.FileIndexSearch = {
    appendResults,
    openEntry,
    findReferences: query => findEntries(query, 500).map(entry => referenceFor(entry, query)),
    getStats: () => ({sources: indexState.sources.size, entries: indexState.entries.length}),
    getCompatibleExtensions: () => [...allCompatibleExtensions],
    clear: () => {
      indexState.entries = [];
      indexState.sources.clear();
      updateStatus();
    }
  };
})();