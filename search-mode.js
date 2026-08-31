(() => {
  'use strict';

  const SEARCH_MODE_VERSION = '20260831-autoclear1';

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('#searchInput');
    const results = document.querySelector('#searchResults');
    const autoBtn = document.querySelector('#searchModeAuto');
    const manualBtn = document.querySelector('#searchModeManual');
    const runBtn = document.querySelector('#searchRunBtn');
    const help = document.querySelector('#searchModeHelp');

    if (!input || !results || !autoBtn || !manualBtn || !runBtn || !help) return;

    const originalSearchHandler = input.oninput;
    let searchMode = 'automatic';

    function focusSearchInput() {
      try { input.focus({preventScroll:true}); }
      catch { input.focus(); }
    }

    function isCompleteAutomaticQuery(value) {
      const query = String(value ?? '').trim().toUpperCase();
      return /^M[A-Z0-9]{11}$/.test(query) || /^0000[0-9]{12}$/.test(query);
    }

    function prepareForNextSearch() {
      input.value = '';
      focusSearchInput();
    }

    function executeSearch({clearAfter = false} = {}) {
      const query = input.value;
      if (typeof originalSearchHandler === 'function') {
        originalSearchHandler.call(input, new Event('input'));
      }
      if (window.FileIndexSearch && typeof window.FileIndexSearch.appendResults === 'function') {
        window.FileIndexSearch.appendResults(query, results);
      }
      if (window.EquipmentRegistry && typeof window.EquipmentRegistry.appendSearchResults === 'function') {
        window.EquipmentRegistry.appendSearchResults(query, results);
      }
      if (clearAfter && String(query).trim()) prepareForNextSearch();
    }

    function automaticSearch(event) {
      const query = input.value;
      executeSearch();
      if (!event?.isComposing && isCompleteAutomaticQuery(query)) {
        prepareForNextSearch();
      }
    }

    function manualWaitingMessage() {
      const value = input.value.trim();
      results.innerHTML = value
        ? '<div class="empty">Pulsa <strong>Buscar</strong> o ENTER para ejecutar la búsqueda.</div>'
        : '<div class="empty">Escribe o escanea un Host SN, UA, lote, caja o texto.</div>';
    }

    function setSearchMode(mode) {
      searchMode = mode;
      const automatic = mode === 'automatic';

      autoBtn.classList.toggle('active', automatic);
      manualBtn.classList.toggle('active', !automatic);
      runBtn.hidden = automatic;
      help.classList.toggle('manual', !automatic);

      if (automatic) {
        help.textContent = 'Busca al escanear. Al completar Host SN o UA, conserva el resultado, limpia el campo y queda listo para el siguiente.';
        input.oninput = automaticSearch;
        automaticSearch();
      } else {
        help.textContent = 'La búsqueda solo se ejecuta al pulsar Buscar o ENTER.';
        input.oninput = manualWaitingMessage;
        manualWaitingMessage();
      }

      focusSearchInput();
    }

    autoBtn.addEventListener('click', () => setSearchMode('automatic'));
    manualBtn.addEventListener('click', () => setSearchMode('manual'));
    runBtn.addEventListener('click', executeSearch);

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();

      if (searchMode === 'manual') {
        executeSearch();
        return;
      }

      if (input.value.trim()) executeSearch({clearAfter:true});
      else focusSearchInput();
    });

    window.MatchSearchModes = {
      version: SEARCH_MODE_VERSION,
      executeSearch,
      setSearchMode,
      prepareForNextSearch,
      isCompleteAutomaticQuery
    };
    setSearchMode('automatic');
  });
})();
