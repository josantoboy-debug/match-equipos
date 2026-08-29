(() => {
  'use strict';

  const STORAGE_KEY = 'matchEquipos.tts.v1';
  const MAX_QUEUE = 8;
  const DEFAULTS = {enabled:true, rate:1.03, pitch:1, volume:1};
  const $ = (selector, root = document) => root.querySelector(selector);

  const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const synth = supported ? window.speechSynthesis : null;

  let settings = readSettings();
  let unlocked = false;
  let speaking = false;
  let currentUtterance = null;
  let queue = [];
  let voices = [];
  let selectedVoice = null;
  let lastToastSignature = '';
  let lastValidationSignature = '';
  let lastResultSignature = '';
  let lastFoundCount = 0;
  let lastReviewCount = 0;
  let initializedCounts = false;
  const recent = new Map();
  const history = [];

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        return {
          ...DEFAULTS,
          enabled: saved.enabled !== false,
          rate: clamp(Number(saved.rate) || DEFAULTS.rate, 0.7, 1.35),
          pitch: clamp(Number(saved.pitch) || DEFAULTS.pitch, 0.7, 1.3),
          volume: clamp(Number(saved.volume) || DEFAULTS.volume, 0, 1)
        };
      }
    } catch {}
    return {...DEFAULTS};
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSpace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function cleanSpeech(value) {
    let text = normalizeSpace(value)
      .replace(/\s*·\s*/g, '. ')
      .replace(/\s*→\s*/g, ', luego ')
      .replace(/\bUA\b/gi, 'U A')
      .replace(/\bSN\b/gi, 'S N')
      .replace(/\bTTS\b/gi, 'T T S')
      .replace(/\bOK\b/gi, 'correcto')
      .replace(/#(\d+)/g, 'número $1')
      .replace(/\b(\d+)\s*\/\s*(\d+)\b/g, '$1 de $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 320) text = `${text.slice(0, 317).trim()}...`;
    return text;
  }

  function voiceScore(voice) {
    const lang = String(voice?.lang || '').toLowerCase();
    const name = String(voice?.name || '').toLowerCase();
    let score = 100;
    if (lang === 'es-pa') score = 0;
    else if (lang === 'es-us') score = 5;
    else if (lang === 'es-mx') score = 8;
    else if (lang === 'es-419') score = 10;
    else if (lang === 'es-es') score = 12;
    else if (lang.startsWith('es')) score = 18;
    if (/natural|neural|google|microsoft/.test(name)) score -= 2;
    if (voice?.default) score -= 1;
    return score;
  }

  function refreshVoices() {
    if (!supported) return;
    try { voices = synth.getVoices() || []; } catch { voices = []; }
    selectedVoice = voices.slice().sort((a, b) => voiceScore(a) - voiceScore(b))[0] || null;
    updateControls();
  }

  function remember(event, text, extra = {}) {
    history.push({at:new Date().toISOString(), event, text, ...extra});
    if (history.length > 80) history.splice(0, history.length - 80);
  }

  function priorityValue(value) {
    if (value === 'critical') return 3;
    if (value === 'high') return 2;
    return 1;
  }

  function isDuplicate(key, text, windowMs) {
    if (!windowMs) return false;
    const signature = key || text.toLowerCase();
    const now = Date.now();
    const last = recent.get(signature) || 0;
    recent.set(signature, now);
    if (recent.size > 100) {
      for (const [item, time] of recent) if (now - time > 30000) recent.delete(item);
    }
    return now - last < windowMs;
  }

  function announce(value, options = {}) {
    const text = cleanSpeech(value);
    if (!text) return false;
    const opts = {
      priority: options.priority || 'normal',
      interrupt: options.interrupt === true,
      dedupeMs: options.dedupeMs === undefined ? 2200 : Number(options.dedupeMs) || 0,
      key: options.key || '',
      force: options.force === true
    };

    document.dispatchEvent(new CustomEvent('tts:announce', {detail:{text, priority:opts.priority, enabled:settings.enabled, supported}}));

    if (!supported) {
      remember('unsupported', text, opts);
      return false;
    }
    if (!settings.enabled && !opts.force) {
      remember('disabled', text, opts);
      return false;
    }
    if (isDuplicate(opts.key, text, opts.dedupeMs)) return false;

    // Los navegadores pueden bloquear audio hasta la primera interacción del usuario.
    // No acumulamos mensajes viejos; al desbloquear se hablarán solo eventos nuevos.
    if (!unlocked && !opts.force) {
      remember('waiting-user-gesture', text, opts);
      return false;
    }

    const item = {text, ...opts, createdAt:Date.now()};
    if (opts.interrupt || opts.priority === 'critical') {
      try { synth.cancel(); } catch {}
      currentUtterance = null;
      speaking = false;
      queue = queue.filter(queued => priorityValue(queued.priority) >= priorityValue(opts.priority));
      queue.unshift(item);
    } else {
      queue.push(item);
      queue.sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority) || a.createdAt - b.createdAt);
      if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    }
    drainQueue();
    return true;
  }

  function drainQueue() {
    if (!supported || !settings.enabled || !unlocked || speaking || !queue.length) return;
    const item = queue.shift();
    const utterance = new SpeechSynthesisUtterance(item.text);
    currentUtterance = utterance;
    speaking = true;
    utterance.lang = selectedVoice?.lang || 'es-PA';
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    utterance.onstart = () => remember('start', item.text, {priority:item.priority, voice:selectedVoice?.name || utterance.lang});
    utterance.onend = () => {
      remember('end', item.text, {priority:item.priority});
      if (currentUtterance === utterance) currentUtterance = null;
      speaking = false;
      setTimeout(drainQueue, 20);
    };
    utterance.onerror = event => {
      remember('error', item.text, {priority:item.priority, error:event?.error || 'speech-error'});
      if (currentUtterance === utterance) currentUtterance = null;
      speaking = false;
      setTimeout(drainQueue, 40);
    };
    try {
      synth.speak(utterance);
    } catch (error) {
      remember('exception', item.text, {error:String(error)});
      currentUtterance = null;
      speaking = false;
      setTimeout(drainQueue, 40);
    }
  }

  function cancel() {
    queue = [];
    speaking = false;
    currentUtterance = null;
    try { synth?.cancel?.(); } catch {}
  }

  function setEnabled(enabled, {announceState = true} = {}) {
    settings.enabled = !!enabled;
    saveSettings();
    if (!settings.enabled) {
      cancel();
      updateControls();
      remember('state', 'Voz TTS desactivada');
      return;
    }
    updateControls();
    if (announceState && unlocked) {
      announce('Voz T T S activada. Las notificaciones habladas están listas.', {force:true, interrupt:true, priority:'high', dedupeMs:0, key:'tts-enabled'});
    }
  }

  function toggle() {
    setEnabled(!settings.enabled);
  }

  function testVoice() {
    if (!settings.enabled) setEnabled(true, {announceState:false});
    if (!unlocked) unlocked = true;
    refreshVoices();
    announce('Prueba de voz. Las notificaciones de registro, alertas e impresión están funcionando.', {force:true, interrupt:true, priority:'critical', dedupeMs:0, key:`tts-test-${Date.now()}`});
  }

  function unlockFromGesture(event) {
    if (unlocked || event?.isTrusted === false) return;
    unlocked = true;
    refreshVoices();
    drainQueue();
    document.documentElement.dataset.ttsUnlocked = '1';
  }

  function toneFromElement(element) {
    const cls = String(element?.className || '').toLowerCase();
    if (/error|warn|danger|review/.test(cls)) return 'critical';
    return 'normal';
  }

  function toastSpeech(title, message) {
    const t = normalizeSpace(title);
    const m = normalizeSpace(message);
    const combined = `${t} ${m}`.toLowerCase();

    if (/registro descargado|registro exportado/.test(combined)) return 'Registro exportado correctamente.';
    if (/equipo registrado automáticamente|equipo agregado/.test(combined)) {
      const number = m.match(/equipo\s+(\d+)/i)?.[1];
      const parts = m.split('·').map(normalizeSpace).filter(Boolean);
      const box = parts.length >= 2 ? parts[1] : '';
      if (number && box) return `Equipo ${number} registrado correctamente en caja ${box}.`;
      if (number) return `Equipo ${number} registrado correctamente.`;
      return 'Equipo registrado correctamente.';
    }
    if (/cantidad completada/.test(combined)) return `Cantidad completada. ${m}`;
    if (/caja lista para imprimir/.test(combined)) return `Caja lista para imprimir. ${m}`;
    if (/impresión bloqueada|no se pudo imprimir/.test(combined)) return `Atención. ${t}. ${m}`;
    if (/modo de impresión/.test(combined)) return `${t}. ${m}`;
    if (/contexto restaurado/.test(combined)) return `Registro cargado. ${m}`;
    if (/registro cargado/.test(combined)) return `${t}. ${m}`;
    if (/no se agregó|duplicad|inválid|bloquead|error|falta|pendiente|revisar/.test(combined)) return `Atención. ${t}. ${m}`;
    return `${t}. ${m}`;
  }

  function handleToast() {
    const toast = $('#toast');
    if (!toast || !toast.classList.contains('show')) return;
    const title = normalizeSpace($('strong', toast)?.textContent);
    const message = normalizeSpace($('span', toast)?.textContent);
    if (!title && !message) return;
    const signature = `${title}|${message}|${toast.className}`;
    if (signature === lastToastSignature) return;
    lastToastSignature = signature;
    const priority = toneFromElement(toast);
    announce(toastSpeech(title, message), {
      priority,
      interrupt: priority === 'critical',
      key:`toast:${title.toLowerCase()}:${message.toLowerCase().slice(0, 80)}`,
      dedupeMs:1800
    });
  }

  function handleValidation() {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    const title = normalizeSpace($('strong', panel)?.textContent);
    const detail = normalizeSpace($('small', panel)?.textContent);
    if (!title && !detail) return;
    const signature = `${title}|${detail}|${panel.className}`;
    if (signature === lastValidationSignature) return;
    lastValidationSignature = signature;

    const cls = String(panel.className || '').toLowerCase();
    const combined = `${title} ${detail}`.toLowerCase();
    const critical = /error|warn/.test(cls) || /inválid|bloquead|duplicad|falta|no confirmado|revisar|límite/.test(combined);
    const important = critical || /registro cargado|contexto restaurado|registro automático activado|registro manual activado|cantidad completada|caja completa/.test(combined);
    if (!important) return;

    announce(`${critical ? 'Atención. ' : ''}${title}. ${detail}`, {
      priority: critical ? 'critical' : 'normal',
      interrupt: critical,
      key:`validation:${title.toLowerCase()}:${detail.toLowerCase().slice(0, 70)}`,
      dedupeMs:2000
    });
  }

  function handleResult() {
    const panel = $('#resultPanel');
    if (!panel || panel.classList.contains('neutral')) return;
    const title = normalizeSpace($('h3', panel)?.textContent);
    const detail = normalizeSpace($('p', panel)?.textContent);
    if (!title && !detail) return;
    const signature = `${title}|${detail}|${panel.className}`;
    if (signature === lastResultSignature) return;
    lastResultSignature = signature;
    const combined = `${title} ${detail}`.toLowerCase();
    const critical = /error|warn/.test(String(panel.className).toLowerCase()) || /revisar|inválid|duplicad|no coincide|advertencia/.test(combined);
    const prefix = critical ? 'Atención. ' : '';
    announce(`${prefix}${title}. ${detail}`, {
      priority: critical ? 'critical' : 'normal',
      interrupt: critical,
      key:`result:${title.toLowerCase()}:${detail.toLowerCase().slice(0, 80)}`,
      dedupeMs:1600
    });
  }

  function numericText(selector) {
    const value = Number(normalizeSpace($(selector)?.textContent));
    return Number.isFinite(value) ? value : 0;
  }

  function handleOperationalCounts() {
    const found = numericText('#cFound');
    const review = numericText('#cReview');
    if (!initializedCounts) {
      lastFoundCount = found;
      lastReviewCount = review;
      initializedCounts = true;
      return;
    }
    if (found > lastFoundCount) {
      const delta = found - lastFoundCount;
      announce(`${delta === 1 ? 'Equipo encontrado' : `${delta} equipos encontrados`}. Total encontrados: ${found}.`, {
        priority:'high', key:`found-count:${found}`, dedupeMs:1000
      });
    }
    if (review > lastReviewCount) {
      announce(`Atención. Hay ${review} ${review === 1 ? 'registro' : 'registros'} para revisar.`, {
        priority:'critical', interrupt:true, key:`review-count:${review}`, dedupeMs:1000
      });
    }
    lastFoundCount = found;
    lastReviewCount = review;
  }

  function observeElement(element, handler, attributes = false) {
    if (!element) return null;
    const observer = new MutationObserver(handler);
    observer.observe(element, {childList:true, subtree:true, characterData:true, attributes, attributeFilter:attributes ? ['class'] : undefined});
    return observer;
  }

  function installObservers() {
    const toast = $('#toast');
    const validation = $('#equipmentValidationMessage');
    const result = $('#resultPanel');
    observeElement(toast, handleToast, true);
    observeElement(validation, handleValidation, true);
    observeElement(result, handleResult, true);

    ['#cFound', '#cReview'].forEach(selector => observeElement($(selector), handleOperationalCounts));
    handleOperationalCounts();
  }

  function injectStyles() {
    if ($('#ttsVoiceStyles')) return;
    const style = document.createElement('style');
    style.id = 'ttsVoiceStyles';
    style.textContent = `
      .tts-toggle{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
      .tts-toggle .tts-dot{width:7px;height:7px;border-radius:50%;background:#64748b;box-shadow:0 0 0 2px rgba(100,116,139,.15)}
      .tts-toggle.is-on .tts-dot{background:#22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.16)}
      .tts-toggle.is-off{opacity:.72}
      .tts-login-control{border:1px solid #27384f;background:#0b131e;border-radius:12px;padding:10px 11px;display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center}
      .tts-login-copy{display:grid;gap:2px;min-width:0}.tts-login-copy strong{font-size:9px;letter-spacing:.05em;color:#aebdd0}.tts-login-copy small{font-size:8px;color:#7890aa;line-height:1.3}
      .tts-login-control button{height:34px;border:1px solid #33445f;border-radius:8px;background:#111c2a;color:#aebdd0;padding:0 10px;font-size:9px;font-weight:850;cursor:pointer}
      .tts-login-control button.active{border-color:#3d82f6;background:#1c3d6d;color:#fff}.tts-login-control button:disabled{opacity:.5;cursor:not-allowed}
      html[data-theme="light"] .tts-login-control{background:#f8fafc;border-color:#d7e0ea}html[data-theme="light"] .tts-login-copy strong{color:#475569}html[data-theme="light"] .tts-login-copy small{color:#64748b}html[data-theme="light"] .tts-login-control button{background:#fff;color:#526174;border-color:#cbd5e1}html[data-theme="light"] .tts-login-control button.active{background:#e6f0ff;color:#1d4f91;border-color:#4f8cff}
      @media(max-width:700px){.tts-toggle .tts-label{display:none}.tts-login-control{grid-template-columns:1fr auto}.tts-login-test{grid-column:1/-1;width:100%}}
      @media print{#ttsToggleBtn,#ttsLoginControl{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function installTopControl() {
    const actions = $('.top-actions');
    if (!actions || $('#ttsToggleBtn')) return;
    const button = document.createElement('button');
    button.id = 'ttsToggleBtn';
    button.type = 'button';
    button.className = 'ghost compact-action tts-toggle';
    button.addEventListener('click', toggle);
    const sessionBadge = $('#sessionBadge');
    if (sessionBadge) actions.insertBefore(button, sessionBadge);
    else actions.appendChild(button);
    updateControls();
  }

  function installLoginControl() {
    if ($('#ttsLoginControl')) return true;
    const body = $('.operator-login-body');
    if (!body) return false;
    const note = $('.operator-login-note', body);
    const control = document.createElement('div');
    control.id = 'ttsLoginControl';
    control.className = 'tts-login-control';
    control.innerHTML = `
      <div class="tts-login-copy"><strong>VOZ TTS</strong><small>Confirma registros, alertas, faltantes, encontrados e impresión.</small></div>
      <button id="ttsLoginToggle" type="button"></button>
      <button id="ttsLoginTest" class="tts-login-test" type="button">PROBAR VOZ</button>`;
    if (note) body.insertBefore(control, note);
    else body.appendChild(control);
    $('#ttsLoginToggle')?.addEventListener('click', toggle);
    $('#ttsLoginTest')?.addEventListener('click', testVoice);
    updateControls();
    return true;
  }

  function updateControls() {
    const top = $('#ttsToggleBtn');
    if (top) {
      top.classList.toggle('is-on', supported && settings.enabled);
      top.classList.toggle('is-off', !supported || !settings.enabled);
      top.disabled = !supported;
      top.setAttribute('aria-pressed', settings.enabled ? 'true' : 'false');
      top.title = !supported ? 'Este navegador no ofrece síntesis de voz.' : settings.enabled ? 'Desactivar notificaciones habladas' : 'Activar notificaciones habladas';
      top.innerHTML = `<span aria-hidden="true">${settings.enabled ? '🔊' : '🔇'}</span><span class="tts-label">Voz ${settings.enabled ? 'ON' : 'OFF'}</span><span class="tts-dot"></span>`;
    }
    const loginToggle = $('#ttsLoginToggle');
    if (loginToggle) {
      loginToggle.disabled = !supported;
      loginToggle.classList.toggle('active', supported && settings.enabled);
      loginToggle.setAttribute('aria-pressed', settings.enabled ? 'true' : 'false');
      loginToggle.textContent = !supported ? 'NO DISPONIBLE' : settings.enabled ? 'ACTIVADA' : 'DESACTIVADA';
    }
    const test = $('#ttsLoginTest');
    if (test) test.disabled = !supported;
  }

  function installLoginWatcher() {
    if (installLoginControl()) return;
    const observer = new MutationObserver(() => {
      if (installLoginControl()) observer.disconnect();
    });
    observer.observe(document.body, {childList:true, subtree:true});
  }

  function installLifecycleAnnouncements() {
    document.addEventListener('operator:login', event => {
      const name = normalizeSpace(event.detail?.name);
      announce(name ? `Sesión iniciada. Operador ${name}.` : 'Sesión iniciada.', {priority:'high', key:`operator-login:${name}`, dedupeMs:1500});
      setTimeout(installLoginControl, 0);
    });

    document.addEventListener('equipment:box-complete', event => {
      const data = event.detail || {};
      const box = normalizeSpace(data.box) || 'actual';
      const count = Number(data.count) || 0;
      const capacity = Number(data.capacity) || count;
      const mode = $('#equipmentPrintMode')?.value === 'automatic' ? 'automatic' : 'manual';
      const text = mode === 'automatic'
        ? `Caja ${box} completa. ${count} de ${capacity} equipos. Preparando impresión automática.`
        : `Caja ${box} completa. ${count} de ${capacity} equipos. Impresión manual disponible.`;
      announce(text, {priority:'high', key:`box-complete:${box}:${count}:${mode}`, dedupeMs:3500});
    });
  }

  function boot() {
    injectStyles();
    installTopControl();
    installLoginWatcher();
    installObservers();
    installLifecycleAnnouncements();
    refreshVoices();
    if (supported) {
      if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoices);
      else if ('onvoiceschanged' in synth) synth.onvoiceschanged = refreshVoices;
    }

    // Captura: un escáner que emite teclado también desbloquea TTS con su primera entrada.
    document.addEventListener('pointerdown', unlockFromGesture, true);
    document.addEventListener('keydown', unlockFromGesture, true);
    document.addEventListener('touchstart', unlockFromGesture, {capture:true, passive:true});

    document.documentElement.dataset.ttsSupported = supported ? '1' : '0';
    document.documentElement.dataset.ttsEnabled = settings.enabled ? '1' : '0';
    updateControls();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();

  window.MatchVoiceTTS = {
    supported,
    announce,
    test: testVoice,
    cancel,
    toggle,
    setEnabled,
    isEnabled: () => settings.enabled,
    isUnlocked: () => unlocked,
    getVoice: () => selectedVoice ? {name:selectedVoice.name, lang:selectedVoice.lang} : null,
    getHistory: () => history.map(item => ({...item})),
    refreshVoices
  };
})();