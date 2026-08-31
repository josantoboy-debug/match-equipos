(() => {
  'use strict';

  const SEARCH_MODE_VERSION = '20260831-autoclear2-sound1';

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

    function hasSearchHit() {
      return Boolean(results.querySelector('.search-card'));
    }

    function announceFoundResult(query) {
      if (!String(query ?? '').trim() || !hasSearchHit()) return false;
      if (window.MatchUISounds && typeof window.MatchUISounds.playFound === 'function') {
        void window.MatchUISounds.playFound();
      }
      return true;
    }

    function prepareForNextSearch() {
      input.value = '';
      focusSearchInput();
    }

    function executeSearch({clearAfter = false, announceFound = false} = {}) {
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
      if (announceFound) announceFoundResult(query);
      if (clearAfter && String(query).trim()) prepareForNextSearch();
    }

    function automaticSearch(event) {
      const query = input.value;
      const complete = !event?.isComposing && isCompleteAutomaticQuery(query);
      executeSearch({announceFound: complete});
      if (complete) prepareForNextSearch();
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
        help.textContent = 'Busca al escanear. Si encuentra un equipo o dato indexado emite una alerta; al completar Host SN o UA limpia el campo y queda listo para el siguiente.';
        input.oninput = automaticSearch;
        automaticSearch();
      } else {
        help.textContent = 'La búsqueda solo se ejecuta al pulsar Buscar o ENTER. Si hay coincidencias emite una alerta sonora.';
        input.oninput = manualWaitingMessage;
        manualWaitingMessage();
      }

      focusSearchInput();
    }

    autoBtn.addEventListener('click', () => setSearchMode('automatic'));
    manualBtn.addEventListener('click', () => setSearchMode('manual'));
    runBtn.addEventListener('click', () => executeSearch({announceFound:true}));

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();

      if (searchMode === 'manual') {
        executeSearch({announceFound:true});
        return;
      }

      if (input.value.trim()) executeSearch({clearAfter:true, announceFound:true});
      else focusSearchInput();
    });

    window.MatchSearchModes = {
      version: SEARCH_MODE_VERSION,
      executeSearch,
      setSearchMode,
      prepareForNextSearch,
      isCompleteAutomaticQuery,
      hasSearchHit,
      announceFoundResult
    };
    setSearchMode('automatic');
  });
})();
