(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();
  let lastRowCount = 0;
  let observerBusy = false;

  function validateQuantity(value) {
    const text = norm(value);
    if (!text) return {valid:false, value:0, message:'La CANTIDAD de equipos por caja es obligatoria.'};
    if (!/^\d+$/.test(text)) return {valid:false, value:0, message:'La CANTIDAD debe ser un número entero positivo.'};
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < 1) return {valid:false, value:0, message:'La CANTIDAD debe ser mayor o igual a 1.'};
    if (number > 100000) return {valid:false, value:0, message:'La CANTIDAD es demasiado alta. Usa un valor menor o igual a 100000.'};
    return {valid:true, value:number, message:''};
  }

  function quantityFieldState(result) {
    const input = $('#equipmentQuantity');
    if (!input) return;
    input.classList.remove('field-valid', 'field-invalid');
    if (!input.value.trim()) return;
    input.classList.add(result.valid ? 'field-valid' : 'field-invalid');
  }

  function message(tone, title, detail) {
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

  function getRows() {
    return window.EquipmentRegistry?.getRows?.() || [];
  }

  function rowsInBox(lot, box) {
    const lotKey = upper(lot);
    const boxKey = upper(box);
    return getRows().filter(row => upper(row.lot) === lotKey && upper(row.box) === boxKey);
  }

  function incrementBoxName(value) {
    const original = norm(value);
    if (!original) return '1';
    const match = original.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const digits = match[2];
      const next = String(Number(digits) + 1).padStart(digits.length, '0');
      return `${prefix}${next}`;
    }
    return `${original}-2`;
  }

  function nextAvailableBox(lot, currentBox, quantity) {
    let candidate = norm(currentBox);
    let loops = 0;
    while (rowsInBox(lot, candidate).length >= quantity && loops < 10000) {
      candidate = incrementBoxName(candidate);
      loops++;
    }
    return candidate;
  }

  function setBox(value) {
    const box = $('#equipmentBox');
    if (!box) return;
    box.value = value;
    box.classList.remove('field-invalid');
    box.classList.add('field-valid');
    box.dispatchEvent(new Event('input', {bubbles:true}));
  }

  function ensureCapacityBeforeRegister() {
    const quantityResult = validateQuantity($('#equipmentQuantity')?.value);
    quantityFieldState(quantityResult);
    if (!quantityResult.valid) {
      message('error', 'CANTIDAD no confirmada', quantityResult.message);
      $('#equipmentQuantity')?.focus();
      $('#equipmentQuantity')?.select?.();
      return false;
    }

    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) return true;

    const count = rowsInBox(lot, box).length;
    if (count >= quantityResult.value) {
      const next = nextAvailableBox(lot, box, quantityResult.value);
      setBox(next);
      message(
        'ok',
        `Caja ${box} completa`,
        `Alcanzó ${count}/${quantityResult.value} equipos. Se seleccionó automáticamente la Caja ${next}.`
      );
    }
    return true;
  }

  function updateCapacityIndicator() {
    const strong = $('#equipmentCurrentBoxCount');
    const label = $('#equipmentCurrentBoxLabel');
    const quantityResult = validateQuantity($('#equipmentQuantity')?.value);
    if (!strong || !label) return;

    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) {
      if (quantityResult.valid) strong.textContent = `0 / ${quantityResult.value}`;
      return;
    }

    const count = rowsInBox(lot, box).length;
    if (!quantityResult.valid) {
      strong.textContent = String(count);
      label.textContent = `${lot} · ${box} · define cantidad`;
      return;
    }

    const remaining = Math.max(0, quantityResult.value - count);
    strong.textContent = `${count} / ${quantityResult.value}`;
    label.textContent = `${lot} · ${box} · ${remaining ? `faltan ${remaining}` : 'CAJA COMPLETA'}`;
  }

  function afterRegistryChanged() {
    if (observerBusy) return;
    observerBusy = true;
    requestAnimationFrame(() => {
      try {
        const rows = getRows();
        const previousCount = lastRowCount;
        lastRowCount = rows.length;

        if (rows.length > previousCount) {
          const newest = rows[rows.length - 1];
          const quantityResult = validateQuantity($('#equipmentQuantity')?.value);
          if (newest && quantityResult.valid && /^Captura /i.test(String(newest.origin || ''))) {
            const boxCount = rowsInBox(newest.lot, newest.box).length;
            const currentLot = upper($('#equipmentLot')?.value);
            const currentBox = upper($('#equipmentBox')?.value);

            if (boxCount >= quantityResult.value && currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const next = nextAvailableBox(newest.lot, newest.box, quantityResult.value);
              setBox(next);
              message(
                'ok',
                `Caja ${newest.box} completada`,
                `${boxCount}/${quantityResult.value} equipos registrados. Nueva Caja ${next} preparada automáticamente para el siguiente equipo.`
              );
            } else if (currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const remaining = Math.max(0, quantityResult.value - boxCount);
              message(
                'ok',
                `Equipo ${boxCount} de ${quantityResult.value} registrado`,
                `La Caja ${newest.box} se mantiene. Faltan ${remaining} equipo${remaining === 1 ? '' : 's'} para crear la siguiente caja.`
              );
            }
          }
        }
        updateCapacityIndicator();
      } finally {
        observerBusy = false;
      }
    });
  }

  function blockEventForQuantity(event) {
    const result = validateQuantity($('#equipmentQuantity')?.value);
    quantityFieldState(result);
    if (result.valid) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    message('error', 'CANTIDAD no confirmada', result.message);
    $('#equipmentQuantity')?.focus();
    $('#equipmentQuantity')?.select?.();
    return true;
  }

  function wireCapacityFlow() {
    const quantity = $('#equipmentQuantity');
    const box = $('#equipmentBox');
    const ua = $('#equipmentUA');
    const add = $('#equipmentAddBtn');
    if (!quantity || !box || !ua || !add) return;

    quantity.addEventListener('input', () => {
      const result = validateQuantity(quantity.value);
      quantityFieldState(result);
      updateCapacityIndicator();
    });

    quantity.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const result = validateQuantity(quantity.value);
      quantityFieldState(result);
      if (!result.valid) {
        message('error', 'CANTIDAD inválida', result.message);
        quantity.focus();
        quantity.select?.();
        return;
      }
      quantity.value = String(result.value);
      ensureCapacityBeforeRegister();

      const mode = window.EquipmentRegistry?.getCaptureMode?.() || 'manual';
      const serialOk = /^M[A-Z0-9]{11}$/.test(String($('#equipmentSerial')?.value || '').trim().toUpperCase());
      const uaNorm = String($('#equipmentUA')?.value || '').replace(/[-\s]/g, '');
      const uaOk = /^0000\d{12}$/.test(uaNorm);
      const lotOk = !!norm($('#equipmentLot')?.value);
      const boxOk = !!norm($('#equipmentBox')?.value);

      if (mode === 'automatic' && serialOk && uaOk && lotOk && boxOk) {
        add.click();
      } else if (serialOk && uaOk && lotOk && boxOk) {
        message('ok', 'CANTIDAD confirmada', `Capacidad fijada en ${result.value} equipos por caja. Pulsa Agregar equipo para guardar.`);
        add.focus();
      } else {
        message('ok', 'CANTIDAD confirmada', `Capacidad fijada en ${result.value} equipos por caja. Continúa con los datos pendientes.`);
        $('#equipmentSerial')?.focus();
      }
      updateCapacityIndicator();
    });

    // En la primera configuración, CAJA → ENTER conduce a CANTIDAD antes de permitir un registro.
    box.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const result = validateQuantity(quantity.value);
      if (result.valid) return;
      if (!norm(box.value)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      box.classList.remove('field-invalid');
      box.classList.add('field-valid');
      message('warn', 'Define la capacidad de la caja', 'Ingresa CANTIDAD y presiona ENTER. La aplicación no registrará equipos sin este valor.');
      quantity.focus();
      quantity.select?.();
    }, true);

    // En automático, UA + ENTER solo registra si la capacidad ya fue confirmada.
    ua.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const mode = window.EquipmentRegistry?.getCaptureMode?.() || 'manual';
      if (mode !== 'automatic') return;
      if (!norm(box.value)) return; // Deja que el módulo base lleve al campo CAJA.
      if (blockEventForQuantity(event)) return;
      ensureCapacityBeforeRegister();
    }, true);

    // El botón manual/Agregar ahora tampoco puede saltarse la capacidad.
    add.addEventListener('click', event => {
      if (blockEventForQuantity(event)) return;
      ensureCapacityBeforeRegister();
    }, true);

    ['#equipmentLot', '#equipmentBox'].forEach(selector => {
      $(selector)?.addEventListener('input', () => setTimeout(updateCapacityIndicator, 0));
    });
  }

  function injectStyles() {
    if ($('#equipmentCapacityStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentCapacityStyles';
    style.textContent = `
      .equipment-entry-grid{grid-template-columns:minmax(140px,.75fr) minmax(190px,.95fr) minmax(225px,1.15fr) minmax(105px,.55fr) minmax(105px,.55fr) minmax(125px,.62fr) auto}
      .equipment-quantity-field .equipment-code{text-align:center;font-size:17px}
      .equipment-quantity-field input::-webkit-inner-spin-button,.equipment-quantity-field input::-webkit-outer-spin-button{opacity:.65}
      @media(max-width:1450px){.equipment-entry-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.equipment-capture-mode,.equipment-add-btn{align-self:end}.equipment-add-btn{grid-column:auto}}
      @media(max-width:900px){.equipment-entry-grid{grid-template-columns:1fr}.equipment-add-btn{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#equipmentQuantity') || !window.EquipmentRegistry) return;
    injectStyles();
    lastRowCount = getRows().length;
    wireCapacityFlow();
    updateCapacityIndicator();

    const body = $('#equipmentRegisterBody');
    if (body) new MutationObserver(afterRegistryChanged).observe(body, {childList:true, subtree:true});
  });
})();