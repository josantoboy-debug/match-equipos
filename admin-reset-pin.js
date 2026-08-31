(() => {
  'use strict';

  // Browser-safe Supabase configuration. Never place service-role or secret keys here.
  const API_URL = 'https://yvlayxmhcngdqribcmkh.supabase.co';
  const API_KEY = 'sb_publishable_9XPD5yoq2N1CQCnYt3D7Fg_IGQrZbJN';
  const APP_NAME = 'admin';
  const REQUEST_TIMEOUT = 8000;

  let operators = [];
  let adminToken = null;
  let adminOperator = null;
  let busy = false;

  const $ = selector => document.querySelector(selector);

  const messages = {
    INVALID_PIN: 'PIN incorrecto.',
    INVALID_PIN_FORMAT: 'El PIN debe contener entre 4 y 8 dígitos.',
    OPERATOR_UNAVAILABLE: 'El operador no está disponible.',
    CREDENTIALS_MISSING: 'El operador no tiene credenciales configuradas.',
    LOCKED: 'La cuenta está bloqueada temporalmente por intentos fallidos.',
    FORBIDDEN: 'La sesión no tiene permisos de administrador.',
    INVALID_SESSION: 'La sesión administrativa ya no es válida.',
    NOT_FOUND: 'El operador seleccionado ya no existe.'
  };

  function setStatus(text, type = 'neutral') {
    const node = $('#status');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.type = type;
  }

  function setBusy(value) {
    busy = !!value;
    ['#adminLoginBtn', '#resetPinBtn', '#logoutBtn', '#refreshBtn'].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = busy;
    });
  }

  function errorMessage(result, fallback = 'No se pudo completar la operación.') {
    if (result?.code === 'LOCKED' && result?.locked_until) {
      const until = new Date(result.locked_until);
      return `Cuenta bloqueada temporalmente hasta ${until.toLocaleTimeString('es-PA', {hour:'2-digit', minute:'2-digit'})}.`;
    }
    if (result?.code === 'INVALID_PIN' && Number.isInteger(result?.remaining_attempts)) {
      return `PIN incorrecto. Intentos restantes antes del bloqueo: ${result.remaining_attempts}.`;
    }
    return messages[result?.code] || fallback;
  }

  async function rpc(name, payload = {}, {keepalive = false} = {}) {
    const controller = keepalive ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT) : null;
    try {
      const response = await fetch(`${API_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller?.signal,
        keepalive
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw new Error(data?.message || data?.hint || `HTTP ${response.status}`);
      return data;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function renderOperatorLists() {
    const adminSelect = $('#adminSelect');
    const targetSelect = $('#targetOperator');
    if (!adminSelect || !targetSelect) return;

    const admins = operators.filter(operator => operator.active !== false && operator.role === 'admin');
    const active = operators.filter(operator => operator.active !== false);

    adminSelect.replaceChildren(...admins.map(operator => {
      const option = document.createElement('option');
      option.value = operator.id;
      option.textContent = operator.name;
      return option;
    }));

    targetSelect.replaceChildren(...active.map(operator => {
      const option = document.createElement('option');
      option.value = operator.id;
      option.textContent = `${operator.name}${operator.role === 'admin' ? ' · Admin' : ' · Operador'}`;
      return option;
    }));

    $('#adminLoginBtn').disabled = !admins.length;
    $('#targetOperator').disabled = true;
  }

  async function loadOperators() {
    setStatus('Cargando operadores centrales…');
    const result = await rpc('core_list_operators_service', {p_app_name: APP_NAME});
    if (!result?.ok) throw new Error(errorMessage(result, 'No se pudieron cargar los operadores.'));
    operators = Array.isArray(result.operators) ? result.operators : [];
    renderOperatorLists();
    const adminCount = operators.filter(operator => operator.active !== false && operator.role === 'admin').length;
    setStatus(adminCount ? 'Selecciona un administrador e inicia sesión.' : 'No hay administradores activos disponibles.', adminCount ? 'neutral' : 'error');
  }

  function showAdminPanel(authenticated) {
    $('#resetPanel').hidden = !authenticated;
    $('#adminLoginPanel').hidden = authenticated;
    $('#sessionAdminName').textContent = authenticated ? adminOperator?.name || 'Administrador' : '—';
    $('#targetOperator').disabled = !authenticated;
    $('#resetPinBtn').disabled = !authenticated;
    $('#logoutBtn').hidden = !authenticated;
    $('#refreshBtn').hidden = !authenticated;
  }

  async function adminLogin() {
    if (busy) return;
    const adminId = $('#adminSelect')?.value;
    const pin = String($('#adminPin')?.value || '');
    if (!adminId) return setStatus('Selecciona un administrador.', 'error');
    if (!/^\d{4,8}$/.test(pin)) return setStatus('El PIN debe contener entre 4 y 8 dígitos.', 'error');

    setBusy(true);
    setStatus('Validando permisos…');
    try {
      const result = await rpc('core_operator_login_service', {
        p_operator_id: adminId,
        p_pin: pin,
        p_app_name: APP_NAME,
        p_device_info: {
          userAgent: navigator.userAgent.slice(0, 280),
          platform: navigator.platform || '',
          language: navigator.language || ''
        }
      });
      if (!result?.ok) throw new Error(errorMessage(result));
      if (result.operator?.role !== 'admin' || result.operator?.active === false) {
        if (result.token) await rpc('core_logout_service', {p_token: result.token}).catch(() => {});
        throw new Error('La cuenta autenticada no tiene permisos de administrador.');
      }

      adminToken = result.token;
      adminOperator = result.operator;
      $('#adminPin').value = '';
      showAdminPanel(true);
      setStatus(`Sesión administrativa activa: ${adminOperator.name}.`, 'success');
    } catch (error) {
      adminToken = null;
      adminOperator = null;
      $('#adminPin')?.select();
      setStatus(error?.message || 'No se pudo iniciar la sesión administrativa.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function logout({silent = false} = {}) {
    const token = adminToken;
    adminToken = null;
    adminOperator = null;
    showAdminPanel(false);
    if (token) {
      try { await rpc('core_logout_service', {p_token: token}, {keepalive: silent}); } catch {}
    }
    if (!silent) setStatus('Sesión administrativa cerrada.');
  }

  async function refreshOperators() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await rpc('core_list_operators_service', {p_app_name: APP_NAME});
      if (!result?.ok) throw new Error(errorMessage(result));
      operators = Array.isArray(result.operators) ? result.operators : [];
      const targetSelect = $('#targetOperator');
      const previousTarget = targetSelect?.value;
      renderOperatorLists();
      if (previousTarget && operators.some(operator => operator.id === previousTarget && operator.active !== false)) targetSelect.value = previousTarget;
      targetSelect.disabled = false;
      $('#resetPinBtn').disabled = false;
      setStatus('Lista de operadores actualizada.', 'success');
    } catch (error) {
      setStatus(error?.message || 'No se pudo actualizar la lista.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resetPin() {
    if (busy) return;
    if (!adminToken || !adminOperator) return setStatus('Inicia una sesión administrativa válida.', 'error');

    const operatorId = $('#targetOperator')?.value;
    const newPin = String($('#newPin')?.value || '');
    const confirmPin = String($('#confirmPin')?.value || '');
    const target = operators.find(operator => operator.id === operatorId && operator.active !== false);

    if (!target) return setStatus('Selecciona un operador activo.', 'error');
    if (!/^\d{4,8}$/.test(newPin)) return setStatus('El nuevo PIN debe contener entre 4 y 8 dígitos.', 'error');
    if (newPin !== confirmPin) return setStatus('Los PIN nuevos no coinciden.', 'error');

    const selfReset = target.id === adminOperator.id;
    const warning = selfReset
      ? `Vas a cambiar el PIN de tu propia cuenta (${target.name}). Tu sesión administrativa se cerrará inmediatamente. ¿Continuar?`
      : `Vas a restablecer el PIN de ${target.name}. Sus sesiones activas se cerrarán. ¿Continuar?`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    setStatus(`Restableciendo el PIN de ${target.name}…`);
    try {
      const result = await rpc('core_admin_reset_pin_service', {
        p_token: adminToken,
        p_operator_id: target.id,
        p_new_pin: newPin
      });
      if (!result?.ok) throw new Error(errorMessage(result));

      $('#newPin').value = '';
      $('#confirmPin').value = '';

      if (selfReset) {
        adminToken = null;
        adminOperator = null;
        showAdminPanel(false);
        setStatus(`PIN de ${target.name} actualizado. Todas sus sesiones fueron revocadas; inicia sesión nuevamente con el PIN nuevo.`, 'success');
      } else {
        setStatus(`PIN de ${target.name} actualizado. Sus sesiones anteriores fueron revocadas.`, 'success');
      }
    } catch (error) {
      const text = error?.message || 'No se pudo restablecer el PIN.';
      if (/sesión|session|FORBIDDEN/i.test(text)) {
        adminToken = null;
        adminOperator = null;
        showAdminPanel(false);
      }
      setStatus(text, 'error');
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    $('#adminLoginBtn')?.addEventListener('click', adminLogin);
    $('#resetPinBtn')?.addEventListener('click', resetPin);
    $('#logoutBtn')?.addEventListener('click', () => logout());
    $('#refreshBtn')?.addEventListener('click', refreshOperators);
    $('#adminPin')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); adminLogin(); }
    });
    $('#confirmPin')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); resetPin(); }
    });
    window.addEventListener('pagehide', () => {
      if (adminToken) logout({silent:true});
    });
  }

  async function init() {
    bind();
    showAdminPanel(false);
    try {
      await loadOperators();
    } catch (error) {
      setStatus(`No se pudo conectar con Supabase: ${error?.message || 'error de red'}.`, 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
