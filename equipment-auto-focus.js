(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PER_BOX = 64;
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
    return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_PER_BOX;
  }

  function validSerial() {
    const value = String($('#equipmentSerial')?.value || '').trim().replace(/\s+/g, '').toUpperCase();
    return /^M[A-Z0-9]{11}$/.test(value);
  }

  function validUA() {
    const value = String($('#equipmentUA')?.value || '').trim().replace(/[-\s]/g, '');
    return /^0000\d{12}$/.test(value);
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
      if (count > lastCount) focusSerial(80);
      lastCount = count;
    }).observe(body, {childList:true, subtree:true});
  }

  document.addEventListener('DOMContentLoaded', () => {
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    if (!serial || !ua) return;

    watchRegistrations();

    ua.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !automaticMode()) return;
      if (!validQuantity() || !validSerial() || !validUA()) return;
      focusSerial(120);
    });

    document.addEventListener('click', event => {
      if (event.target.closest?.('#equipmentRegisterModeBtn') && automaticMode()) {
        if (validQuantity()) focusSerial(60);
        else $('#equipmentQuantity')?.focus({preventScroll:true});
      }
    });

    window.EquipmentAutoFocus = {focusSerial};
  });
})();