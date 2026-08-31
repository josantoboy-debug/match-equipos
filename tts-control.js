(() => {
  'use strict';

  const POLICY_VERSION = '20260831-critical4';
  const STORAGE_PREFIX = 'matchEquipos.ttsPreference.v3';
  const OPERATOR_STORE_KEY = 'matchEquipos.operatorAccess.v1';
  const DEFAULTS = Object.freeze({welcome:false, criticalWarnings:true, alerts:false});
  const FIXED_MESSAGES = Object.freeze({
    duplicate:'Precaución. Dispositivo duplicado.',
    serial:'Error en código Serial. Host SN inválido.',
    ua:'Error en código UA. UA inválido.',
    match:'Los dispositivos hacen Match.',
    newSession:'Precaución. Guarda el registro antes de iniciar otra sesión.'
  });
  const $ = selector => document.querySelector(selector);

  let currentOperator = null;
  let preference = {...DEFAULTS};
  let nativeSpeak = null;
  let speakWrapped = false;
  let lastMatchCount = null;
  let matchObserver = null;
  const lastFixedAt = new Map();

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

  function fixedAnnouncement(text) {
    const value = normalizeSpeechText(text);
    if (!value) return null;

    if (/guardar.*registro.*(nueva|otra) sesion|antes de.*(nueva|otra) sesion/.test(value)) {
      return {key:'newSession', text:FIXED_MESSAGES.newSession};
    }

    if (/duplicad|dispositivo repetid|registro repetid|ya esta registrado|ya existe/.test(value)) {
      return {key:'duplicate', text:FIXED_MESSAGES.duplicate};
    }

    const uaMention = /\bu\s*a\b|unit address/.test(value);
    const serialMention = /serial|host\s*s\s*n|host sn|\bs\s*n\b/.test(value);
    const codeError = /invalid|incorrect|error|no valido|formato|debe iniciar|debe comenzar|debe tener|incomplet|longitud|fuera del formato|no cumple/.test(value);
    if (codeError && serialMention) return {key:'serial', text:FIXED_MESSAGES.serial};
    if (codeError && uaMention) return {key:'ua', text:FIXED_MESSAGES.ua};

    const negativeMatch = /no coincide|no se creo match|no se encontro|match pendiente|revisar/.test(value);
    if (!negativeMatch && (/los dispositivos hacen match|match correcto|match ok|host\s*s\s*n.*u\s*a.*coinciden exactamente/.test(value))) {
      return {key:'match', text:FIXED_MESSAGES.match};
    }

    return null;
  }

  function isCriticalWarning(text) {
    return !!fixedAnnouncement(text);
  }

  function recentlySpokenFixed(key, windowMs = 1800) {
    const now = Date.now();
    const last = lastFixedAt.get(key) || 0;
    if (now - last < windowMs) return true;
    lastFixedAt.set(key, now);
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
      const originalText = String(utterance?.text || '');
      const fixed = fixedAnnouncement(originalText);
      const allowed = fixed
        ? preference.criticalWarnings
        : isWelcome(originalText)
          ? preference.welcome
          : preference.alerts;
      if (!allowed) {
        completeSuppressedUtterance(utterance);
        return;
      }
      if (fixed) {
        if (recentlySpokenFixed(fixed.key)) {
          completeSuppressedUtterance(utterance);
          return;
        }
        try { utterance.text = fixed.text; } catch {}
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

  function announceMatchCreated() {
    window.MatchVoiceTTS?.announce?.(FIXED_MESSAGES.match, {
      priority:'high',
      interrupt:true,
      dedupeMs:800,
      key:'fixed:match-created'
    });
  }

  function checkMatchCount() {
    const counter = $('#cMatches');
    if (!counter) return false;
    const current = Number(String(counter.textContent || '').trim()) || 0;
    if (lastMatchCount === null) {
      lastMatchCount = current;
      return true;
    }
    if (current > lastMatchCount) announceMatchCreated();
    lastMatchCount = current;
    return true;
  }

  function installMatchWatcher() {
    const counter = $('#cMatches');
    if (!counter) return false;
    if (counter.dataset.ttsMatchWatcherBound === '1') {
      checkMatchCount();
      return true;
    }
    counter.dataset.ttsMatchWatcherBound = '1';
    checkMatchCount();
    matchObserver?.disconnect?.();
    matchObserver = new MutationObserver(checkMatchCount);
    matchObserver.observe(counter, {childList:true, subtree:true, characterData:true});
    return true;
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
    if (support) support.textContent = 'speechSynthesis' in window ? 'Avisos clave por voz' : 'TTS no disponible';
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
            <span class="voice-icon" aria-hidden="true">⚠️</span><span><strong>Avisos clave</strong><small>Duplicado · códigos · Match · nueva sesión</small></span><b data-tts-state>ON</b>
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
    installMatchWatcher();
  });

  preference = readPreference(null);
  installSpeechPolicy();

  function bootPolicy() {
    watchLogin();
    installMatchWatcher();
    setTimeout(() => {
      installSpeechPolicy();
      ensureCoreAlertsEnabled();
      installMatchWatcher();
    }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootPolicy, {once:true});
  else bootPolicy();

  window.AppTTS = {
    version: POLICY_VERSION,
    fixedMessages: {...FIXED_MESSAGES},
    getPreference: () => ({...preference}),
    classifyAnnouncement: text => fixedAnnouncement(text)?.key || null,
    fixedAnnouncement: text => fixedAnnouncement(text)?.text || null,
    isCriticalWarning,
    setWelcome: enabled => savePreference({welcome:!!enabled}),
    setCriticalWarnings: enabled => savePreference({criticalWarnings:!!enabled}),
    setAlerts: enabled => savePreference({alerts:!!enabled}),
    setOperator,
    installMatchWatcher,
    policyInstalled: () => speakWrapped
  };
})();