(() => {
  'use strict';

  const state = {
    mode: 'Carcasa', records: [], matches: [], found: [], events: [],
    recordSeq: 1, matchSeq: 1, foundSeq: 1, eventSeq: 1,
    dirty: false, view: 'recent', filter: 'Todos', importPlans: [], importFile: ''
  };

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const now = () => new Date().toISOString();
  const fmt = v => { if(!v) return ''; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):d.toLocaleString('es-PA'); };
  const id = (prefix, key) => `${prefix}-${String(state[key]++).padStart(6,'0')}`;
  const normHost = v => String(v ?? '').trim().replace(/\s+/g,'').toUpperCase();
  const normUA = v => String(v ?? '').trim().replace(/[-\s]/g,'');
  const validHost = v => { const x=normHost(v); return {value:x, valid:x.length===12 && x.startsWith('M'), reason:x.length!==12?`Debe tener exactamente 12 caracteres; tiene ${x.length}.`:'Debe comenzar con M mayúscula.'}; };
  const validUA = v => { const x=normUA(v), reasons=[]; if(!/^\d+$/.test(x))reasons.push('solo debe contener dígitos'); if(x.length!==16)reasons.push(`debe tener 16 dígitos; tiene ${x.length}`); if(!x.startsWith('0000'))reasons.push('debe iniciar con 0000'); return {value:x, valid:!reasons.length, reason:reasons.join('; ')}; };
  const normalizeType = v => { const x=String(v??'').toLowerCase(); if(x.includes('carcasa'))return 'Carcasa'; if(x.includes('equipo')||x.includes('placa')||x.includes('modulo')||x.includes('módulo'))return 'Equipo'; if(x.includes('encontr'))return 'Encontrado previo'; return ''; };
  const opposite = t => t==='Carcasa'?'Equipo':'Carcasa';
  const pendingText = t => t==='Carcasa'?'PENDIENTE - EQUIPO NO ENCONTRADO':'PENDIENTE - CARCASA NO ENCONTRADA';

  function markDirty(){ state.dirty=true; $('#sessionBadge').textContent='Cambios sin exportar'; $('#sessionBadge').className='badge warn'; }
  function markSaved(){ state.dirty=false; $('#sessionBadge').textContent='Sesión exportada'; $('#sessionBadge').className='badge ok'; }
  function activeRecords(){ return state.records.filter(r=>!r.deleted); }
  function activeMatches(){ return state.matches.filter(m=>!m.voided); }
  function pending(type=''){ return activeRecords().filter(r=>!r.matchId && (!type||r.type===type)); }
  function getRecord(rid){ return activeRecords().find(r=>r.id===rid); }
  function statusClass(s=''){ s=s.toUpperCase(); if(s.includes('OK')||s.includes('COINCIDE'))return 'ok'; if(s.includes('REVISAR')||s.includes('DUPLIC')||s.includes('ADVERT'))return 'warn'; if(s.includes('PENDIENTE'))return 'pending'; if(s.includes('INVÁLIDO')||s.includes('ERROR'))return 'error'; return ''; }

  function addEvent(type, host, ua, result, detail=''){
    state.events.unshift({id:id('EVT','eventSeq'), at:now(), type, host, ua, result, detail});
    if(state.events.length>1000) state.events.length=1000;
  }

  function findCounterpart(rec){
    const list=pending(opposite(rec.type)).filter(r=>r.host===rec.host);
    if(!list.length)return null;
    return list.find(r=>r.uaNorm===rec.uaNorm)||list[0];
  }

  function createMatch(a,b,origin='Automático'){
    const carcasa=a.type==='Carcasa'?a:b, equipo=a.type==='Equipo'?a:b;
    const same=carcasa.uaNorm===equipo.uaNorm;
    const m={id:id('MATCH','matchSeq'), host:carcasa.host, carcasaId:carcasa.id, equipoId:equipo.id, uaCarcasa:carcasa.ua, uaEquipo:equipo.ua, atCarcasa:carcasa.at, atEquipo:equipo.at, at:now(), status:same?'OK - COINCIDE':'REVISAR - UA NO COINCIDE', origin, voided:false};
    state.matches.push(m); carcasa.matchId=m.id; equipo.matchId=m.id; carcasa.status=same?'MATCH OK':'REVISAR - UA NO COINCIDE'; equipo.status=carcasa.status; return m;
  }

  function register(type, hostInput, uaInput, opts={}){
    const hv=validHost(hostInput), uv=validUA(uaInput); type=normalizeType(type)||type;
    if(!['Carcasa','Equipo'].includes(type)) return {ok:false,code:'TYPE',title:'TIPO INVÁLIDO',message:'Selecciona Carcasa o Equipo.'};
    if(!hv.valid) return {ok:false,code:'HOST',title:'HOST SN INVÁLIDO',message:hv.reason};

    const sameType=activeRecords().filter(r=>r.type===type && r.host===hv.value);
    const dup=sameType.find(r=>r.uaNorm===uv.value);
    if(dup) return {ok:false,code:'DUP',title:'REGISTRO DUPLICADO',message:`Ya existe ${dup.id} con el mismo Tipo + Host SN + UA.`};
    const conflicts=sameType.filter(r=>r.uaNorm!==uv.value);
    if(conflicts.length && !opts.allowConflict) return {ok:false,code:'CONFLICT',title:'HOST SN YA REGISTRADO CON OTRO UA',message:`Ya existe ${hv.value} como ${type} con UA ${conflicts.map(r=>r.ua).join(', ')}.`};
    if(!uv.valid && !opts.allowUA) return {ok:false,code:'UA',title:'ADVERTENCIA - UA NO CUMPLE EL FORMATO',message:uv.reason};

    const rec={id:id('REG','recordSeq'), type, host:hv.value, ua:String(uaInput??'').trim(), uaNorm:uv.value, uaValid:uv.valid, at:opts.at||now(), origin:opts.origin||'Manual', status:pendingText(type), matchId:null, deleted:false};
    state.records.push(rec);
    const cp=findCounterpart(rec); let match=null;
    if(cp) match=createMatch(rec,cp,opts.imported?'Importación automática':'Registro automático');
    const result=match ? {ok:true,code:match.status.startsWith('OK')?'MATCH_OK':'MATCH_REVIEW',title:match.status.startsWith('OK')?'MATCH CORRECTO':'REVISAR UA',message:match.status.startsWith('OK')?'Host SN y UA coinciden.':'El Host SN coincide, pero el UA es diferente.',record:rec,match} : {ok:true,code:'PENDING',title:'PENDIENTE',message:`No se encontró todavía el ${opposite(type).toLowerCase()} correspondiente.`,record:rec};
    addEvent(type,rec.host,rec.ua,match?match.status:rec.status,match?match.id:'Pendiente'); markDirty(); return result;
  }

  function manualRegister(){
    const host=$('#hostInput').value, ua=$('#uaInput').value; let res=register(state.mode,host,ua);
    if(res.code==='UA'){
      if(!confirm(`ADVERTENCIA DE UA\n\n${res.message}\n\n¿Registrar de todas formas?`))return;
      res=register(state.mode,host,ua,{allowUA:true});
    }
    if(res.code==='CONFLICT'){
      if(!confirm(`HOST SN REPETIDO CON OTRO UA\n\n${res.message}\n\n¿Guardar el nuevo registro para revisión?`))return;
      res=register(state.mode,host,ua,{allowConflict:true});
      if(res.code==='UA'){
        if(!confirm(`El UA también tiene advertencia: ${res.message}\n\n¿Guardar de todas formas?`))return;
        res=register(state.mode,host,ua,{allowConflict:true,allowUA:true});
      }
    }
    showResult(res); renderAll();
    if(res.ok){ $('#hostInput').value=''; $('#uaInput').value=''; $('#hostInput').focus(); }
    else toast(res.title,res.message,'error');
  }

  function undoMatch(mid,silent=false){
    const m=activeMatches().find(x=>x.id===mid); if(!m)return;
    m.voided=true; m.voidedAt=now(); [m.carcasaId,m.equipoId].forEach(rid=>{const r=getRecord(rid); if(r){r.matchId=null;r.status=pendingText(r.type);}});
    addEvent('Sistema',m.host,'','MATCH DESHECHO',mid); markDirty(); if(!silent){toast('Match deshecho',mid,'warn');renderAll();}
  }

  function editRecord(rid){
    const r=getRecord(rid); if(!r)return;
    if(r.matchId && !confirm(`Este registro pertenece a ${r.matchId}. Para corregirlo se deshará el match y luego se intentará emparejar de nuevo. ¿Continuar?`))return;
    if(r.matchId) undoMatch(r.matchId,true);
    $('#editId').value=r.id; $('#editType').value=r.type; $('#editHost').value=r.host; $('#editUA').value=r.ua; openModal('editModal');
  }

  function saveEdit(){
    const r=getRecord($('#editId').value); if(!r)return;
    const type=$('#editType').value, hv=validHost($('#editHost').value), uv=validUA($('#editUA').value);
    if(!hv.valid){toast('HOST SN inválido',hv.reason,'error');return;}
    const dup=activeRecords().find(x=>x.id!==r.id&&x.type===type&&x.host===hv.value&&x.uaNorm===uv.value); if(dup){toast('Duplicado',`La corrección duplicaría ${dup.id}.`,'error');return;}
    if(!uv.valid && !confirm(`${uv.reason}\n\n¿Guardar el UA con advertencia?`))return;
    r.type=type;r.host=hv.value;r.ua=$('#editUA').value.trim();r.uaNorm=uv.value;r.uaValid=uv.valid;r.matchId=null;r.status=pendingText(type);r.editedAt=now();
    const cp=findCounterpart(r); if(cp)createMatch(r,cp,'Corrección manual'); addEvent(type,r.host,r.ua,'REGISTRO CORREGIDO',r.id); markDirty(); closeModal('editModal'); renderAll(); toast('Registro actualizado',r.id,'ok');
  }

  function deleteRecord(rid){
    const r=getRecord(rid); if(!r)return; if(!confirm(`¿Eliminar ${r.id}\n${r.host} / ${r.ua}?`))return;
    if(r.matchId)undoMatch(r.matchId,true); r.deleted=true;r.deletedAt=now();addEvent(r.type,r.host,r.ua,'REGISTRO ELIMINADO',r.id);markDirty();renderAll();toast('Registro eliminado',r.id,'warn');
  }

  function addFound(host,ua,origin){
    const hv=validHost(host),uv=validUA(ua); if(!hv.valid)return false;
    if(state.found.some(f=>!f.deleted&&f.host===hv.value&&f.uaNorm===uv.value))return false;
    state.found.push({id:id('FOUND','foundSeq'),host:hv.value,ua:String(ua??'').trim(),uaNorm:uv.value,uaValid:uv.valid,at:now(),origin,deleted:false});markDirty();return true;
  }

  function reviewRows(){
    const rows=[];
    activeRecords().filter(r=>!r.uaValid).forEach(r=>rows.push(['UA INVÁLIDO',r.type,r.host,r.type==='Carcasa'?r.ua:'',r.type==='Equipo'?r.ua:'','El UA no cumple 16 dígitos iniciando en 0000.',fmt(r.at)]));
    activeMatches().filter(m=>m.status.startsWith('REVISAR')).forEach(m=>rows.push(['UA NO COINCIDE','Match',m.host,m.uaCarcasa,m.uaEquipo,'Host SN coincide, pero el UA es diferente.',fmt(m.at)]));
    ['Carcasa','Equipo'].forEach(type=>{const map={};activeRecords().filter(r=>r.type===type).forEach(r=>(map[r.host]??=[]).push(r));Object.entries(map).forEach(([host,list])=>{const uas=[...new Set(list.map(r=>r.uaNorm))];if(uas.length>1)rows.push(['HOST SN REPETIDO CON OTRO UA',type,host,type==='Carcasa'?list.map(r=>r.ua).join(' | '):'',type==='Equipo'?list.map(r=>r.ua).join(' | '):'','Mismo Host SN con UA diferentes dentro del mismo tipo.',fmt(list[list.length-1].at)]);});});
    state.found.filter(f=>!f.deleted&&!f.uaValid).forEach(f=>rows.push(['UA INVÁLIDO','Encontrado previo',f.host,'',f.ua,'UA histórico fuera del formato esperado.',fmt(f.at)])); return rows;
  }

  function setMode(mode){state.mode=mode;$$('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('#hostInput').focus();}
  function showResult(res){
    const p=$('#resultPanel'); if(!res){p.className='result neutral';p.innerHTML='<div class="result-icon">⌁</div><div><h3>Listo para verificar</h3><p>Selecciona Carcasa o Equipo y escanea los dos códigos.</p></div>';return;}
    const cls=res.code==='MATCH_OK'?'ok':res.code==='MATCH_REVIEW'?'warn':res.code==='PENDING'?'pending':res.ok?'ok':'error', icon=cls==='ok'?'✓':cls==='warn'?'!':cls==='pending'?'…':'×';
    let codes=''; if(res.match)codes=`<div class="codes"><div><span>Host SN</span><strong>${esc(res.match.host)}</strong></div><div><span>UA Carcasa</span><strong>${esc(res.match.uaCarcasa)}</strong></div><div><span>UA Equipo</span><strong>${esc(res.match.uaEquipo)}</strong></div></div>`; else if(res.record)codes=`<div class="codes"><div><span>Host SN</span><strong>${esc(res.record.host)}</strong></div><div><span>UA</span><strong>${esc(res.record.ua)}</strong></div></div>`;
    p.className=`result ${cls}`;p.innerHTML=`<div class="result-icon">${icon}</div><div><h3>${esc(res.title)}</h3><p>${esc(res.message)}</p>${codes}</div>`;
  }

  function renderKPIs(){const rs=activeRecords(),ms=activeMatches(),ps=pending();const vals={kTotal:rs.length+state.found.filter(f=>!f.deleted).length,kCarcasas:rs.filter(r=>r.type==='Carcasa').length,kEquipos:rs.filter(r=>r.type==='Equipo').length,kMatches:ms.length,kOk:ms.filter(m=>m.status.startsWith('OK')).length,kReview:ms.filter(m=>m.status.startsWith('REVISAR')).length,kPC:ps.filter(r=>r.type==='Carcasa').length,kPE:ps.filter(r=>r.type==='Equipo').length};Object.entries(vals).forEach(([x,v])=>$('#'+x).textContent=v);}
  function passFilter(status,type){const f=state.filter;if(f==='Todos')return true;if(f==='OK')return /OK|COINCIDE/i.test(status);if(f==='Pendiente')return /PENDIENTE/i.test(status);if(f==='Revisar')return /REVISAR|ADVERT|INVÁLIDO|DUPLIC/i.test(status);if(f==='Carcasa')return type==='Carcasa';if(f==='Equipo')return type==='Equipo';return true;}
  function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}" class="empty">Sin registros.</td></tr>`}</tbody></table></div>`;}
  function renderWorkspace(){
    let html='';
    if(state.view==='recent') html=table(['Fecha/Hora','Tipo','Host SN','UA','Resultado'],state.events.slice(0,20).map(e=>`<tr><td>${fmt(e.at)}</td><td>${esc(e.type)}</td><td class="mono">${esc(e.host)}</td><td class="mono">${esc(e.ua)}</td><td><span class="status ${statusClass(e.result)}">${esc(e.result)}</span></td></tr>`));
    if(state.view==='all'){const rows=activeRecords().filter(r=>passFilter(r.status,r.type));html=table(['Tipo','Host SN','UA','Fecha/Hora','Estado','Acciones'],rows.map(r=>`<tr><td>${r.type}</td><td class="mono">${r.host}</td><td class="mono">${esc(r.ua)}</td><td>${fmt(r.at)}</td><td><span class="status ${statusClass(r.status)}">${esc(r.status)}</span></td><td class="actions"><button class="action" data-edit="${r.id}">Editar</button><button class="action danger" data-delete="${r.id}">Eliminar</button></td></tr>`));}
    if(state.view==='pending'){html=`<div class="split">${['Carcasa','Equipo'].map(type=>{const list=pending(type).filter(r=>passFilter(r.status,r.type));return `<section><div class="subhead"><h3>${type==='Carcasa'?'CARCASAS':'EQUIPOS'} PENDIENTES</h3><span>${list.length}</span></div>${table(['Host SN','UA','Fecha/Hora','Estado',''],list.map(r=>`<tr><td class="mono">${r.host}</td><td class="mono">${esc(r.ua)}</td><td>${fmt(r.at)}</td><td><span class="status pending">${esc(r.status)}</span></td><td><button class="action" data-edit="${r.id}">Editar</button></td></tr>`))}</section>`;}).join('')}</div>`;}
    if(state.view==='matches'){const list=activeMatches().filter(m=>passFilter(m.status,'Match'));html=table(['ID Match','Host SN','UA Carcasa','UA Equipo','Fecha Match','Estado',''],list.map(m=>`<tr><td class="mono">${m.id}</td><td class="mono">${m.host}</td><td class="mono">${esc(m.uaCarcasa)}</td><td class="mono">${esc(m.uaEquipo)}</td><td>${fmt(m.at)}</td><td><span class="status ${statusClass(m.status)}">${m.status}</span></td><td><button class="action danger" data-undo="${m.id}">Deshacer</button></td></tr>`));}
    if(state.view==='found'){const rows=[...activeMatches().map(m=>[m.host,m.uaCarcasa,m.uaEquipo,m.status,fmt(m.at),'Match']),...state.found.filter(f=>!f.deleted).map(f=>[f.host,'',f.ua,'ENCONTRADO PREVIO',fmt(f.at),f.origin])];html=table(['Host SN','UA Carcasa','UA Equipo','Resultado','Fecha','Origen'],rows.map(r=>`<tr><td class="mono">${r[0]}</td><td class="mono">${esc(r[1])}</td><td class="mono">${esc(r[2])}</td><td><span class="status ${statusClass(r[3])}">${esc(r[3])}</span></td><td>${r[4]}</td><td>${esc(r[5])}</td></tr>`));}
    if(state.view==='review'){const rows=reviewRows();html=table(['Problema','Tipo','Host SN','UA Carcasa','UA Equipo','Descripción','Fecha/Hora'],rows.map(r=>`<tr><td><span class="status warn">${esc(r[0])}</span></td><td>${esc(r[1])}</td><td class="mono">${esc(r[2])}</td><td class="mono">${esc(r[3])}</td><td class="mono">${esc(r[4])}</td><td>${esc(r[5])}</td><td>${esc(r[6])}</td></tr>`));}
    $('#workspaceBody').innerHTML=html; wireActions();
  }
  function wireActions(){$$('[data-edit]').forEach(b=>b.onclick=()=>editRecord(b.dataset.edit));$$('[data-delete]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.delete));$$('[data-undo]').forEach(b=>b.onclick=()=>{if(confirm(`¿Deshacer ${b.dataset.undo}?`))undoMatch(b.dataset.undo);});}
  function updateCounts(){const c={cRecent:state.events.length,cPending:pending().length,cAll:activeRecords().length,cMatches:activeMatches().length,cFound:activeMatches().length+state.found.filter(f=>!f.deleted).length,cReview:reviewRows().length};Object.entries(c).forEach(([x,v])=>$('#'+x).textContent=v);}
  function renderSearch(){const q=normUA($('#searchInput').value.toUpperCase());if(!q){$('#searchResults').innerHTML='<div class="empty">Sin búsqueda activa.</div>';return;}const rows=[];activeRecords().forEach(r=>{if(r.host.includes(q)||r.uaNorm.includes(q)){const m=r.matchId?activeMatches().find(x=>x.id===r.matchId):null,cp=m?getRecord(r.type==='Carcasa'?m.equipoId:m.carcasaId):null;rows.push(`<div class="search-card"><div><span class="mini-badge">${r.type}</span> <b class="mono">${r.host}</b></div><div class="mono muted">${esc(r.ua)}</div><div><span class="status ${statusClass(r.status)}">${esc(r.status)}</span></div>${cp?`<div>Contraparte: ${cp.type} · <span class="mono">${esc(cp.ua)}</span></div>`:''}</div>`);}});state.found.filter(f=>!f.deleted).forEach(f=>{if(f.host.includes(q)||f.uaNorm.includes(q))rows.push(`<div class="search-card"><div><span class="mini-badge">Encontrado previo</span> <b class="mono">${f.host}</b></div><div class="mono muted">${esc(f.ua)}</div></div>`);});$('#searchResults').innerHTML=rows.length?rows.join(''):'<div class="empty">No encontrado.</div>';}
  function renderAll(){renderKPIs();updateCounts();renderWorkspace();renderSearch();}

  // --------------------------- IMPORTACIÓN EXCEL ---------------------------
  const hostNames=['host sn','hostsn','host','serial','serial no','serial number','sn','sr'];
  const uaNames=['ua','unit address','ua / unit address','unitaddress','address','ua original'];
  const typeNames=['tipo','type','modo','mode'];
  const nh=v=>String(v??'').trim().toLowerCase().replace(/[_\s]+/g,' ');
  const col=(row,names)=>{const x=row.map(nh);return x.findIndex(v=>names.includes(v));};
  function headerInfo(rows){for(let i=0;i<Math.min(rows.length,12);i++){const h=rows[i]||[],hc=col(h,hostNames),uc=col(h,uaNames);if(hc>=0&&uc>=0)return{row:i,headers:h,host:hc,ua:uc,type:col(h,typeNames)};}return null;}
  function sideBySide(rows){for(let i=0;i<Math.min(rows.length,5);i++){const r=rows[i]||[],p=r.findIndex(v=>/equipos?\s*placa/i.test(String(v??''))),c=r.findIndex(v=>/carcasa/i.test(String(v??'')));if(p>=0&&c>=0)return[{label:'Equipos placa',type:'Equipo',host:p,ua:p+1,start:i+2},{label:'Carcasa equipos',type:'Carcasa',host:c,ua:c+1,start:i+2}];}return null;}
  function makePlans(wb){const plans=[];const names=wb.SheetNames;const canonical=names.find(n=>nh(n)==='equipos totales');if(canonical){const rows=XLSX.utils.sheet_to_json(wb.Sheets[canonical],{header:1,raw:false,defval:''}),h=headerInfo(rows);if(h&&rows.slice(h.row+1).some(r=>r[h.host]||r[h.ua])){plans.push({sheet:canonical,label:canonical,kind:'generic',rows,h,start:h.row+1,typePreset:h.type>=0?'AUTO':''});return plans;}}
    names.forEach(name=>{const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:''});const side=sideBySide(rows);if(side){side.forEach(b=>plans.push({sheet:name,label:`${name} — ${b.label}`,kind:'fixed',rows,h:{host:b.host,ua:b.ua,type:-1,headers:[]},start:b.start,typePreset:b.type}));return;}const h=headerInfo(rows);if(!h)return;if(/encontrad/i.test(name))plans.push({sheet:name,label:`${name} — encontrados previos`,kind:'found',rows,h,start:h.row+1,typePreset:'Encontrado previo'});else{let preset=h.type>=0?'AUTO':(/carcasa/i.test(name)?'Carcasa':(/equipo|placa/i.test(name)?'Equipo':''));plans.push({sheet:name,label:name,kind:'generic',rows,h,start:h.row+1,typePreset:preset});}});return plans;}
  function planCount(p){return p.rows.slice(p.start).filter(r=>String(r[p.h.host]??'').trim()||String(r[p.h.ua]??'').trim()).length;}
  function showImport(){const total=state.importPlans.reduce((n,p)=>n+planCount(p),0);$('#importSummary').innerHTML=`<div class="sum"><span>Archivo</span><strong>${esc(state.importFile)}</strong></div><div class="sum"><span>Bloques</span><strong>${state.importPlans.length}</strong></div><div class="sum"><span>Registros</span><strong>${total}</strong></div><div class="sum"><span>Motor</span><strong>SheetJS</strong></div>`;$('#importBlocks').innerHTML=state.importPlans.length?state.importPlans.map((p,i)=>`<div class="import-block"><div class="import-block-head"><label><input type="checkbox" class="include" data-i="${i}" checked> ${esc(p.label)}</label>${p.typePreset&&p.typePreset!=='AUTO'?`<span class="mini-badge">${p.typePreset}</span>`:p.typePreset==='AUTO'?'<span class="mini-badge">Tipo desde columna</span>':`<select class="type-select" data-i="${i}"><option value="">Seleccionar tipo…</option><option>Carcasa</option><option>Equipo</option></select>`}</div><p>${planCount(p)} filas detectadas · Hoja: ${esc(p.sheet)}</p></div>`).join(''):'<div class="empty">No se detectaron columnas Host SN + UA.</div>';openModal('importModal');}
  async function readExcel(file){try{if(typeof XLSX==='undefined')throw new Error('No se pudo cargar el módulo Excel. Verifica tu conexión a internet y recarga la página.');const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array',cellText:true,cellDates:false});state.importFile=file.name;state.importPlans=makePlans(wb);showImport();}catch(e){toast('Error al importar',e.message||String(e),'error');}finally{$('#fileInput').value='';}}
  function runImport(){let added=0,dups=0,before=activeMatches().length;state.importPlans.forEach((p,i)=>{const include=$(`.include[data-i="${i}"]`);if(include&&!include.checked)return;let preset=p.typePreset;if(!preset){preset=$(`.type-select[data-i="${i}"]`)?.value||'';if(!preset)return;}p.rows.slice(p.start).forEach(row=>{const host=row[p.h.host],ua=row[p.h.ua];if(!String(host??'').trim()&&!String(ua??'').trim())return;let type=p.kind==='found'?'Encontrado previo':preset==='AUTO'?normalizeType(row[p.h.type]):preset;if(type==='Encontrado previo'){if(addFound(host,ua,`Importado: ${state.importFile} / ${p.sheet}`))added++;else dups++;return;}if(!['Carcasa','Equipo'].includes(type))return;const res=register(type,host,ua,{allowUA:true,allowConflict:true,imported:true,origin:`Importado: ${state.importFile} / ${p.sheet}`});if(res.ok)added++;else if(res.code==='DUP')dups++;});});const newMatches=activeMatches().length-before;closeModal('importModal');showResult({ok:true,code:'IMPORT',title:'IMPORTACIÓN COMPLETADA',message:`${added} registros agregados · ${newMatches} matches nuevos · ${dups} duplicados omitidos.`});renderAll();toast('Excel importado',`${added} registros procesados.`,'ok');}

  // --------------------------- EXPORTACIÓN EXCEL ---------------------------
  function makeSheet(rows,widths){const ws=XLSX.utils.aoa_to_sheet(rows);ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(0,rows.length-1),c:Math.max(0,rows[0].length-1)}})};ws['!cols']=widths.map(w=>({wch:w}));Object.keys(ws).forEach(a=>{if(a[0]==='!')return;const c=ws[a];if(typeof c.v==='string')c.t='s';});return ws;}
  function exportExcel(){if(typeof XLSX==='undefined'){toast('Excel no disponible','Recarga la página con conexión a internet.','error');return;}const wb=XLSX.utils.book_new();const totals=[['ID','Tipo','Host SN','UA Original','UA Normalizado','Fecha/Hora','Origen','Estado']];activeRecords().forEach(r=>totals.push([r.id,r.type,r.host,r.ua,r.uaNorm,fmt(r.at),r.origin,r.status]));state.found.filter(f=>!f.deleted).forEach(f=>totals.push([f.id,'Encontrado previo',f.host,f.ua,f.uaNorm,fmt(f.at),f.origin,'ENCONTRADO PREVIO']));const matches=[['ID Match','Host SN','UA Carcasa','UA Equipo','Fecha/Hora Carcasa','Fecha/Hora Equipo','Fecha Match','Estado']];activeMatches().forEach(m=>matches.push([m.id,m.host,m.uaCarcasa,m.uaEquipo,fmt(m.atCarcasa),fmt(m.atEquipo),fmt(m.at),m.status]));const found=[['Host SN','UA Carcasa','UA Equipo','Resultado','Fecha Match']];activeMatches().forEach(m=>found.push([m.host,m.uaCarcasa,m.uaEquipo,m.status,fmt(m.at)]));state.found.filter(f=>!f.deleted).forEach(f=>found.push([f.host,'',f.ua,'ENCONTRADO PREVIO',fmt(f.at)]));const pend=[['Tipo','Host SN','UA','Fecha/Hora','Estado']];pending().forEach(r=>pend.push([r.type,r.host,r.ua,fmt(r.at),r.status]));const rev=[['Tipo de problema','Tipo','Host SN','UA Carcasa','UA Equipo','Descripción','Fecha/Hora'],...reviewRows()];[[totals,'Equipos totales',[14,18,18,24,22,22,38,30]],[matches,'Equipos match',[16,18,24,24,22,22,22,28]],[found,'Equipos encontrados',[18,24,24,28,22]],[pend,'Pendientes',[16,18,24,22,32]],[rev,'Revisar',[30,16,18,26,26,52,22]]].forEach(([rows,name,widths])=>XLSX.utils.book_append_sheet(wb,makeSheet(rows,widths),name));const d=new Date(),p=n=>String(n).padStart(2,'0'),name=`Match_Equipos_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;XLSX.writeFile(wb,name,{compression:true});markSaved();toast('Excel exportado',name,'ok');}

  function openModal(id){$('#'+id).classList.add('open');}
  function closeModal(id){$('#'+id).classList.remove('open');}
  let toastTimer;function toast(title,msg,tone=''){const t=$('#toast');t.className=`toast show ${tone}`;t.innerHTML=`<strong>${esc(title)}</strong><span>${esc(msg)}</span>`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4200);}
  function clearSession(){if(!confirm('Se borrarán todos los datos de la sesión actual. ¿Continuar?'))return;state.records=[];state.matches=[];state.found=[];state.events=[];state.recordSeq=1;state.matchSeq=1;state.foundSeq=1;state.eventSeq=1;state.dirty=false;$('#sessionBadge').textContent='Sesión en memoria';$('#sessionBadge').className='badge';showResult(null);renderAll();}
  function init(){
    $$('.mode').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$('#registerBtn').onclick=manualRegister;$('#hostInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#uaInput').focus();}};$('#uaInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();manualRegister();}};
    $('#importBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>readExcel(e.target.files?.[0]);$('#runImport').onclick=runImport;$('#exportBtn').onclick=exportExcel;$('#newSessionBtn').onclick=clearSession;$('#searchInput').oninput=renderSearch;$('#saveEdit').onclick=saveEdit;
    $$('.tabs button').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;$$('.tabs button').forEach(x=>x.classList.toggle('active',x===b));renderWorkspace();});$$('.filters button').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$$('.filters button').forEach(x=>x.classList.toggle('active',x===b));renderWorkspace();});$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));$$('.modal').forEach(m=>m.onclick=e=>{if(e.target===m)closeModal(m.id);});window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});setMode('Carcasa');showResult(null);renderAll();
  }
  document.addEventListener('DOMContentLoaded',init);
})();