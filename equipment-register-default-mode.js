(() => {
  'use strict';

  const VERSION = '20260831-josueauto1';
  const TARGET_OPERATOR = 'josue parfait';
  let lastOperator = null;

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

  function boot() {
    const operator = currentOperator();
    if (operator?.name) applyWhenReady(operator);
    document.documentElement.dataset.equipmentDefaultModeVersion = VERSION;
  }

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    lastOperator = detail?.name ? {id:detail.id || '', name:detail.name} : currentOperator();
    applyWhenReady(lastOperator);
  });

  document.addEventListener('equipment:new-session-created', event => {
    const detailOperator = event.detail?.operator;
    applyWhenReady(detailOperator?.name ? detailOperator : currentOperator());
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();

  window.EquipmentCaptureDefaults = {
    version: VERSION,
    targetOperator: 'Josue Parfait',
    normalizeName,
    defaultModeFor,
    applyDefault
  };
})();
