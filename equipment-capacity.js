(() => {
  'use strict';

  const MAX_PER_BOX = 64;
  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();
  let lastRowCount = 0;
  let observerBusy = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function message(tone, title, detail) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    const icon = tone === 'error' ? '×' : tone === 'warn' ? '!' : '✓';
    panel.className = `equipment-validation ${tone || 'neutral'}`;
    panel.innerHTML = `<span class="equipment-validation-icon">${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  }

  function getRows() {
    const rows = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(rows) ? rows : [];
  }

  function rowsInBox(lot, box) {
    const lotKey = upper(lot);
    const boxKey = upper(box);
    if (!lotKey || !boxKey) return [];
    return getRows().filter(row => upper(row.lot) === lotKey && upper(row.box) === boxKey);
  }

  function assignedQuantity() {
    const input = $('#equipmentQuantity');
    const raw = norm(input?.value);
    if (!/^\d+$/.test(raw)) return 0;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PER_BOX ? value : 0;
  }

  function validateQuantity({focus = true, announce = true} = {}) {
    const input = $('#equipmentQuantity');
    if (!input) return false;
    const cap = assignedQuantity();
    input.classList.remove('field-valid', 'field-invalid');
    if (!cap) {
      if (norm(input.value)) input.classList.add('field-invalid');
      if (announce) message('error', 'CANTIDAD inválida', `Asigna entre 1 y ${MAX_PER_BOX} equipos para esta caja.`);
      if (focus) {
        input.focus({preventScroll:true});
        input.select?.();
      }
      return false;
    }
    input.classList.add('field-valid');
    return true;
  }

  function incrementBoxName(value) {
    const original = norm(value);
    if (!original) return '1';
    const match = original.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const digits = match[2];
      return `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
    }
    return `${original}-2`;
  }

  function nextAvailableBox(lot, currentBox, cap) {
    let candidate = norm(currentBox);
    let loops = 0;
    while (cap && rowsInBox(lot, candidate).length >= cap && loops < 10000) {
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

  function currentCount() {
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) return 0;
    return rowsInBox(lot, box).length;
  }

  function configureQuantityField() {
    const input = $('#equipmentQuantity');
    if (!input) return;
    input.type = 'number';
    input.min = '1';
    input.max = String(MAX_PER_BOX);
    input.step = '1';
    input.inputMode = 'numeric';
    input.removeAttribute('aria-hidden');
    input.removeAttribute('tabindex');
    input.placeholder = '1–64';
    input.title = `Cantidad de equipos asignados a esta caja. Este número es el límite real de la caja. Mínimo 1, máximo ${MAX_PER_BOX}.`;

    const field = input.closest('label');
    const title = field?.querySelector('span');
    if (title) title.innerHTML = `CANTIDAD <small>Límite de la caja · máximo ${MAX_PER_BOX}</small>`;
    $('#equipmentQuantityDisplay')?.remove();
  }

  function updateCapacityIndicator() {
    const cap = assignedQuantity();
    const count = currentCount();
    const strong = $('#equipmentCurrentBoxCount');
    const label = $('#equipmentCurrentBoxLabel');
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);

    if (strong) strong.textContent = `${count} / ${cap || '—'}`;
    if (!label) return;

    if (!lot || !box) {
      label.textContent = 'Sin caja seleccionada';
      return;
    }
    if (!cap) {
      label.textContent = `${lot} · ${box} · asigna CANTIDAD`;
      return;
    }

    const remaining = Math.max(0, cap - count);
    label.textContent = `${lot} · ${box} · ${remaining ? `faltan ${remaining}` : 'LÍMITE ALCANZADO'}`;
  }

  function prepareNextBoxIfFull({announce = true} = {}) {
    const cap = assignedQuantity();
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!cap || !lot || !box) return {moved:false, cap, lot, box, count:0};

    const count = rowsInBox(lot, box).length;
    if (count < cap) return {moved:false, cap, lot, box, count};

    const next = nextAvailableBox(lot, box, cap);
    if (next !== box) {
      setBox(next);
      if (announce) message('ok', `Caja ${box} completada`, `${count}/${cap} equipos. El límite de esta caja es ${cap}. El siguiente equipo irá a la Caja ${next}.`);
      return {moved:true, cap, lot, box:next, previousBox:box, count};
    }

    if (announce) message('warn', `Caja ${box} completa`, `La caja alcanzó su límite de ${cap}/${cap} equipos.`);
    return {moved:false, blocked:true, cap, lot, box, count};
  }

  function ensureCapacityBeforeRegister() {
    if (!validateQuantity()) return false;
    const result = prepareNextBoxIfFull({announce:true});
    updateCapacityIndicator();
    return !result.blocked;
  }

  function afterRegistryChanged() {
    if (observerBusy) return;
    observerBusy = true;
    requestAnimationFrame(() => {
      try {
        const rows = getRows();
        const previousCount = lastRowCount;
        lastRowCount = rows.length;
        const cap = assignedQuantity();

        if (rows.length > previousCount && cap) {
          const newest = rows[rows.length - 1];
          if (newest && /^Captura /i.test(String(newest.origin || ''))) {
            const boxCount = rowsInBox(newest.lot, newest.box).length;
            const currentLot = upper($('#equipmentLot')?.value);
            const currentBox = upper($('#equipmentBox')?.value);

            if (boxCount >= cap && currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const next = nextAvailableBox(newest.lot, newest.box, cap);
              if (next !== newest.box) setBox(next);
              message('ok', `Caja ${newest.box} completada`, `${boxCount}/${cap} equipos registrados. Límite alcanzado.${next !== newest.box ? ` Nueva Caja ${next} preparada automáticamente.` : ''}`);
            } else if (currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const remaining = Math.max(0, cap - boxCount);
              message('ok', `Equipo ${boxCount} registrado`, `Caja ${newest.box}: ${boxCount}/${cap}. Faltan ${remaining} equipo${remaining === 1 ? '' : 's'}.`);
            }
          }
        }
        updateCapacityIndicator();
      } finally {
        observerBusy = false;
      }
    });
  }

  function wireCapacityFlow() {
    const quantity = $('#equipmentQuantity');
    const add = $('#equipmentAddBtn');
    if (!quantity || !add) return;

    quantity.addEventListener('input', event => {
      let value = String(event.target.value || '').replace(/\D/g, '');
      if (value.length > 2) value = value.slice(0, 2);
      if (event.target.value !== value) event.target.value = value;
      const cap = assignedQuantity();
      event.target.classList.toggle('field-valid', !!cap);
      event.target.classList.toggle('field-invalid', !!value && !cap);
      updateCapacityIndicator();
    }, true);

    quantity.addEventListener('blur', () => validateQuantity({focus:false, announce:false}));

    add.addEventListener('click', event => {
      if (!ensureCapacityBeforeRegister()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    // En automático, UA + ENTER registra sin pulsar el botón. Este guard se ejecuta
    // antes del registrador principal para que nunca se pueda superar CANTIDAD.
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.target?.id !== 'equipmentUA') return;
      if (!validateQuantity({focus:false, announce:false})) {
        event.preventDefault();
        event.stopImmediatePropagation();
        validateQuantity({focus:true, announce:true});
        return;
      }

      const result = prepareNextBoxIfFull({announce:true});
      if (result.blocked) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Si la caja estaba llena, setBox() ya cambió a la siguiente antes de que
      // el handler de registro automático procese este mismo ENTER.
      updateCapacityIndicator();
    }, true);

    ['#equipmentLot', '#equipmentBox'].forEach(selector => {
      $(selector)?.addEventListener('input', () => setTimeout(updateCapacityIndicator, 0));
    });

    document.addEventListener('operator:login', () => setTimeout(updateCapacityIndicator, 0));
  }

  function injectStyles() {
    if ($('#equipmentCapacityStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentCapacityStyles';
    style.textContent = `
      .equipment-entry-grid{grid-template-columns:minmax(140px,.75fr) minmax(190px,.95fr) minmax(150px,.72fr) minmax(225px,1.15fr) minmax(250px,1.25fr) auto}
      .equipment-quantity-field .equipment-code{text-align:center;font-size:17px;font-weight:800}
      #equipmentQuantity{appearance:textfield}
      #equipmentQuantity::-webkit-inner-spin-button,#equipmentQuantity::-webkit-outer-spin-button{opacity:.65}
      @media(max-width:1450px){.equipment-entry-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.equipment-add-btn{align-self:end}}
      @media(max-width:900px){.equipment-entry-grid{grid-template-columns:1fr}.equipment-add-btn{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (!$('#equipmentQuantity') || !window.EquipmentRegistry) {
      setTimeout(install, 40);
      return;
    }
    configureQuantityField();
    injectStyles();
    lastRowCount = getRows().length;
    wireCapacityFlow();
    updateCapacityIndicator();

    const body = $('#equipmentRegisterBody');
    if (body) new MutationObserver(afterRegistryChanged).observe(body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.EquipmentCapacity = {
    maxPerBox: MAX_PER_BOX,
    getAssignedQuantity: assignedQuantity,
    validateQuantity,
    getCurrentCount: currentCount,
    prepareNextBoxIfFull,
    canRegister: () => {
      const cap = assignedQuantity();
      return !!cap && currentCount() < cap;
    },
    refresh: updateCapacityIndicator
  };
})();