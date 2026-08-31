(() => {
  'use strict';

  const VERSION = '20260831-josueauto1';
  const TARGET_OPERATOR = 'josue parfait';
  const NEW_SESSION_SELECTOR = '#equipmentNewSessionBtn';
  let lastOperator = null;
  let delegatedNewSessionBound = false;

  function normalizeName(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function currentOperator() {
    return window.OperatorSession?.getCurrentOperator?.() || lastOperator || null;
  }

  function defaultModeFor(operator) {
    return normalizeName(operator?.name) === TARGET_OPERATOR ? 'automatic' : 'manual';
  }

  function applyDefault(operator = currentOperator()) {
    const registry = window.EquipmentRegistry;
    if (!operator?.name || typeof registry?.setCaptureMode !== 'function') return false;
    const mode = defaultModeFor(operator);
    registry.setCaptureMode(mode);
    document.documentElement.dataset.equipmentDefaultModeVersion = VERSION;
    document.documentElement.dataset.equipmentDefaultMode = mode;
    return true;
  }

  function applyWhenReady(operator, attempts = 30) {
    if (applyDefault(operator)) return;
    if (attempts <= 0) return;
    setTimeout(() => applyWhenReady(operator, attempts - 1), 50);
  }

  function successfulNewSession() {
    const title = document.querySelector('#equipmentValidationMessage strong')?.textContent || '';
    return normalizeName(title) === 'nueva sesion lista';
  }

  function handleNewSessionClick(event) {
    const target = event?.target?.closest?.(NEW_SESSION_SELECTOR);
    if (!target) return;
    // El manejador real de Nueva sesión vive en equipment-new-session.js y se ejecuta
    // antes de que el click llegue al documento. En el siguiente tick solo aplicamos
    // el predeterminado si ese flujo terminó realmente en "Nueva sesión lista".
    setTimeout(() => {
      if (successfulNewSession()) applyWhenReady(currentOperator());
    }, 0);
  }

  function bindNewSession() {
    if (delegatedNewSessionBound) return true;
    document.addEventListener('click', handleNewSessionClick, false);
    delegatedNewSessionBound = true;
    return true;
  }

  function boot() {
    bindNewSession();
    const operator = currentOperator();
    if (operator?.name) applyWhenReady(operator);
    document.documentElement.dataset.equipmentDefaultModeVersion = VERSION;
  }

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    lastOperator = detail?.name ? {id:detail.id || '', name:detail.name} : currentOperator();
    bindNewSession();
    applyWhenReady(lastOperator);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();

  window.EquipmentCaptureDefaults = {
    version: VERSION,
    targetOperator: 'Josue Parfait',
    normalizeName,
    defaultModeFor,
    applyDefault,
    bindNewSession
  };
})();
