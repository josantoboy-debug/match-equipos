(() => {
  'use strict';

  const MAX_PER_BOX = 64;
  const $ = selector => document.querySelector(selector);
  const norm = value => String(value ?? '').trim();
  const upper = value => norm(value).toUpperCase();

  let waitingForImport = false;
  let restoreTimer = null;
  let lastFileName = '';
  let observer = null;

  function rows() {
    const value = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(value) ? value : [];
  }

  function setInput(selector, value) {
    const input = $(selector);
    if (!input) return;
    input.value = value ?? '';
    input.classList.remove('field-invalid');
    if (String(value ?? '').trim()) input.classList.add('field-valid');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }

  function setMessage(context) {
    const panel = $('#equipmentValidationMessage');
    if (!panel) return;
    panel.className = 'equipment-validation ok';
    panel.innerHTML = `<span class="equipment-validation-icon">✓</span><div><strong>Registro cargado y contexto restaurado</strong><small>${context.count} equipo${context.count === 1 ? '' : 's'} en Caja ${escapeHtml(context.box)} · Lote ${escapeHtml(context.lot)}${context.process ? ` · ${escapeHtml(context.process)}` : ''}. Puedes continuar desde SERIAL.</small></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(context) {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = 'toast show ok';
    toast.innerHTML = `<strong>Contexto restaurado</strong><span>${escapeHtml(lastFileName || 'Registro cargado')} · Caja ${escapeHtml(context.box)} · ${context.count}/${MAX_PER_BOX} equipos.</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4800);
  }

  function contextFromRows(source) {
    if (!source.length) return null;

    const last = source[source.length - 1];
    const lot = norm(last?.lot);
    const box = norm(last?.box);
    if (!lot || !box) return null;

    const activeRows = source.filter(row => upper(row?.lot) === upper(lot) && upper(row?.box) === upper(box));
    const process = [...source].reverse().find(row => norm(row?.process))?.process || '';

    return {
      lot,
      box,
      process: norm(process),
      count: activeRows.length,
      total: source.length
    };
  }

  function applyContext() {
    if (!waitingForImport) return false;

    const source = rows();
    const context = contextFromRows(source);
    if (!context) return false;

    setInput('#equipmentLot', context.lot);
    setInput('#equipmentBox', context.box);

    if (context.process) {
      if (typeof window.EquipmentRegistry?.setCurrentProcess === 'function') {
        window.EquipmentRegistry.setCurrentProcess(context.process);
        $('#equipmentProcess')?.dispatchEvent(new Event('input', {bubbles:true}));
      } else {
        setInput('#equipmentProcess', context.process);
      }
    }

    const hiddenQuantity = $('#equipmentQuantity');
    if (hiddenQuantity) hiddenQuantity.value = String(MAX_PER_BOX);

    const quantityDisplay = $('#equipmentQuantityDisplay');
    if (quantityDisplay) quantityDisplay.value = String(context.count);

    const currentCount = $('#equipmentCurrentBoxCount');
    if (currentCount) currentCount.textContent = `${context.count} / ${MAX_PER_BOX}`;

    const currentLabel = $('#equipmentCurrentBoxLabel');
    if (currentLabel) {
      currentLabel.textContent = `${upper(context.lot)} · ${upper(context.box)}${context.process ? ` · ${context.process}` : ''}`;
    }

    const serial = $('#equipmentSerial');
    const ua = $('#equipmentUA');
    if (serial) {
      serial.value = '';
      serial.classList.remove('field-valid', 'field-invalid');
    }
    if (ua) {
      ua.value = '';
      ua.classList.remove('field-valid', 'field-invalid');
    }

    window.EquipmentCapacity?.refresh?.();
    window.OperatorSession?.saveNow?.();
    setMessage(context);
    showToast(context);

    waitingForImport = false;
    setTimeout(() => serial?.focus({preventScroll:true}), 80);
    return true;
  }

  function scheduleRestore(delay = 450) {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (!applyContext() && waitingForImport) scheduleRestore(350);
    }, delay);
  }

  function install() {
    const input = $('#equipmentImportFile');
    const button = $('#equipmentImportBtn');
    const body = $('#equipmentRegisterBody');
    if (!input || !button || !body || !window.EquipmentRegistry) {
      setTimeout(install, 50);
      return;
    }

    if (input.dataset.contextRestoreInstalled === '1') return;
    input.dataset.contextRestoreInstalled = '1';

    button.addEventListener('click', () => {
      waitingForImport = true;
      lastFileName = '';
    }, true);

    input.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      waitingForImport = true;
      lastFileName = file.name || '';
      scheduleRestore(/\.accdb$/i.test(lastFileName) ? 900 : 500);
    });

    observer = new MutationObserver(() => {
      if (waitingForImport) scheduleRestore(220);
    });
    observer.observe(body, {childList:true, subtree:true});

    window.EquipmentImportContext = {
      restore: () => {
        waitingForImport = true;
        return applyContext();
      },
      getContext: () => contextFromRows(rows())
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();