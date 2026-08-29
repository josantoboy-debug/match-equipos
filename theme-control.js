(() => {
  'use strict';

  const LEGACY_KEY = 'matchEquipos.themePreference.v1';
  const STORAGE_PREFIX = 'matchEquipos.themePreference.v2';
  const OPERATOR_STORE_KEY = 'matchEquipos.operatorAccess.v1';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  let currentOperator = null;
  let preference = {mode:'auto', theme:'dark'};

  const normalizeName = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  function validPreference(value) {
    return !!value && (value.mode === 'auto' || value.mode === 'manual') && (value.theme === 'dark' || value.theme === 'light');
  }

  function safeJSON(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function operators() {
    const store = safeJSON(localStorage.getItem(OPERATOR_STORE_KEY), null);
    return Array.isArray(store?.operators) ? store.operators : [];
  }

  function selectedOperator() {
    const select = document.querySelector('#operatorSelect');
    if (!select?.value) return null;
    return operators().find(op => op.id === select.value) || {
      id: select.value,
      name: select.selectedOptions?.[0]?.textContent?.trim() || 'Operador'
    };
  }

  function operatorDefault(operator) {
    const name = normalizeName(operator?.name);
    if (name.includes('marcos')) return {mode:'manual', theme:'light'};
    if (name.includes('josue')) return {mode:'manual', theme:'dark'};
    return {mode:'auto', theme: systemDark.matches ? 'dark' : 'light'};
  }

  function preferenceKey(operator = currentOperator) {
    return `${STORAGE_PREFIX}.${operator?.id || 'guest'}`;
  }

  function readPreference(operator) {
    const saved = safeJSON(localStorage.getItem(preferenceKey(operator)), null);
    if (validPreference(saved)) return saved;

    const name = normalizeName(operator?.name);
    if (!name.includes('marcos') && !name.includes('josue')) {
      const legacy = safeJSON(localStorage.getItem(LEGACY_KEY), null);
      if (validPreference(legacy)) return legacy;
    }
    return operatorDefault(operator);
  }

  function effectiveTheme() {
    return preference.mode === 'auto' ? (systemDark.matches ? 'dark' : 'light') : preference.theme;
  }

  function operatorLabel() {
    const name = String(currentOperator?.name || '').trim();
    return name ? name.split(/\s+/)[0] : '';
  }

  function applyTheme() {
    const theme = effectiveTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = preference.mode;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#090d14' : '#f4f7fb';
    syncControls();
  }

  function savePreference(next) {
    preference = {...preference, ...next};
    try { localStorage.setItem(preferenceKey(), JSON.stringify(preference)); } catch {}
    applyTheme();
  }

  function setOperator(operator) {
    const next = operator?.id ? {id: operator.id, name: operator.name || 'Operador'} : null;
    if (next?.id === currentOperator?.id && next?.name === currentOperator?.name) return;
    currentOperator = next;
    preference = readPreference(currentOperator);
    applyTheme();
  }

  function syncControls() {
    const theme = effectiveTheme();
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = preference.mode === 'manual' && button.dataset.themeChoice === preference.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-theme-mode-choice="auto"]').forEach(button => {
      const active = preference.mode === 'auto';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const status = document.querySelector('#operatorThemeStatus');
    if (status) {
      const who = operatorLabel();
      const state = preference.mode === 'auto'
        ? `Auto · ${theme === 'dark' ? 'oscuro' : 'claro'}`
        : (theme === 'dark' ? 'Oscuro' : 'Claro');
      status.textContent = who ? `${who} · ${state}` : state;
    }
  }

  function bindOperatorSelect() {
    const select = document.querySelector('#operatorSelect');
    if (!select) return false;
    if (select.dataset.themeBound !== '1') {
      select.dataset.themeBound = '1';
      select.addEventListener('change', () => setOperator(selectedOperator()));
    }
    if (!currentOperator) setOperator(selectedOperator());
    return true;
  }

  function installLoginControls() {
    const body = document.querySelector('.operator-login-body');
    const note = body?.querySelector('.operator-login-note');
    if (!body || !note) return false;

    if (!document.querySelector('#operatorThemeControl')) {
      const control = document.createElement('section');
      control.id = 'operatorThemeControl';
      control.className = 'operator-theme-control';
      control.setAttribute('aria-label', 'Tema de interfaz');
      control.innerHTML = `
        <div class="operator-theme-head">
          <span>TEMA</span>
          <small id="operatorThemeStatus"></small>
        </div>
        <div class="operator-theme-picker" role="group" aria-label="Cambiar tema">
          <button type="button" class="theme-icon-button" data-theme-choice="light" aria-label="Tema claro manual" title="Tema claro">
            <span class="theme-glyph" aria-hidden="true">☀</span><small>CLARO</small>
          </button>
          <button type="button" class="theme-auto-button" data-theme-mode-choice="auto" aria-label="Tema automático según el sistema" title="Automático">
            <span class="theme-auto-glyph" aria-hidden="true">◐</span><small>AUTO</small>
          </button>
          <button type="button" class="theme-icon-button" data-theme-choice="dark" aria-label="Tema oscuro manual" title="Tema oscuro">
            <span class="theme-glyph" aria-hidden="true">☾</span><small>OSCURO</small>
          </button>
        </div>`;
      body.insertBefore(control, note);

      control.addEventListener('click', event => {
        const auto = event.target.closest('[data-theme-mode-choice="auto"]');
        if (auto) {
          savePreference({mode:'auto'});
          return;
        }
        const choice = event.target.closest('[data-theme-choice]');
        if (choice) savePreference({mode:'manual', theme: choice.dataset.themeChoice === 'light' ? 'light' : 'dark'});
      });
    }

    bindOperatorSelect();
    syncControls();
    return true;
  }

  function watchLogin() {
    installLoginControls();
    const observer = new MutationObserver(() => {
      installLoginControls();
      bindOperatorSelect();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }

  systemDark.addEventListener?.('change', () => {
    if (preference.mode === 'auto') applyTheme();
  });

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    setOperator({id:detail.id, name:detail.name});
  });

  preference = readPreference(null);
  applyTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLogin);
  else watchLogin();

  window.AppTheme = {
    getPreference: () => ({...preference}),
    getEffectiveTheme: effectiveTheme,
    getCurrentOperator: () => currentOperator ? {...currentOperator} : null,
    setAuto: () => savePreference({mode:'auto'}),
    setManual: theme => savePreference({mode:'manual', theme: theme === 'light' ? 'light' : 'dark'}),
    setOperator
  };
})();