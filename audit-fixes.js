(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PER_BOX = 64;

  if (!document.querySelector('#hiddenKpiStyle')) {
    const style = document.createElement('style');
    style.id = 'hiddenKpiStyle';
    style.textContent = '.kpis{display:none!important}';
    document.head.appendChild(style);
  }

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
    if (!input) return;
    input.type = 'number';
    input.min = '1';
    input.max = String(MAX_PER_BOX);
    input.step = '1';
    input.inputMode = 'numeric';
    input.removeAttribute('aria-hidden');
    input.removeAttribute('tabindex');
    input.removeAttribute('value');

    if (input.dataset.auditGuarded === '1') return;
    input.dataset.auditGuarded = '1';
    input.addEventListener('input', event => {
      const raw = String(event.target.value || '').replace(/\D/g, '').slice(0, 2);
      if (event.target.value !== raw) event.target.value = raw;
      const value = Number(raw);
      const valid = Number.isInteger(value) && value >= 1 && value <= MAX_PER_BOX;
      event.target.classList.toggle('field-valid', valid);
      event.target.classList.toggle('field-invalid', !!raw && !valid);
    }, true);
  }

  function loadExportSummary() {
    if (window.ExportSummary || document.querySelector('script[data-export-summary]')) return;
    const script = document.createElement('script');
    script.src = 'export-summary.js?v=71cfd66';
    script.dataset.exportSummary = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar export-summary.js');
    document.body.appendChild(script);
  }

  function loadEquipmentNewSession() {
    if (window.EquipmentNewSession || document.querySelector('script[data-equipment-new-session]')) {
      window.EquipmentNewSession?.install?.();
      return;
    }
    const script = document.createElement('script');
    script.src = 'equipment-new-session.js?v=af744ee';
    script.dataset.equipmentNewSession = '1';
    script.async = false;
    script.onload = () => window.EquipmentNewSession?.install?.();
    script.onerror = () => console.error('[match-equipos] No se pudo cargar equipment-new-session.js');
    document.body.appendChild(script);
  }

  function loadEquipmentProcessHistory() {
    if (window.EquipmentProcessHistory || document.querySelector('script[data-equipment-process-history]')) return;
    const script = document.createElement('script');
    script.src = 'equipment-process-history.js?v=cb379be';
    script.dataset.equipmentProcessHistory = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar equipment-process-history.js');
    document.body.appendChild(script);
  }

  function loadEquipmentImportContext() {
    if (window.EquipmentImportContext || document.querySelector('script[data-equipment-import-context]')) return;
    const script = document.createElement('script');
    script.src = 'equipment-import-context.js?v=1f7237f';
    script.dataset.equipmentImportContext = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar equipment-import-context.js');
    document.body.appendChild(script);
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

    if (problems.length) console.warn('[match-equipos] Auditoría de carga: faltan módulos', problems);
  }

  document.addEventListener('DOMContentLoaded', () => {
    restoreNativeAnchorClick();
    normalizeNumericUAInput();
    guardQuantity();
    loadExportSummary();
    loadEquipmentNewSession();
    loadEquipmentProcessHistory();
    loadEquipmentImportContext();
    setTimeout(healthCheck, 0);
  });

  document.addEventListener('operator:login', () => {
    restoreNativeAnchorClick();
    guardQuantity();
    loadExportSummary();
    loadEquipmentNewSession();
    loadEquipmentProcessHistory();
    loadEquipmentImportContext();
    setTimeout(healthCheck, 0);
  });

  window.MatchEquiposAuditFixes = {
    restoreNativeAnchorClick,
    healthCheck,
    loadExportSummary,
    loadEquipmentNewSession,
    loadEquipmentProcessHistory,
    loadEquipmentImportContext,
    guardQuantity
  };
})();