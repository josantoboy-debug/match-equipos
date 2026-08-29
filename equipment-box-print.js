(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MAX_PER_BOX = 64;
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const upper = value => norm(value).toUpperCase();

  let lastRowCount = 0;
  let lastCompleted = null;
  let observer = null;
  let busy = false;
  const autoPrinted = new Set();

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4400);
  }

  function getRows() {
    const rows = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(rows) ? rows : [];
  }

  function targetQuantity() {
    const raw = String($('#equipmentQuantity')?.value || '').trim();
    const parsed = /^\d+$/.test(raw) ? Number(raw) : MAX_PER_BOX;
    if (!Number.isSafeInteger(parsed) || parsed < 1) return MAX_PER_BOX;
    return Math.min(parsed, MAX_PER_BOX);
  }

  function rowsInBox(lot, box) {
    if (!norm(lot) || !norm(box)) return [];
    return getRows().filter(row => upper(row.lot) === upper(lot) && upper(row.box) === upper(box));
  }

  function operatorName() {
    return norm(window.OperatorSession?.getCurrentOperator?.()?.name);
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

  function processForBox(boxRows) {
    const values = [...new Set(boxRows.map(row => norm(row.process)).filter(Boolean))];
    if (values.length) return values.join(' / ');
    return norm(window.EquipmentProcess?.getCurrent?.());
  }

  function completionDate(boxRows) {
    const latest = boxRows
      .map(row => ({row, time: new Date(row.at || 0).getTime()}))
      .sort((a, b) => a.time - b.time)
      .at(-1)?.row;
    const date = latest?.at ? new Date(latest.at) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function completionKey(lot, box, cap, boxRows) {
    const last = boxRows.at(-1);
    const token = norm(last?.id || last?.serial || last?.at || boxRows.length);
    return `${upper(lot)}\u0000${upper(box)}\u0000${cap}\u0000${upper(token)}`;
  }

  function buildCompletedSnapshot(lot, box, cap = targetQuantity(), mode = printMode()) {
    if (!norm(lot) || !norm(box) || !cap) return null;
    const boxRows = rowsInBox(lot, box);
    if (boxRows.length < cap) return null;
    const completedAt = completionDate(boxRows);
    return {
      key: completionKey(lot, box, cap, boxRows),
      lot: norm(lot),
      box: norm(box),
      count: boxRows.length,
      capacity: cap,
      process: processForBox(boxRows),
      operator: operatorName(),
      printMode: mode,
      completedAt: completedAt.toISOString()
    };
  }

  function buildManualSnapshot() {
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    const cap = targetQuantity();
    const boxRows = rowsInBox(lot, box);
    const now = new Date();
    return {
      key: completionKey(lot || 'MANUAL', box || 'SIN-CAJA', cap, boxRows),
      lot,
      box,
      count: boxRows.length,
      capacity: cap,
      process: processForBox(boxRows),
      operator: operatorName(),
      printMode: 'manual',
      completedAt: now.toISOString()
    };
  }

  function findLatestCompleteBox() {
    const cap = targetQuantity();
    const groups = new Map();
    getRows().forEach(row => {
      const key = `${upper(row.lot)}\u0000${upper(row.box)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    let best = null;
    groups.forEach(group => {
      if (group.length < cap) return;
      const snapshot = buildCompletedSnapshot(group[0]?.lot, group[0]?.box, cap);
      if (!snapshot) return;
      if (!best || new Date(snapshot.completedAt).getTime() > new Date(best.completedAt).getTime()) best = snapshot;
    });
    return best;
  }

  function updateModeLabels() {
    const select = $('#equipmentPrintMode');
    if (!select) return;
    const manual = select.querySelector('option[value="manual"]');
    const automatic = select.querySelector('option[value="automatic"]');
    if (manual) manual.textContent = 'Manual · imprimir con botón';
    if (automatic) automatic.textContent = `Automática · al completar ${targetQuantity()}`;
  }

  function updateControls() {
    const button = $('#equipmentPrintBtn');
    const select = $('#equipmentPrintMode');
    if (!button || !select) return;

    updateModeLabels();
    if (!lastCompleted) lastCompleted = findLatestCompleteBox();

    // El botón queda disponible para impresión manual o reimpresión en ambos modos.
    button.disabled = false;
    const currentBox = norm($('#equipmentBox')?.value);
    const printableBox = currentBox || lastCompleted?.box || '';
    button.textContent = printableBox ? `Imprimir caja ${printableBox}` : 'Imprimir caja';
    button.title = printMode() === 'automatic'
      ? `Automático: imprime al llegar a ${targetQuantity()} equipos. Este botón permite reimpresión manual.`
      : 'Manual: no imprime automáticamente; usa este botón cuando quieras imprimir.';
    select.title = `Modo de impresión: ${modeLabel()}`;
  }

  function restoreMode() {
    const select = $('#equipmentPrintMode');
    if (!select) return;
    try {
      select.value = localStorage.getItem(operatorStorageKey()) === 'automatic' ? 'automatic' : 'manual';
    } catch {
      select.value = 'manual';
    }
    updateControls();
  }

  function printHtml(data) {
    const date = new Date(data.completedAt || Date.now());
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const dateText = safeDate.toLocaleDateString('es-PA');
    const timeText = safeDate.toLocaleTimeString('es-PA', {hour:'2-digit', minute:'2-digit', second:'2-digit'});

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${data.box ? `Caja ${escapeHtml(data.box)}` : 'Registro de caja'}</title>
<style>
  @page{size:2.5in 2in;margin:0}
  *{box-sizing:border-box}
  html,body{width:2.5in;height:2in;margin:0;padding:0;background:#fff;color:#000}
  body{font-family:Arial,Helvetica,sans-serif}
  .label{width:2.5in;height:2in;padding:.10in .12in;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start}
  h1{margin:0 0 .045in;text-align:center;font-size:12pt;line-height:1;font-weight:800;letter-spacing:.2px}
  .process{text-align:center;margin:0 0 .055in;line-height:1.05}
  .caption{display:block;font-size:5.8pt;line-height:1.05;font-weight:700;text-transform:uppercase;letter-spacing:.25px}
  .process strong{display:block;margin-top:.018in;min-height:10.5pt;font-size:10pt;line-height:1.05;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .data{display:grid;grid-template-columns:1.45fr .55fr;column-gap:.10in;row-gap:.045in;align-items:start}
  .item{min-width:0}
  .item strong{display:block;margin-top:.012in;min-height:9pt;font-size:8.5pt;line-height:1.05;font-weight:800;overflow-wrap:anywhere}
  .item.operator{grid-column:1/-1}
  .item.operator strong{font-size:8pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .date-time{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;column-gap:.10in}
  @media print{
    html,body,.label{width:2.5in;height:2in}
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  }
</style></head><body>
<section class="label">
  <h1>REGISTRO DE CAJA</h1>
  <div class="process"><span class="caption">Asignación / Proceso</span><strong>${escapeHtml(data.process || '')}</strong></div>
  <div class="data">
    <div class="item"><span class="caption">Lote</span><strong>${escapeHtml(data.lot || '')}</strong></div>
    <div class="item"><span class="caption">Caja</span><strong>${escapeHtml(data.box || '')}</strong></div>
    <div class="item"><span class="caption">N.º de equipos</span><strong>${Number.isFinite(Number(data.count)) ? Number(data.count) : 0}</strong></div>
    <div class="item"></div>
    <div class="date-time">
      <div class="item"><span class="caption">Fecha</span><strong>${escapeHtml(dateText)}</strong></div>
      <div class="item"><span class="caption">Hora</span><strong>${escapeHtml(timeText)}</strong></div>
    </div>
    <div class="item operator"><span class="caption">Operador</span><strong>${escapeHtml(data.operator || '')}</strong></div>
  </div>
</section>
</body></html>`;
  }

  function openPrint(data, source = 'manual') {
    const printable = data || buildManualSnapshot();
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
    doc.write(printHtml(printable));
    doc.close();

    const cleanup = () => setTimeout(() => iframe.remove(), 300);
    try {
      iframe.contentWindow?.addEventListener('afterprint', cleanup, {once:true});
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          if (source === 'automatic') autoPrinted.add(printable.key);
        } catch (error) {
          console.error('[equipment-box-print]', error);
          showToast('Impresión automática bloqueada', 'El navegador no permitió abrir impresión automáticamente. Usa Imprimir caja.', 'warn');
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

  function completedFromNewest(newest) {
    const cap = targetQuantity();
    if (!newest || !cap) return null;
    // Las importaciones/restauraciones no deben lanzar impresiones inesperadas.
    if (!/^Captura /i.test(String(newest.origin || ''))) return null;
    const boxRows = rowsInBox(newest.lot, newest.box);
    if (boxRows.length !== cap) return null;
    return buildCompletedSnapshot(newest.lot, newest.box, cap, printMode());
  }

  function triggerAutomaticPrint(completed) {
    if (!completed || printMode() !== 'automatic' || autoPrinted.has(completed.key)) return false;
    autoPrinted.add(completed.key);
    showToast(
      'Caja completa · impresión automática',
      `Caja ${completed.box}: ${completed.count}/${completed.capacity} equipos. Abriendo tiquete automáticamente.`,
      'ok'
    );
    const opened = openPrint({...completed, printMode:'automatic'}, 'automatic');
    if (!opened) autoPrinted.delete(completed.key);
    return opened;
  }

  function checkCurrentBoxOnModeChange() {
    if (printMode() !== 'automatic') return;
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!lot || !box) return;
    const rows = rowsInBox(lot, box);
    if (rows.length !== targetQuantity()) return;
    const completed = buildCompletedSnapshot(lot, box, targetQuantity(), 'automatic');
    if (completed) {
      lastCompleted = completed;
      triggerAutomaticPrint(completed);
    }
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
          const newest = rows.at(-1);
          const completed = completedFromNewest(newest);
          if (completed) {
            lastCompleted = completed;
            document.dispatchEvent(new CustomEvent('equipment:box-complete', {detail:{...completed}}));

            if (printMode() === 'automatic') {
              triggerAutomaticPrint(completed);
            } else {
              // MODO MANUAL: jamás se imprime solo.
              showToast(
                'Caja completa',
                `Caja ${completed.box}: ${completed.count}/${completed.capacity} equipos. Pulsa Imprimir caja cuando quieras.`,
                'ok'
              );
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
      #equipmentPrintMode{min-width:205px}
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
    updateModeLabels();
    restoreMode();
    lastRowCount = getRows().length;

    select.addEventListener('change', () => {
      saveMode();
      updateControls();
      if (printMode() === 'automatic') {
        showToast('Impresión automática activada', `El tiquete se abrirá automáticamente al llegar a ${targetQuantity()} equipos.`, 'ok');
        setTimeout(checkCurrentBoxOnModeChange, 0);
      } else {
        showToast('Impresión manual activada', 'Nada se imprimirá solo. Usa Imprimir caja cuando quieras.', 'ok');
      }
    });

    button.addEventListener('click', () => {
      // Siempre es una acción manual/reimpresión: imprime el contexto actual,
      // aunque haya campos vacíos o la caja no esté completa.
      openPrint(buildManualSnapshot(), 'manual');
    });

    ['#equipmentQuantity', '#equipmentLot', '#equipmentBox', '#equipmentProcess'].forEach(selector => {
      $(selector)?.addEventListener('input', updateControls);
    });

    document.addEventListener('operator:login', restoreMode);

    if (!observer) {
      observer = new MutationObserver(afterRegistryChanged);
      observer.observe(body, {childList:true, subtree:true});
    }

    updateControls();
    window.EquipmentBoxPrint = {
      printLast: () => openPrint(buildManualSnapshot(), 'manual'),
      getLastCompleted: () => lastCompleted ? {...lastCompleted} : null,
      getMode: printMode,
      setMode: mode => {
        select.value = mode === 'automatic' ? 'automatic' : 'manual';
        saveMode();
        updateControls();
        if (select.value === 'automatic') setTimeout(checkCurrentBoxOnModeChange, 0);
      },
      buildManualSnapshot,
      checkCurrentBoxOnModeChange
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();