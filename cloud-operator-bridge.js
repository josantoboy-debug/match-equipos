(() => {
  'use strict';

  const APP_NAME = 'match-equipos';
  const API_URL = 'https://yvlayxmhcngdqribcmkh.supabase.co';
  const API_KEY = 'sb_publishable_9XPD5yoq2N1CQCnYt3D7Fg_IGQrZbJN';
  const APP_KEY = 'matchEquipos.operatorAccess.v1';
  const SESSION_KEY = 'matchEquipos.activeOperator.v1';
  const CLOUD_SESSION_KEY = 'matchEquipos.cloudOperatorSession.v1';
  const REQUEST_TIMEOUT = 8000;

  let remoteOperators = [];
  let bootstrapped = null;
  let onlineAvailable = true;
  let busy = false;

  const $ = (selector, root = document) => root.querySelector(selector);

  function safeJSON(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function getStore() {
    const stored = safeJSON(localStorage.getItem(APP_KEY), null);
    return stored && Array.isArray(stored.operators) ? stored : {version: 1, operators: []};
  }

  function setStore(store) {
    localStorage.setItem(APP_KEY, JSON.stringify(store));
  }

  function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  async function hashPin(operatorId, pin) {
    const payload = new TextEncoder().encode(`${operatorId}|${String(pin)}`);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function getCloudSession() {
    return safeJSON(sessionStorage.getItem(CLOUD_SESSION_KEY), null);
  }

  function setCloudSession(value) {
    sessionStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(value));
  }

  function clearCloudSession() {
    sessionStorage.removeItem(CLOUD_SESSION_KEY);
  }

  async function rpc(name, payload = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(`${API_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        const message = data?.message || data?.hint || `HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function messageFor(code) {
    const messages = {
      INVALID_PIN: 'PIN incorrecto.',
      INVALID_PIN_FORMAT: 'El PIN debe contener entre 4 y 8 dígitos.',
      OPERATOR_UNAVAILABLE: 'El operador no está disponible.',
      CREDENTIALS_MISSING: 'El operador no tiene credenciales configuradas.',
      LOCKED: 'Acceso bloqueado temporalmente por intentos fallidos.',
      NAME_EXISTS: 'Ya existe un operador con ese nombre.',
      INVALID_INPUT: 'Revisa los datos ingresados.',
      FORBIDDEN: 'Se requiere autorización de administrador.',
      INVALID_SESSION: 'La sesión ya no es válida.',
      ALREADY_BOOTSTRAPPED: 'El sistema ya tiene un administrador configurado.'
    };
    return messages[code] || 'No se pudo completar la operación.';
  }

  function setError(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text || '';
  }

  function setBusy(value) {
    busy = !!value;
    ['#operatorLoginBtn', '#operatorCreateBtn'].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = busy;
    });
  }

  function cacheOperator(operator, pin = null) {
    if (!operator?.id) return;
    const store = getStore();
    const previous = store.operators.find(item => item.id === operator.id);
    const next = {
      ...(previous || {}),
      id: operator.id,
      name: operator.name,
      role: operator.role || previous?.role || 'operator',
      active: operator.active !== false,
      cloud: true,
      updatedAt: new Date().toISOString()
    };
    const write = async () => {
      if (pin) next.pinHash = await hashPin(operator.id, pin);
      const filtered = store.operators.filter(item => item.id !== operator.id);
      filtered.push(next);
      store.operators = filtered;
      setStore(store);
    };
    return write();
  }

  function mergeRemoteOperators(operators) {
    const store = getStore();
    const byId = new Map(store.operators.map(item => [item.id, item]));
    operators.forEach(operator => {
      const previous = byId.get(operator.id) || {};
      byId.set(operator.id, {
        ...previous,
        id: operator.id,
        name: operator.name,
        role: operator.role || previous.role || 'operator',
        active: operator.active !== false,
        cloud: true
      });
    });
    store.operators = [...byId.values()];
    setStore(store);
  }

  function copyOperatorStorage(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const copies = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.includes(oldId)) continue;
      const target = key.split(oldId).join(newId);
      if (localStorage.getItem(target) !== null) continue;
      copies.push([target, localStorage.getItem(key)]);
    }
    copies.forEach(([key, value]) => localStorage.setItem(key, value));
  }

  function replaceLegacyOperator(oldId, operator, pin) {
    copyOperatorStorage(oldId, operator.id);
    const store = getStore();
    store.operators = store.operators.filter(item => item.id !== oldId && item.id !== operator.id);
    store.operators.push({
      id: operator.id,
      name: operator.name,
      role: operator.role || 'admin',
      active: true,
      cloud: true,
      migratedFrom: oldId,
      migratedAt: new Date().toISOString()
    });
    setStore(store);
    return cacheOperator(operator, pin);
  }

  function showCreateMode(show) {
    $('#operatorLoginBox')?.classList.toggle('hidden', show);
    $('#operatorCreateBox')?.classList.toggle('open', show);
    setError('#operatorLoginError', '');
    setError('#operatorCreateError', '');
  }

  function renderSelect() {
    const select = $('#operatorSelect');
    if (!select) return;

    const store = getStore();
    const source = bootstrapped === true
      ? remoteOperators
      : (remoteOperators.length ? remoteOperators : store.operators.filter(item => item.active !== false));

    if (!source.length) {
      select.innerHTML = '<option value="">No hay operadores creados</option>';
      $('#operatorLoginBtn') && ($('#operatorLoginBtn').disabled = true);
      showCreateMode(true);
      return;
    }

    const escape = value => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    select.innerHTML = source
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
      .map(operator => `<option value="${escape(operator.id)}">${escape(operator.name)}${operator.role === 'admin' ? ' · Admin' : ''}</option>`)
      .join('');
    $('#operatorLoginBtn') && ($('#operatorLoginBtn').disabled = false);
    showCreateMode(false);
  }

  function ensureAdminFields() {
    const box = $('#operatorCreateBox');
    if (!box || $('#cloudAdminAuth')) return;
    const actions = box.querySelector('.operator-login-actions');
    if (!actions) return;

    const wrap = document.createElement('div');
    wrap.id = 'cloudAdminAuth';
    wrap.innerHTML = `
      <div class="operator-login-note" style="margin-bottom:10px">Para crear otro operador, autoriza con una cuenta administradora.</div>
      <label>Administrador
        <select id="cloudAdminSelect"></select>
      </label>
      <label>PIN del administrador
        <input id="cloudAdminPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="4 a 8 dígitos">
      </label>`;
    box.insertBefore(wrap, actions);
  }

  function renderAdminSelect() {
    if (bootstrapped !== true) return;
    ensureAdminFields();
    const select = $('#cloudAdminSelect');
    if (!select) return;
    const admins = remoteOperators.filter(item => item.role === 'admin' && item.active !== false);
    select.innerHTML = admins.map(item => `<option value="${item.id}">${String(item.name).replace(/</g, '&lt;')}</option>`).join('');
  }

  function updateNote() {
    const note = $('.operator-login-note', $('#operatorLock') || document);
    if (!note) return;
    note.textContent = onlineAvailable
      ? 'Operadores y PIN se validan de forma central en Supabase. Los registros de trabajo conservan una copia local para continuidad y recuperación.'
      : 'Sin conexión a Supabase. Solo pueden entrar offline operadores que ya hayan autenticado previamente en este dispositivo.';
  }

  async function loadOperators() {
    try {
      const result = await rpc('core_list_operators_service', {p_app_name: APP_NAME});
      if (!result?.ok) throw new Error(result?.code || 'LIST_FAILED');
      onlineAvailable = true;
      bootstrapped = !!result.bootstrapped;
      remoteOperators = Array.isArray(result.operators) ? result.operators : [];
      mergeRemoteOperators(remoteOperators);
    } catch (error) {
      console.warn('[CloudAuth] Supabase no disponible:', error);
      onlineAvailable = false;
      bootstrapped = null;
      remoteOperators = [];
    }
    renderSelect();
    renderAdminSelect();
    updateNote();
  }

  async function loginRemote(operatorId, pin, appName = APP_NAME) {
    const result = await rpc('core_operator_login_service', {
      p_operator_id: operatorId,
      p_pin: pin,
      p_app_name: appName,
      p_device_info: {
        userAgent: navigator.userAgent.slice(0, 280),
        platform: navigator.platform || '',
        language: navigator.language || ''
      }
    });
    if (!result?.ok) {
      const error = new Error(messageFor(result?.code));
      error.code = result?.code;
      error.details = result;
      throw error;
    }
    return result;
  }

  async function finishLogin(result, pin) {
    await cacheOperator(result.operator, pin);
    setCloudSession({
      token: result.token,
      expiresAt: result.expires_at,
      operator: result.operator,
      offline: false,
      savedAt: new Date().toISOString()
    });
    sessionStorage.setItem(SESSION_KEY, result.operator.id);
    location.reload();
  }

  async function tryOfflineLogin(operator, pin) {
    if (!operator?.pinHash) return false;
    const hash = await hashPin(operator.id, pin);
    if (hash !== operator.pinHash) return false;
    setCloudSession({operator: {id: operator.id, name: operator.name, role: operator.role || 'operator'}, offline: true, savedAt: new Date().toISOString()});
    sessionStorage.setItem(SESSION_KEY, operator.id);
    location.reload();
    return true;
  }

  async function migrateLegacyOperator(legacyOperator, pin) {
    const localHash = await hashPin(legacyOperator.id, pin);
    if (!legacyOperator.pinHash || localHash !== legacyOperator.pinHash) {
      throw new Error('PIN incorrecto para migrar el operador local.');
    }
    const bootstrap = await rpc('core_bootstrap_admin_service', {p_name: legacyOperator.name, p_pin: pin});
    if (!bootstrap?.ok) {
      const error = new Error(messageFor(bootstrap?.code));
      error.code = bootstrap?.code;
      throw error;
    }
    await replaceLegacyOperator(legacyOperator.id, bootstrap.operator, pin);
    return loginRemote(bootstrap.operator.id, pin, APP_NAME);
  }

  async function handleLogin() {
    if (busy) return;
    const id = $('#operatorSelect')?.value;
    const pin = String($('#operatorPin')?.value || '');
    const store = getStore();
    const localOperator = store.operators.find(item => item.id === id);
    const remoteOperator = remoteOperators.find(item => item.id === id);

    setError('#operatorLoginError', '');
    if (!id || !localOperator) return setError('#operatorLoginError', 'Selecciona un operador válido.');
    if (!/^\d{4,8}$/.test(pin)) return setError('#operatorLoginError', 'Ingresa el PIN de 4 a 8 dígitos.');

    setBusy(true);
    try {
      if (onlineAvailable && bootstrapped === false && !remoteOperators.length) {
        const result = await migrateLegacyOperator(localOperator, pin);
        await finishLogin(result, pin);
        return;
      }

      if (onlineAvailable && remoteOperator) {
        const result = await loginRemote(remoteOperator.id, pin, APP_NAME);
        await finishLogin(result, pin);
        return;
      }

      if (await tryOfflineLogin(localOperator, pin)) return;
      setError('#operatorLoginError', onlineAvailable ? 'El operador no existe en el registro central.' : 'No hay credencial offline válida para este operador.');
    } catch (error) {
      setError('#operatorLoginError', error?.message || 'No se pudo iniciar sesión.');
      $('#operatorPin')?.select();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (busy) return;
    const name = normalizeName($('#operatorCreateName')?.value);
    const pin = String($('#operatorCreatePin')?.value || '');
    const pin2 = String($('#operatorCreatePin2')?.value || '');
    setError('#operatorCreateError', '');

    if (!name) return setError('#operatorCreateError', 'Escribe el nombre del operador.');
    if (!/^\d{4,8}$/.test(pin)) return setError('#operatorCreateError', 'El PIN debe contener entre 4 y 8 dígitos.');
    if (pin !== pin2) return setError('#operatorCreateError', 'Los PIN no coinciden.');
    if (!onlineAvailable) return setError('#operatorCreateError', 'Se necesita conexión para crear operadores.');

    setBusy(true);
    let adminToken = null;
    try {
      if (bootstrapped === false) {
        const bootstrap = await rpc('core_bootstrap_admin_service', {p_name: name, p_pin: pin});
        if (!bootstrap?.ok) throw new Error(messageFor(bootstrap?.code));
        const login = await loginRemote(bootstrap.operator.id, pin, APP_NAME);
        await finishLogin(login, pin);
        return;
      }

      const adminId = $('#cloudAdminSelect')?.value;
      const adminPin = String($('#cloudAdminPin')?.value || '');
      if (!adminId || !/^\d{4,8}$/.test(adminPin)) throw new Error('Selecciona un administrador e ingresa su PIN.');

      const adminLogin = await loginRemote(adminId, adminPin, 'admin');
      if (adminLogin.operator?.role !== 'admin') throw new Error('La cuenta seleccionada no es administradora.');
      adminToken = adminLogin.token;

      const created = await rpc('core_admin_create_operator_service', {
        p_token: adminToken,
        p_name: name,
        p_pin: pin,
        p_role: 'operator'
      });
      if (!created?.ok) throw new Error(messageFor(created?.code));

      try { await rpc('core_logout_service', {p_token: adminToken}); } catch {}
      adminToken = null;
      const login = await loginRemote(created.operator.id, pin, APP_NAME);
      await finishLogin(login, pin);
    } catch (error) {
      if (adminToken) {
        try { await rpc('core_logout_service', {p_token: adminToken}); } catch {}
      }
      setError('#operatorCreateError', error?.message || 'No se pudo crear el operador.');
    } finally {
      setBusy(false);
    }
  }

  async function validateCloudSession() {
    const cloud = getCloudSession();
    if (!cloud || cloud.offline || !cloud.token) return;
    try {
      const result = await rpc('core_validate_session_service', {p_token: cloud.token});
      if (!result?.ok || !result.operator?.active) {
        clearCloudSession();
        sessionStorage.removeItem(SESSION_KEY);
        location.reload();
        return;
      }
      onlineAvailable = true;
      await cacheOperator(result.operator);
    } catch (error) {
      console.warn('[CloudAuth] Sesión no pudo validarse en línea; continúa en modo degradado.', error);
      cloud.offline = true;
      cloud.savedAt = new Date().toISOString();
      setCloudSession(cloud);
      onlineAvailable = false;
      updateNote();
    }
  }

  function captureAuthEvents() {
    document.addEventListener('click', event => {
      const login = event.target.closest?.('#operatorLoginBtn');
      const create = event.target.closest?.('#operatorCreateBtn');
      if (!login && !create) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (login) handleLogin();
      else handleCreate();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (event.target?.id === 'operatorPin') {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); handleLogin();
      }
      if (event.target?.id === 'operatorCreatePin2' || event.target?.id === 'cloudAdminPin') {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); handleCreate();
      }
    }, true);
  }

  function reconcileStartupSession() {
    const cloud = getCloudSession();
    const localSessionId = sessionStorage.getItem(SESSION_KEY);

    if (cloud && !localSessionId) {
      if (cloud.token) rpc('core_logout_service', {p_token: cloud.token}).catch(() => {});
      clearCloudSession();
      return;
    }

    if (!cloud && localSessionId) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    if (cloud?.operator?.id && localSessionId !== cloud.operator.id) {
      sessionStorage.setItem(SESSION_KEY, cloud.operator.id);
    }
  }

  async function init() {
    await new Promise(resolve => setTimeout(resolve, 0));
    await loadOperators();
    await validateCloudSession();
  }

  reconcileStartupSession();
  captureAuthEvents();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();

  window.CloudOperatorAuth = {
    refresh: loadOperators,
    getSession: getCloudSession,
    isOnline: () => onlineAvailable
  };
})();
