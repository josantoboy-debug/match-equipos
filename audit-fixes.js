(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

  // Los indicadores se siguen calculando internamente, pero no ocupan espacio
  // en la interfaz. Sus valores se usan en los archivos exportados.
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
    if (!input || input.dataset.auditGuarded === '1') return;
    input.dataset.auditGuarded = '1';
    input.addEventListener('input', event => {
      const raw = String(event.target.value || '').replace(/\D/g, '');
      if (!raw) return;
      const safe = Math.min(100000, Math.max(1, Number(raw)));
      event.target.value = String(safe);
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
    loadExportSummary();
    setTimeout(healthCheck, 0);
  });

  document.addEventListener('operator:login', () => {
    restoreNativeAnchorClick();
    loadExportSummary();
    setTimeout(healthCheck, 0);
  });

  window.MatchEquiposAuditFixes = {
    restoreNativeAnchorClick,
    healthCheck,
    loadExportSummary
  };
})();