(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let lastCount = 0;
  let focusTimer = null;

  function automaticMode() {
    return window.EquipmentRegistry?.getCaptureMode?.() === 'automatic';
  }

  function editingNow() {
    const button = $('#equipmentAddBtn');
    return /guardar cambios/i.test(String(button?.textContent || ''));
  }

  function validQuantity() {
    const value = String($('#equipmentQuantity')?.value || '').trim();
    return /^\d+$/.test(value) && Number(value) >= 1;
  }

  function readyForNextSerial() {
    return automaticMode() && !editingNow() && validQuantity() && !!String($('#equipmentLot')?.value || '').trim() && !!String($('#equipmentBox')?.value || '').trim();
  }

  function focusSerial(delay = 0) {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (!readyForNextSerial()) return;
      const serial = $('#equipmentSerial');
      if (!serial) return;
      serial.focus({preventScroll:true});
      serial.select?.();
    }, delay);
  }

  function watchRegistrations() {
    const body = $('#equipmentRegisterBody');
    if (!body) return;
    lastCount = window.EquipmentRegistry?.getRows?.().length || 0;

    new MutationObserver(() => {
      const count = window.EquipmentRegistry?.getRows?.().length || 0;
      if (count > lastCount) {
        // Primero deja que el módulo de capacidad mantenga o cambie la caja.
        // Luego devuelve siempre el flujo al SERIAL del siguiente equipo.
        focusSerial(80);
      }
      lastCount = count;
    }).observe(body, {childList:true, subtree:true});
  }

  document.addEventListener('DOMContentLoaded', () => {
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    const mode = $('#equipmentRegisterModeBtn');
    if (!serial || !ua) return;

    watchRegistrations();

    ua.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !automaticMode()) return;
      // El registro base valida/guarda primero. Este refuerzo asegura que,
      // haya o no cambio automático de caja, el siguiente destino sea SERIAL.
      focusSerial(120);
    });

    document.addEventListener('click', event => {
      if (event.target.closest?.('#equipmentRegisterModeBtn') && automaticMode()) {
        focusSerial(60);
      }
    });

    window.EquipmentAutoFocus = {focusSerial};
  });
})();