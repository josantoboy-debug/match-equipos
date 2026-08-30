(() => {
  'use strict';

  const STORAGE_PREFIX = 'matchEquipos.ttsPreference.v2';
  const OPERATOR_STORE_KEY = 'matchEquipos.operatorAccess.v1';
  const DEFAULTS = Object.freeze({welcome:false, alerts:true});
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
      alerts: typeof saved?.alerts === 'boolean' ? saved.alerts : DEFAULTS.alerts
    };
  }

  function savePreference(next) {
    preference = {...preference, ...next};
    try { localStorage.setItem(storageKey(), JSON.stringify(preference)); } catch {}
    syncControls();
    if (!preference.alerts) {
      try { window.speechSynthesis?.cancel?.(); } catch {}
    }
  }

  function isWelcome(text) {
    return /^\s*bienvenid[ao]\b/i.test(String(text || ''));
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
      const allowed = isWelcome(text) ? preference.welcome : preference.alerts;
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
      console.warn('[tts-policy] No se pudo separar bienvenida y alertas', error);
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
    if (support) support.textContent = 'speechSynthesis' in window ? 'Voz del navegador' : 'TTS no disponible';
  }

  function announceAlertsEnabled() {
    if (!preference.alerts) return;
    ensureCoreAlertsEnabled();
    setTimeout(() => {
      window.MatchVoiceTTS?.announce?.('Alertas de voz activadas.', {
        priority:'high', interrupt:true, dedupeMs:0, key:`tts-alerts-on-${Date.now()}`
      });
    }, 0);
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
          <button type="button" data-tts-setting="welcome" aria-pressed="false">
            <span class="voice-icon" aria-hidden="true">👋</span><span><strong>Bienvenida</strong><small>Al iniciar sesión</small></span><b data-tts-state>OFF</b>
          </button>
          <button type="button" data-tts-setting="alerts" aria-pressed="true">
            <span class="voice-icon" aria-hidden="true">🔊</span><span><strong>Alertas</strong><small>Errores y procesos</small></span><b data-tts-state>ON</b>
          </button>
        </div>`;
      body.insertBefore(section, note);
      section.addEventListener('click', event => {
        const button = event.target.closest('[data-tts-setting]');
        if (!button) return;
        const setting = button.dataset.ttsSetting;
        const next = !preference[setting];
        savePreference({[setting]:next});
        if (setting === 'alerts' && next) announceAlertsEnabled();
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
    getPreference: () => ({...preference}),
    setWelcome: enabled => savePreference({welcome:!!enabled}),
    setAlerts: enabled => {
      savePreference({alerts:!!enabled});
      if (enabled) announceAlertsEnabled();
    },
    setOperator,
    policyInstalled: () => speakWrapped
  };
})();
