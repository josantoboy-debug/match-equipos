(() => {
  'use strict';

  const VERSION='20260831-crossmatch1';
  const Contract=window.MatchCrossContract;
  if(!Contract){console.error('MatchCrossContract no está cargado.');return;}

  const state={excelFile:'',excelRecords:[],txtRecords:[],txtSources:new Map(),errors:[]};
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const ext=name=>String(name||'').toLowerCase().split('.').pop();
  const uniqueFiles=files=>{
    const out=[],seen=new Set();
    for(const file of files||[]){
      if(!file||!/^txt$/i.test(ext(file.name))) continue;
      const key=`${file.webkitRelativePath||''}|${file.name}|${file.size}|${file.lastModified}`;
      if(seen.has(key)) continue;seen.add(key);out.push(file);
    }
    return out;
  };

  function roleLabel(role){
    if(role==='CARCASA')return 'CARCASA';
    if(role==='EQUIPO')return 'EQUIPO';
    if(role==='ENCONTRADO')return 'ENCONTRADO PREVIO';
    return role||'REGISTRO';
  }

  function statusText(){
    const txtLines=[...state.txtSources.values()].reduce((n,x)=>n+x.records,0);
    const parts=[];
    parts.push(state.excelFile?`Excel: ${state.excelFile} · ${state.excelRecords.length} registros`:'Excel maestro: no cargado');
    parts.push(state.txtSources.size?`TXT: ${state.txtSources.size} archivo${state.txtSources.size===1?'':'s'} · ${txtLines} líneas válidas`:'TXT: sin bases cargadas');
    if(state.errors.length) parts.push(`${state.errors.length} advertencia${state.errors.length===1?'':'s'}`);
    return parts.join(' · ');
  }

  function updateStatus(){
    const el=$('#crossMatchStatus'); if(!el)return;
    const ready=Boolean(state.excelRecords.length||state.txtRecords.length);
    el.className=`cross-match-status${ready?' ready':''}${state.errors.length?' warning':''}`;
    el.innerHTML=`<span class="cross-match-dot"></span><span>${esc(statusText())}</span>`;
    el.title=state.errors.slice(0,20).map(e=>`${e.file||''}${e.sheet?` · ${e.sheet}`:''}${e.lineNumber?` · línea ${e.lineNumber}`:''}: ${e.message}`).join('\n');
  }

  function refreshSearch(){
    if(window.MatchSearchModes&&typeof window.MatchSearchModes.executeSearch==='function') window.MatchSearchModes.executeSearch();
  }

  function ingestWorkbookModel(fileName,sheets){
    const parsed=Contract.parseWorkbookModel(fileName,sheets);
    state.excelFile=String(fileName||'Excel');
    state.excelRecords=parsed.records;
    state.errors=state.errors.filter(e=>e.scope!=='EXCEL');
    state.errors.push(...parsed.errors.map(e=>({...e,scope:'EXCEL'})));
    updateStatus();refreshSearch();
    return parsed;
  }

  async function loadExcelFile(file){
    if(!file) return null;
    if(typeof XLSX==='undefined') throw new Error('SheetJS no está disponible para leer el Excel.');
    if(!/^(xlsx|xls|xlsm|xlsb|ods)$/i.test(ext(file.name))) throw new Error('Selecciona un archivo Excel compatible.');
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:'array',cellText:true,cellDates:false});
    const sheets=wb.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:''})}));
    return ingestWorkbookModel(file.name,sheets);
  }

  function ingestTxtText(fileName,text,{replace=true}={}){
    const parsed=Contract.parseTxt(text,fileName);
    if(replace){
      state.txtRecords=state.txtRecords.filter(r=>r.file!==fileName);
      state.errors=state.errors.filter(e=>!(e.scope==='TXT'&&e.file===fileName));
    }
    state.txtRecords.push(...parsed.records);
    state.txtSources.set(fileName,{records:parsed.records.length,totalLines:parsed.totalLines,errors:parsed.errors.length});
    state.errors.push(...parsed.errors.map(e=>({...e,scope:'TXT'})));
    updateStatus();refreshSearch();
    return parsed;
  }

  async function loadTxtFiles(files){
    const list=uniqueFiles(files);
    if(!list.length) throw new Error('No se encontraron archivos .txt compatibles.');
    const failures=[];
    for(const file of list){
      try{ingestTxtText(file.webkitRelativePath||file.name,await file.text());}
      catch(error){failures.push({file:file.name,message:error.message||String(error),scope:'TXT'});}
    }
    state.errors.push(...failures);updateStatus();refreshSearch();
    return {loaded:list.length-failures.length,failed:failures.length};
  }

  function clearSources(){
    state.excelFile='';state.excelRecords=[];state.txtRecords=[];state.txtSources.clear();state.errors=[];
    updateStatus();refreshSearch();
  }

  function matchedFieldText(fields){return (fields||[]).map(f=>`${f.field}: ${f.value}`).join(' · ');}

  function linkCard(link){
    const e=link.excel,t=link.txt;
    const sentence=link.exactPair
      ? `El registro ${roleLabel(e.role)} ${e.srRaw||e.uaRaw} de ${e.file} (hoja “${e.sheet}”, fila ${e.rowNumber}) se encontró en ${t.file} (línea ${t.lineNumber}).`
      : `Coincidencia parcial de identidad entre ${e.file} (hoja “${e.sheet}”, fila ${e.rowNumber}) y ${t.file} (línea ${t.lineNumber}) por ${link.matchKind}.`;
    return `<article class="cross-match-card ${link.exactPair?'exact':'related'}">
      <div class="cross-match-head"><span class="mini-badge ${link.exactPair?'ok':'warn'}">${link.exactPair?'CRUCE EXACTO':'CRUCE RELACIONADO'}</span><strong>${esc(roleLabel(e.role))}</strong></div>
      <p class="cross-match-sentence">${esc(sentence)}</p>
      <div class="cross-match-grid">
        <div><span>Excel</span><strong>${esc(e.file)}</strong><small>Hoja: ${esc(e.sheet)} · fila ${e.rowNumber}</small><code>SR: ${esc(e.srRaw||'—')}</code><code>UA: ${esc(e.uaRaw||'—')}</code></div>
        <div><span>TXT</span><strong>${esc(t.file)}</strong><small>Línea: ${t.lineNumber}</small><code>CARCASA: ${esc(t.carcasaRaw||'—')}</code><code>EQUIPO: ${esc(t.equipoRaw||'—')}</code></div>
      </div>
      <div class="cross-match-proof"><span>${link.srMatch?'✓ SR = EQUIPO':'— SR ≠ EQUIPO'}</span><span>${link.uaMatch?'✓ UA = CARCASA':'— UA ≠ CARCASA'}</span></div>
    </article>`;
  }

  function excelHitCard(e){
    return `<article class="cross-source-hit"><div><span class="mini-badge">EXCEL · ${esc(roleLabel(e.role))}</span><strong>${esc(e.file)}</strong></div><p>${esc(matchedFieldText(e.matchedFields))}</p><small>Hoja: <strong>${esc(e.sheet)}</strong> · fila <strong>${e.rowNumber}</strong> · SR: <code>${esc(e.srRaw||'—')}</code> · UA: <code>${esc(e.uaRaw||'—')}</code></small></article>`;
  }

  function txtHitCard(t){
    return `<article class="cross-source-hit"><div><span class="mini-badge">TXT</span><strong>${esc(t.file)}</strong></div><p>${esc(matchedFieldText(t.matchedFields))}</p><small>Línea <strong>${t.lineNumber}</strong> · CARCASA: <code>${esc(t.carcasaRaw||'—')}</code> · EQUIPO: <code>${esc(t.equipoRaw||'—')}</code></small></article>`;
  }

  function appendResults(query,resultsElement){
    if(!resultsElement)return;
    resultsElement.querySelectorAll('.cross-match-section').forEach(n=>n.remove());
    const q=String(query??'').trim();
    if(!q||(!state.excelRecords.length&&!state.txtRecords.length))return;
    const result=Contract.search(q,state.excelRecords,state.txtRecords);
    const hasAny=result.excelHits.length||result.txtHits.length||result.links.length;
    const linkedExcel=new Set(result.links.map(x=>`${x.excel.file}|${x.excel.sheet}|${x.excel.rowNumber}`));
    const linkedTxt=new Set(result.links.map(x=>`${x.txt.file}|${x.txt.lineNumber}`));
    const unlinkedExcel=result.excelHits.filter(e=>!linkedExcel.has(`${e.file}|${e.sheet}|${e.rowNumber}`));
    const unlinkedTxt=result.txtHits.filter(t=>!linkedTxt.has(`${t.file}|${t.lineNumber}`));
    const summary=hasAny
      ? `<strong>${result.links.length} cruce${result.links.length===1?'':'s'}</strong> · ${result.excelHits.length} coincidencia${result.excelHits.length===1?'':'s'} Excel · ${result.txtHits.length} coincidencia${result.txtHits.length===1?'':'s'} TXT`
      : '<strong>Sin coincidencia</strong> en el Excel maestro ni en las bases TXT cargadas.';
    const body=`<section class="cross-match-section" aria-label="Cruce Excel y TXT">
      <div class="cross-match-section-head"><span>CRUCE EXCEL ↔ TXT</span><div>${summary}</div></div>
      ${result.links.map(linkCard).join('')}
      ${unlinkedExcel.length?`<details class="cross-match-details" open><summary>Coincidencias solo en Excel (${unlinkedExcel.length})</summary>${unlinkedExcel.map(excelHitCard).join('')}</details>`:''}
      ${unlinkedTxt.length?`<details class="cross-match-details" open><summary>Coincidencias solo en TXT (${unlinkedTxt.length})</summary>${unlinkedTxt.map(txtHitCard).join('')}</details>`:''}
      ${!hasAny?'<div class="cross-match-empty">SIN COINCIDENCIA · Verifica el código o carga más bases TXT.</div>':''}
    </section>`;
    resultsElement.insertAdjacentHTML('afterbegin',body);
  }

  function bind(){
    const excelBtn=$('#crossMatchExcelBtn'),txtBtn=$('#crossMatchTxtBtn'),folderBtn=$('#crossMatchFolderBtn'),clearBtn=$('#crossMatchClearBtn');
    const excelInput=$('#crossMatchExcelInput'),txtInput=$('#crossMatchTxtInput'),folderInput=$('#crossMatchFolderInput');
    if(!excelBtn||!txtBtn||!excelInput||!txtInput)return;
    excelBtn.addEventListener('click',()=>excelInput.click());
    txtBtn.addEventListener('click',()=>txtInput.click());
    folderBtn?.addEventListener('click',()=>folderInput?.click());
    clearBtn?.addEventListener('click',clearSources);
    excelInput.addEventListener('change',async()=>{
      try{await loadExcelFile(excelInput.files?.[0]);}
      catch(error){state.errors.push({file:excelInput.files?.[0]?.name||'Excel',message:error.message||String(error),scope:'EXCEL'});updateStatus();}
      finally{excelInput.value='';}
    });
    txtInput.addEventListener('change',async()=>{
      try{await loadTxtFiles(txtInput.files);}
      catch(error){state.errors.push({file:'TXT',message:error.message||String(error),scope:'TXT'});updateStatus();}
      finally{txtInput.value='';}
    });
    folderInput?.addEventListener('change',async()=>{
      try{await loadTxtFiles(folderInput.files);}
      catch(error){state.errors.push({file:'Carpeta TXT',message:error.message||String(error),scope:'TXT'});updateStatus();}
      finally{folderInput.value='';}
    });
    updateStatus();
  }

  document.addEventListener('DOMContentLoaded',bind);
  window.MatchCrossSearch={version:VERSION,appendResults,loadExcelFile,loadTxtFiles,ingestWorkbookModel,ingestTxtText,clear:clearSources,getStats:()=>({excelFile:state.excelFile,excelRecords:state.excelRecords.length,txtFiles:state.txtSources.size,txtRecords:state.txtRecords.length,errors:state.errors.length}),search:q=>Contract.search(q,state.excelRecords,state.txtRecords)};
})();
