(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.MatchCrossContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const stripAccents=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cleanCode=v=>stripAccents(v).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  const canonicalCode=v=>{
    const clean=cleanCode(v);
    if(/^\d+$/.test(clean)) return clean.replace(/^0+(?=\d)/,'') || '0';
    return clean;
  };
  const partialCode=v=>cleanCode(v);
  const normalizeHeader=v=>stripAccents(v).trim().toLowerCase().replace(/[_\s]+/g,' ').replace(/\s*\/\s*/g,' / ');
  const headerKey=v=>normalizeHeader(v).replace(/[^a-z0-9]+/g,'');

  const SR_HEADERS=new Set(['sr','hostsn','host','serial','serialno','serialnumber','sn','hostserial','hostserialnumber']);
  const UA_HEADERS=new Set(['ua','unitaddress','uaunitaddress','address','uaoriginal','unitaddressoriginal']);
  const TYPE_HEADERS=new Set(['tipo','type','modo','mode']);

  function classifyCode(value){
    const clean=cleanCode(value);
    if(/^M[A-Z0-9]{5,}$/.test(clean)) return 'EQUIPO';
    if(/^\d+$/.test(clean)) return 'CARCASA';
    return 'DATO';
  }

  function sheetRole(name){
    const n=normalizeHeader(name);
    if(/equipos?\s+sin\s+carcasa/.test(n) || /equipos?\s+placa/.test(n)) return 'EQUIPO';
    if(/carcasa\s+equipos?/.test(n) || /carcasas?\s+sin\s+equipo/.test(n)) return 'CARCASA';
    if(/equipos?\s+encontrad/.test(n) || /encontrad/.test(n)) return 'ENCONTRADO';
    if(/equipos?\s+totales?/.test(n)) return 'TOTAL';
    return 'OTRO';
  }

  function findHeader(rows){
    for(let r=0;r<Math.min(rows.length,20);r++){
      const row=Array.isArray(rows[r])?rows[r]:[];
      const keys=row.map(headerKey);
      const sr=keys.findIndex(k=>SR_HEADERS.has(k));
      const ua=keys.findIndex(k=>UA_HEADERS.has(k));
      const type=keys.findIndex(k=>TYPE_HEADERS.has(k));
      if(sr>=0 || ua>=0) return {row:r,sr,ua,type,headers:row};
    }
    return null;
  }

  function rowRole(sheetName,typeValue){
    const fromSheet=sheetRole(sheetName);
    if(fromSheet!=='TOTAL'&&fromSheet!=='OTRO') return fromSheet;
    const t=normalizeHeader(typeValue);
    if(/carcasa/.test(t)) return 'CARCASA';
    if(/equipo|placa/.test(t)) return 'EQUIPO';
    if(/encontrad/.test(t)) return 'ENCONTRADO';
    return fromSheet;
  }

  function cellEntry(value,field,columnIndex){
    const raw=String(value??'').trim();
    return {field:String(field||`COL_${columnIndex+1}`),columnIndex:columnIndex+1,value:raw,clean:partialCode(raw),norm:canonicalCode(raw),kind:classifyCode(raw)};
  }

  function rowCells(row,headers=[]){
    const out=[];
    for(let j=0;j<row.length;j++){
      const raw=String(row[j]??'').trim();
      if(!raw) continue;
      const h=String(headers[j]??'').trim() || `COL_${j+1}`;
      out.push(cellEntry(raw,h,j));
    }
    return out;
  }

  function parseWorkbookModel(fileName,sheets){
    const records=[];
    const errors=[];
    for(const sheet of sheets||[]){
      const name=String(sheet?.name||'Hoja');
      const rows=Array.isArray(sheet?.rows)?sheet.rows:[];
      const header=findHeader(rows);
      let start=0, headers=[];
      if(header){start=header.row+1;headers=header.headers;}
      else {
        const firstNonEmpty=rows.find(r=>Array.isArray(r)&&r.some(v=>String(v??'').trim()));
        headers=Array.isArray(firstNonEmpty)?firstNonEmpty.map((_,i)=>`COL_${i+1}`):[];
        if(firstNonEmpty) errors.push({file:fileName,sheet:name,message:'Hoja sin encabezados SR/UA: se indexaron todas las celdas como datos genéricos.'});
      }
      for(let i=start;i<rows.length;i++){
        const row=Array.isArray(rows[i])?rows[i]:[];
        const cells=rowCells(row,headers);
        if(!cells.length) continue;
        const srRaw=header&&header.sr>=0?String(row[header.sr]??'').trim():'';
        const uaRaw=header&&header.ua>=0?String(row[header.ua]??'').trim():'';
        const typeRaw=header&&header.type>=0?String(row[header.type]??'').trim():'';
        records.push({
          source:'EXCEL',file:String(fileName||'Excel'),sheet:name,rowNumber:i+1,
          role:rowRole(name,typeRaw),srRaw,uaRaw,typeRaw,cells,
          srClean:partialCode(srRaw),uaClean:partialCode(uaRaw),
          srNorm:canonicalCode(srRaw),uaNorm:canonicalCode(uaRaw)
        });
      }
    }
    return {records,errors};
  }

  function delimiterFor(line){
    const options=['\t',';','|',','];
    let best='',count=0;
    for(const d of options){const n=(String(line).split(d).length-1);if(n>count){best=d;count=n;}}
    return best;
  }

  function parseTxt(text,fileName='base.txt'){
    const records=[];
    const errors=[];
    const lines=String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/);
    lines.forEach((raw,index)=>{
      const line=String(raw??'');
      if(!line.trim()) return;
      const delimiter=delimiterFor(line);
      const cols=(delimiter?line.split(delimiter):[line]).map(v=>String(v??'').trim().replace(/^["']|["']$/g,''));
      const cells=cols.map((v,i)=>cellEntry(v,i===0?'CARCASA':i===1?'EQUIPO':`COL_${i+1}`,i)).filter(c=>c.value);
      if(!cells.length) return;
      const pairValid=cols.length>=2;
      const carcasaRaw=pairValid?cols[0]:'';
      const equipoRaw=pairValid?cols[1]:'';
      if(!pairValid && !cleanCode(cols[0])) return;
      if(!pairValid) errors.push({file:fileName,lineNumber:index+1,raw:line,message:'Línea de una sola columna: indexada para búsqueda, no válida como par CARCASA↔EQUIPO.'});
      records.push({
        source:'TXT',file:String(fileName),lineNumber:index+1,raw:line,delimiter:delimiter||null,pairValid,cells,
        carcasaRaw,equipoRaw,
        carcasaClean:partialCode(carcasaRaw),equipoClean:partialCode(equipoRaw),
        carcasaNorm:canonicalCode(carcasaRaw),equipoNorm:canonicalCode(equipoRaw)
      });
    });
    return {records,errors,totalLines:lines.length};
  }

  function valueMatches(raw,norm,query,exactOnly=false){
    const qClean=partialCode(query),qNorm=canonicalCode(query);
    if(!qClean) return false;
    const rawClean=partialCode(raw);
    if(norm&&qNorm&&norm===qNorm) return true;
    if(rawClean===qClean) return true;
    if(exactOnly||qClean.length<4) return false;
    if(rawClean.includes(qClean)) return true;
    if(/^\d+$/.test(qClean)&&/^\d+$/.test(rawClean)){
      const qNo=qClean.replace(/^0+/,''),rawNo=rawClean.replace(/^0+/,'');
      return qNo.length>=4&&rawNo.includes(qNo);
    }
    return false;
  }

  function hitRank(raw,norm,query){
    const qClean=partialCode(query),qNorm=canonicalCode(query),rawClean=partialCode(raw);
    if(norm&&qNorm&&norm===qNorm) return 0;
    if(rawClean===qClean) return 0;
    return 1;
  }

  function discoveryEntries(excelRecords,txtRecords){
    const out=[];
    for(const r of excelRecords||[]) for(const c of r.cells||[]) out.push({source:'EXCEL',file:r.file,sheet:r.sheet,rowNumber:r.rowNumber,role:r.role,field:c.field,columnIndex:c.columnIndex,value:c.value,clean:c.clean,norm:c.norm,kind:c.kind});
    for(const r of txtRecords||[]) for(const c of r.cells||[]) out.push({source:'TXT',file:r.file,lineNumber:r.lineNumber,pairValid:r.pairValid,field:c.field,columnIndex:c.columnIndex,value:c.value,clean:c.clean,norm:c.norm,kind:c.kind});
    return out;
  }

  function buildDiscoveryIndex(excelRecords,txtRecords){
    const entries=discoveryEntries(excelRecords,txtRecords),exact=new Map();
    const add=(k,e)=>{if(!k)return;const list=exact.get(k)||[];list.push(e);exact.set(k,list);};
    for(const e of entries){add(`N:${e.norm}`,e);if(e.clean!==e.norm)add(`C:${e.clean}`,e);}
    return {entries,exact};
  }

  function discoverySearch(query,index,{limit=300}={}){
    const qClean=partialCode(query),qNorm=canonicalCode(query);
    if(!qClean||!index) return [];
    const out=[],seen=new Set();
    const push=e=>{const key=[e.source,e.file,e.sheet||'',e.rowNumber||e.lineNumber||'',e.columnIndex,e.value].join('|');if(seen.has(key)||out.length>=limit)return;seen.add(key);out.push(e);};
    for(const e of index.exact.get(`N:${qNorm}`)||[]) push({...e,matchType:'EXACTO'});
    for(const e of index.exact.get(`C:${qClean}`)||[]) push({...e,matchType:'EXACTO'});
    if(qClean.length>=4&&out.length<limit){
      for(const e of index.entries){
        if(out.length>=limit) break;
        if(valueMatches(e.value,e.norm,query)&&!(e.norm===qNorm||e.clean===qClean)) push({...e,matchType:'PARCIAL'});
      }
    }
    return out;
  }

  function search(query,excelRecords,txtRecords,{limit=200,discoveryIndex=null}={}){
    const q=String(query??'').trim();
    if(!partialCode(q)) return {query:q,excelHits:[],txtHits:[],links:[],discoveryHits:[],total:0};
    const excelHits=[],txtHits=[];
    for(const e of excelRecords||[]){
      const fields=[];
      if(e.srRaw&&valueMatches(e.srRaw,e.srNorm,q)) fields.push({field:'SR',value:e.srRaw,rank:hitRank(e.srRaw,e.srNorm,q)});
      if(e.uaRaw&&valueMatches(e.uaRaw,e.uaNorm,q)) fields.push({field:'UA',value:e.uaRaw,rank:hitRank(e.uaRaw,e.uaNorm,q)});
      if(fields.length) excelHits.push({...e,matchedFields:fields,rank:Math.min(...fields.map(x=>x.rank))});
    }
    for(const t of txtRecords||[]){
      const fields=[];
      if(t.carcasaRaw&&valueMatches(t.carcasaRaw,t.carcasaNorm,q)) fields.push({field:'CARCASA',value:t.carcasaRaw,rank:hitRank(t.carcasaRaw,t.carcasaNorm,q)});
      if(t.equipoRaw&&valueMatches(t.equipoRaw,t.equipoNorm,q)) fields.push({field:'EQUIPO',value:t.equipoRaw,rank:hitRank(t.equipoRaw,t.equipoNorm,q)});
      if(fields.length) txtHits.push({...t,matchedFields:fields,rank:Math.min(...fields.map(x=>x.rank))});
    }
    const links=[],linkSeen=new Set(),byEquipo=new Map(),byCarcasa=new Map();
    const pushMap=(map,key,value)=>{if(!key)return;const list=map.get(key)||[];list.push(value);map.set(key,list);};
    for(const t of txtRecords||[]){if(t.pairValid!==false){pushMap(byEquipo,t.equipoNorm,t);pushMap(byCarcasa,t.carcasaNorm,t);}}
    const relevantExcel=new Set(excelHits.map(e=>`${e.file}|${e.sheet}|${e.rowNumber}`));
    const relevantTxt=new Set(txtHits.map(t=>`${t.file}|${t.lineNumber}`));
    for(const e of excelRecords||[]){
      const candidates=new Set([...(byEquipo.get(e.srNorm)||[]),...(byCarcasa.get(e.uaNorm)||[])]);
      for(const t of candidates){
        const eKey=`${e.file}|${e.sheet}|${e.rowNumber}`,tKey=`${t.file}|${t.lineNumber}`;
        if(!relevantExcel.has(eKey)&&!relevantTxt.has(tKey)) continue;
        const srMatch=Boolean(e.srNorm&&t.equipoNorm&&e.srNorm===t.equipoNorm);
        const uaMatch=Boolean(e.uaNorm&&t.carcasaNorm&&e.uaNorm===t.carcasaNorm);
        const key=`${eKey}|${tKey}`;if(linkSeen.has(key))continue;linkSeen.add(key);
        links.push({excel:e,txt:t,srMatch,uaMatch,exactPair:srMatch&&uaMatch,matchKind:srMatch&&uaMatch?'PAR EXACTO':srMatch?'SR / EQUIPO':'UA / CARCASA'});
      }
    }
    const sortHits=(a,b)=>a.rank-b.rank||String(a.file).localeCompare(String(b.file),'es')||(a.rowNumber||a.lineNumber)-(b.rowNumber||b.lineNumber);
    excelHits.sort(sortHits);txtHits.sort(sortHits);
    links.sort((a,b)=>Number(b.exactPair)-Number(a.exactPair)||String(a.excel.file).localeCompare(String(b.excel.file),'es')||a.excel.rowNumber-b.excel.rowNumber||String(a.txt.file).localeCompare(String(b.txt.file),'es')||a.txt.lineNumber-b.txt.lineNumber);
    const idx=discoveryIndex||buildDiscoveryIndex(excelRecords,txtRecords);
    const discoveryHits=discoverySearch(q,idx,{limit});
    return {query:q,excelHits,txtHits,links,discoveryHits,total:excelHits.length+txtHits.length,discoveryTotal:discoveryHits.length};
  }

  return {cleanCode,canonicalCode,partialCode,normalizeHeader,classifyCode,sheetRole,findHeader,parseWorkbookModel,parseTxt,valueMatches,buildDiscoveryIndex,discoverySearch,search};
});
