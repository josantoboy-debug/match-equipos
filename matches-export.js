(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function textOf(element) {
    return String(element?.textContent ?? '').trim().replace(/\s+/g, ' ');
  }

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function collectFoundRows() {
    const workspaceBody = $('#workspaceBody');
    const foundTab = $('.tabs button[data-view="found"]');
    const activeTab = $('.tabs button.active');
    if (!workspaceBody || !foundTab) return [];

    const previousVisibility = workspaceBody.style.visibility;
    workspaceBody.style.visibility = 'hidden';

    if (activeTab !== foundTab) foundTab.click();

    const rows = $$('table tbody tr', workspaceBody).map(row => {
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

    if (activeTab && activeTab !== foundTab) activeTab.click();
    workspaceBody.style.visibility = previousVisibility;
    return rows;
  }

  function extractCurrentFileReferences() {
    const results = $('#searchResults');
    if (!results) return [];
    return $$('.file-search-card', results).map(card => {
      const file = textOf($('.file-search-head strong', card));
      const location = textOf($('.file-location', card));
      if (!file) return '';
      return location ? `${file} → ${location}` : file;
    }).filter(Boolean);
  }

  function referencesForValue(value) {
    const query = String(value ?? '').trim();
    if (!query || !window.MatchSearchModes?.executeSearch) return [];
    const input = $('#searchInput');
    if (!input) return [];
    input.value = query;
    window.MatchSearchModes.executeSearch();
    return extractCurrentFileReferences();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function normalizeOrigin(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function buildMatchSection(match, index) {
    const hostRefs = unique(referencesForValue(match.host));
    const carcasaRefs = unique(referencesForValue(match.uaCarcasa));
    const equipoRefs = unique(referencesForValue(match.uaEquipo));

    const allRefs = unique([
      ...hostRefs.map(ref => `HOST SN      | ${ref}`),
      ...carcasaRefs.map(ref => `UA CARCASA   | ${ref}`),
      ...equipoRefs.map(ref => `UA EQUIPO    | ${ref}`)
    ]);

    const lines = [
      '======================================================================',
      `MATCH ${String(index + 1).padStart(4, '0')}`,
      '======================================================================',
      `Host SN      : ${match.host || '—'}`,
      `UA Carcasa   : ${match.uaCarcasa || '—'}`,
      `UA Equipo    : ${match.uaEquipo || '—'}`,
      `Resultado    : ${match.resultado || '—'}`,
      `Fecha        : ${match.fecha || '—'}`,
      `Origen       : ${match.origen || '—'}`,
      '',
      'UBICACIONES INDEXADAS:'
    ];

    if (!allRefs.length) {
      lines.push('  - Sin ubicación indexada en los archivos cargados.');
    } else {
      allRefs.forEach(ref => lines.push(`  - ${ref}`));
    }

    lines.push('');
    return lines;
  }

  function buildLegacySection(rows) {
    if (!rows.length) return [];
    const lines = [
      '',
      '######################################################################',
      'ENCONTRADOS PREVIOS / REFERENCIAS SIN MATCH ACTIVO',
      '######################################################################',
      ''
    ];

    rows.forEach((row, index) => {
      const refs = unique([
        ...referencesForValue(row.host),
        ...referencesForValue(row.uaEquipo)
      ]);
      lines.push(`REF ${String(index + 1).padStart(4, '0')}`);
      lines.push(`Host SN    : ${row.host || '—'}`);
      lines.push(`UA         : ${row.uaEquipo || '—'}`);
      lines.push(`Resultado  : ${row.resultado || '—'}`);
      lines.push(`Fecha      : ${row.fecha || '—'}`);
      lines.push(`Origen     : ${row.origen || '—'}`);
      lines.push('Ubicaciones:');
      if (refs.length) refs.forEach(ref => lines.push(`  - ${ref}`));
      else lines.push('  - Sin ubicación indexada en los archivos cargados.');
      lines.push('');
    });

    return lines;
  }

  function downloadText(content) {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const filename = `Matches_Ubicaciones_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
    const blob = new Blob(['\uFEFF', content], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  function exportMatchesTxt() {
    const button = $('#exportMatchesTxtBtn');
    const input = $('#searchInput');
    const searchResults = $('#searchResults');
    if (!button || !input || !searchResults) return;

    const rows = collectFoundRows();
    const matches = rows.filter(row => normalizeOrigin(row.origen) === 'match' || /COINCIDE|UA NO COINCIDE/i.test(row.resultado));
    const legacy = rows.filter(row => !matches.includes(row));

    if (!matches.length && !legacy.length) {
      showToast('Sin equipos encontrados', 'No hay matches o encontrados para exportar.', 'warn');
      return;
    }

    const originalQuery = input.value;
    const originalVisibility = searchResults.style.visibility;
    button.disabled = true;
    button.textContent = 'Creando TXT…';
    searchResults.style.visibility = 'hidden';

    try {
      const stats = window.FileIndexSearch?.getStats?.() || {sources: 0, entries: 0};
      const generated = new Date().toLocaleString('es-PA');
      const lines = [
        'VERIFICACIÓN Y MATCH DE EQUIPOS',
        'REPORTE DE MATCHES Y UBICACIONES INDEXADAS',
        '======================================================================',
        `Generado          : ${generated}`,
        `Matches activos   : ${matches.length}`,
        `Encontrados prev. : ${legacy.length}`,
        `Archivos indexados: ${stats.sources ?? 0}`,
        `Filas/líneas índice: ${stats.entries ?? 0}`,
        '',
        'Este reporte indica dónde aparece cada Host SN / UA dentro de los',
        'archivos indexados durante la sesión actual.',
        ''
      ];

      matches.forEach((match, index) => lines.push(...buildMatchSection(match, index)));
      lines.push(...buildLegacySection(legacy));

      const filename = downloadText(lines.join('\r\n'));
      showToast('TXT exportado', `${filename} · ${matches.length} matches incluidos.`, 'ok');
    } catch (error) {
      console.error(error);
      showToast('Error al exportar TXT', error.message || String(error), 'error');
    } finally {
      input.value = originalQuery;
      input.dispatchEvent(new Event('input'));
      searchResults.style.visibility = originalVisibility;
      button.disabled = false;
      button.textContent = 'Exportar matches TXT';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = $('#exportMatchesTxtBtn');
    if (button) button.addEventListener('click', exportMatchesTxt);
  });
})();