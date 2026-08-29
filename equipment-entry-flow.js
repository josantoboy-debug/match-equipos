(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PER_BOX = 64;

  const normalizeLot = value => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const normalizeUA = value => String(value ?? '').replace(/[-\s]/g, '');

  function setMessage(tone, title, detail) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    const icon = tone === 'error' ? '×' : tone === 'warn' ? '!' : '✓';
    panel.className = `equipment-validation ${tone || 'neutral'}`;
    panel.innerHTML = `<span class="equipment-validation-icon">${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function lotValid() {
    const input = $('#equipmentLot');
    if (!input) return false;
    const normalized = normalizeLot(input.value);
    input.value = normalized;
    input.classList.remove('field-valid', 'field-invalid');
    if (!normalized) {
      input.classList.add('field-invalid');
      setMessage('error', 'LOTE no confirmado', 'El LOTE es obligatorio y solo admite letras y números, sin guiones ni símbolos.');
      input.focus();
      return false;
    }
    input.classList.add('field-valid');
    return true;
  }

  function boxValid() {
    const input = $('#equipmentBox');
    if (!input) return false;
    const value = String(input.value || '').trim();
    input.classList.remove('field-valid', 'field-invalid');
    if (!value) {
      input.classList.add('field-invalid');
      setMessage('error', 'CAJA no confirmada', 'Ingresa la caja antes de registrar equipos.');
      input.focus();
      return false;
    }
    input.classList.add('field-valid');
    return true;
  }

  function serialValid() {
    const input = $('#equipmentSerial');
    const value = String(input?.value || '').trim().replace(/\s+/g, '').toUpperCase();
    if (input) input.value = value;
    return /^M[A-Z0-9]{11}$/.test(value);
  }

  function uaValid() {
    const input = $('#equipmentUA');
    const value = normalizeUA(input?.value);
    return /^0000\d{12}$/.test(value);
  }

  function captureMode() {
    return window.EquipmentRegistry?.getCaptureMode?.() || 'manual';
  }

  function focusField(selector, select = true) {
    const input = $(selector);
    if (!input) return;
    input.focus({preventScroll: true});
    if (select) input.select?.();
  }

  function currentBoxCount() {
    return window.EquipmentCapacity?.getCurrentCount?.() || 0;
  }

  function wireFlow() {
    const lot = $('#equipmentLot');
    const box = $('#equipmentBox');
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    const add = $('#equipmentAddBtn');
    if (!lot || !box || !serial || !ua || !add) return;

    lot.placeholder = 'LOTE001';
    lot.setAttribute('inputmode', 'text');
    lot.setAttribute('pattern', '[A-Za-z0-9]+');
    lot.title = 'Solo letras y números, sin guiones ni símbolos.';

    lot.addEventListener('input', event => {
      const normalized = normalizeLot(event.target.value);
      if (event.target.value !== normalized) event.target.value = normalized;
    }, true);

    lot.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!lotValid()) return;
      setMessage('ok', 'LOTE confirmado', 'Continúa con CAJA. La cantidad se calculará automáticamente.');
      focusField('#equipmentBox');
    }, true);

    box.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!lotValid() || !boxValid()) return;
      const count = currentBoxCount();
      setMessage('ok', 'CAJA confirmada', `Cantidad automática: ${count}/${MAX_PER_BOX}. Continúa con SERIAL.`);
      focusField('#equipmentSerial');
    }, true);

    ua.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (captureMode() !== 'manual') return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!lotValid() || !boxValid()) return;
      if (!serialValid()) {
        setMessage('error', 'SERIAL no confirmado', 'El SERIAL debe iniciar con M y tener exactamente 12 caracteres alfanuméricos.');
        focusField('#equipmentSerial');
        return;
      }
      if (!uaValid()) {
        setMessage('error', 'UA no confirmado', 'El UA / Unit Address debe tener 16 dígitos e iniciar con 0000.');
        focusField('#equipmentUA');
        return;
      }

      setMessage('ok', 'SERIAL y UA confirmados', `La cantidad se calculará automáticamente, con máximo ${MAX_PER_BOX} equipos por caja. Pulsa Agregar equipo.`);
      add.focus({preventScroll: true});
    }, true);

    add.addEventListener('click', event => {
      if (!lotValid() || !boxValid()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', wireFlow);

  window.EquipmentEntryFlow = {
    normalizeLot,
    focusSerial: () => focusField('#equipmentSerial')
  };
})();