(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function resetFields() {
    ['#equipmentLot', '#equipmentBox', '#equipmentQuantity', '#equipmentSerial', '#equipmentUA'].forEach(selector => {
      const input = $(selector);
      if (!input) return;
      input.value = '';
      input.classList.remove('field-valid', 'field-invalid');
    });

    window.EquipmentRegistry?.setCaptureMode?.('manual');

    const summaryValues = {
      equipmentTotalCount: '0',
      equipmentLotCount: '0',
      equipmentBoxCount: '0',
      equipmentCurrentBoxCount: '0'
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
      message.innerHTML = '<span class="equipment-validation-icon">✓</span><div><strong>Nueva sesión lista</strong><small>Define Lote, Caja y Cantidad para comenzar un nuevo registro.</small></div>';
    }

    setTimeout(() => $('#equipmentLot')?.focus(), 0);
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
      ? `Se eliminarán ${rows.length} equipos del registro por caja actual.\n\nEl Registro operativo y los Matches NO se borrarán.\n\n¿Crear una nueva sesión?`
      : 'Se limpiarán Lote, Caja, Cantidad, Serial y UA del registrador por caja.\n\n¿Crear una nueva sesión?';

    if (!window.confirm(message)) return;

    clearRegistryRows();
    resetFields();
    window.OperatorSession?.saveNow?.();
    showToast('Nueva sesión', 'Registro por caja reiniciado correctamente.', 'ok');
  }

  function install() {
    const button = $('#equipmentNewSessionBtn');
    if (!button || button.dataset.newSessionInstalled === '1') return;
    button.dataset.newSessionInstalled = '1';
    button.addEventListener('click', startNewSession);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.EquipmentNewSession = { start: startNewSession };
})();