(() => {
  'use strict';

  const VERSION='20260922-dcx1';
  const MODEL='DCX3510-M';
  const BOX_CAPACITY=8;
  const ASSIGNMENTS=['08','98','79','99'];
  const STATE_PREFIX='matchEquipos.dcx3510.v1';
  const BASE_PREFIX='matchEquipos.dcx3510.base.v1';
  const $=(s,r=document)=>r.querySelector(s);
  const norm=v=>String(v??'').trim().replace(/\s+/g,' ');
  const upper=v=>norm(v).toUpperCase();
  const digits=v=>String(v??'').replace(/\D/g,'');
  const normalizeMac=v=>upper(v).replace(/[^0-9A-F]/g,'').slice(0,12);
  const normalizeHost=v=>upper(v).replace(/[^A-Z0-9]/g,'').slice(0,20);
  const normalizeCardSn=v=>upper(v).replace(/[^A-Z0-9]/g,'').slice(0,24);
  const normalizeMcardUa=v=>digits(v).slice(0,16);
  const validMac=v=>/^[0-9A-F]{12}$/.test(normalizeMac(v));
  const validHost=v=>/^M[A-Z0-9]{10,15}$/.test(normalizeHost(v));
  const validCardSn=v=>/^[A-Z0-9]{8,24}$/.test(normalizeCardSn(v));
  const validMcardUa=v=>/^0000\d{12}$/.test(normalizeMcardUa(v));

  function assignmentFromProcedencia(v){
    const m=upper(v).match(/(?:^|\D)(08|98|79|99)(?:\D|$)/);
    return m?m[1]:'';
  }
  function header(v){
    return upper(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,' ').trim();
  }
  function col(headers,candidates){
    const h=headers.map(header);
    for(const c of candidates){const i=h.indexOf(header(c));if(i>=0)return i;}
    return -1;
  }
  function parseBaseRows(matrix,fallback='08'){
    if(!Array.isArray(matrix)||matrix.length<2)return {rows:[],assignments:{}};
    const headers=(matrix[0]||[]).map(norm);
    const serialIdx=col(headers,['Serial','Host SN','HOST SN']);
    if(serialIdx<0)throw new Error('El Excel no contiene una columna Serial / Host SN.');
    const procIdx=col(headers,['Procedencia','Origen','Asignacion','Asignación']);
    const nIdx=col(headers,['N','No','Numero','Número']);
    const modelIdx=col(headers,['Modelo','Model']);
    const dateIdx=col(headers,['Fecha','Date']);
    const seen=new Set(),rows=[];
    const assignments=Object.fromEntries(ASSIGNMENTS.map(x=>[x,0]));
    for(let i=1;i<matrix.length;i++){
      const src=matrix[i]||[];
      const serial=normalizeHost(src[serialIdx]);
      if(!serial||seen.has(serial))continue;
      seen.add(serial);
      const detected=procIdx>=0?assignmentFromProcedencia(src[procIdx]):'';
      const assignment=detected||ASSIGNMENTS.includes(fallback)?(detected||fallback):'08';
      rows.push({
        serial,assignment,sourceRow:i+1,
        n:nIdx>=0?norm(src[nIdx]):'',
        procedencia:procIdx>=0?norm(src[procIdx]):'',
        modelo:modelIdx>=0?norm(src[modelIdx]):'',
        fecha:dateIdx>=0?norm(src[dateIdx]):''
      });
      assignments[assignment]=(assignments[assignment]||0)+1;
    }
    return {rows,assignments};
  }
  function nextBoxValue(v){
    const raw=norm(v),width=Math.max(2,raw.length||2),n=parseInt(raw,10);
    return String(Number.isInteger(n)&&n>=0?n+1:1).padStart(width,'0');
  }
  function resolvePlacement(records,assignment,requestedBox){
    const rows=Array.isArray(records)?records:[];
    let box=norm(requestedBox)||'01';
    let count=rows.filter(r=>r.assignment===assignment&&String(r.box)===box).length;
    if(count>=BOX_CAPACITY){
      box=nextBoxValue(box);
      count=rows.filter(r=>r.assignment===assignment&&String(r.box)===box).length;
    }
    return {box,position:count+1,advanced:box!==norm(requestedBox)};
  }

  globalThis.DCX3510Utils=Object.freeze({
    VERSION,MODEL,BOX_CAPACITY,ASSIGNMENTS:[...ASSIGNMENTS],
    normalizeMac,normalizeHost,normalizeCardSn,normalizeMcardUa,
    validMac,validHost,validCardSn,validMcardUa,
    assignmentFromProcedencia,parseBaseRows,nextBoxValue,resolvePlacement
  });
  if(typeof document==='undefined'||typeof window==='undefined')return;

  let activeOperator=null;
  let state=emptyState();
  let bases=emptyBases();
  let saveTimer=null;

  function emptyState(){
    return {version:1,records:[],boxByAssignment:Object.fromEntries(ASSIGNMENTS.map(x=>[x,'01'])),selectedAssignment:'08',updatedAt:null};
  }
  function emptyBases(){return Object.fromEntries(ASSIGNMENTS.map(x=>[x,null]));}
  function safeJSON(v,fallback){try{return JSON.parse(v);}catch{return fallback;}}
  function operatorId(){return activeOperator?.id||window.OperatorSession?.getCurrentOperator?.()?.id||'guest';}
  function stateKey(){return `${STATE_PREFIX}.${operatorId()}`;}
  function baseKey(){return `${BASE_PREFIX}.${operatorId()}`;}
  function loadStorage(){
    const saved=safeJSON(localStorage.getItem(stateKey()),null);
    state=saved&&Array.isArray(saved.records)?{
      ...emptyState(),...saved,records:saved.records,
      boxByAssignment:{...emptyState().boxByAssignment,...(saved.boxByAssignment||{})}
    }:emptyState();
    bases={...emptyBases(),...(safeJSON(localStorage.getItem(baseKey()),null)||{})};
  }
  function persistNow(){
    clearTimeout(saveTimer);
    state.updatedAt=new Date().toISOString();
    try{
      localStorage.setItem(stateKey(),JSON.stringify(state));
      localStorage.setItem(baseKey(),JSON.stringify(bases));
    }catch(e){console.warn('[DCX3510] No se pudo guardar localmente',e);}
  }
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,120);}
  function esc(v){
    return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function toast(title,message,tone='ok'){
    const t=$('#toast');if(!t)return;
    t.className=`toast show ${tone}`;
    t.innerHTML=`<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),5000);
  }
  function markup(){
    return `
<section class="panel dcx3510-panel" id="dcx3510Panel" data-dcx3510-version="${VERSION}">
  <div class="dcx3510-head">
    <div><div class="dcx3510-titleline"><h2>Registro ${MODEL}</h2><span class="mini-badge">8 equipos por caja</span></div>
    <p>MCARD SN → MCARD UA → HOST SN → eSTB MAC → DOCSIS MAC. Compara HOST SN con el Serial del Excel de ingreso.</p></div>
    <div class="dcx3510-actions">
      <input id="dcx3510BaseInput" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods" hidden>
      <button id="dcx3510LoadBaseBtn" type="button" class="secondary">Cargar Excel de ingreso</button>
      <button id="dcx3510ExportBtn" type="button" class="primary">Descargar registro</button>
    </div>
  </div>
  <div class="dcx3510-base-status" id="dcx3510BaseStatus"><span class="file-index-dot"></span><span>Sin Excel de ingreso cargado.</span></div>
  <div class="dcx3510-context">
    <label><span>ASIGNACIÓN</span><select id="dcx3510Assignment" class="equipment-code"><option>08</option><option>98</option><option>79</option><option>99</option></select></label>
    <label><span>CAJA <small>8 equipos</small></span><input id="dcx3510Box" class="equipment-code" inputmode="numeric" maxlength="5" value="01"></label>
    <div class="dcx3510-box-indicator"><span>Caja actual</span><strong id="dcx3510BoxCount">0 / 8</strong><small id="dcx3510BoxLabel">Asignación 08 · Caja 01</small></div>
  </div>
  <div class="dcx3510-entry-grid">
    <label><span>MCARD SN</span><input id="dcx3510McardSn" class="equipment-code" autocomplete="off" placeholder="MT1332TP6620" maxlength="24"></label>
    <label><span>MCARD UA <small>0000 + 12 dígitos</small></span><input id="dcx3510McardUa" class="equipment-code" inputmode="numeric" autocomplete="off" placeholder="0000086989871111" maxlength="16"></label>
    <label><span>HOST SN <small>Se compara con Serial del Excel</small></span><input id="dcx3510HostSn" class="equipment-code" autocomplete="off" placeholder="M11334TC7794" maxlength="20"></label>
    <label><span>eSTB MAC <small>12 hex</small></span><input id="dcx3510EstbMac" class="equipment-code" autocomplete="off" placeholder="F80BBE59F24A" maxlength="17"></label>
    <label><span>DOCSIS MAC <small>12 hex</small></span><input id="dcx3510DocsisMac" class="equipment-code" autocomplete="off" placeholder="DC45179C7D56" maxlength="17"></label>
    <button id="dcx3510AddBtn" type="button" class="primary equipment-add-btn">Registrar equipo</button>
  </div>
  <div id="dcx3510Validation" class="equipment-validation neutral"><span class="equipment-validation-icon">✓</span><div><strong>Listo para registrar</strong><small>Selecciona 08, 98, 79 o 99. Cada caja se completa automáticamente al llegar a 8 equipos.</small></div></div>
  <div class="dcx3510-summary">
    <div><span>Total</span><strong id="dcx3510Total">0</strong></div>
    <div><span>Encontrados en Excel</span><strong id="dcx3510Found">0</strong></div>
    <div><span>No encontrados</span><strong id="dcx3510Missing">0</strong></div>
    <div><span>Cajas usadas</span><strong id="dcx3510Boxes">0</strong></div>
    <div><span>Base cargada</span><strong id="dcx3510BaseCount">0</strong></div>
  </div>
  <div class="equipment-table-wrap dcx3510-table-wrap">
    <table class="equipment-table dcx3510-table"><thead><tr><th>#</th><th>Asign.</th><th>Caja</th><th>Pos.</th><th>HOST SN</th><th>MCARD SN</th><th>MCARD UA</th><th>eSTB MAC</th><th>DOCSIS MAC</th><th>Comparación</th><th>N Excel</th><th>Fecha/Hora</th><th>Acción</th></tr></thead>
    <tbody id="dcx3510Body"><tr><td colspan="13" class="equipment-empty">Sin equipos registrados.</td></tr></tbody></table>
  </div>
</section>`;
  }
  function install(){
    if($('#dcx3510Panel'))return;
    const anchor=$('#equipmentRegisterPanel')||$('.workspace');
    if(!anchor)return;
    anchor.insertAdjacentHTML(anchor.id==='equipmentRegisterPanel'?'afterend':'beforebegin',markup());
    bind();render();
  }
  function bind(){
    $('#dcx3510LoadBaseBtn')?.addEventListener('click',()=>$('#dcx3510BaseInput')?.click());
    $('#dcx3510BaseInput')?.addEventListener('change',loadBaseFile);
    $('#dcx3510ExportBtn')?.addEventListener('click',exportRegistry);
    $('#dcx3510AddBtn')?.addEventListener('click',registerCurrent);
    $('#dcx3510Assignment')?.addEventListener('change',e=>{
      state.selectedAssignment=e.target.value;
      $('#dcx3510Box').value=state.boxByAssignment[e.target.value]||'01';
      scheduleSave();render();
    });
    $('#dcx3510Box')?.addEventListener('input',e=>{
      e.target.value=String(e.target.value||'').replace(/\D/g,'').slice(0,5);
      const a=$('#dcx3510Assignment')?.value||'08';
      if(e.target.value)state.boxByAssignment[a]=e.target.value;
      scheduleSave();renderBox();
    });
    const fields=[
      ['#dcx3510McardSn',normalizeCardSn],
      ['#dcx3510McardUa',normalizeMcardUa],
      ['#dcx3510HostSn',normalizeHost],
      ['#dcx3510EstbMac',v=>upper(v).replace(/[^0-9A-F:-]/g,'').slice(0,17)],
      ['#dcx3510DocsisMac',v=>upper(v).replace(/[^0-9A-F:-]/g,'').slice(0,17)]
    ];
    fields.forEach(([s,cleaner],i)=>{
      const el=$(s);if(!el)return;
      el.addEventListener('input',()=>{el.value=cleaner(el.value);});
      el.addEventListener('keydown',e=>{
        if(e.key!=='Enter')return;
        e.preventDefault();
        if(i<fields.length-1)$(fields[i+1][0])?.focus();else registerCurrent();
      });
    });
    $('#dcx3510Body')?.addEventListener('click',e=>{
      const b=e.target.closest('[data-dcx-delete]');if(!b)return;
      const row=state.records.find(r=>r.id===b.dataset.dcxDelete);if(!row)return;
      if(!confirm(`¿Eliminar ${row.hostSn} de Asignación ${row.assignment}, Caja ${row.box}?`))return;
      state.records=state.records.filter(r=>r.id!==row.id);persistNow();render();toast('Registro eliminado',row.hostSn,'warn');
    });
  }
  async function loadBaseFile(e){
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(typeof XLSX==='undefined')throw new Error('No se cargó la librería XLSX.');
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
      const grouped=Object.fromEntries(ASSIGNMENTS.map(x=>[x,[]]));let total=0;
      for(const name of wb.SheetNames||[]){
        const matrix=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:false});
        if(!matrix?.length)continue;
        let parsed;try{parsed=parseBaseRows(matrix,$('#dcx3510Assignment')?.value||'08');}catch{continue;}
        parsed.rows.forEach(r=>grouped[r.assignment].push({...r,sheet:name}));total+=parsed.rows.length;
      }
      if(!total)throw new Error('No se encontraron Serial / Host SN válidos en el Excel.');
      const loadedAt=new Date().toISOString();
      for(const code of ASSIGNMENTS){
        if(!grouped[code].length)continue;
        const seen=new Set(),rows=grouped[code].filter(r=>!seen.has(r.serial)&&seen.add(r.serial));
        bases[code]={fileName:file.name,loadedAt,rows};
      }
      persistNow();render();
      toast('Excel de ingreso cargado',ASSIGNMENTS.filter(c=>bases[c]?.rows?.length).map(c=>`${c}: ${bases[c].rows.length}`).join(' · '),'ok');
    }catch(err){console.error('[DCX3510] Excel',err);toast('No se pudo cargar el Excel',err?.message||'Archivo inválido.','error');}
    finally{e.target.value='';}
  }
  function values(){
    return {
      assignment:$('#dcx3510Assignment')?.value||'08',
      requestedBox:norm($('#dcx3510Box')?.value)||'01',
      mcardSn:normalizeCardSn($('#dcx3510McardSn')?.value),
      mcardUa:normalizeMcardUa($('#dcx3510McardUa')?.value),
      hostSn:normalizeHost($('#dcx3510HostSn')?.value),
      estbMac:normalizeMac($('#dcx3510EstbMac')?.value),
      docsisMac:normalizeMac($('#dcx3510DocsisMac')?.value)
    };
  }
  function errorFor(v){
    if(!ASSIGNMENTS.includes(v.assignment))return ['Asignación inválida','Selecciona 08, 98, 79 o 99.'];
    if(!/^\d{1,5}$/.test(v.requestedBox))return ['Caja inválida','Escribe un número de caja válido.'];
    if(!validCardSn(v.mcardSn))return ['MCARD SN inválido','Debe ser alfanumérico.'];
    if(!validMcardUa(v.mcardUa))return ['MCARD UA inválido','Debe tener 16 dígitos y comenzar por 0000.'];
    if(!validHost(v.hostSn))return ['HOST SN inválido','Debe comenzar por M y contener solo letras/números.'];
    if(!validMac(v.estbMac))return ['eSTB MAC inválido','Debe contener 12 caracteres hexadecimales.'];
    if(!validMac(v.docsisMac))return ['DOCSIS MAC inválido','Debe contener 12 caracteres hexadecimales.'];
    for(const [label,key] of [['HOST SN','hostSn'],['MCARD SN','mcardSn'],['MCARD UA','mcardUa'],['eSTB MAC','estbMac'],['DOCSIS MAC','docsisMac']]){
      const old=state.records.find(r=>r[key]===v[key]);
      if(old)return [`${label} duplicado`,`${v[key]} ya está registrado en Asignación ${old.assignment}, Caja ${old.box}.`];
    }
    return null;
  }
  function lookup(serial){
    const out={};for(const code of ASSIGNMENTS){const f=(bases[code]?.rows||[]).find(r=>r.serial===serial);if(f)out[code]=f;}return out;
  }
  function setValidation(title,detail,tone='neutral'){
    const p=$('#dcx3510Validation');if(!p)return;
    p.className=`equipment-validation ${tone}`;
    p.innerHTML=`<span class="equipment-validation-icon">${tone==='error'?'×':tone==='warn'?'!':'✓'}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`;
  }
  function registerCurrent(){
    const v=values(),bad=errorFor(v);
    if(bad){setValidation(bad[0],bad[1],'error');toast(bad[0],bad[1],'error');return false;}
    const hits=lookup(v.hostSn),match=hits[v.assignment]||null,other=ASSIGNMENTS.find(c=>c!==v.assignment&&hits[c]);
    if(other){
      const d=`${v.hostSn} aparece en el Excel de Asignación ${other}. Cambia la asignación antes de registrar.`;
      setValidation('Asignación no coincide con el Excel',d,'error');toast('Asignación incorrecta',d,'error');return false;
    }
    const p=resolvePlacement(state.records,v.assignment,v.requestedBox);
    const comparison=match?'ENCONTRADO':bases[v.assignment]?.rows?.length?'NO ENCONTRADO':'SIN BASE';
    const op=window.OperatorSession?.getCurrentOperator?.()||activeOperator;
    const row={
      id:crypto?.randomUUID?.()||`dcx-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      model:MODEL,assignment:v.assignment,box:p.box,boxPosition:p.position,
      mcardSn:v.mcardSn,mcardUa:v.mcardUa,hostSn:v.hostSn,estbMac:v.estbMac,docsisMac:v.docsisMac,
      comparison,excel:match?{...match}:null,operator:op?{id:op.id,name:op.name}:null,createdAt:new Date().toISOString()
    };
    state.records.push(row);state.selectedAssignment=v.assignment;state.boxByAssignment[v.assignment]=p.box;
    if(p.position===BOX_CAPACITY)state.boxByAssignment[v.assignment]=nextBoxValue(p.box);
    $('#dcx3510Box').value=state.boxByAssignment[v.assignment];
    persistNow();clearFields();render();
    const completed=p.position===BOX_CAPACITY;
    const d=`Asignación ${row.assignment} · Caja ${row.box} · ${row.boxPosition}/8 · ${comparison}${completed?' · Caja completa':''}`;
    setValidation(completed?'Caja completa':'Equipo registrado',d,comparison==='NO ENCONTRADO'?'warn':'ok');
    toast(completed?'Caja completa':'DCX3510 registrado',`${row.hostSn} · ${d}`,comparison==='NO ENCONTRADO'?'warn':'ok');
    $('#dcx3510McardSn')?.focus({preventScroll:true});return true;
  }
  function clearFields(){
    ['#dcx3510McardSn','#dcx3510McardUa','#dcx3510HostSn','#dcx3510EstbMac','#dcx3510DocsisMac'].forEach(s=>{const e=$(s);if(e)e.value='';});
  }
  function renderBase(){
    const t=$('#dcx3510BaseStatus');if(!t)return;
    const parts=ASSIGNMENTS.filter(c=>bases[c]?.rows?.length).map(c=>`${c}: ${bases[c].rows.length}`);
    if(!parts.length){t.innerHTML='<span class="file-index-dot"></span><span>Sin Excel de ingreso cargado.</span>';return;}
    const names=[...new Set(ASSIGNMENTS.map(c=>bases[c]?.fileName).filter(Boolean))];
    t.innerHTML=`<span class="file-index-dot indexed"></span><span>${esc(names.join(', '))} · ${esc(parts.join(' · '))}</span>`;
  }
  function renderBox(){
    const a=$('#dcx3510Assignment')?.value||state.selectedAssignment||'08';
    const box=norm($('#dcx3510Box')?.value)||state.boxByAssignment[a]||'01';
    const count=state.records.filter(r=>r.assignment===a&&String(r.box)===box).length;
    if($('#dcx3510BoxCount'))$('#dcx3510BoxCount').textContent=`${count} / 8`;
    if($('#dcx3510BoxLabel'))$('#dcx3510BoxLabel').textContent=`Asignación ${a} · Caja ${box}`;
  }
  function renderSummary(){
    const r=state.records;
    const vals={
      dcx3510Total:r.length,
      dcx3510Found:r.filter(x=>x.comparison==='ENCONTRADO').length,
      dcx3510Missing:r.filter(x=>x.comparison==='NO ENCONTRADO').length,
      dcx3510Boxes:new Set(r.map(x=>`${x.assignment}|${x.box}`)).size,
      dcx3510BaseCount:ASSIGNMENTS.reduce((s,c)=>s+(bases[c]?.rows?.length||0),0)
    };
    for(const [id,v] of Object.entries(vals)){const n=document.getElementById(id);if(n)n.textContent=String(v);}
  }
  function renderTable(){
    const b=$('#dcx3510Body');if(!b)return;
    if(!state.records.length){b.innerHTML='<tr><td colspan="13" class="equipment-empty">Sin equipos registrados.</td></tr>';return;}
    b.innerHTML=state.records.slice().reverse().map((r,i)=>{
      const n=state.records.length-i,tone=r.comparison==='ENCONTRADO'?'dcx-found':r.comparison==='NO ENCONTRADO'?'dcx-missing':'dcx-pending';
      const d=new Date(r.createdAt),stamp=Number.isNaN(d.getTime())?'':d.toLocaleString('es-PA');
      return `<tr><td>${n}</td><td><strong>${esc(r.assignment)}</strong></td><td>${esc(r.box)}</td><td>${r.boxPosition}/8</td>
      <td class="mono">${esc(r.hostSn)}</td><td class="mono">${esc(r.mcardSn)}</td><td class="mono">${esc(r.mcardUa)}</td>
      <td class="mono">${esc(r.estbMac)}</td><td class="mono">${esc(r.docsisMac)}</td>
      <td><span class="dcx-status ${tone}">${esc(r.comparison)}</span></td><td>${esc(r.excel?.n||'')}</td><td>${esc(stamp)}</td>
      <td><button type="button" class="action" data-dcx-delete="${esc(r.id)}">Eliminar</button></td></tr>`;
    }).join('');
  }
  function render(){
    const a=state.selectedAssignment||'08';
    if($('#dcx3510Assignment'))$('#dcx3510Assignment').value=a;
    const box=state.boxByAssignment[a]||'01';
    if($('#dcx3510Box')&&!$('#dcx3510Box').matches(':focus'))$('#dcx3510Box').value=box;
    renderBase();renderBox();renderSummary();renderTable();
  }
  function exportRegistry(){
    if(!state.records.length){toast('Sin registros','No hay equipos DCX3510 para exportar.','warn');return;}
    if(typeof XLSX==='undefined'){toast('Excel no disponible','No se cargó la librería XLSX.','error');return;}
    const rows=state.records.map((r,i)=>({
      '#':i+1,'Modelo':r.model,'Asignación':r.assignment,'Caja':r.box,'Posición caja':`${r.boxPosition}/8`,
      'MCARD SN':r.mcardSn,'MCARD UA':r.mcardUa,'HOST SN':r.hostSn,'eSTB MAC':r.estbMac,'DOCSIS MAC':r.docsisMac,
      'Comparación Excel':r.comparison,'N Excel':r.excel?.n||'','Procedencia Excel':r.excel?.procedencia||'',
      'Modelo Excel':r.excel?.modelo||'','Fila Excel':r.excel?.sourceRow||'','Operador':r.operator?.name||activeOperator?.name||'','Fecha/Hora':r.createdAt
    }));
    const summary=ASSIGNMENTS.map(c=>{
      const list=state.records.filter(r=>r.assignment===c);
      return {'Asignación':c,'Equipos':list.length,'Cajas':new Set(list.map(r=>r.box)).size,'Encontrados':list.filter(r=>r.comparison==='ENCONTRADO').length,'No encontrados':list.filter(r=>r.comparison==='NO ENCONTRADO').length,'Base cargada':bases[c]?.rows?.length||0};
    });
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Registro DCX3510');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Resumen');
    const op=upper(activeOperator?.name||window.OperatorSession?.getCurrentOperator?.()?.name||'OPERADOR').replace(/[^A-Z0-9]+/g,'-');
    const d=new Date(),p=v=>String(v).padStart(2,'0'),stamp=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    XLSX.writeFile(wb,`DCX3510_${op}_${stamp}.xlsx`);
    toast('Registro DCX3510 exportado',`${state.records.length} equipos.`,'ok');
  }
  function onOperator(op){
    activeOperator=op?.id?{id:op.id,name:op.name||'Operador'}:window.OperatorSession?.getCurrentOperator?.();
    loadStorage();if(!$('#dcx3510Panel'))install();render();
  }
  function boot(){
    install();
    const current=window.OperatorSession?.getCurrentOperator?.();if(current)onOperator(current);
    window.addEventListener('beforeunload',persistNow);
  }
  document.addEventListener('operator:login',e=>onOperator(e.detail||null));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();

  window.DCX3510Registry={
    version:VERSION,model:MODEL,boxCapacity:BOX_CAPACITY,assignments:[...ASSIGNMENTS],
    getRecords:()=>state.records.map(r=>({...r})),
    getBases:()=>JSON.parse(JSON.stringify(bases)),
    registerCurrent,exportRegistry,persistNow
  };
})();