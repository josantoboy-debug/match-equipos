(() => {
  'use strict';

  const API_URL = 'https://yvlayxmhcngdqribcmkh.supabase.co/functions/v1/operator-api';
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
    NOT_FOUND: 'El operador seleccionado ya no existe.',
    INVALID_RECOVERY_CODE: 'El código de recuperación no es válido.',
    RECOVERY_NOT_AVAILABLE: 'No hay una recuperación de emergencia habilitada o ya expiró.',
    RECOVERY_LOCKED: 'La recuperación está bloqueada temporalmente por intentos fallidos.',
    ADMIN_UNAVAILABLE: 'El administrador de recuperación ya no está disponible.'
  };

  function setStatus(text, type = 'neutral') {
    const node = $('#status');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.type = type;
  }

  function setBusy(value) {
    busy = !!value;
    ['#adminLoginBtn','#resetPinBtn','#logoutBtn','#refreshBtn','#emergencyResetBtn'].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = busy;
    });
  }

  function errorMessage(result, fallback = 'No se pudo completar la operación.') {
    if ((result?.code === 'LOCKED' || result?.code === 'RECOVERY_LOCKED') && result?.locked_until) {
      const until = new Date(result.locked_until);
      return `Bloqueado temporalmente hasta ${until.toLocaleTimeString('es-PA',{hour:'2-digit',minute:'2-digit'})}.`;
    }
    if ((result?.code === 'INVALID_PIN' || result?.code === 'INVALID_RECOVERY_CODE') && Number.isInteger(result?.remaining_attempts)) {
      return `${messages[result.code]} Intentos restantes: ${result.remaining_attempts}.`;
    }
    return messages[result?.code] || fallback;
  }

  async function api(action, payload = {}, {token = '', keepalive = false} = {}) {
    const controller = keepalive ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT) : null;
    try {
      const headers = {apikey: API_KEY,'Content-Type':'application/json'};
      if (token) headers['x-operator-session'] = token;
      const response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({action, ...payload}),
        signal: controller?.signal,
        keepalive
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok && !data?.code) throw new Error(`HTTP ${response.status}`);
      return data || {ok:false,code:'EMPTY_RESPONSE'};
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
      const option=document.createElement('option'); option.value=operator.id; option.textContent=operator.name; return option;
    }));
    targetSelect.replaceChildren(...active.map(operator => {
      const option=document.createElement('option'); option.value=operator.id; option.textContent=`${operator.name}${operator.role==='admin'?' · Admin':' · Operador'}`; return option;
    }));
    $('#adminLoginBtn').disabled = !admins.length || busy;
    targetSelect.disabled = !adminToken;
  }

  async function loadOperators() {
    setStatus('Cargando operadores centrales…');
    const result = await api('list');
    if (!result?.ok) throw new Error(errorMessage(result,'No se pudieron cargar los operadores.'));
    operators = Array.isArray(result.operators) ? result.operators : [];
    renderOperatorLists();
    const adminCount=operators.filter(operator=>operator.active!==false&&operator.role==='admin').length;
    setStatus(adminCount?'Selecciona un administrador e inicia sesión.':'No hay administradores activos disponibles.',adminCount?'neutral':'error');
  }

  function showAdminPanel(authenticated) {
    $('#resetPanel').hidden=!authenticated;
    $('#adminLoginPanel').hidden=authenticated;
    $('#emergencyPanel').hidden=authenticated;
    $('#sessionAdminName').textContent=authenticated?(adminOperator?.name||'Administrador'):'—';
    $('#targetOperator').disabled=!authenticated;
    $('#resetPinBtn').disabled=!authenticated||busy;
    $('#logoutBtn').hidden=!authenticated;
    $('#refreshBtn').hidden=!authenticated;
  }

  async function adminLogin() {
    if (busy) return;
    const adminId=$('#adminSelect')?.value;
    const pin=String($('#adminPin')?.value||'');
    if (!adminId) return setStatus('Selecciona un administrador.','error');
    if (!/^\d{4,8}$/.test(pin)) return setStatus(messages.INVALID_PIN_FORMAT,'error');
    setBusy(true); setStatus('Validando permisos…');
    try {
      const result=await api('login',{operator_id:adminId,pin,app_name:APP_NAME,device_info:{userAgent:navigator.userAgent.slice(0,280),platform:navigator.platform||'',language:navigator.language||''}});
      if (!result?.ok) throw new Error(errorMessage(result));
      if (result.operator?.role!=='admin'||result.operator?.active===false) {
        if (result.token) await api('logout',{}, {token:result.token}).catch(()=>{});
        throw new Error('La cuenta autenticada no tiene permisos de administrador.');
      }
      adminToken=result.token; adminOperator=result.operator; $('#adminPin').value=''; showAdminPanel(true);
      setStatus(`Sesión administrativa activa: ${adminOperator.name}.`,'success');
    } catch(error) {
      adminToken=null; adminOperator=null; $('#adminPin')?.select(); setStatus(error?.message||'No se pudo iniciar la sesión administrativa.','error');
    } finally { setBusy(false); }
  }

  async function logout({silent=false}={}) {
    const token=adminToken; adminToken=null; adminOperator=null; showAdminPanel(false);
    if (token) { try { await api('logout',{}, {token,keepalive:silent}); } catch {} }
    if (!silent) setStatus('Sesión administrativa cerrada.');
  }

  async function refreshOperators() {
    if (busy) return; setBusy(true);
    try {
      const result=await api('list'); if (!result?.ok) throw new Error(errorMessage(result));
      operators=Array.isArray(result.operators)?result.operators:[];
      const target=$('#targetOperator'); const previous=target?.value; renderOperatorLists();
      if (previous&&operators.some(op=>op.id===previous&&op.active!==false)) target.value=previous;
      target.disabled=false; $('#resetPinBtn').disabled=false; setStatus('Lista de operadores actualizada.','success');
    } catch(error) { setStatus(error?.message||'No se pudo actualizar la lista.','error'); }
    finally { setBusy(false); }
  }

  async function resetPin() {
    if (busy) return;
    if (!adminToken||!adminOperator) return setStatus('Inicia una sesión administrativa válida.','error');
    const operatorId=$('#targetOperator')?.value;
    const newPin=String($('#newPin')?.value||'');
    const confirmPin=String($('#confirmPin')?.value||'');
    const target=operators.find(operator=>operator.id===operatorId&&operator.active!==false);
    if (!target) return setStatus('Selecciona un operador activo.','error');
    if (!/^\d{4,8}$/.test(newPin)) return setStatus('El nuevo PIN debe contener entre 4 y 8 dígitos.','error');
    if (newPin!==confirmPin) return setStatus('Los PIN nuevos no coinciden.','error');
    const selfReset=target.id===adminOperator.id;
    if (!window.confirm(selfReset?`Vas a cambiar el PIN de tu propia cuenta (${target.name}). Tu sesión se cerrará. ¿Continuar?`:`Vas a restablecer el PIN de ${target.name}. Sus sesiones activas se cerrarán. ¿Continuar?`)) return;
    setBusy(true); setStatus(`Restableciendo el PIN de ${target.name}…`);
    try {
      const result=await api('reset_pin',{operator_id:target.id,new_pin:newPin},{token:adminToken});
      if (!result?.ok) throw new Error(errorMessage(result));
      $('#newPin').value=''; $('#confirmPin').value='';
      if (selfReset) { adminToken=null; adminOperator=null; showAdminPanel(false); setStatus(`PIN de ${target.name} actualizado. Inicia sesión nuevamente con el PIN nuevo.`,'success'); }
      else setStatus(`PIN de ${target.name} actualizado. Sus sesiones anteriores fueron revocadas.`,'success');
    } catch(error) {
      const text=error?.message||'No se pudo restablecer el PIN.';
      if (/sesión|session|FORBIDDEN/i.test(text)) { adminToken=null; adminOperator=null; showAdminPanel(false); }
      setStatus(text,'error');
    } finally { setBusy(false); }
  }

  async function emergencyReset() {
    if (busy) return;
    const activationCode=String($('#recoveryCode')?.value||'').trim();
    const newPin=String($('#recoveryPin')?.value||'');
    const confirmPin=String($('#recoveryPinConfirm')?.value||'');
    if (activationCode.length<8) return setStatus('Introduce el código de activación válido.','error');
    if (!/^\d{4,8}$/.test(newPin)) return setStatus('El nuevo PIN debe contener entre 4 y 8 dígitos.','error');
    if (newPin!==confirmPin) return setStatus('Los PIN nuevos no coinciden.','error');
    if (!window.confirm('La recuperación de emergencia cambiará el PIN del administrador y consumirá la autorización temporal. ¿Continuar?')) return;
    setBusy(true); setStatus('Aplicando recuperación administrativa…');
    try {
      const result=await api('emergency_reset_pin',{activation_code:activationCode,new_pin:newPin});
      if (!result?.ok) throw new Error(errorMessage(result));
      $('#recoveryCode').value=''; $('#recoveryPin').value=''; $('#recoveryPinConfirm').value='';
      setStatus(`PIN de ${result.operator?.name||'Usuario Admin'} actualizado. Ya puedes iniciar sesión con el PIN nuevo.`,'success');
      await loadOperators();
    } catch(error) { setStatus(error?.message||'No se pudo completar la recuperación.','error'); }
    finally { setBusy(false); }
  }

  function bind() {
    $('#adminLoginBtn')?.addEventListener('click',adminLogin);
    $('#resetPinBtn')?.addEventListener('click',resetPin);
    $('#emergencyResetBtn')?.addEventListener('click',emergencyReset);
    $('#logoutBtn')?.addEventListener('click',()=>logout());
    $('#refreshBtn')?.addEventListener('click',refreshOperators);
    $('#adminPin')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();adminLogin();}});
    $('#confirmPin')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();resetPin();}});
    $('#recoveryPinConfirm')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();emergencyReset();}});
    window.addEventListener('pagehide',()=>{if(adminToken) logout({silent:true});});
  }

  async function init() {
    bind(); showAdminPanel(false);
    try { await loadOperators(); }
    catch(error) { setStatus(`No se pudo conectar con Supabase: ${error?.message||'error de red'}.`,'error'); }
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
