(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const MAX_PER_BOX = 64;
  const HISTORY_PREFIX = 'matchEquipos.sessionRecovery.v1';
  const MAX_HISTORY = 20;

  const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ');

  function esc(v) {
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function toast(title, message, tone='ok') {
    const el = $('#toast');
    if (!el) return;
    el.className = `toast show ${tone}`;
    el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 5200);
  }

  function operator() {
    return window.OperatorSession?.getCurrentOperator?.() || {id:'default', name:'Operador'};
  }

  function historyKey() {
    return `${HISTORY_PREFIX}.${operator().id || 'default'}`;
  }

  function readHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(historyKey()) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  function writeHistory(items) {
    try {
      localStorage.setItem(historyKey(), JSON.stringify(items.slice(0, MAX_HISTORY)));
      updateRecoverButton();
      return true;
    } catch (error) {
      console.error('[equipment-new-session] recovery history', error);
      return false;
    }
  }

  function context() {
    return {
      process: norm($('#equipmentProcess')?.value || window.EquipmentProcess?.getCurrent?.()),
      lot: norm($('#equipmentLot')?.value),
      box: norm($('#equipmentBox')?.value),
      quantity: norm($('#equipmentQuantity')?.value),
      captureMode: window.EquipmentRegistry?.getCaptureMode?.() === 'automatic' ? 'automatic' : 'manual'
    };
  }

  function saveSnapshot(reason='Copia automática') {
    const rows = window.EquipmentRegistry?.getRows?.() || [];
    const ctx = context();
    const hasContext = [ctx.process,ctx.lot,ctx.box,ctx.quantity].some(Boolean);
    if (!rows.length && !hasContext) return null;

    const item = {
      id:`REC-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      createdAt:new Date().toISOString(),
      reason,
      operator:operator(),
      context:ctx,
      rows:rows.map(row => ({...row}))
    };
    const history = readHistory();
    history.unshift(item);
    return writeHistory(history) ? item : null;
  }

  function resetFields() {
    ['#equipmentProcess','#equipmentLot','#equipmentBox','#equipmentSerial','#equipmentUA'].forEach(s => {
      const el=$(s); if (!el) return; el.value=''; el.classList.remove('field-valid','field-invalid');
    });
    const quantity=$('#equipmentQuantity');
    if (quantity) { quantity.value=''; quantity.removeAttribute('value'); quantity.classList.remove('field-valid','field-invalid'); }
    $('#equipmentQuantityDisplay')?.remove();
    window.EquipmentProcess?.clear?.();
    window.EquipmentRegistry?.setCaptureMode?.('manual');
    window.EquipmentCapacity?.refresh?.();
    const message=$('#equipmentValidationMessage');
    if (message) {
      message.className='equipment-validation neutral';
      message.innerHTML=`<span class="equipment-validation-icon">✓</span><div><strong>Nueva sesión lista</strong><small>Define Asignación / Proceso, Lote, Caja y CANTIDAD asignada. Máximo ${MAX_PER_BOX} equipos.</small></div>`;
    }
    setTimeout(() => ($('#equipmentProcess') || $('#equipmentLot'))?.focus(), 0);
  }

  function clearRows() {
    const buttons=$$('[data-equipment-delete]');
    if (!buttons.length) return;
    const original=window.confirm;
    try { window.confirm=()=>true; buttons.forEach(btn=>btn.click()); }
    finally { window.confirm=original; }
  }

  function applyContext(ctx={}) {
    const put=(s,v) => {
      const el=$(s); if (!el) return; el.value=v || ''; el.dispatchEvent(new Event('input',{bubbles:true}));
    };
    put('#equipmentProcess',ctx.process);
    put('#equipmentLot',ctx.lot);
    put('#equipmentBox',ctx.box);
    put('#equipmentQuantity',ctx.quantity);
    if ($('#equipmentSerial')) $('#equipmentSerial').value='';
    if ($('#equipmentUA')) $('#equipmentUA').value='';
    window.EquipmentRegistry?.setCurrentProcess?.(ctx.process || '');
    window.EquipmentRegistry?.setCaptureMode?.(ctx.captureMode === 'automatic' ? 'automatic' : 'manual');
    window.EquipmentCapacity?.refresh?.();
  }

  function importSnapshot(item) {
    const input=$('#equipmentImportFile');
    if (!input || typeof File === 'undefined' || typeof DataTransfer === 'undefined') return false;
    const file=new File([JSON.stringify({context:item.context,registros:item.rows})],`RECUPERAR_${item.id}.json`,{type:'application/json'});
    const transfer=new DataTransfer();
    transfer.items.add(file);
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }

  async function waitRows(expected, timeout=3500) {
    const start=Date.now();
    while (Date.now()-start<timeout) {
      const n=window.EquipmentRegistry?.getRows?.().length || 0;
      if (n>=expected) return n;
      await new Promise(r=>setTimeout(r,50));
    }
    return window.EquipmentRegistry?.getRows?.().length || 0;
  }

  function newSession() {
    const rows=window.EquipmentRegistry?.getRows?.() || [];
    const first=window.confirm(
      `¿YA GUARDASTE / EXPORTASTE EL REGISTRO?\n\n` +
      `${rows.length ? `La sesión actual contiene ${rows.length} equipos.` : 'La sesión actual no contiene equipos.'}\n\n` +
      `Antes de borrar, la aplicación guardará automáticamente una copia recuperable.\n\n` +
      `Aceptar = Sí, ya guardé el registro y quiero continuar.\nCancelar = Volver sin borrar nada.`
    );
    if (!first) return;

    const backup=saveSnapshot('Antes de Nueva sesión');
    const hasData=rows.length || [context().process,context().lot,context().box,context().quantity].some(Boolean);
    if (hasData && !backup) {
      toast('Nueva sesión cancelada','No se pudo crear la copia de seguridad. No se borró ningún registro.','error');
      return;
    }

    const second=window.confirm(
      `${backup ? 'COPIA DE RECUPERACIÓN CREADA CORRECTAMENTE.\n\n' : ''}` +
      `¿Confirmas crear la NUEVA SESIÓN?\n\nPodrás usar “Recuperar sesión” para volver a esta copia.`
    );
    if (!second) return;

    clearRows();
    resetFields();
    window.OperatorSession?.saveNow?.();
    updateRecoverButton();
    document.dispatchEvent(new CustomEvent('equipment:new-session-created', {
      detail:{operator:operator(), source:'equipment-register'}
    }));
    toast('Nueva sesión',backup ? 'Registro reiniciado. La sesión anterior quedó guardada para recuperación.' : 'Registro reiniciado.','ok');
  }

  function describe(item,index) {
    const c=item.context || {};
    const date=new Date(item.createdAt || 0);
    const stamp=Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleString('es-PA');
    return `${index+1}. ${stamp} | ${c.process || 'Sin proceso'} | Lote ${c.lot || '—'} | Caja ${c.box || '—'} | ${(item.rows || []).length} equipos`;
  }

  async function recoverSession() {
    const history=readHistory();
    if (!history.length) { toast('Sin sesiones recuperables','Las próximas Nuevas sesiones crearán una copia automática antes de borrar.','warn'); return; }

    const visible=history.slice(0,10);
    const answer=window.prompt(
      `RECUPERAR SESIÓN ANTERIOR\n\nEscribe el número de la sesión que quieres recuperar:\n\n${visible.map(describe).join('\n')}\n\nCancelar = no hacer cambios.`,
      '1'
    );
    if (answer === null) return;
    const pos=Number(String(answer).trim())-1;
    if (!Number.isInteger(pos) || pos<0 || pos>=visible.length) {
      toast('Selección inválida','Escribe uno de los números mostrados en la lista.','warn');
      return;
    }

    const chosen=visible[pos];
    const current=window.EquipmentRegistry?.getRows?.() || [];
    if (current.length) {
      const ok=window.confirm(`El registro actual tiene ${current.length} equipos.\n\nSe guardará una copia del estado actual antes de recuperar la sesión seleccionada.\n\n¿Continuar?`);
      if (!ok) return;
      if (!saveSnapshot('Antes de recuperar otra sesión')) {
        toast('Recuperación cancelada','No se pudo respaldar la sesión actual. No se hizo ningún cambio.','error');
        return;
      }
    }

    clearRows();
    resetFields();
    applyContext(chosen.context);

    if ((chosen.rows || []).length) {
      if (!importSnapshot(chosen)) {
        toast('No se pudo recuperar','El navegador no permitió restaurar el respaldo.','error');
        return;
      }
      const restored=await waitRows(chosen.rows.length);
      applyContext(chosen.context);
      window.OperatorSession?.saveNow?.();
      $('#equipmentSerial')?.focus({preventScroll:true});
      toast(restored>=chosen.rows.length ? 'Sesión recuperada' : 'Recuperación parcial',`${restored} de ${chosen.rows.length} equipos restaurados.`,restored>=chosen.rows.length?'ok':'warn');
    } else {
      window.OperatorSession?.saveNow?.();
      toast('Sesión recuperada','Se restauró el contexto de la sesión.','ok');
    }
  }

  function updateRecoverButton() {
    const btn=$('#equipmentRecoverSessionBtn');
    if (!btn) return;
    const n=readHistory().length;
    btn.disabled=n===0;
    btn.textContent=n ? `Recuperar sesión (${n})` : 'Recuperar sesión';
    btn.title=n ? `${n} copia${n===1?'':'s'} guardada${n===1?'':'s'}` : 'Todavía no hay copias guardadas';
  }

  function install() {
    const actions=$('.equipment-file-actions');
    if (!actions) return;

    let newBtn=$('#equipmentNewSessionBtn');
    if (!newBtn) {
      newBtn=document.createElement('button');
      newBtn.id='equipmentNewSessionBtn'; newBtn.type='button'; newBtn.className='ghost danger'; newBtn.textContent='Nueva sesión';
      actions.insertBefore(newBtn,$('#equipmentImportBtn') || actions.firstChild);
    }

    if (newBtn.dataset.safeNewSession !== '1') {
      const clean=newBtn.cloneNode(true);
      clean.dataset.safeNewSession='1';
      newBtn.replaceWith(clean);
      newBtn=clean;
      newBtn.addEventListener('click',newSession);
    }

    let recover=$('#equipmentRecoverSessionBtn');
    if (!recover) {
      recover=document.createElement('button');
      recover.id='equipmentRecoverSessionBtn'; recover.type='button'; recover.className='secondary';
      newBtn.insertAdjacentElement('afterend',recover);
    }
    if (recover.dataset.recoveryInstalled !== '1') {
      recover.dataset.recoveryInstalled='1';
      recover.addEventListener('click',recoverSession);
    }
    updateRecoverButton();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',install);
  else install();
  document.addEventListener('operator:login',()=>setTimeout(install,0));

  window.EquipmentNewSession={start:newSession,install,recover:recoverSession,saveRecoverySnapshot:saveSnapshot,getHistory:()=>readHistory().map(x=>({...x}))};
})();
