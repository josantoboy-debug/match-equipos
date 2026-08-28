(() => {
  'use strict';

  const APP_KEY = 'matchEquipos.operatorAccess.v1';
  const SESSION_KEY = 'matchEquipos.activeOperator.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let activeOperator = null;
  let restoring = false;
  let snapshotting = false;
  let registrySaveTimer = null;
  let mainSaveTimer = null;
  let registryObserver = null;
  let mainObserver = null;
  let lastExportName = '';

  function safeJSON(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function getStore() {
    const stored = safeJSON(localStorage.getItem(APP_KEY), null);
    if (stored && Array.isArray(stored.operators)) return stored;
    return {version: 1, operators: []};
  }

  function setStore(store) {
    localStorage.setItem(APP_KEY, JSON.stringify(store));
  }

  function operatorKey(id, suffix) {
    return `${APP_KEY}.${id}.${suffix}`;
  }

  function randomId() {
    if (crypto?.randomUUID) return `op-${crypto.randomUUID()}`;
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function cleanFilenamePart(value) {
    return normalizeName(value)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\.+$/g, '')
      .trim()
      .toUpperCase() || 'OPERADOR';
  }

  async function hashPin(operatorId, pin) {
    const payload = new TextEncoder().encode(`${operatorId}|${String(pin)}`);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function createOverlay() {
    if ($('#operatorLock')) return;
    const overlay = document.createElement('div');
    overlay.id = 'operatorLock';
    overlay.className = 'operator-lock';
    overlay.innerHTML = `
      <section class="operator-login-card" aria-labelledby="operatorLoginTitle">
        <div class="operator-login-head">
          <div class="operator-login-brand">
            <div class="operator-login-mark">M</div>
            <div>
              <h2 id="operatorLoginTitle">Acceso de operador</h2>
              <p>Verificación y Match de Equipos · registro individual por operador</p>
            </div>
          </div>
        </div>
        <div class="operator-login-body">
          <div id="operatorLoginBox" class="operator-login-box">
            <label>Operador
              <select id="operatorSelect"></select>
            </label>
            <label>PIN
              <input id="operatorPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="4 a 8 dígitos">
            </label>
            <div id="operatorLoginError" class="operator-login-error"></div>
            <div class="operator-login-actions">
              <button id="operatorNewBtn" type="button">Nuevo operador</button>
              <button id="operatorLoginBtn" class="primary" type="button">Iniciar sesión</button>
            </div>
          </div>

          <div id="operatorCreateBox" class="operator-create-box">
            <label>Nombre del operador
              <input id="operatorCreateName" autocomplete="off" maxlength="60" placeholder="Ej. Samuel Johnson">
            </label>
            <label>Crear PIN
              <input id="operatorCreatePin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="4 a 8 dígitos">
            </label>
            <label>Confirmar PIN
              <input id="operatorCreatePin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="Repite el PIN">
            </label>
            <div id="operatorCreateError" class="operator-login-error"></div>
            <div class="operator-login-actions">
              <button id="operatorCancelCreate" type="button">Volver</button>
              <button id="operatorCreateBtn" class="primary" type="button">Crear e ingresar</button>
            </div>
          </div>

          <div class="operator-login-note">
            Los perfiles, PIN cifrado y registros se guardan localmente en este navegador. Para usar las mismas cuentas en varias computadoras se necesitará un servicio de autenticación/servidor.
          </div>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    $('#operatorNewBtn').addEventListener('click', () => showCreateMode(true));
    $('#operatorCancelCreate').addEventListener('click', () => showCreateMode(false));
    $('#operatorLoginBtn').addEventListener('click', loginSelectedOperator);
    $('#operatorCreateBtn').addEventListener('click', createOperator);
    $('#operatorPin').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); loginSelectedOperator(); }
    });
    $('#operatorCreatePin2').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); createOperator(); }
    });
    refreshOperatorSelect();
  }

  function refreshOperatorSelect(selectId = null) {
    const select = $('#operatorSelect');
    if (!select) return;
    const store = getStore();
    if (!store.operators.length) {
      select.innerHTML = '<option value="">No hay operadores creados</option>';
      $('#operatorLoginBtn').disabled = true;
      showCreateMode(true);
      return;
    }
    select.innerHTML = store.operators
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map(op => `<option value="${escapeHtml(op.id)}">${escapeHtml(op.name)}</option>`)
      .join('');
    $('#operatorLoginBtn').disabled = false;
    if (selectId && store.operators.some(op => op.id === selectId)) select.value = selectId;
  }

  function showCreateMode(show) {
    const login = $('#operatorLoginBox');
    const create = $('#operatorCreateBox');
    if (!login || !create) return;
    login.classList.toggle('hidden', show);
    create.classList.toggle('open', show);
    $('#operatorLoginError').textContent = '';
    $('#operatorCreateError').textContent = '';
    setTimeout(() => (show ? $('#operatorCreateName') : $('#operatorPin'))?.focus(), 0);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function createOperator() {
    const name = normalizeName($('#operatorCreateName')?.value);
    const pin = String($('#operatorCreatePin')?.value || '');
    const pin2 = String($('#operatorCreatePin2')?.value || '');
    const error = $('#operatorCreateError');
    if (!name) { error.textContent = 'Escribe el nombre del operador.'; $('#operatorCreateName').focus(); return; }
    if (!/^\d{4,8}$/.test(pin)) { error.textContent = 'El PIN debe contener entre 4 y 8 dígitos.'; $('#operatorCreatePin').focus(); return; }
    if (pin !== pin2) { error.textContent = 'Los PIN no coinciden.'; $('#operatorCreatePin2').focus(); return; }

    const store = getStore();
    if (store.operators.some(op => op.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
      error.textContent = 'Ya existe un operador con ese nombre.';
      return;
    }

    const id = randomId();
    const pinHash = await hashPin(id, pin);
    const operator = {id, name, pinHash, createdAt: new Date().toISOString()};
    store.operators.push(operator);
    setStore(store);
    refreshOperatorSelect(id);
    await unlock(operator);
  }

  async function loginSelectedOperator() {
    const id = $('#operatorSelect')?.value;
    const pin = String($('#operatorPin')?.value || '');
    const error = $('#operatorLoginError');
    const operator = getStore().operators.find(op => op.id === id);
    if (!operator) { error.textContent = 'Selecciona un operador válido.'; return; }
    if (!/^\d{4,8}$/.test(pin)) { error.textContent = 'Ingresa el PIN de 4 a 8 dígitos.'; return; }
    const hash = await hashPin(operator.id, pin);
    if (hash !== operator.pinHash) {
      error.textContent = 'PIN incorrecto.';
      $('#operatorPin').select();
      return;
    }
    await unlock(operator);
  }

  async function unlock(operator) {
    activeOperator = operator;
    sessionStorage.setItem(SESSION_KEY, operator.id);
    $('#operatorLock')?.setAttribute('hidden', '');
    installOperatorChip();
    installExportNaming();
    await restoreOperatorData();
    startPersistence();
    document.documentElement.dataset.operator = operator.id;
    document.dispatchEvent(new CustomEvent('operator:login', {detail: {id: operator.id, name: operator.name}}));
  }

  function installOperatorChip() {
    if (!activeOperator) return;
    let chip = $('#operatorChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'operatorChip';
      chip.className = 'operator-chip';
      const sessionBadge = $('#sessionBadge');
      sessionBadge?.parentNode?.insertBefore(chip, sessionBadge);
    }
    const initial = cleanFilenamePart(activeOperator.name).charAt(0) || 'O';
    chip.innerHTML = `<span class="operator-avatar">${escapeHtml(initial)}</span><span class="operator-chip-text"><span>Operador</span><strong>${escapeHtml(activeOperator.name)}</strong></span>`;

    let logout = $('#operatorLogoutBtn');
    if (!logout) {
      logout = document.createElement('button');
      logout.id = 'operatorLogoutBtn';
      logout.type = 'button';
      logout.className = 'ghost danger operator-logout';
      logout.textContent = 'Cerrar sesión';
      $('.top-actions')?.appendChild(logout);
      logout.addEventListener('click', logoutOperator);
    }
  }

  function showBanner(text) {
    let banner = $('#operatorRestoreBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'operatorRestoreBanner';
      banner.className = 'operator-restore-banner';
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    clearTimeout(showBanner.timer);
    showBanner.timer = setTimeout(() => banner.remove(), 3600);
  }

  function saveRegistryNow() {
    if (!activeOperator || restoring) return;
    const rows = window.EquipmentRegistry?.getRows?.();
    if (!Array.isArray(rows)) return;
    localStorage.setItem(operatorKey(activeOperator.id, 'registry'), JSON.stringify({savedAt: new Date().toISOString(), rows}));
  }

  function scheduleRegistrySave() {
    clearTimeout(registrySaveTimer);
    registrySaveTimer = setTimeout(saveRegistryNow, 150);
  }

  function scrapeMainSnapshot() {
    if (!activeOperator || snapshotting || restoring) return null;
    const workspace = $('#workspaceBody');
    const allTab = $('.tabs button[data-view="all"]');
    const foundTab = $('.tabs button[data-view="found"]');
    const allFilter = $('.filters button[data-filter="Todos"]');
    if (!workspace || !allTab || !foundTab || !allFilter) return null;

    snapshotting = true;
    mainObserver?.disconnect();
    const previousVisibility = workspace.style.visibility;
    const originalTab = $('.tabs button.active');
    const originalFilter = $('.filters button.active');
    workspace.style.visibility = 'hidden';

    try {
      if (originalFilter !== allFilter) allFilter.click();
      if (originalTab !== allTab) allTab.click();
      const records = $$('table tbody tr', workspace).map(row => {
        const cells = $$('td', row).map(td => String(td.textContent || '').trim().replace(/\s+/g, ' '));
        if (cells.length < 6 || !/^(Carcasa|Equipo)$/i.test(cells[0])) return null;
        return {type: /^carcasa$/i.test(cells[0]) ? 'Carcasa' : 'Equipo', host: cells[1], ua: cells[2]};
      }).filter(Boolean);

      foundTab.click();
      const found = $$('table tbody tr', workspace).map(row => {
        const cells = $$('td', row).map(td => String(td.textContent || '').trim().replace(/\s+/g, ' '));
        if (cells.length < 6 || !/ENCONTRADO PREVIO/i.test(cells[3])) return null;
        return {host: cells[0], ua: cells[2], origin: cells[5] || 'Encontrado previo'};
      }).filter(Boolean);

      if (originalFilter && originalFilter !== allFilter) originalFilter.click();
      if (originalTab && originalTab !== foundTab) originalTab.click();
      return {savedAt: new Date().toISOString(), records, found};
    } finally {
      workspace.style.visibility = previousVisibility;
      snapshotting = false;
      if (mainObserver) mainObserver.observe(workspace, {childList: true, subtree: true});
    }
  }

  function saveMainNow() {
    if (!activeOperator || restoring) return;
    const snapshot = scrapeMainSnapshot();
    if (snapshot) localStorage.setItem(operatorKey(activeOperator.id, 'main'), JSON.stringify(snapshot));
  }

  function scheduleMainSave() {
    if (snapshotting || restoring) return;
    clearTimeout(mainSaveTimer);
    mainSaveTimer = setTimeout(saveMainNow, 220);
  }

  function startPersistence() {
    const registryBody = $('#equipmentRegisterBody');
    if (registryBody) {
      registryObserver?.disconnect();
      registryObserver = new MutationObserver(scheduleRegistrySave);
      registryObserver.observe(registryBody, {childList: true, subtree: true, characterData: true});
    }

    const workspace = $('#workspaceBody');
    if (workspace) {
      mainObserver?.disconnect();
      mainObserver = new MutationObserver(scheduleMainSave);
      mainObserver.observe(workspace, {childList: true, subtree: true});
    }

    window.addEventListener('beforeunload', () => {
      saveRegistryNow();
      saveMainNow();
    });
  }

  function assignFileToInput(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }

  async function restoreEquipmentRegistry() {
    const saved = safeJSON(localStorage.getItem(operatorKey(activeOperator.id, 'registry')), null);
    if (!saved?.rows?.length || !$('#equipmentImportFile')) return 0;
    const file = new File([JSON.stringify({registros: saved.rows})], `registro_${activeOperator.id}.json`, {type: 'application/json'});
    assignFileToInput($('#equipmentImportFile'), file);
    await waitFor(() => (window.EquipmentRegistry?.getRows?.().length || 0) >= saved.rows.length, 2500);
    return saved.rows.length;
  }

  async function restoreMainWorkspace() {
    const saved = safeJSON(localStorage.getItem(operatorKey(activeOperator.id, 'main')), null);
    const records = Array.isArray(saved?.records) ? saved.records : [];
    const found = Array.isArray(saved?.found) ? saved.found : [];
    if ((!records.length && !found.length) || typeof XLSX === 'undefined' || !$('#fileInput')) return 0;

    const rows = [['Tipo', 'Host SN', 'UA']];
    records.forEach(row => rows.push([row.type, row.host, row.ua]));
    found.forEach(row => rows.push(['Encontrado previo', row.host, row.ua]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Equipos totales');
    const bytes = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
    const file = new File([bytes], `sesion_${activeOperator.id}.xlsx`, {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    assignFileToInput($('#fileInput'), file);

    const opened = await waitFor(() => $('#importModal')?.classList.contains('open'), 3000);
    if (opened) {
      $('#runImport')?.click();
      await waitFor(() => !$('#importModal')?.classList.contains('open'), 2500);
    }
    window.FileIndexSearch?.clear?.();
    return records.length + found.length;
  }

  async function waitFor(predicate, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (predicate()) return true; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  }

  async function restoreOperatorData() {
    if (!activeOperator) return;
    restoring = true;
    try {
      const [registryCount, mainCount] = await Promise.all([
        restoreEquipmentRegistry(),
        restoreMainWorkspace()
      ]);
      if (registryCount || mainCount) {
        showBanner(`${activeOperator.name}: ${registryCount} registros por caja y ${mainCount} registros de verificación restaurados.`);
      }
    } finally {
      restoring = false;
      saveRegistryNow();
      saveMainNow();
    }
  }

  function getCounters() {
    if (!activeOperator) return {REGISTRO: 0, BUSQUEDA: 0};
    return safeJSON(localStorage.getItem(operatorKey(activeOperator.id, 'counters')), {REGISTRO: 0, BUSQUEDA: 0});
  }

  function nextExportName(kind, extension) {
    if (!activeOperator) return null;
    const counters = getCounters();
    counters[kind] = (Number(counters[kind]) || 0) + 1;
    localStorage.setItem(operatorKey(activeOperator.id, 'counters'), JSON.stringify(counters));
    const number = String(counters[kind]).padStart(3, '0');
    const d = new Date();
    const p = value => String(value).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return `${kind} #${number} ${cleanFilenamePart(activeOperator.name)} ${stamp}.${extension}`;
  }

  function classifyDownloadName(filename) {
    const name = String(filename || '');
    if (/^Registro_Equipos_Cajas_/i.test(name)) return 'REGISTRO';
    if (/^Matches_Ubicaciones_/i.test(name)) return 'BUSQUEDA';
    if (/^Match_Equipos_/i.test(name)) return 'BUSQUEDA';
    return null;
  }

  function installExportNaming() {
    if (window.__operatorExportNamingInstalled) return;
    window.__operatorExportNamingInstalled = true;

    if (typeof XLSX !== 'undefined' && typeof XLSX.writeFile === 'function') {
      const originalWriteFile = XLSX.writeFile.bind(XLSX);
      XLSX.writeFile = function(workbook, filename, options) {
        const kind = classifyDownloadName(filename);
        let finalName = filename;
        if (kind && activeOperator) {
          const ext = String(filename).split('.').pop() || 'xlsx';
          finalName = nextExportName(kind, ext);
          lastExportName = finalName;
          workbook.Props = Object.assign({}, workbook.Props || {}, {
            Author: activeOperator.name,
            LastAuthor: activeOperator.name,
            Comments: `${kind} generado por ${activeOperator.name}`
          });
        }
        return originalWriteFile(workbook, finalName, options);
      };
    }

    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(...args) {
      if (this.download && activeOperator) {
        const kind = classifyDownloadName(this.download);
        if (kind) {
          const ext = String(this.download).split('.').pop() || 'txt';
          const finalName = nextExportName(kind, ext);
          this.download = finalName;
          lastExportName = finalName;
        }
      }
      return originalAnchorClick.apply(this, args);
    };

    ['#exportBtn', '#exportMatchesTxtBtn', '#equipmentExportBtn'].forEach(selector => {
      const button = $(selector);
      if (!button) return;
      button.addEventListener('click', () => { lastExportName = ''; }, true);
      button.addEventListener('click', () => {
        setTimeout(() => {
          if (!lastExportName) return;
          const toastSpan = $('#toast span');
          if (toastSpan) toastSpan.textContent = lastExportName;
        }, 80);
      });
    });
  }

  function saveAllNow() {
    clearTimeout(registrySaveTimer);
    clearTimeout(mainSaveTimer);
    saveRegistryNow();
    saveMainNow();
  }

  function logoutOperator() {
    if (!activeOperator) return;
    saveAllNow();
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  function getCurrentOperator() {
    return activeOperator ? {id: activeOperator.id, name: activeOperator.name} : null;
  }

  async function boot() {
    createOverlay();
    const id = sessionStorage.getItem(SESSION_KEY);
    const operator = getStore().operators.find(op => op.id === id);
    if (operator) {
      await unlock(operator);
      return;
    }
    $('#operatorLock')?.removeAttribute('hidden');
    refreshOperatorSelect();
  }

  document.addEventListener('DOMContentLoaded', boot);

  window.OperatorSession = {
    getCurrentOperator,
    nextExportName,
    saveNow: saveAllNow,
    logout: logoutOperator
  };
})();