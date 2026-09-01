(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

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

  function quantityValid() {
    if (window.EquipmentCapacity?.validateQuantity) {
      return window.EquipmentCapacity.validateQuantity({focus:true, announce:true});
    }
    const input = $('#equipmentQuantity');
    const raw = String(input?.value || '').trim();
    const value = Number(raw);
    const valid = /^\d+$/.test(raw) && Number.isSafeInteger(value) && value >= 1;
    input?.classList.toggle('field-valid', valid);
    input?.classList.toggle('field-invalid', !valid && !!raw);
    if (!valid) {
      setMessage('error', 'CANTIDAD inválida', 'Asigna un número entero de 1 o más equipos para esta caja.');
      input?.focus();
      input?.select?.();
    }
    return valid;
  }

  function assignedQuantity() {
    return window.EquipmentCapacity?.getAssignedQuantity?.() || Number($('#equipmentQuantity')?.value || 0) || 0;
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
    const quantity = $('#equipmentQuantity');
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    const add = $('#equipmentAddBtn');
    if (!lot || !box || !quantity || !serial || !ua || !add) return;

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
      setMessage('ok', 'LOTE confirmado', 'Continúa con CAJA.');
      focusField('#equipmentBox');
    }, true);

    box.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!lotValid() || !boxValid()) return;
      setMessage('ok', 'CAJA confirmada', 'Ahora asigna la CANTIDAD de equipos de esta caja. Ese número será el límite real.');
      focusField('#equipmentQuantity');
    }, true);

    quantity.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!lotValid() || !boxValid() || !quantityValid()) return;
      const cap = assignedQuantity();
      const count = currentBoxCount();
      if (count >= cap) {
        setMessage('warn', 'Cantidad ya completada', `Caja ${box.value}: ${count}/${cap}. Usa la siguiente caja para continuar.`);
        focusField('#equipmentBox');
        return;
      }
      setMessage('ok', 'CANTIDAD confirmada', `Caja ${box.value}: ${count}/${cap}. Continúa con SERIAL.`);
      focusField('#equipmentSerial');
    }, true);

    ua.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (captureMode() !== 'manual') return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!lotValid() || !boxValid() || !quantityValid()) return;
      if (!serialValid()) {
        setMessage('error', 'SERIAL no confirmado', 'El SERIAL debe iniciar con M y tener exactamente 12 caracteres alfanuméricos.');
        focusField('#equipmentSerial');
        return;
      }
      if (!uaValid()) {
        setMessage('error', 'UA no confirmado', 'La UA debe ser 0000 + 12 dígitos (16 dígitos en total).');
        focusField('#equipmentUA');
        return;
      }

      const cap = assignedQuantity();
      const count = currentBoxCount();
      setMessage('ok', 'SERIAL y UA confirmados', `Caja ${box.value}: ${count}/${cap}. Pulsa Agregar equipo.`);
      add.focus({preventScroll: true});
    }, true);

    add.addEventListener('click', event => {
      if (!lotValid() || !boxValid() || !quantityValid()) {
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