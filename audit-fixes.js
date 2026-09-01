(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const THEME_ASSET_VERSION = '20260831-light2';
  const TTS_ASSET_VERSION = '20260831-critical4';
  const REGISTER_DEFAULT_MODE_VERSION = '20260831-josueauto1';
  const EQUIPMENT_NEW_SESSION_VERSION = '20260901-operator-limit3';
  const QUANTITY_POLICY_VERSION = '20260901-operator-limit3';

  if (!document.querySelector('#hiddenKpiStyle')) {
    const style = document.createElement('style');
    style.id = 'hiddenKpiStyle';
    style.textContent = '.kpis{display:none!important}';
    document.head.appendChild(style);
  }

  function loadThemeControl() {
    if (!document.querySelector('link[data-theme-control]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `theme-control.css?v=${THEME_ASSET_VERSION}`;
      link.dataset.themeControl = '1';
      document.head.appendChild(link);
    }
    if (window.AppTheme || document.querySelector('script[data-theme-control]')) return;
    const script = document.createElement('script');
    script.src = 'theme-control.js?v=20260830-stable1';
    script.dataset.themeControl = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar theme-control.js');
    document.head.appendChild(script);
  }

  function loadTTSControl() {
    if (!document.querySelector('link[data-tts-control]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `tts-control.css?v=${TTS_ASSET_VERSION}`;
      link.dataset.ttsControl = '1';
      document.head.appendChild(link);
    }
    if (window.AppTTS || document.querySelector('script[data-tts-control]')) return;
    const script = document.createElement('script');
    script.src = `tts-control.js?v=${TTS_ASSET_VERSION}`;
    script.dataset.ttsControl = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar tts-control.js');
    document.head.appendChild(script);
  }

  function loadCriticalWarnings() {
    if (window.MatchCriticalWarnings || document.querySelector('script[data-critical-tts]')) {
      window.MatchCriticalWarnings?.bind?.();
      return;
    }
    const script = document.createElement('script');
    script.src = `tts-critical-warnings.js?v=${TTS_ASSET_VERSION}`;
    script.dataset.criticalTts = '1';
    script.async = false;
    script.onload = () => window.MatchCriticalWarnings?.bind?.();
    script.onerror = () => console.error('[match-equipos] No se pudo cargar tts-critical-warnings.js');
    document.body.appendChild(script);
  }

  function loadEquipmentDefaultMode() {
    if (window.EquipmentCaptureDefaults || document.querySelector('script[data-equipment-default-mode]')) return;
    const script = document.createElement('script');
    script.src = `equipment-register-default-mode.js?v=${REGISTER_DEFAULT_MODE_VERSION}`;
    script.dataset.equipmentDefaultMode = '1';
    script.async = false;
    script.onerror = () => console.error('[match-equipos] No se pudo cargar equipment-register-default-mode.js');
    document.body.appendChild(script);
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

  // EquipmentCapacity es la única fuente de verdad de CANTIDAD.
  // Este hook heredado solo limpia atributos antiguos y solicita refresco;
  // no instala listeners ni vuelve a validar el mismo campo.
  function guardQuantity() {
    const input = $('#equipmentQuantity');
    if (!input) return;
    input.removeAttribute('max');
    input.removeAttribute('value');
    window.EquipmentCapacity?.refresh?.();
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
      loadEquipmentDefaultMode();
      return;
    }
    const script = document.createElement('script');
    script.src = `equipment-new-session.js?v=${EQUIPMENT_NEW_SESSION_VERSION}`;
    script.dataset.equipmentNewSession = '1';
    script.async = false;
    script.onload = () => {
      window.EquipmentNewSession?.install?.();
      loadCriticalWarnings();
      loadEquipmentDefaultMode();
    };
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
    script.src = `equipment-import-context.js?v=${QUANTITY_POLICY_VERSION}`;
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

  loadThemeControl();
  loadTTSControl();

  document.addEventListener('DOMContentLoaded', () => {
    loadThemeControl();
    loadTTSControl();
    restoreNativeAnchorClick();
    normalizeNumericUAInput();
    guardQuantity();
    loadExportSummary();
    loadEquipmentNewSession();
    loadCriticalWarnings();
    loadEquipmentDefaultMode();
    loadEquipmentProcessHistory();
    loadEquipmentImportContext();
    setTimeout(healthCheck, 0);
  });

  document.addEventListener('operator:login', () => {
    loadThemeControl();
    loadTTSControl();
    restoreNativeAnchorClick();
    guardQuantity();
    loadExportSummary();
    loadEquipmentNewSession();
    loadCriticalWarnings();
    loadEquipmentDefaultMode();
    loadEquipmentProcessHistory();
    loadEquipmentImportContext();
    setTimeout(healthCheck, 0);
  });

  window.MatchEquiposAuditFixes = {
    restoreNativeAnchorClick,
    healthCheck,
    loadThemeControl,
    loadTTSControl,
    loadCriticalWarnings,
    loadEquipmentDefaultMode,
    loadExportSummary,
    loadEquipmentNewSession,
    loadEquipmentProcessHistory,
    loadEquipmentImportContext,
    guardQuantity,
    quantityPolicyVersion: QUANTITY_POLICY_VERSION
  };
})();