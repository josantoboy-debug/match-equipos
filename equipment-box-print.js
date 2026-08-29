(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const upper = value => norm(value).toUpperCase();

  let lastRowCount = 0;
  let lastCompleted = null;
  let observer = null;
  let busy = false;
  const autoPrinted = new Set();

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
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

  function quantity() {
    const raw = String($('#equipmentQuantity')?.value || '').trim();
    if (!/^\d+$/.test(raw)) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }

  function boxKey(lot, box, cap) {
    return `${upper(lot)}\u0000${upper(box)}\u0000${cap}`;
  }

  function rowsInBox(lot, box) {
    return getRows().filter(row => upper(row.lot) === upper(lot) && upper(row.box) === upper(box));
  }

  function operatorName() {
    return window.OperatorSession?.getCurrentOperator?.()?.name || 'Sin operador';
  }

  function printMode() {
    return $('#equipmentPrintMode')?.value === 'automatic' ? 'automatic' : 'manual';
  }

  function modeLabel(mode = printMode()) {
    return mode === 'automatic' ? 'AUTOMÁTICA' : 'MANUAL';
  }

  function operatorStorageKey() {
    const id = window.OperatorSession?.getCurrentOperator?.()?.id || 'default';
    return `matchEquipos.boxPrintMode.${id}`;
  }

  function saveMode() {
    try { localStorage.setItem(operatorStorageKey(), printMode()); } catch {}
  }

  function restoreMode() {
    const select = $('#equipmentPrintMode');
    if (!select) return;
    try {
      const saved = localStorage.getItem(operatorStorageKey());
      select.value = saved === 'automatic' ? 'automatic' : 'manual';
    } catch {
      select.value = 'manual';
    }
    updateControls();
  }

  function processForBox(boxRows) {
    const values = [...new Set(boxRows.map(row => norm(row.process)).filter(Boolean))];
    if (values.length) return values.join(' / ');
    return norm(window.EquipmentProcess?.getCurrent?.()) || 'Sin asignación';
  }

  function registrationMode(boxRows) {
    const values = new Set();
    boxRows.forEach(row => {
      const origin = String(row.origin || '');
      if (/autom[aá]tica/i.test(origin)) values.add('AUTOMÁTICO');
      else if (/manual/i.test(origin)) values.add('MANUAL');
      else if (/import/i.test(origin)) values.add('IMPORTADO');
    });
    if (!values.size) return 'NO IDENTIFICADO';
    return values.size === 1 ? [...values][0] : 'MIXTO';
  }

  function completionDate(boxRows) {
    const latest = boxRows
      .map(row => ({row, time: new Date(row.at || 0).getTime()}))
      .sort((a, b) => a.time - b.time)
      .at(-1)?.row;
    const date = latest?.at ? new Date(latest.at) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function buildSnapshot(lot, box, cap, mode = printMode()) {
    if (!lot || !box || !cap) return null;
    const boxRows = rowsInBox(lot, box);
    if (boxRows.length < cap) return null;
    const completedAt = completionDate(boxRows);
    return {
      key: boxKey(lot, box, cap),
      lot: norm(lot),
      box: norm(box),
      count: boxRows.length,
      capacity: cap,
      process: processForBox(boxRows),
      operator: operatorName(),
      registrationMode: registrationMode(boxRows),
      printMode: mode,
      completedAt: completedAt.toISOString(),
      serials: boxRows.map(row => norm(row.serial)).filter(Boolean)
    };
  }

  function findLatestCompleteBox() {
    const cap = quantity();
    if (!cap) return null;
    const rows = getRows();
    const groups = new Map();
    rows.forEach(row => {
      const key = `${upper(row.lot)}\u0000${upper(row.box)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    let best = null;
    groups.forEach(group => {
      if (group.length < cap) return;
      const snapshot = buildSnapshot(group[0]?.lot, group[0]?.box, cap);
      if (!snapshot) return;
      const time = new Date(snapshot.completedAt).getTime();
      if (!best || time > new Date(best.completedAt).getTime()) best = snapshot;
    });
    return best;
  }

  function updateControls() {
    const button = $('#equipmentPrintBtn');
    const select = $('#equipmentPrintMode');
    if (!button || !select) return;

    if (!lastCompleted) lastCompleted = findLatestCompleteBox();
    const ready = !!lastCompleted;
    button.disabled = !ready;
    button.textContent = ready ? `Imprimir caja ${lastCompleted.box}` : 'Imprimir caja';
    button.title = ready
      ? `Caja ${lastCompleted.box} completa · ${lastCompleted.count}/${lastCompleted.capacity} equipos`
      : 'Se habilita cuando una caja alcanza la cantidad asignada.';
    select.title = `Modo de impresión: ${modeLabel()}`;
  }

  function printHtml(data) {
    const date = new Date(data.completedAt);
    const dateText = date.toLocaleDateString('es-PA');
    const timeText = date.toLocaleTimeString('es-PA', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const serialList = data.serials.length
      ? `<div class="serials"><span>Seriales registrados</span><div>${data.serials.map(escapeHtml).join(' · ')}</div></div>`
      : '';

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Caja ${escapeHtml(data.box)}</title>
<style>
  @page{margin:7mm}
  *{box-sizing:border-box}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
  .ticket{width:80mm;max-width:100%;margin:0 auto;border:1.5px solid #000;padding:5mm}
  h1{font-size:17px;margin:0 0 2px;text-align:center;letter-spacing:.5px}
  .sub{font-size:10px;text-align:center;margin-bottom:5mm}
  .process{border:1px solid #000;padding:3mm;margin-bottom:4mm;text-align:center}
  .process span,.item span,.serials span{display:block;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
  .process strong{display:block;font-size:14px;margin-top:1mm}
  .grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #000;border-left:1px solid #000}
  .item{min-height:16mm;padding:3mm;border-right:1px solid #000;border-bottom:1px solid #000}
  .item strong{display:block;font-size:14px;margin-top:1.5mm;overflow-wrap:anywhere}
  .item.wide{grid-column:1/-1}
  .serials{margin-top:4mm;padding-top:3mm;border-top:1px dashed #000;font-size:8px;line-height:1.45;overflow-wrap:anywhere}
  .foot{margin-top:4mm;text-align:center;font-size:8px}
  @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.ticket{border:1.5px solid #000}}
</style></head><body>
<section class="ticket">
  <h1>REGISTRO DE CAJA</h1>
  <div class="sub">Cierre de caja por cantidad completada</div>
  <div class="process"><span>Asignación / Proceso</span><strong>${escapeHtml(data.process)}</strong></div>
  <div class="grid">
    <div class="item"><span>Lote</span><strong>${escapeHtml(data.lot)}</strong></div>
    <div class="item"><span>Caja</span><strong>${escapeHtml(data.box)}</strong></div>
    <div class="item"><span>N.º de equipos</span><strong>${data.count}</strong></div>
    <div class="item"><span>Cantidad asignada</span><strong>${data.capacity}</strong></div>
    <div class="item"><span>Fecha</span><strong>${escapeHtml(dateText)}</strong></div>
    <div class="item"><span>Hora</span><strong>${escapeHtml(timeText)}</strong></div>
    <div class="item wide"><span>Operador</span><strong>${escapeHtml(data.operator)}</strong></div>
    <div class="item"><span>Modo de registro</span><strong>${escapeHtml(data.registrationMode)}</strong></div>
    <div class="item"><span>Impresión</span><strong>${modeLabel(data.printMode)}</strong></div>
  </div>
  ${serialList}
  <div class="foot">REGISTRO Y VERIFICACION · Caja completada ${data.count}/${data.capacity}</div>
</section>
</body></html>`;
  }

  function openPrint(data, source = 'manual') {
    if (!data) {
      showToast('Caja no lista', 'Completa la cantidad asignada antes de imprimir.', 'warn');
      return false;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      showToast('No se pudo imprimir', 'El navegador bloqueó la vista de impresión.', 'error');
      return false;
    }

    doc.open();
    doc.write(printHtml(data));
    doc.close();

    const cleanup = () => setTimeout(() => iframe.remove(), 300);
    try {
      iframe.contentWindow?.addEventListener('afterprint', cleanup, {once:true});
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          if (source === 'automatic') autoPrinted.add(data.key);
        } catch (error) {
          console.error('[equipment-box-print]', error);
          showToast('Impresión bloqueada', 'Usa el botón Imprimir caja para abrirla manualmente.', 'warn');
          cleanup();
        }
      }, 120);
      setTimeout(() => { if (iframe.isConnected) iframe.remove(); }, 60000);
      return true;
    } catch (error) {
      console.error('[equipment-box-print]', error);
      iframe.remove();
      return false;
    }
  }

  function completeFromNewest(newest) {
    const cap = quantity();
    if (!newest || !cap) return null;
    if (!/^Captura /i.test(String(newest.origin || ''))) return null;
    const boxRows = rowsInBox(newest.lot, newest.box);
    if (boxRows.length !== cap) return null;
    return buildSnapshot(newest.lot, newest.box, cap, printMode());
  }

  function afterRegistryChanged() {
    if (busy) return;
    busy = true;
    requestAnimationFrame(() => {
      try {
        const rows = getRows();
        const previous = lastRowCount;
        lastRowCount = rows.length;

        if (!rows.length) {
          lastCompleted = null;
          updateControls();
          return;
        }

        if (rows.length > previous) {
          const newest = rows[rows.length - 1];
          const completed = completeFromNewest(newest);
          if (completed) {
            lastCompleted = completed;
            updateControls();
            document.dispatchEvent(new CustomEvent('equipment:box-complete', {detail:{...completed}}));

            if (printMode() === 'automatic' && !autoPrinted.has(completed.key)) {
              showToast('Caja completa', `Caja ${completed.box}: ${completed.count}/${completed.capacity}. Abriendo impresión automática.`, 'ok');
              openPrint({...completed, printMode:'automatic'}, 'automatic');
            } else {
              showToast('Caja lista para imprimir', `Caja ${completed.box}: ${completed.count}/${completed.capacity} equipos.`, 'ok');
            }
          }
        }
        updateControls();
      } finally {
        busy = false;
      }
    });
  }

  function installStyles() {
    if ($('#equipmentBoxPrintStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentBoxPrintStyles';
    style.textContent = `
      #equipmentPrintMode{min-width:150px}
      #equipmentPrintBtn{white-space:nowrap}
      #equipmentPrintBtn:disabled{opacity:.48;cursor:not-allowed}
      @media(max-width:900px){#equipmentPrintMode,#equipmentPrintBtn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    const select = $('#equipmentPrintMode');
    const button = $('#equipmentPrintBtn');
    const body = $('#equipmentRegisterBody');
    if (!select || !button || !body || !window.EquipmentRegistry) {
      setTimeout(install, 40);
      return;
    }

    installStyles();
    restoreMode();
    lastRowCount = getRows().length;

    select.addEventListener('change', () => {
      saveMode();
      updateControls();
      showToast('Modo de impresión', `Impresión ${modeLabel().toLowerCase()} seleccionada.`, 'ok');
    });

    button.addEventListener('click', () => {
      const data = lastCompleted || findLatestCompleteBox();
      if (!data) {
        showToast('Caja no completa', 'El botón se habilita cuando la caja alcanza la cantidad asignada.', 'warn');
        return;
      }
      lastCompleted = {...data, printMode: printMode(), operator: operatorName()};
      openPrint(lastCompleted, 'manual');
    });

    $('#equipmentQuantity')?.addEventListener('input', () => {
      lastCompleted = findLatestCompleteBox();
      updateControls();
    });

    document.addEventListener('operator:login', restoreMode);

    if (!observer) {
      observer = new MutationObserver(afterRegistryChanged);
      observer.observe(body, {childList:true, subtree:true});
    }

    updateControls();
    window.EquipmentBoxPrint = {
      printLast: () => openPrint(lastCompleted || findLatestCompleteBox(), 'manual'),
      getLastCompleted: () => lastCompleted ? {...lastCompleted} : null,
      getMode: printMode,
      setMode: mode => {
        select.value = mode === 'automatic' ? 'automatic' : 'manual';
        saveMode();
        updateControls();
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();