(() => {
  'use strict';

  const MAX_PER_BOX = 64;
  const $ = selector => document.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();
  let observer = null;

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

  function rows() {
    const list = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(list) ? list : [];
  }

  function currentCount() {
    const lot = upper($('#equipmentLot')?.value);
    const box = upper($('#equipmentBox')?.value);
    if (!lot || !box) return 0;
    return rows().filter(row => upper(row.lot) === lot && upper(row.box) === box).length;
  }

  function forceInternalCapacity() {
    const input = $('#equipmentQuantity');
    if (!input) return;
    input.value = String(MAX_PER_BOX);
    input.setAttribute('value', String(MAX_PER_BOX));
  }

  function installDisplay() {
    const internal = $('#equipmentQuantity');
    const field = internal?.closest('label');
    if (!internal || !field) return false;

    forceInternalCapacity();
    internal.type = 'hidden';
    internal.tabIndex = -1;
    internal.setAttribute('aria-hidden', 'true');

    const title = field.querySelector('span');
    if (title) title.innerHTML = 'CANTIDAD <small>Automática · máximo 64</small>';

    let display = $('#equipmentQuantityDisplay');
    if (!display) {
      display = document.createElement('input');
      display.id = 'equipmentQuantityDisplay';
      display.className = 'equipment-code';
      display.type = 'text';
      display.readOnly = true;
      display.setAttribute('aria-label', 'Cantidad automática de equipos en la caja actual');
      display.title = 'Se calcula automáticamente. Máximo 64 equipos por caja.';
      field.appendChild(display);
    }
    return true;
  }

  function updateDisplay() {
    forceInternalCapacity();
    const display = $('#equipmentQuantityDisplay');
    if (!display) return;
    const count = Math.min(MAX_PER_BOX, currentCount());
    display.value = String(count);
    display.classList.toggle('field-valid', count > 0);
    display.title = `${count} equipo${count === 1 ? '' : 's'} en la caja actual · máximo ${MAX_PER_BOX}`;
  }

  function validateLotAndBox() {
    const lot = $('#equipmentLot');
    const box = $('#equipmentBox');
    const lotValue = String(lot?.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (lot) lot.value = lotValue;
    if (!lotValue) {
      lot?.classList.add('field-invalid');
      message('error', 'LOTE no confirmado', 'El LOTE es obligatorio antes de registrar equipos.');
      lot?.focus();
      return false;
    }
    const boxValue = norm(box?.value);
    if (!boxValue) {
      box?.classList.add('field-invalid');
      message('error', 'CAJA no confirmada', 'Ingresa la caja antes de registrar equipos.');
      box?.focus();
      return false;
    }
    lot?.classList.remove('field-invalid');
    lot?.classList.add('field-valid');
    box?.classList.remove('field-invalid');
    box?.classList.add('field-valid');
    return true;
  }

  function interceptBoxEnter(event) {
    if (event.key !== 'Enter' || event.target?.id !== 'equipmentBox') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    forceInternalCapacity();
    if (!validateLotAndBox()) return;

    const count = currentCount();
    if (count >= MAX_PER_BOX) {
      message('warn', 'Caja completa', `La caja actual ya tiene ${MAX_PER_BOX} equipos. El sistema preparará la siguiente caja al registrar.`);
    } else {
      message('ok', 'CAJA confirmada', `CANTIDAD automática: ${count}/${MAX_PER_BOX}. Continúa con SERIAL.`);
    }
    $('#equipmentSerial')?.focus({preventScroll:true});
    $('#equipmentSerial')?.select?.();
  }

  function installEvents() {
    if (document.documentElement.dataset.autoQuantityEvents === '1') return;
    document.documentElement.dataset.autoQuantityEvents = '1';

    // Document capture runs before the legacy CAJA → CANTIDAD handlers.
    document.addEventListener('keydown', interceptBoxEnter, true);

    ['#equipmentLot', '#equipmentBox'].forEach(selector => {
      $(selector)?.addEventListener('input', () => setTimeout(updateDisplay, 0));
    });

    document.addEventListener('click', event => {
      if (event.target.closest?.('#equipmentBoxNewSessionBtn')) {
        setTimeout(() => {
          forceInternalCapacity();
          updateDisplay();
        }, 0);
      }
    }, true);

    document.addEventListener('operator:login', () => {
      setTimeout(() => {
        forceInternalCapacity();
        updateDisplay();
      }, 0);
    });
  }

  function startObserver() {
    const body = $('#equipmentRegisterBody');
    if (!body || observer) return;
    observer = new MutationObserver(() => setTimeout(updateDisplay, 0));
    observer.observe(body, {childList:true, subtree:true});
  }

  function installStyles() {
    if ($('#equipmentAutoQuantityStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentAutoQuantityStyles';
    style.textContent = `
      #equipmentQuantityDisplay{cursor:default;text-align:center;font-size:17px;font-weight:800}
      #equipmentQuantityDisplay:read-only{opacity:1}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (!$('#equipmentQuantity') || !window.EquipmentRegistry) {
      setTimeout(install, 40);
      return;
    }
    installStyles();
    if (!installDisplay()) {
      setTimeout(install, 40);
      return;
    }
    installEvents();
    startObserver();
    updateDisplay();

    window.EquipmentAutoQuantity = {
      maxPerBox: MAX_PER_BOX,
      getCurrentCount: currentCount,
      refresh: updateDisplay,
      forceCapacity: forceInternalCapacity
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();