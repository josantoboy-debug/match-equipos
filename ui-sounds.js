(() => {
  'use strict';

  const UI_SOUND_VERSION = '20260831-sound1';
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  const lastPlayedAt = {found: Number.NEGATIVE_INFINITY, registered: Number.NEGATIVE_INFINITY};
  const minimumGapMs = {found: 180, registered: 220};

  function getAudioContext() {
    if (!AudioContextCtor) return null;
    if (!audioContext || audioContext.state === 'closed') {
      try { audioContext = new AudioContextCtor(); }
      catch { audioContext = null; }
    }
    return audioContext;
  }

  async function primeAudio() {
    const context = getAudioContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch {
      return false;
    }
  }

  function scheduleTone(context, {frequency, start = 0, duration = 0.08, volume = 0.055, type = 'sine'}) {
    const when = context.currentTime + Math.max(0, start);
    const stopAt = when + Math.max(0.03, duration);
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(when);
    oscillator.stop(stopAt + 0.015);
  }

  async function playPattern(kind) {
    const now = performance.now();
    if (now - lastPlayedAt[kind] < minimumGapMs[kind]) return false;
    lastPlayedAt[kind] = now;

    const context = getAudioContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended') await context.resume();
      if (context.state !== 'running') return false;

      if (kind === 'found') {
        scheduleTone(context, {frequency: 880, start: 0, duration: 0.075, volume: 0.06, type: 'sine'});
        scheduleTone(context, {frequency: 1175, start: 0.095, duration: 0.09, volume: 0.065, type: 'sine'});
      } else if (kind === 'registered') {
        scheduleTone(context, {frequency: 523.25, start: 0, duration: 0.08, volume: 0.052, type: 'triangle'});
        scheduleTone(context, {frequency: 659.25, start: 0.075, duration: 0.09, volume: 0.058, type: 'triangle'});
        scheduleTone(context, {frequency: 783.99, start: 0.155, duration: 0.12, volume: 0.064, type: 'triangle'});
      }
      return true;
    } catch {
      return false;
    }
  }

  function playFound() {
    return playPattern('found');
  }

  function playRegistered() {
    return playPattern('registered');
  }

  function registrationSnapshot() {
    let matchRecords = null;
    let boxRecords = null;
    try {
      const state = window.MatchEquiposCore?.getState?.();
      if (state && Array.isArray(state.records)) matchRecords = state.records.length;
    } catch {}
    try {
      const rows = window.EquipmentRegistry?.getRows?.();
      if (Array.isArray(rows)) boxRecords = rows.length;
    } catch {}
    return {matchRecords, boxRecords};
  }

  function registrationIncreased(before, after) {
    return (
      (Number.isInteger(before.matchRecords) && Number.isInteger(after.matchRecords) && after.matchRecords > before.matchRecords) ||
      (Number.isInteger(before.boxRecords) && Number.isInteger(after.boxRecords) && after.boxRecords > before.boxRecords)
    );
  }

  function verifyInteractiveRegistration(before) {
    setTimeout(() => {
      const after = registrationSnapshot();
      if (registrationIncreased(before, after)) void playRegistered();
    }, 0);
  }

  function isInteractiveRegistrationTarget(target, eventType) {
    const id = target?.id || '';
    if (eventType === 'click') return id === 'registerBtn' || id === 'equipmentAddBtn';
    return id === 'uaInput' || id === 'equipmentUA' || id === 'equipmentBox';
  }

  const prime = () => { void primeAudio(); };
  document.addEventListener('pointerdown', prime, {passive: true});
  document.addEventListener('keydown', prime, {passive: true});
  document.addEventListener('touchstart', prime, {passive: true});

  document.addEventListener('click', event => {
    const target = event.target?.closest?.('#registerBtn, #equipmentAddBtn');
    if (!target || !isInteractiveRegistrationTarget(target, 'click')) return;
    verifyInteractiveRegistration(registrationSnapshot());
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !isInteractiveRegistrationTarget(event.target, 'keydown')) return;
    verifyInteractiveRegistration(registrationSnapshot());
  }, true);

  window.MatchUISounds = {
    version: UI_SOUND_VERSION,
    playFound,
    playRegistered,
    primeAudio,
    registrationSnapshot,
    registrationIncreased,
    isSupported: () => Boolean(AudioContextCtor)
  };
})();
