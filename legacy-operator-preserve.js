(() => {
  'use strict';

  const APP_KEY = 'matchEquipos.operatorAccess.v1';
  const $ = selector => document.querySelector(selector);

  function safeJSON(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function getLegacyOperators() {
    const store = safeJSON(localStorage.getItem(APP_KEY), null);
    if (!store || !Array.isArray(store.operators)) return [];
    return store.operators.filter(operator => operator && operator.id && operator.name && operator.active !== false && !operator.cloud);
  }

  function appendLegacyOptions() {
    const select = $('#operatorSelect');
    if (!select) return;

    const existing = new Set([...select.options].map(option => option.value));
    getLegacyOperators().forEach(operator => {
      if (existing.has(operator.id)) return;
      const option = document.createElement('option');
      option.value = operator.id;
      option.textContent = `${operator.name} · Local`;
      option.dataset.legacyLocal = 'true';
      select.appendChild(option);
    });

    if (select.options.length && select.value) {
      const loginButton = $('#operatorLoginBtn');
      if (loginButton) loginButton.disabled = false;
    }
  }

  function boot() {
    appendLegacyOptions();
    const observer = new MutationObserver(() => appendLegacyOptions());
    observer.observe(document.body, {childList: true, subtree: true});
    window.addEventListener('storage', event => {
      if (event.key === APP_KEY) appendLegacyOptions();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
