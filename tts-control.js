(() => {
  'use strict';

  const STORAGE_PREFIX = 'matchEquipos.ttsPreference.v1';
  const OPERATOR_STORE_KEY = 'matchEquipos.operatorAccess.v1';
  const DEFAULTS = Object.freeze({welcome:false, alerts:true});

  let currentOperator = null;
  let preference = {...DEFAULTS};
  let unlocked = false;
  let pendingWelcome = '';
  let lastSpoken = '';
  let lastSpokenAt = 0;
  let toastObserver = null;
  let resultObserver = null;
  let validationObserver = null;

  const $ = selector => document.querySelector(selector);
  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeName = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

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

  function key(operator = currentOperator) {
    return `${STORAGE_PREFIX}.${operator?.id || 'guest'}`;
  }

  function readPreference(operator) {
    const saved = safeJSON(localStorage.getItem(key(operator)), null);
    return {
      welcome: typeof saved?.welcome === 'boolean' ? saved.welcome : DEFAULTS.welcome,
      alerts: typeof saved?.alerts === 'boolean' ? saved.alerts : DEFAULTS.alerts
    };
  }

  function savePreference(next) {
    preference = {...preference, ...next};
    try { localStorage.setItem(key(), JSON.stringify(preference)); } catch {}
    syncControls();
  }

  function speechAvailable() {
    return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  }

  function spanishVoice() {
    if (!speechAvailable()) return null;
    const voices = window.speechSynthesis.getVoices?.() || [];
    return voices.find(v => /^es-PA$/i.test(v.lang))
      || voices.find(v => /^es-(MX|US)$/i.test(v.lang))
      || voices.find(v => /^es/i.test(v.lang))
      || null;
  }

  function speak(text, {force=false, interrupt=true} = {}) {
    const message = normalizeText(text);
    if (!message || !speechAvailable()) return false;
    if (!force && !preference.alerts) return false;
    if (!unlocked) return false;

    const now = Date.now();
    if (message === lastSpoken && now - lastSpokenAt < 1200) return false;
    lastSpoken = message;
    lastSpokenAt = now;

    try {
      if (interrupt) window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.slice(0, 260));
      utterance.lang = 'es-PA';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = spanishVoice();
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      console.warn('[tts] No se pudo reproducir la alerta', error);
      return false;
    }
  }

  function unlockSpeech() {
    unlocked = true;
    if (pendingWelcome && preference.welcome) {
      const text = pendingWelcome;
      pendingWelcome = '';
      speak(text, {force:true, interrupt:false});
    }
  }

  function conciseAlert(element) {
    if (!element) return '';
    const strong = normalizeText(element.querySelector?.('strong,h3')?.textContent);
    const detail = normalizeText(element.querySelector?.('span,small,p')?.textContent);
    const combined = normalizeText(`${strong}. ${detail}`);
    return combined || normalizeText(element.textContent);
  }

  function shouldSpeakPanel(element) {
    const cls = String(element?.className || '');
    const text = normalizeText(element?.textContent);
    return /\b(error|warn|ok)\b/i.test(cls)
      || /(duplicado|inv[aá]lido|bloqueado|complet|impresi[oó]n|encontrad|match|falt|cargad|recuperad|registrad|no se pudo|error)/i.test(text);
  }

  function speakElement(element) {
    if (!preference.alerts || !unlocked || !shouldSpeakPanel(element)) return;
    const text = conciseAlert(element);
    if (text) speak(text);
  }

  function observeElement(selector, kind) {
    const element = $(selector);
    if (!element) return null;
    const observer = new MutationObserver(() => {
      if (kind === 'toast' && !element.classList.contains('show')) return;
      speakElement(element);
    });
    observer.observe(element, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class']});
    return observer;
  }

  function installObservers() {
    toastObserver?.disconnect();
    resultObserver?.disconnect();
    validationObserver?.disconnect();
    toastObserver = observeElement('#toast', 'toast');
    resultObserver = observeElement('#resultPanel', 'result');
    validationObserver = observeElement('#equipmentValidationMessage', 'validation');
  }

  function setOperator(operator) {
    const next = operator?.id ? {id:operator.id, name:operator.name || 'Operador'} : null;
    if (next?.id === currentOperator?.id && next?.name === currentOperator?.name) return;
    currentOperator = next;
    preference = readPreference(currentOperator);
    pendingWelcome = '';
    syncControls();
  }

  function bindOperatorSelect() {
    const select = $('#operatorSelect');
    if (!select) return false;
    if (select.dataset.ttsBound !== '1') {
      select.dataset.ttsBound = '1';
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
    if (support) support.textContent = speechAvailable() ? 'Voz del navegador' : 'TTS no disponible';
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
        unlockSpeech();
        const setting = button.dataset.ttsSetting;
        savePreference({[setting]: !preference[setting]});
        if (setting === 'alerts' && preference.alerts) speak('Alertas de voz activadas.', {force:true});
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

  document.addEventListener('pointerdown', unlockSpeech, {capture:true, passive:true});
  document.addEventListener('keydown', unlockSpeech, {capture:true});

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    setOperator({id:detail.id, name:detail.name});
    if (preference.welcome) {
      const first = normalizeName(detail.name).split(/\s+/)[0] || 'operador';
      const text = `Bienvenido ${first}. Registro y verificación listo.`;
      if (!speak(text, {force:true, interrupt:false})) pendingWelcome = text;
    }
    setTimeout(installObservers, 0);
  });

  window.speechSynthesis?.addEventListener?.('voiceschanged', syncControls);

  preference = readPreference(null);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      watchLogin();
      installObservers();
    });
  } else {
    watchLogin();
    installObservers();
  }

  window.AppTTS = {
    getPreference: () => ({...preference}),
    setWelcome: enabled => savePreference({welcome:!!enabled}),
    setAlerts: enabled => savePreference({alerts:!!enabled}),
    notify: text => speak(text),
    speak: text => speak(text, {force:true}),
    isAvailable: speechAvailable,
    setOperator
  };
})();