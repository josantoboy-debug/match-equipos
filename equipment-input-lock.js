(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const normSerial = value => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const normUA = value => String(value ?? '').trim().replace(/[-\s]/g, '');

  function serialResult(value) {
    const normalized = normSerial(value);
    if (!normalized) return {valid:false, value:normalized, message:'El SERIAL es obligatorio.'};
    if (!normalized.startsWith('M')) return {valid:false, value:normalized, message:'El SERIAL debe iniciar con M.'};
    if (normalized.length !== 12) return {valid:false, value:normalized, message:`El SERIAL debe tener exactamente 12 caracteres; tiene ${normalized.length}.`};
    if (!/^M[A-Z0-9]{11}$/.test(normalized)) return {valid:false, value:normalized, message:'El SERIAL solo puede contener letras y números después de M.'};
    return {valid:true, value:normalized, message:''};
  }

  function uaResult(value) {
    const normalized = normUA(value);
    if (!normalized) return {valid:false, value:normalized, message:'La UA / Unit Address es obligatoria.'};
    if (!/^\d+$/.test(normalized)) return {valid:false, value:normalized, message:'La UA / Unit Address solo puede contener dígitos.'};
    if (!normalized.startsWith('0000')) return {valid:false, value:normalized, message:'La UA / Unit Address debe iniciar con 0000.'};
    if (normalized.length !== 16) return {valid:false, value:normalized, message:`La UA / Unit Address debe tener exactamente 16 dígitos; tiene ${normalized.length}.`};
    return {valid:true, value:normalized, message:''};
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setMessage(title, detail) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    panel.className = 'equipment-validation error';
    panel.innerHTML = `<span class="equipment-validation-icon">×</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  }

  function keepInField(input, result, title) {
    if (!input) return;
    input.value = result.value;
    input.classList.remove('field-valid');
    input.classList.add('field-invalid');
    setMessage(title, `${result.message} Corrige este campo para continuar.`);
    requestAnimationFrame(() => {
      input.focus({preventScroll:true});
      try {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } catch {}
    });
  }

  function markValid(input, result) {
    if (!input) return;
    input.value = result.value;
    input.classList.remove('field-invalid');
    input.classList.add('field-valid');
  }

  function validateSerialBeforeContinue(event) {
    const input = $('#equipmentSerial');
    if (!input || event.target !== input || event.key !== 'Enter') return false;
    const result = serialResult(input.value);
    if (result.valid) {
      markValid(input, result);
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    keepInField(input, result, 'SERIAL inválido');
    return true;
  }

  function validateUABeforeContinue(event) {
    const input = $('#equipmentUA');
    if (!input || event.target !== input || event.key !== 'Enter') return false;
    const result = uaResult(input.value);
    if (result.valid) {
      markValid(input, result);
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    keepInField(input, result, 'UA inválida');
    return true;
  }

  function validateBeforeAdd(event) {
    const button = event.target.closest?.('#equipmentAddBtn');
    if (!button) return;

    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    const serialCheck = serialResult(serial?.value);
    if (!serialCheck.valid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      keepInField(serial, serialCheck, 'SERIAL inválido');
      return;
    }
    markValid(serial, serialCheck);

    const uaCheck = uaResult(ua?.value);
    if (!uaCheck.valid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      keepInField(ua, uaCheck, 'UA inválida');
      return;
    }
    markValid(ua, uaCheck);
  }

  function installLiveState() {
    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    if (serial && serial.dataset.strictStayInstalled !== '1') {
      serial.dataset.strictStayInstalled = '1';
      serial.addEventListener('input', () => {
        const result = serialResult(serial.value);
        serial.classList.toggle('field-invalid', !!serial.value && !result.valid);
        serial.classList.toggle('field-valid', result.valid);
      });
    }
    if (ua && ua.dataset.strictStayInstalled !== '1') {
      ua.dataset.strictStayInstalled = '1';
      ua.addEventListener('input', () => {
        const result = uaResult(ua.value);
        ua.classList.toggle('field-invalid', !!ua.value && !result.valid);
        ua.classList.toggle('field-valid', result.valid);
      });
    }
  }

  function install() {
    installLiveState();
    if (document.documentElement.dataset.equipmentInputLock === '1') return;
    document.documentElement.dataset.equipmentInputLock = '1';

    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (validateSerialBeforeContinue(event)) return;
      validateUABeforeContinue(event);
    }, true);

    document.addEventListener('click', validateBeforeAdd, true);
    document.addEventListener('operator:login', () => setTimeout(installLiveState, 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.EquipmentInputLock = {
    validateSerial: value => serialResult(value),
    validateUA: value => uaResult(value)
  };
})();