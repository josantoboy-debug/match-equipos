(() => {
  'use strict';

  const core = () => window.ProductionCore;
  const $ = (s, r = document) => r.querySelector(s);
  let bypassRegisterClick = false;
  let realtimeStarted = false;
  let adminLoaded = false;
  const inFlightBoxes = new Set();

  function ensureAdminPanel() {
    if (adminLoaded || core()?.AuthService.operator?.role !== 'admin') return;
    adminLoaded = true;
    const script = document.createElement('script');
    script.src = `admin-panel.js?v=${encodeURIComponent(core().config.appVersion)}`;
    script.onerror = error => { adminLoaded = false; core()?.ErrorService.capture('admin-panel-load', error); };
    document.head.appendChild(script);
  }

  function showCloudToast(title, message, tone = 'ok') {
    const toast = $('#toast');
    if (!toast) return;
    toast.className = `toast show ${tone}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    clearTimeout(showCloudToast.timer);
    showCloudToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

  function readMainRegistration() {
    const c = core();
    const recordType = $('.mode.active')?.dataset.mode || 'Carcasa';
    const host = c.ValidationService.normalizeHost($('#hostInput')?.value || '');
    const ua = c.ValidationService.normalizeUA($('#uaInput')?.value || '');
    return { record_type: recordType, host_sn: host, ua, source: 'main-register', origin_device: navigator.userAgent.slice(0,180), payload: { local_mode: recordType } };
  }

  async function cloudRegisterBeforeLocal(event) {
    if (bypassRegisterClick) return;
    const c = core();
    if (!c?.AuthService.operator) return;
    const payload = readMainRegistration();

    if (!c.ValidationService.isValidHost(payload.host_sn)) {
      event.preventDefault(); event.stopImmediatePropagation();
      showCloudToast('Host SN inválido', 'Debe tener exactamente 12 caracteres, iniciar con M y contener solo letras o números.', 'error');
      return;
    }
    if (!c.ValidationService.isValidUA(payload.ua)) {
      event.preventDefault(); event.stopImmediatePropagation();
      showCloudToast('UA inválido', 'Debe tener exactamente 16 dígitos y comenzar por 0000.', 'error');
      return;
    }

    if (!navigator.onLine) {
      await c.SyncService.enqueue('equipment.register', payload);
      c.AuditService.record('equipment_queued_offline', { host_sn: payload.host_sn, ua: payload.ua, result: payload.record_type });
      showCloudToast('Trabajando sin conexión', 'El registro se guardó localmente y se sincronizará al recuperar Internet.', 'warn');
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const result = await c.DataService.registerEquipment(payload);
      if (!result?.ok) {
        if (result?.code === 'DUPLICATE') {
          showCloudToast('Registro duplicado', 'Este Host SN o UA ya existe para el mismo tipo en la base central.', 'warn');
          c.AuditService.record('duplicate_detected', { host_sn: payload.host_sn, ua: payload.ua, result: 'CENTRAL_DUPLICATE' });
          return;
        }
        throw new Error(result?.code || 'Registro rechazado');
      }
      bypassRegisterClick = true;
      $('#registerBtn')?.click();
      bypassRegisterClick = false;
      if (result.review) showCloudToast('REVISAR MATCH', result.assignment || 'El serial coincide, pero las UA reales son diferentes.', 'warn');
      else if (result.matched) showCloudToast('MATCH CENTRAL CORRECTO', `${payload.host_sn} / ${result.ua || payload.ua} fue asociado entre dispositivos.`, 'ok');
      else showCloudToast('Registro sincronizado', 'Guardado en Supabase. La contraparte aún está pendiente.', 'ok');
    } catch (error) {
      bypassRegisterClick = true;
      $('#registerBtn')?.click();
      bypassRegisterClick = false;
      await c.SyncService.enqueue('equipment.register', payload);
      c.ErrorService.capture('central-register', error);
      showCloudToast('Sincronización pendiente', 'El registro se conservó localmente y se reintentará automáticamente.', 'warn');
    }
  }

  function boxPayload(row, op) {
    const c = core();
    const serial = c.ValidationService.normalizeHost(row.serial);
    const ua = c.ValidationService.normalizeUA(row.ua);
    if (!c.ValidationService.isValidHost(serial) || !c.ValidationService.isValidUA(ua)) return null;
    const signature = `${String(row.lot || '').toUpperCase()}|${String(row.box || '').toUpperCase()}|${serial}|${ua}`;
    return { signature, data: { client_id: signature, lot: String(row.lot || '').trim(), box: String(row.box || '').trim(), serial, ua, process: row.process || null, quantity: Number(row.quantity) || null, box_position: Number(row.boxPosition) || null, operator_id: op.id, source: row.origin || 'local-registry', payload: { local_id: row.id || null } } };
  }

  async function syncOneBox(item) {
    const c = core();
    if (inFlightBoxes.has(item.signature)) return;
    inFlightBoxes.add(item.signature);
    try {
      if (!navigator.onLine) { await c.StorageCache.setCache(`box:${item.signature}`, item.data); return; }
      const { error } = await c.DataService.getClient().from('box_registry_records').upsert(item.data, { onConflict: 'client_id', ignoreDuplicates: false });
      if (error && error.code !== '23505') throw error;
      await c.StorageCache.delete('cache', `box:${item.signature}`).catch(() => {});
    } catch (error) { core()?.ErrorService.capture('box-registry-sync', error); }
    finally { inFlightBoxes.delete(item.signature); }
  }

  async function syncBoxRegistry() {
    const c = core();
    const op = c?.AuthService.operator;
    const rows = window.EquipmentRegistry?.getRows?.();
    if (!op || !Array.isArray(rows) || !rows.length) return;
    for (const row of rows) { const item = boxPayload(row, op); if (item) await syncOneBox(item); }
  }

  async function flushCachedBoxes() {
    const c = core();
    if (!navigator.onLine || !c?.AuthService.operator) return;
    const cached = await c.StorageCache.getAll('cache');
    for (const item of cached.filter(x => String(x.key || '').startsWith('box:'))) {
      const signature = String(item.key).slice(4);
      await syncOneBox({ signature, data: item.value });
    }
  }

  function observeBoxRegistry() {
    const body = $('#equipmentRegisterBody');
    if (!body) return;
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => syncBoxRegistry().catch(error => core()?.ErrorService.capture('box-registry-observer', error)), 180);
    });
    observer.observe(body, { childList:true, subtree:true, characterData:true });
    syncBoxRegistry().catch(() => {});
  }

  function startRealtime() {
    if (realtimeStarted || !core()?.AuthService.token) return;
    realtimeStarted = true;
    const client = core().DataService.getClient();
    client.channel(`production-${Date.now()}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'equipment_matches' }, payload => {
        const row = payload.new || {};
        showCloudToast(row.result === 'Revisar' ? 'Match para revisar' : 'Nuevo Match sincronizado', `${row.host_sn || ''} ${row.ua || ''}`.trim(), row.result === 'Revisar' ? 'warn' : 'ok');
      })
      .on('postgres_changes', { event:'*', schema:'public', table:'operators' }, () => document.dispatchEvent(new CustomEvent('operators:changed')))
      .subscribe();
  }

  function bindAuditButtons() {
    const c = core();
    $('#importBtn')?.addEventListener('click', () => c?.AuditService.record('file_import_started', { result:'USER_ACTION' }));
    $('#exportBtn')?.addEventListener('click', () => c?.AuditService.record('file_exported', { result:'XLSX' }));
    $('#exportMatchesTxtBtn')?.addEventListener('click', () => c?.AuditService.record('matches_exported', { result:'TXT' }));
    $('#equipmentImportBtn')?.addEventListener('click', () => c?.AuditService.record('box_registry_import_started', { result:'USER_ACTION' }));
    $('#equipmentExportBtn')?.addEventListener('click', () => c?.AuditService.record('box_registry_exported', { result:$('#equipmentExportFormat')?.value || 'unknown' }));
    $('#equipmentPrintBtn')?.addEventListener('click', () => c?.AuditService.record('box_printed', { result:$('#equipmentPrintMode')?.value || 'manual' }));
  }

  function bind() {
    $('#registerBtn')?.addEventListener('click', event => cloudRegisterBeforeLocal(event).catch(error => core()?.ErrorService.capture('register-bridge', error)), true);
    $('#uaInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') cloudRegisterBeforeLocal(event).catch(error => core()?.ErrorService.capture('scanner-register-bridge', error));
    }, true);
    window.addEventListener('online', () => { flushCachedBoxes().catch(() => {}); syncBoxRegistry().catch(() => {}); });
    document.addEventListener('operator:login', () => {
      startRealtime(); ensureAdminPanel(); flushCachedBoxes().catch(() => {}); syncBoxRegistry().catch(() => {});
    });
    document.addEventListener('production:session-changed', ensureAdminPanel);
    document.addEventListener('operators:changed', () => { if (core()?.AuthService.operator?.role === 'admin') core().AuthService.adminList().catch(() => {}); });
    bindAuditButtons(); observeBoxRegistry(); ensureAdminPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();
