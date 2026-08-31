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

  function parseWorkbookModel(fileName,sheets){
    const records=[];
    const errors=[];
    for(const sheet of sheets||[]){
      const name=String(sheet?.name||'Hoja');
      const rows=Array.isArray(sheet?.rows)?sheet.rows:[];
      const header=findHeader(rows);
      if(!header){
        if(rows.some(row=>Array.isArray(row)&&row.some(v=>String(v??'').trim()))) errors.push({file:fileName,sheet:name,message:'No se detectó columna SR/Serial/Host SN ni UA.'});
        continue;
      }
      for(let i=header.row+1;i<rows.length;i++){
        const row=Array.isArray(rows[i])?rows[i]:[];
        const srRaw=header.sr>=0?String(row[header.sr]??'').trim():'';
        const uaRaw=header.ua>=0?String(row[header.ua]??'').trim():'';
        const typeRaw=header.type>=0?String(row[header.type]??'').trim():'';
        if(!srRaw&&!uaRaw) continue;
        records.push({
          source:'EXCEL', file:String(fileName||'Excel'), sheet:name, rowNumber:i+1,
          role:rowRole(name,typeRaw), srRaw, uaRaw, typeRaw,
          srClean:partialCode(srRaw), uaClean:partialCode(uaRaw),
          srNorm:canonicalCode(srRaw), uaNorm:canonicalCode(uaRaw)
        });
      }
    }
    return {records,errors};
  }

  function parseTxt(text,fileName='base.txt'){
    const records=[];
    const errors=[];
    const lines=String(text??'').split(/\r?\n/);
    lines.forEach((raw,index)=>{
      const line=String(raw??'');
      if(!line.trim()) return;
      const cols=line.split('\t').map(v=>String(v??'').trim());
      if(cols.length<2){
        const one=cleanCode(cols[0]);
        if(!one || /^\d{1,5}$/.test(one) || /^(CARCASA|EQUIPO|SR|UA|SERIAL|HOSTSN)$/.test(one)) return;
        errors.push({file:fileName,lineNumber:index+1,raw:line,message:'Línea TXT sin dos columnas separadas por TAB.'});
        return;
      }
      const carcasaRaw=cols[0];
      const equipoRaw=cols[1];
      if(!carcasaRaw&&!equipoRaw) return;
      records.push({
        source:'TXT', file:String(fileName), lineNumber:index+1, raw:line,
        carcasaRaw,equipoRaw,
        carcasaClean:partialCode(carcasaRaw), equipoClean:partialCode(equipoRaw),
        carcasaNorm:canonicalCode(carcasaRaw), equipoNorm:canonicalCode(equipoRaw)
      });
    });
    return {records,errors,totalLines:lines.length};
  }

  function valueMatches(raw,norm,query,exactOnly=false){
    const qClean=partialCode(query);
    const qNorm=canonicalCode(query);
    if(!qClean) return false;
    const rawClean=partialCode(raw);
    if(norm && qNorm && norm===qNorm) return true;
    if(rawClean===qClean) return true;
    if(exactOnly || qClean.length<4) return false;
    if(rawClean.includes(qClean)) return true;
    if(/^\d+$/.test(qClean) && /^\d+$/.test(rawClean)) {
      const qNo=qClean.replace(/^0+/,'');
      const rawNo=rawClean.replace(/^0+/,'');
      return qNo.length>=4 && rawNo.includes(qNo);
    }
    return false;
  }

  function hitRank(raw,norm,query){
    const qClean=partialCode(query), qNorm=canonicalCode(query), rawClean=partialCode(raw);
    if(norm&&qNorm&&norm===qNorm) return 0;
    if(rawClean===qClean) return 0;
    return 1;
  }

  function search(query,excelRecords,txtRecords,{limit=200}={}){
    const q=String(query??'').trim();
    if(!partialCode(q)) return {query:q,excelHits:[],txtHits:[],links:[],total:0};
    const excelHits=[];
    const txtHits=[];
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

    const links=[];
    const linkSeen=new Set();
    const byEquipo=new Map(), byCarcasa=new Map();
    const pushMap=(map,key,value)=>{if(!key)return;(map.get(key)||map.set(key,[]).get(key)).push(value);};
    for(const t of txtRecords||[]){pushMap(byEquipo,t.equipoNorm,t);pushMap(byCarcasa,t.carcasaNorm,t);}
    const relevantExcel=new Set(excelHits.map(e=>`${e.file}|${e.sheet}|${e.rowNumber}`));
    const relevantTxt=new Set(txtHits.map(t=>`${t.file}|${t.lineNumber}`));
    for(const e of excelRecords||[]){
      const candidates=new Set([...(byEquipo.get(e.srNorm)||[]),...(byCarcasa.get(e.uaNorm)||[])]);
      for(const t of candidates){
        const eKey=`${e.file}|${e.sheet}|${e.rowNumber}`, tKey=`${t.file}|${t.lineNumber}`;
        if(!relevantExcel.has(eKey)&&!relevantTxt.has(tKey)) continue;
        const srMatch=Boolean(e.srNorm&&t.equipoNorm&&e.srNorm===t.equipoNorm);
        const uaMatch=Boolean(e.uaNorm&&t.carcasaNorm&&e.uaNorm===t.carcasaNorm);
        const key=`${eKey}|${tKey}`;
        if(linkSeen.has(key)) continue;
        linkSeen.add(key);
        links.push({excel:e,txt:t,srMatch,uaMatch,exactPair:srMatch&&uaMatch,matchKind:srMatch&&uaMatch?'PAR EXACTO':srMatch?'SR / EQUIPO':'UA / CARCASA'});
      }
    }

    const sortHits=(a,b)=>a.rank-b.rank || String(a.file).localeCompare(String(b.file),'es') || (a.rowNumber||a.lineNumber)-(b.rowNumber||b.lineNumber);
    excelHits.sort(sortHits);txtHits.sort(sortHits);
    links.sort((a,b)=>Number(b.exactPair)-Number(a.exactPair)||String(a.excel.file).localeCompare(String(b.excel.file),'es')||a.excel.rowNumber-b.excel.rowNumber||String(a.txt.file).localeCompare(String(b.txt.file),'es')||a.txt.lineNumber-b.txt.lineNumber);
    return {query:q,excelHits,txtHits,links,total:excelHits.length+txtHits.length};
  }

  return {cleanCode,canonicalCode,partialCode,normalizeHeader,classifyCode,sheetRole,findHeader,parseWorkbookModel,parseTxt,valueMatches,search};
});
