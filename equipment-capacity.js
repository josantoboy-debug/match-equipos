(() => {
  'use strict';

  const MAX_PER_BOX = 64;
  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();
  let lastRowCount = 0;
  let observerBusy = false;

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
    const rows = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(rows) ? rows : [];
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
      return `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
    }
    return `${original}-2`;
  }

  function nextAvailableBox(lot, currentBox) {
    let candidate = norm(currentBox);
    let loops = 0;
    while (rowsInBox(lot, candidate).length >= MAX_PER_BOX && loops < 10000) {
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

  function forceInternalCapacity() {
    const input = $('#equipmentQuantity');
    if (!input) return;
    input.value = String(MAX_PER_BOX);
    input.setAttribute('value', String(MAX_PER_BOX));
  }

  function installAutomaticQuantityField() {
    const internal = $('#equipmentQuantity');
    const field = internal?.closest('label');
    if (!internal || !field) return;

    forceInternalCapacity();
    internal.type = 'hidden';
    internal.tabIndex = -1;
    internal.setAttribute('aria-hidden', 'true');

    const title = field.querySelector('span');
    if (title) title.innerHTML = 'CANTIDAD <small>Automática · máximo 64</small>';

    if (!$('#equipmentQuantityDisplay')) {
      const display = document.createElement('input');
      display.id = 'equipmentQuantityDisplay';
      display.className = 'equipment-code';
      display.type = 'text';
      display.readOnly = true;
      display.value = '0';
      display.setAttribute('aria-label', 'Cantidad automática de equipos en la caja actual');
      display.title = 'Se calcula automáticamente según los equipos registrados. Máximo 64.';
      field.appendChild(display);
    }
  }

  function currentCount() {
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) return 0;
    return rowsInBox(lot, box).length;
  }

  function updateQuantityDisplay() {
    forceInternalCapacity();
    const display = $('#equipmentQuantityDisplay');
    if (!display) return;
    const count = Math.min(MAX_PER_BOX, currentCount());
    display.value = String(count);
    display.classList.remove('field-invalid');
    display.classList.toggle('field-valid', count > 0);
    display.title = `${count} de ${MAX_PER_BOX} equipos en la caja actual`;
  }

  function ensureCapacityBeforeRegister() {
    forceInternalCapacity();
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) return true;

    const count = rowsInBox(lot, box).length;
    if (count >= MAX_PER_BOX) {
      const next = nextAvailableBox(lot, box);
      setBox(next);
      message('ok', `Caja ${box} completa`, `${MAX_PER_BOX}/${MAX_PER_BOX} equipos. Se preparó automáticamente la Caja ${next}.`);
    }
    updateQuantityDisplay();
    return true;
  }

  function updateCapacityIndicator() {
    forceInternalCapacity();
    const strong = $('#equipmentCurrentBoxCount');
    const label = $('#equipmentCurrentBoxLabel');
    if (!strong || !label) return;

    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) {
      strong.textContent = `0 / ${MAX_PER_BOX}`;
      updateQuantityDisplay();
      return;
    }

    const count = rowsInBox(lot, box).length;
    const remaining = Math.max(0, MAX_PER_BOX - count);
    strong.textContent = `${count} / ${MAX_PER_BOX}`;
    label.textContent = `${lot} · ${box} · ${remaining ? `faltan ${remaining}` : 'CAJA COMPLETA'}`;
    updateQuantityDisplay();
  }

  function afterRegistryChanged() {
    if (observerBusy) return;
    observerBusy = true;
    requestAnimationFrame(() => {
      try {
        forceInternalCapacity();
        const rows = getRows();
        const previousCount = lastRowCount;
        lastRowCount = rows.length;

        if (rows.length > previousCount) {
          const newest = rows[rows.length - 1];
          if (newest && /^Captura /i.test(String(newest.origin || ''))) {
            const boxCount = rowsInBox(newest.lot, newest.box).length;
            const currentLot = upper($('#equipmentLot')?.value);
            const currentBox = upper($('#equipmentBox')?.value);

            if (boxCount >= MAX_PER_BOX && currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const next = nextAvailableBox(newest.lot, newest.box);
              setBox(next);
              message('ok', `Caja ${newest.box} completada`, `${MAX_PER_BOX} equipos registrados. Nueva Caja ${next} preparada automáticamente.`);
            } else if (currentLot === upper(newest.lot) && currentBox === upper(newest.box)) {
              const remaining = Math.max(0, MAX_PER_BOX - boxCount);
              message('ok', `Equipo ${boxCount} registrado`, `Caja ${newest.box}: ${boxCount}/${MAX_PER_BOX}. Faltan ${remaining} equipo${remaining === 1 ? '' : 's'}.`);
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
    const box = $('#equipmentBox');
    const add = $('#equipmentAddBtn');
    if (!box || !add) return;

    add.addEventListener('click', () => {
      forceInternalCapacity();
      ensureCapacityBeforeRegister();
    }, true);

    ['#equipmentLot', '#equipmentBox'].forEach(selector => {
      $(selector)?.addEventListener('input', () => setTimeout(updateCapacityIndicator, 0));
    });

    document.addEventListener('click', event => {
      if (!event.target.closest?.('#equipmentBoxNewSessionBtn')) return;
      setTimeout(() => {
        forceInternalCapacity();
        updateCapacityIndicator();
      }, 0);
    }, true);

    document.addEventListener('operator:login', () => {
      setTimeout(() => {
        forceInternalCapacity();
        updateCapacityIndicator();
      }, 0);
    });
  }

  function injectStyles() {
    if ($('#equipmentCapacityStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentCapacityStyles';
    style.textContent = `
      .equipment-entry-grid{grid-template-columns:minmax(140px,.75fr) minmax(190px,.95fr) minmax(225px,1.15fr) minmax(105px,.55fr) minmax(105px,.55fr) minmax(125px,.62fr) auto}
      .equipment-quantity-field .equipment-code{text-align:center;font-size:17px;font-weight:800}
      #equipmentQuantityDisplay{cursor:default;opacity:1}
      @media(max-width:1450px){.equipment-entry-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.equipment-capture-mode,.equipment-add-btn{align-self:end}.equipment-add-btn{grid-column:auto}}
      @media(max-width:900px){.equipment-entry-grid{grid-template-columns:1fr}.equipment-add-btn{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('#equipmentQuantity') || !window.EquipmentRegistry) return;
    injectStyles();
    installAutomaticQuantityField();
    lastRowCount = getRows().length;
    wireCapacityFlow();
    updateCapacityIndicator();

    const body = $('#equipmentRegisterBody');
    if (body) new MutationObserver(afterRegistryChanged).observe(body, {childList:true, subtree:true});
  });

  window.EquipmentCapacity = {
    maxPerBox: MAX_PER_BOX,
    getCurrentCount: currentCount,
    refresh: updateCapacityIndicator
  };
})();