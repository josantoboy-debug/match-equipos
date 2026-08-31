(() => {
  'use strict';

  const VERSION = '20260831-josueauto1';
  const TARGET_OPERATOR = 'josue parfait';
  const NEW_SESSION_SELECTOR = '#equipmentNewSessionBtn';
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
    registry.setCaptureMode(defaultModeFor(operator));
    document.documentElement.dataset.equipmentDefaultModeVersion = VERSION;
    document.documentElement.dataset.equipmentDefaultMode = defaultModeFor(operator);
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

  function bindNewSession() {
    const button = document.querySelector(NEW_SESSION_SELECTOR);
    if (!button) return false;
    if (button.dataset.operatorDefaultModeBound === '1') return true;
    button.dataset.operatorDefaultModeBound = '1';
    button.addEventListener('click', () => {
      setTimeout(() => {
        if (successfulNewSession()) applyWhenReady(currentOperator());
      }, 0);
    });
    return true;
  }

  function bindWhenReady(attempts = 30) {
    if (bindNewSession()) return;
    if (attempts <= 0) return;
    setTimeout(() => bindWhenReady(attempts - 1), 50);
  }

  function boot() {
    bindWhenReady();
    const operator = currentOperator();
    if (operator?.name) applyWhenReady(operator);
    document.documentElement.dataset.equipmentDefaultModeVersion = VERSION;
  }

  document.addEventListener('operator:login', event => {
    const detail = event.detail || {};
    lastOperator = detail?.name ? {id:detail.id || '', name:detail.name} : currentOperator();
    bindWhenReady();
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
