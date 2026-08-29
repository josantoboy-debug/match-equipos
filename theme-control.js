(() => {
  'use strict';

  const STORAGE_KEY = 'matchEquipos.themePreference.v1';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function readPreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && (saved.mode === 'auto' || saved.mode === 'manual') && (saved.theme === 'dark' || saved.theme === 'light')) {
        return saved;
      }
    } catch {}
    return {mode: 'auto', theme: 'dark'};
  }

  let preference = readPreference();

  function effectiveTheme() {
    return preference.mode === 'auto' ? (systemDark.matches ? 'dark' : 'light') : preference.theme;
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch {}
    applyTheme();
  }

  function syncControls() {
    document.querySelectorAll('[data-theme-mode-choice]').forEach(button => {
      const active = button.dataset.themeModeChoice === preference.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const manual = document.querySelector('#operatorManualThemeChoices');
    if (manual) manual.hidden = preference.mode !== 'manual';
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === preference.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const status = document.querySelector('#operatorThemeStatus');
    if (status) {
      status.textContent = preference.mode === 'auto'
        ? `Automático · ${effectiveTheme() === 'dark' ? 'oscuro' : 'claro'} según el sistema`
        : `Manual · ${preference.theme === 'dark' ? 'oscuro' : 'claro'}`;
    }
  }

  function installLoginControls() {
    if (document.querySelector('#operatorThemeControl')) return true;
    const body = document.querySelector('.operator-login-body');
    const note = body?.querySelector('.operator-login-note');
    if (!body || !note) return false;

    const control = document.createElement('section');
    control.id = 'operatorThemeControl';
    control.className = 'operator-theme-control';
    control.setAttribute('aria-label', 'Tema de interfaz');
    control.innerHTML = `
      <div class="operator-theme-head">
        <span>TEMA DE INTERFAZ</span>
        <small id="operatorThemeStatus"></small>
      </div>
      <div class="operator-theme-mode" role="group" aria-label="Modo del tema">
        <button type="button" data-theme-mode-choice="auto">Automático</button>
        <button type="button" data-theme-mode-choice="manual">Manual</button>
      </div>
      <div id="operatorManualThemeChoices" class="operator-theme-manual" role="group" aria-label="Tema manual">
        <button type="button" data-theme-choice="dark">Oscuro</button>
        <button type="button" data-theme-choice="light">Claro</button>
      </div>`;
    body.insertBefore(control, note);

    control.addEventListener('click', event => {
      const modeButton = event.target.closest('[data-theme-mode-choice]');
      if (modeButton) {
        savePreference({mode: modeButton.dataset.themeModeChoice});
        return;
      }
      const themeButton = event.target.closest('[data-theme-choice]');
      if (themeButton) savePreference({mode: 'manual', theme: themeButton.dataset.themeChoice});
    });
    syncControls();
    return true;
  }

  function watchLogin() {
    if (installLoginControls()) return;
    const observer = new MutationObserver(() => {
      if (installLoginControls()) observer.disconnect();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }

  systemDark.addEventListener?.('change', () => {
    if (preference.mode === 'auto') applyTheme();
  });

  applyTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLogin);
  else watchLogin();

  window.AppTheme = {
    getPreference: () => ({...preference}),
    getEffectiveTheme: effectiveTheme,
    setAuto: () => savePreference({mode:'auto'}),
    setManual: theme => savePreference({mode:'manual', theme: theme === 'light' ? 'light' : 'dark'})
  };
})();