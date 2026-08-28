(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  function ensureStyles() {
    if ($('#operationalMenuStyles')) return;
    const style = document.createElement('style');
    style.id = 'operationalMenuStyles';
    style.textContent = `
      .operational-actions{position:relative;max-width:none!important}
      .operational-actions > .mini-badge,
      .operational-actions > #newSessionBtn,
      .operational-actions > #importBtn,
      .operational-actions > .global-export-group,
      .operational-actions > #exportMatchesTxtBtn,
      .operational-actions > #exportBtn{display:none!important}
      .op-menu-wrap{position:relative;margin-left:auto}
      .op-menu-trigger{width:36px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:transparent;color:#c9d4e2;font-size:20px;line-height:1;cursor:pointer}
      .op-menu-trigger:hover,.op-menu-trigger[aria-expanded="true"]{background:#162132;border-color:#426aa3;color:#fff}
      .op-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:60;width:210px;padding:7px;border:1px solid var(--line2);border-radius:12px;background:#0d1520;box-shadow:0 18px 45px rgba(0,0,0,.45)}
      .op-menu[hidden]{display:none!important}
      .op-menu button{width:100%;border:0;border-radius:8px;background:transparent;color:#dbe7f4;text-align:left;padding:10px 11px;font-size:10px;font-weight:750;cursor:pointer}
      .op-menu button:hover{background:#182538}
      .op-menu .danger{color:#fca5a5}
      .op-menu-divider{height:1px;background:var(--line);margin:5px 2px}
      .op-export-panel{display:grid;gap:5px;padding:4px 0 1px}
      .op-export-panel[hidden]{display:none!important}
      .op-export-title{padding:4px 11px 2px;color:#7f91a8;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .op-format-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .op-format-grid button{text-align:center;border:1px solid #2b3a50;background:#101a28;padding:9px 6px}
      .op-format-grid button:hover{border-color:#4f8cff;background:#17315a}
      @media(max-width:900px){.op-menu{right:-4px;width:200px}}
    `;
    document.head.appendChild(style);
  }

  function closeMenu() {
    const menu = $('#operationalMenu');
    const trigger = $('#operationalMenuBtn');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    $('#operationalExportPanel')?.setAttribute('hidden', '');
  }

  function runExport(format) {
    const selector = $('#globalExportFormat');
    if (!selector || !window.UnifiedExport?.run) {
      console.error('[operational-menu] Exportador unificado no disponible');
      return;
    }
    selector.value = format;
    closeMenu();
    window.UnifiedExport.run();
  }

  function createMenu() {
    const actions = $('.register-panel-head .operational-actions');
    if (!actions || $('#operationalMenuBtn')) return !!actions;

    ensureStyles();

    const wrap = document.createElement('div');
    wrap.className = 'op-menu-wrap';
    wrap.innerHTML = `
      <button id="operationalMenuBtn" class="op-menu-trigger" type="button" aria-label="Abrir acciones" aria-haspopup="menu" aria-expanded="false">⋯</button>
      <div id="operationalMenu" class="op-menu" role="menu" hidden>
        <button type="button" data-op-action="new" class="danger">Nueva sesión</button>
        <button type="button" data-op-action="import">Importar archivo</button>
        <button type="button" data-op-action="export">Exportar</button>
        <div id="operationalExportPanel" class="op-export-panel" hidden>
          <div class="op-menu-divider"></div>
          <div class="op-export-title">Selecciona formato</div>
          <div class="op-format-grid">
            <button type="button" data-export-format="xlsx">XLSX</button>
            <button type="button" data-export-format="txt">TXT</button>
            <button type="button" data-export-format="csv">CSV</button>
            <button type="button" data-export-format="json">JSON</button>
          </div>
        </div>
      </div>`;
    actions.appendChild(wrap);

    const trigger = $('#operationalMenuBtn');
    const menu = $('#operationalMenu');
    const exportPanel = $('#operationalExportPanel');

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
      if (!willOpen) exportPanel.hidden = true;
    });

    menu.addEventListener('click', event => {
      event.stopPropagation();
      const action = event.target.closest('[data-op-action]')?.dataset.opAction;
      const format = event.target.closest('[data-export-format]')?.dataset.exportFormat;

      if (format) {
        runExport(format);
        return;
      }
      if (action === 'new') {
        closeMenu();
        $('#newSessionBtn')?.click();
      } else if (action === 'import') {
        closeMenu();
        $('#importBtn')?.click();
      } else if (action === 'export') {
        exportPanel.hidden = !exportPanel.hidden;
      }
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });

    return true;
  }

  function boot() {
    if (!createMenu()) setTimeout(createMenu, 120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.OperationalMenu = {close: closeMenu, runExport};
})();