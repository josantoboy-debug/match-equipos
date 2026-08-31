(() => {
  'use strict';

  const POLICY_VERSION = '20260831-critical3';
  const STORAGE_PREFIX = 'matchEquipos.ttsPreference.v3';
  const OPERATOR_STORE_KEY = 'matchEquipos.operatorAccess.v1';
  const DEFAULTS = Object.freeze({welcome:false, criticalWarnings:true, alerts:false});
  const $ = selector => document.querySelector(selector);

  let currentOperator = null;
  let preference = {...DEFAULTS};
  let nativeSpeak = null;
  let speakWrapped = false;

  function safeJSON(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function operators() {
    const store = safeJSON(localStorage.getItem(OPERATOR_STORE_KEY), null);
    return Array.isArray(store?.operators) ? store.operators : [];
  }

  function selectedOperator() {
    const select = $('#operatorSelect');
    if (!select?.value) return null;
    return operators().find(op => op.id === select.value) || {
      id: select.value,
      name: select.selectedOptions?.[0]?.textContent?.trim() || 'Operador'
    };
  }

  function storageKey(operator = currentOperator) {
    return `${STORAGE_PREFIX}.${operator?.id || 'guest'}`;
  }

  function readPreference(operator) {
    const saved = safeJSON(localStorage.getItem(storageKey(operator)), null);
    return {
      welcome: typeof saved?.welcome === 'boolean' ? saved.welcome : DEFAULTS.welcome,
      criticalWarnings: typeof saved?.criticalWarnings === 'boolean' ? saved.criticalWarnings : DEFAULTS.criticalWarnings,
      alerts: typeof saved?.alerts === 'boolean' ? saved.alerts : DEFAULTS.alerts
    };
  }

  function savePreference(next) {
    preference = {...preference, ...next};
    try { localStorage.setItem(storageKey(), JSON.stringify(preference)); } catch {}
    syncControls();
    if (!preference.welcome && !preference.criticalWarnings && !preference.alerts) {
      try { window.speechSynthesis?.cancel?.(); } catch {}
    }
  }

  function normalizeSpeechText(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isWelcome(text) {
    return /^\s*bienvenid[ao]\b/i.test(String(text || ''));
  }

  function isCriticalWarning(text) {
    const value = normalizeSpeechText(text);
    if (!value) return false;

    // 1) Dispositivo / registro duplicado.
    if (/duplicad|dispositivo repetid|ya existe/.test(value)) return true;

    // 2) Error en código UA o Serial / Host SN.
    const uaMention = /\bu\s*a\b|unit address/.test(value);
    const serialMention = /serial|host\s*s\s*n|host sn|\bs\s*n\b/.test(value);
    const codeError = /invalid|incorrect|error|no valido|formato|debe iniciar|debe comenzar|debe tener|incomplet|longitud|fuera del formato/.test(value);
    if (codeError && (uaMention || serialMention)) return true;
    if (/host sn ya registrado con otro ua/.test(value)) return true;

    // 3) No Match de dispositivos: discrepancia o contraparte aún no encontrada.
    if (/no coincide|no se creo match|no se encontro todavia|no se encontro aun|match pendiente|revisar ua/.test(value)) return true;
    if (/serial.*otra ua|ua.*otro serial|mismo host.*ua diferente/.test(value)) return true;

    // 4) Precaución antes de iniciar otra sesión.
    if (/ya guardaste|asegurate de (guardar|exportar)|antes de .*nueva sesion|antes de .*otra sesion/.test(value)) return true;

    return false;
  }

  function completeSuppressedUtterance(utterance) {
    setTimeout(() => {
      try {
        if (typeof utterance?.onend === 'function') utterance.onend(new Event('end'));
      } catch {}
    }, 0);
  }

  function installSpeechPolicy() {
    const synth = window.speechSynthesis;
    if (!synth || speakWrapped || typeof synth.speak !== 'function') return false;

    nativeSpeak = synth.speak.bind(synth);
    const wrappedSpeak = utterance => {
      const text = String(utterance?.text || '');
      const critical = isCriticalWarning(text);
      const allowed = critical
        ? preference.criticalWarnings
        : isWelcome(text)
          ? preference.welcome
          : preference.alerts;
      if (!allowed) {
        completeSuppressedUtterance(utterance);
        return;
      }
      return nativeSpeak(utterance);
    };

    try {
      synth.speak = wrappedSpeak;
      if (synth.speak !== wrappedSpeak) {
        Object.defineProperty(synth, 'speak', {configurable:true, writable:true, value:wrappedSpeak});
      }
      speakWrapped = synth.speak === wrappedSpeak;
    } catch (error) {
      console.warn('[tts-policy] No se pudo instalar la política selectiva de voz', error);
      speakWrapped = false;
    }
    return speakWrapped;
  }

  function ensureCoreAlertsEnabled() {
    const core = window.MatchVoiceTTS;
    if (!core?.setEnabled) return false;
    try {
      core.setEnabled(true, {announceState:false});
      return true;
    } catch { return false; }
  }

  function setOperator(operator) {
    const next = operator?.id ? {id:operator.id, name:operator.name || 'Operador'} : null;
    if (next?.id === currentOperator?.id && next?.name === currentOperator?.name) return;
    currentOperator = next;
    preference = readPreference(currentOperator);
    syncControls();
  }

  function bindOperatorSelect() {
    const select = $('#operatorSelect');
    if (!select) return false;
    if (select.dataset.ttsPolicyBound !== '1') {
      select.dataset.ttsPolicyBound = '1';
      select.addEventListener('change', () => setOperator(selectedOperator()));
    }
    if (!currentOperator) setOperator(selectedOperator());
    return true;
  }

  function syncControls() {
    document.querySelectorAll('[data-tts-setting]').forEach(button => {
      const setting = button.dataset.ttsSetting;
      const active = !!preference[setting];
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      const state = button.querySelector('[data-tts-state]');
      if (state) state.textContent = active ? 'ON' : 'OFF';
    });
    const support = $('#operatorVoiceSupport');
    if (support) support.textContent = 'speechSynthesis' in window ? 'Precauciones críticas por voz' : 'TTS no disponible';
    document.documentElement.dataset.ttsPolicyVersion = POLICY_VERSION;
  }

  function installLoginControls() {
    const body = document.querySelector('.operator-login-body');
    const note = body?.querySelector('.operator-login-note');
    if (!body || !note) return false;

    if (!$('#operatorVoiceControl')) {
      const section = document.createElement('section');
      section.id = 'operatorVoiceControl';
      section.className = 'operator-voice-control';
      section.innerHTML = `
        <div class="operator-voice-head"><span>VOZ TTS</span><small id="operatorVoiceSupport"></small></div>
        <div class="operator-voice-options">
          <button type="button" data-tts-setting="criticalWarnings" aria-pressed="true">
            <span class="voice-icon" aria-hidden="true">⚠️</span><span><strong>Precauciones</strong><small>Duplicado · códigos · no Match · nueva sesión</small></span><b data-tts-state>ON</b>
          </button>
          <button type="button" data-tts-setting="welcome" aria-pressed="false">
            <span class="voice-icon" aria-hidden="true">👋</span><span><strong>Bienvenida</strong><small>Al iniciar sesión</small></span><b data-tts-state>OFF</b>
          </button>
          <button type="button" data-tts-setting="alerts" aria-pressed="false">
            <span class="voice-icon" aria-hidden="true">🔊</span><span><strong>Otros avisos</strong><small>Procesos y confirmaciones</small></span><b data-tts-state>OFF</b>
          </button>
        </div>`;
      body.insertBefore(section, note);
      section.addEventListener('click', event => {
        const button = event.target.closest('[data-tts-setting]');
        if (!button) return;
        const setting = button.dataset.ttsSetting;
        savePreference({[setting]:!preference[setting]});
      });
    }

    bindOperatorSelect();
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

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    setOperator({id:detail.id, name:detail.name});
    installSpeechPolicy();
    ensureCoreAlertsEnabled();
  });

  preference = readPreference(null);
  installSpeechPolicy();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      watchLogin();
      setTimeout(() => {
        installSpeechPolicy();
        ensureCoreAlertsEnabled();
      }, 0);
    });
  } else {
    watchLogin();
    setTimeout(() => {
      installSpeechPolicy();
      ensureCoreAlertsEnabled();
    }, 0);
  }

  window.AppTTS = {
    version: POLICY_VERSION,
    getPreference: () => ({...preference}),
    isCriticalWarning,
    setWelcome: enabled => savePreference({welcome:!!enabled}),
    setCriticalWarnings: enabled => savePreference({criticalWarnings:!!enabled}),
    setAlerts: enabled => savePreference({alerts:!!enabled}),
    setOperator,
    policyInstalled: () => speakWrapped
  };
})();