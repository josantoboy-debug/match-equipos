(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

  function restoreNativeAnchorClick() {
    try {
      if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.click === 'function') {
        HTMLAnchorElement.prototype.click = HTMLElement.prototype.click;
      }
    } catch (error) {
      console.warn('[audit-fixes] No se pudo restaurar click nativo', error);
    }
  }

  function normalizeNumericUAInput() {
    const input = $('#equipmentUA');
    if (!input || input.dataset.auditNormalized === '1') return;
    input.dataset.auditNormalized = '1';
    input.addEventListener('input', event => {
      const value = String(event.target.value || '');
      const cleaned = value.replace(/[^0-9\s-]/g, '');
      if (cleaned !== value) event.target.value = cleaned;
    }, true);
  }

  function guardQuantity() {
    const input = $('#equipmentQuantity');
    if (!input || input.dataset.auditGuarded === '1') return;
    input.dataset.auditGuarded = '1';
    input.addEventListener('input', event => {
      const raw = String(event.target.value || '').replace(/\D/g, '');
      if (!raw) return;
      const safe = Math.min(100000, Math.max(1, Number(raw)));
      event.target.value = String(safe);
    }, true);
  }

  function healthCheck() {
    const problems = [];
    if (!window.EquipmentRegistry) problems.push('EquipmentRegistry');
    if (!window.MatchSearchModes) problems.push('MatchSearchModes');
    if (!window.FileIndexSearch) problems.push('FileIndexSearch');
    if (!window.OperatorSession) problems.push('OperatorSession');
    if (!window.RegistryExport) problems.push('RegistryExport');
    if (typeof XLSX === 'undefined') problems.push('SheetJS/XLSX');

    window.MatchEquiposHealth = {
      ok: problems.length === 0,
      missing: problems,
      checkedAt: new Date().toISOString()
    };

    if (problems.length) {
      console.warn('[match-equipos] Auditoría de carga: faltan módulos', problems);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    restoreNativeAnchorClick();
    normalizeNumericUAInput();
    guardQuantity();
    setTimeout(healthCheck, 0);
  });

  document.addEventListener('operator:login', () => {
    restoreNativeAnchorClick();
    setTimeout(healthCheck, 0);
  });

  window.MatchEquiposAuditFixes = {
    restoreNativeAnchorClick,
    healthCheck
  };
})();