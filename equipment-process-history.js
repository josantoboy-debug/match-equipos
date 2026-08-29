(() => {
  'use strict';

  const MAX_ITEMS = 30;
  const STORAGE_PREFIX = 'matchEquipos.processHistory.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ');

  function operatorId() {
    return window.OperatorSession?.getCurrentOperator?.()?.id || 'default';
  }

  function storageKey() {
    return `${STORAGE_PREFIX}.${operatorId()}`;
  }

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed
        .map(norm)
        .filter(Boolean)
        .filter(value => {
          const key = value.toLocaleUpperCase('es');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_ITEMS);
    } catch {
      return [];
    }
  }

  function writeHistory(items) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(items.slice(0, MAX_ITEMS)));
    } catch (error) {
      console.warn('[equipment-process-history] No se pudo guardar historial', error);
    }
  }

  function saveProcess(value) {
    const clean = norm(value);
    if (!clean) return;
    const key = clean.toLocaleUpperCase('es');
    const next = [
      clean,
      ...readHistory().filter(item => item.toLocaleUpperCase('es') !== key)
    ].slice(0, MAX_ITEMS);
    writeHistory(next);
    renderHistory();
  }

  function removeProcess(value) {
    const key = norm(value).toLocaleUpperCase('es');
    writeHistory(readHistory().filter(item => item.toLocaleUpperCase('es') !== key));
    renderHistory();
  }

  function clearHistory() {
    writeHistory([]);
    renderHistory();
  }

  function selectProcess(value) {
    const input = $('#equipmentProcess');
    if (!input) return;
    input.value = norm(value);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
    window.EquipmentRegistry?.setCurrentProcess?.(input.value);
    saveProcess(input.value);
    closeHistory();
    input.focus();
    input.select?.();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderHistory() {
    const list = $('#equipmentProcessHistoryList');
    const clear = $('#equipmentProcessHistoryClear');
    const count = $('#equipmentProcessHistoryCount');
    if (!list) return;

    const items = readHistory();
    if (count) count.textContent = String(items.length);
    if (clear) clear.disabled = !items.length;

    if (!items.length) {
      list.innerHTML = '<div class="equipment-process-history-empty">Aún no hay procesos guardados.</div>';
      return;
    }

    list.innerHTML = items.map((item, index) => `
      <div class="equipment-process-history-item" data-history-row="${index}">
        <button type="button" class="equipment-process-history-use" data-history-use="${encodeURIComponent(item)}" title="Usar ${escapeHtml(item)}">
          <span>${escapeHtml(item)}</span>
        </button>
        <button type="button" class="equipment-process-history-remove" data-history-remove="${encodeURIComponent(item)}" aria-label="Eliminar ${escapeHtml(item)} del historial" title="Eliminar">×</button>
      </div>`).join('');
  }

  function openHistory() {
    const panel = $('#equipmentProcessHistoryPanel');
    const button = $('#equipmentProcessHistoryBtn');
    if (!panel || !button) return;
    renderHistory();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }

  function closeHistory() {
    const panel = $('#equipmentProcessHistoryPanel');
    const button = $('#equipmentProcessHistoryBtn');
    if (!panel || !button) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function toggleHistory() {
    const panel = $('#equipmentProcessHistoryPanel');
    if (!panel) return;
    if (panel.hidden) openHistory();
    else closeHistory();
  }

  function installStyles() {
    if ($('#equipmentProcessHistoryStyles')) return;
    const style = document.createElement('style');
    style.id = 'equipmentProcessHistoryStyles';
    style.textContent = `
      .equipment-process-history-wrap{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;width:100%}
      .equipment-process-history-btn{height:44px;padding:0 13px;border:1px solid var(--line,#263247);border-radius:10px;background:#101a28;color:var(--text,#edf3fb);font-size:10px;font-weight:800;white-space:nowrap;cursor:pointer}
      .equipment-process-history-btn:hover,.equipment-process-history-btn[aria-expanded="true"]{border-color:#4f8cff;background:#14233a}
      .equipment-process-history-panel{position:absolute;z-index:120;top:calc(100% + 7px);right:0;width:min(420px,100%);max-height:310px;overflow:hidden;border:1px solid var(--line,#263247);border-radius:12px;background:#0d1623;box-shadow:0 16px 45px rgba(0,0,0,.38)}
      .equipment-process-history-panel[hidden]{display:none!important}
      .equipment-process-history-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid var(--line,#263247);font-size:9px;color:#8ea1b8}
      .equipment-process-history-head strong{color:var(--text,#edf3fb);font-size:10px}
      .equipment-process-history-clear{border:0;background:transparent;color:#7da9ff;font-size:9px;font-weight:750;cursor:pointer;padding:4px 6px}
      .equipment-process-history-clear:disabled{opacity:.4;cursor:not-allowed}
      .equipment-process-history-list{max-height:255px;overflow:auto;padding:6px}
      .equipment-process-history-item{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:4px;align-items:stretch}
      .equipment-process-history-use,.equipment-process-history-remove{border:0;background:transparent;color:var(--text,#edf3fb);cursor:pointer}
      .equipment-process-history-use{text-align:left;padding:9px 10px;border-radius:8px;font-size:11px;font-weight:700;overflow:hidden}
      .equipment-process-history-use span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .equipment-process-history-use:hover{background:#152238}
      .equipment-process-history-remove{border-radius:8px;color:#8fa0b5;font-size:17px;line-height:1}
      .equipment-process-history-remove:hover{background:#2a1720;color:#ff8d9b}
      .equipment-process-history-empty{padding:18px 12px;text-align:center;color:#71839a;font-size:10px}
      @media(max-width:700px){.equipment-process-history-wrap{grid-template-columns:1fr}.equipment-process-history-btn{width:100%}.equipment-process-history-panel{left:0;right:auto;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function installUi() {
    const input = $('#equipmentProcess');
    if (!input) return false;
    if ($('#equipmentProcessHistoryWrap')) return true;

    const parent = input.parentNode;
    if (!parent) return false;

    const wrap = document.createElement('div');
    wrap.id = 'equipmentProcessHistoryWrap';
    wrap.className = 'equipment-process-history-wrap';
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const button = document.createElement('button');
    button.id = 'equipmentProcessHistoryBtn';
    button.type = 'button';
    button.className = 'equipment-process-history-btn';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'equipmentProcessHistoryPanel');
    button.textContent = 'Historial ▾';
    wrap.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'equipmentProcessHistoryPanel';
    panel.className = 'equipment-process-history-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="equipment-process-history-head">
        <strong>Procesos recientes <span id="equipmentProcessHistoryCount">0</span></strong>
        <button id="equipmentProcessHistoryClear" class="equipment-process-history-clear" type="button">Limpiar historial</button>
      </div>
      <div id="equipmentProcessHistoryList" class="equipment-process-history-list"></div>`;
    wrap.appendChild(panel);

    renderHistory();
    return true;
  }

  function installEvents() {
    const input = $('#equipmentProcess');
    const button = $('#equipmentProcessHistoryBtn');
    const panel = $('#equipmentProcessHistoryPanel');
    if (!input || !button || !panel || button.dataset.historyBound === '1') return;
    button.dataset.historyBound = '1';

    button.addEventListener('click', event => {
      event.stopPropagation();
      toggleHistory();
    });

    panel.addEventListener('click', event => {
      event.stopPropagation();
      const use = event.target.closest('[data-history-use]');
      if (use) {
        selectProcess(decodeURIComponent(use.dataset.historyUse || ''));
        return;
      }
      const remove = event.target.closest('[data-history-remove]');
      if (remove) {
        removeProcess(decodeURIComponent(remove.dataset.historyRemove || ''));
      }
    });

    $('#equipmentProcessHistoryClear')?.addEventListener('click', event => {
      event.stopPropagation();
      if (!readHistory().length) return;
      if (confirm('¿Limpiar todo el historial de Asignación / Proceso de este operador?')) clearHistory();
    });

    input.addEventListener('blur', () => saveProcess(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') saveProcess(input.value);
      if (event.key === 'ArrowDown' && event.altKey) {
        event.preventDefault();
        openHistory();
      }
    });

    $('#equipmentAddBtn')?.addEventListener('click', () => saveProcess(input.value), true);
    $('#equipmentImportFile')?.addEventListener('change', () => saveProcess(input.value), true);

    document.addEventListener('click', event => {
      if (!event.target.closest('#equipmentProcessHistoryWrap')) closeHistory();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeHistory();
    });

    document.addEventListener('operator:login', () => {
      closeHistory();
      renderHistory();
    });
  }

  function install() {
    installStyles();
    if (!installUi()) {
      setTimeout(install, 40);
      return;
    }
    installEvents();
    renderHistory();

    window.EquipmentProcessHistory = {
      getAll: () => [...readHistory()],
      add: value => saveProcess(value),
      remove: value => removeProcess(value),
      clear: clearHistory,
      open: openHistory,
      close: closeHistory
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
