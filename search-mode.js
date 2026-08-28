(() => {
  'use strict';

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

    function executeSearch() {
      if (typeof originalSearchHandler === 'function') {
        originalSearchHandler.call(input, new Event('input'));
      }
    }

    function manualWaitingMessage() {
      const value = input.value.trim();
      results.innerHTML = value
        ? '<div class="empty">Pulsa <strong>Buscar</strong> o ENTER para ejecutar la búsqueda.</div>'
        : '<div class="empty">Escribe o escanea un Host SN o UA.</div>';
    }

    function setSearchMode(mode) {
      searchMode = mode;
      const automatic = mode === 'automatic';

      autoBtn.classList.toggle('active', automatic);
      manualBtn.classList.toggle('active', !automatic);
      runBtn.hidden = automatic;
      help.classList.toggle('manual', !automatic);

      if (automatic) {
        help.textContent = 'Busca mientras escribes o escaneas.';
        input.oninput = executeSearch;
        executeSearch();
      } else {
        help.textContent = 'La búsqueda solo se ejecuta al pulsar Buscar o ENTER.';
        input.oninput = manualWaitingMessage;
        manualWaitingMessage();
      }

      input.focus();
    }

    autoBtn.addEventListener('click', () => setSearchMode('automatic'));
    manualBtn.addEventListener('click', () => setSearchMode('manual'));
    runBtn.addEventListener('click', executeSearch);

    input.addEventListener('keydown', event => {
      if (searchMode === 'manual' && event.key === 'Enter') {
        event.preventDefault();
        executeSearch();
      }
    });

    setSearchMode('automatic');
  });
})();