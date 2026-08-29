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
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function getRows() {
    const rows = window.EquipmentRegistry?.getRows?.();
    return Array.isArray(rows) ? rows : [];
  }

  function quantity() {
    const raw = String($('#equipmentQuantity')?.value || '').trim();
    if (!/^\d+$/.test(raw)) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PER_BOX ? n : 0;
  }

  function boxKey(lot, box, cap) {
    return `${upper(lot)}\u0000${upper(box)}\u0000${cap}`;
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
      printMode: mode,
      completedAt: completedAt.toISOString()
    };
  }

  function currentReadySnapshot() {
    const cap = quantity();
    const lot = norm($('#equipmentLot')?.value);
    const box = norm($('#equipmentBox')?.value);
    if (!cap || !lot || !box) return null;
    return buildSnapshot(lot, box, cap, printMode());
  }

  function findLatestCompleteBox() {
    const cap = quantity();
    if (!cap) return null;
    const groups = new Map();
    getRows().forEach(row => {
      const key = `${upper(row.lot)}\u0000${upper(row.box)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    let best = null;
    groups.forEach(group => {
      if (group.length < cap) return;
      const snapshot = buildSnapshot(group[0]?.lot, group[0]?.box, cap);
      if (!snapshot) return;
      if (!best || new Date(snapshot.completedAt).getTime() > new Date(best.completedAt).getTime()) best = snapshot;
    });
    return best;
  }

  function updateControls() {
    const button = $('#equipmentPrintBtn');
    const select = $('#equipmentPrintMode');
    if (!button || !select) return;

    const cap = quantity();
    const current = currentReadySnapshot();
    const ready = current || lastCompleted || findLatestCompleteBox();
    if (ready) lastCompleted = ready;

    button.disabled = !cap || !ready;
    button.textContent = ready?.box ? `Imprimir caja ${ready.box}` : 'Imprimir caja';
    button.title = !cap
      ? `Asigna una CANTIDAD entre 1 y ${MAX_PER_BOX}.`
      : ready
        ? `Caja ${ready.box}: ${ready.count}/${cap}. Lista para impresión manual.`
        : `Se habilita cuando la caja alcance ${cap}/${cap} equipos.`;

    const optionAuto = select.querySelector('option[value="automatic"]');
    const optionManual = select.querySelector('option[value="manual"]');
    if (optionAuto) optionAuto.textContent = cap ? `Automática · al completar ${cap}` : 'Automática · según CANTIDAD';
    if (optionManual) optionManual.textContent = cap ? `Manual · habilitar al ${cap}/${cap}` : 'Manual · según CANTIDAD';
    select.title = `Modo de impresión: ${modeLabel()} · depende de CANTIDAD asignada.`;
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
    if (!data) {
      const cap = quantity();
      showToast('Caja todavía no lista', cap ? `Completa ${cap}/${cap} equipos antes de imprimir.` : 'Asigna primero la CANTIDAD de equipos.', 'warn');
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
              showToast('Cantidad completada', `Caja ${completed.box}: ${completed.count}/${completed.capacity}. Abriendo impresión automática.`, 'ok');
              openPrint({...completed, printMode:'automatic'}, 'automatic');
            } else {
              showToast('Caja lista para imprimir', `Caja ${completed.box}: ${completed.count}/${completed.capacity}. Pulsa Imprimir caja.`, 'ok');
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
      #equipmentPrintMode{min-width:175px}
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
      const cap = quantity();
      showToast('Modo de impresión', cap
        ? `${modeLabel()} · se considera completa al llegar a ${cap}/${cap}.`
        : `${modeLabel()} · asigna primero la CANTIDAD.`, 'ok');
    });

    button.addEventListener('click', () => {
      const data = currentReadySnapshot() || lastCompleted || findLatestCompleteBox();
      if (!data) {
        openPrint(null, 'manual');
        return;
      }
      openPrint({...data, printMode:'manual', operator:operatorName()}, 'manual');
    });

    ['#equipmentQuantity', '#equipmentLot', '#equipmentBox', '#equipmentProcess'].forEach(selector => {
      $(selector)?.addEventListener('input', () => {
        lastCompleted = currentReadySnapshot() || findLatestCompleteBox();
        updateControls();
      });
    });

    document.addEventListener('operator:login', restoreMode);

    if (!observer) {
      observer = new MutationObserver(afterRegistryChanged);
      observer.observe(body, {childList:true, subtree:true});
    }

    updateControls();
    window.EquipmentBoxPrint = {
      printLast: () => openPrint(currentReadySnapshot() || lastCompleted || findLatestCompleteBox(), 'manual'),
      getLastCompleted: () => lastCompleted ? {...lastCompleted} : null,
      getMode: printMode,
      setMode: mode => {
        select.value = mode === 'automatic' ? 'automatic' : 'manual';
        saveMode();
        updateControls();
      },
      refresh: updateControls
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();