(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const MAX_PER_BOX = 64;

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function resetFields() {
    ['#equipmentProcess', '#equipmentLot', '#equipmentBox', '#equipmentSerial', '#equipmentUA'].forEach(selector => {
      const input = $(selector);
      if (!input) return;
      input.value = '';
      input.classList.remove('field-valid', 'field-invalid');
    });

    const quantity = $('#equipmentQuantity');
    if (quantity) {
      quantity.value = String(MAX_PER_BOX);
      quantity.setAttribute('value', String(MAX_PER_BOX));
      quantity.classList.remove('field-invalid');
    }
    const quantityDisplay = $('#equipmentQuantityDisplay');
    if (quantityDisplay) {
      quantityDisplay.value = '0';
      quantityDisplay.classList.remove('field-valid', 'field-invalid');
    }

    window.EquipmentProcess?.clear?.();
    window.EquipmentRegistry?.setCaptureMode?.('manual');
    window.EquipmentCapacity?.refresh?.();

    const summaryValues = {
      equipmentTotalCount: '0',
      equipmentLotCount: '0',
      equipmentBoxCount: '0',
      equipmentCurrentBoxCount: `0 / ${MAX_PER_BOX}`
    };
    Object.entries(summaryValues).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    const currentLabel = $('#equipmentCurrentBoxLabel');
    if (currentLabel) currentLabel.textContent = 'Sin caja seleccionada';

    const message = $('#equipmentValidationMessage');
    if (message) {
      message.className = 'equipment-validation neutral';
      message.innerHTML = `<span class="equipment-validation-icon">✓</span><div><strong>Nueva sesión lista</strong><small>Define Asignación / Proceso, Lote y Caja. La cantidad se calcula automáticamente con un máximo de ${MAX_PER_BOX} equipos por caja.</small></div>`;
    }

    setTimeout(() => {
      const process = $('#equipmentProcess');
      if (process) process.focus();
      else $('#equipmentLot')?.focus();
    }, 0);
  }

  function clearRegistryRows() {
    const deleteButtons = $$('[data-equipment-delete]');
    if (!deleteButtons.length) return;

    const originalConfirm = window.confirm;
    try {
      window.confirm = () => true;
      deleteButtons.forEach(button => button.click());
    } finally {
      window.confirm = originalConfirm;
    }
  }

  function startNewSession() {
    const rows = window.EquipmentRegistry?.getRows?.() || [];
    const message = rows.length
      ? `Se eliminarán ${rows.length} equipos del registro por caja actual.\n\nTambién se limpiará la Asignación / Proceso actual.\n\nEl Registro operativo y los Matches NO se borrarán.\n\n¿Crear una nueva sesión?`
      : 'Se limpiarán Asignación / Proceso, Lote, Caja, Serial y UA del registrador por caja.\n\nLa cantidad automática seguirá con máximo 64 equipos por caja.\n\n¿Crear una nueva sesión?';

    if (!window.confirm(message)) return;

    clearRegistryRows();
    resetFields();
    window.OperatorSession?.saveNow?.();
    showToast('Nueva sesión', 'Registro por caja reiniciado correctamente.', 'ok');
  }

  function install() {
    const actions = $('.equipment-file-actions');
    if (!actions) return;

    let button = $('#equipmentNewSessionBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'equipmentNewSessionBtn';
      button.type = 'button';
      button.className = 'ghost danger';
      button.textContent = 'Nueva sesión';
      const importButton = $('#equipmentImportBtn');
      actions.insertBefore(button, importButton || actions.firstChild);
    }

    if (button.dataset.newSessionInstalled === '1') return;
    button.dataset.newSessionInstalled = '1';
    button.addEventListener('click', startNewSession);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.EquipmentNewSession = { start: startNewSession, install };
})();