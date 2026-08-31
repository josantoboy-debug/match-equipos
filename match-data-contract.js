(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.MatchDataContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const HOST_RE=/\bM[A-Z0-9]{11}\b/i;
  const UA_DASHED_RE=/\b\d{3}-\d{5}-\d{5}-\d{3}\b/g;
  const UA_COMPACT_RE=/\b\d{16}\b/g;

  const stripAccents=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const normalizeLabel=v=>stripAccents(v).trim().toLowerCase().replace(/[_\s]+/g,' ');
  const normalizeHost=v=>String(v??'').trim().replace(/\s+/g,'').toUpperCase();
  const normalizeUA=v=>String(v??'').trim().replace(/[-\s]/g,'');
  const coerceUA=v=>{
    const raw=String(v??'').trim();
    const compact=normalizeUA(raw).replace(/\.0$/,'');
    if(/^\d{12}$/.test(compact)) return `0000${compact}`;
    return compact;
  };
  const validHost=v=>{const x=normalizeHost(v);return {value:x,valid:/^M[A-Z0-9]{11}$/.test(x),reason:x.length!==12?`Debe tener exactamente 12 caracteres; tiene ${x.length}.`:'Debe comenzar con M y usar solo letras/números.'};};
  const validUA=v=>{const x=coerceUA(v),reasons=[];if(!/^\d+$/.test(x))reasons.push('solo debe contener dígitos');if(x.length!==16)reasons.push(`debe tener 16 dígitos; tiene ${x.length}`);if(!x.startsWith('0000'))reasons.push('debe iniciar con 0000');return {value:x,valid:!reasons.length,reason:reasons.join('; ')};};
  const exactPair=(a,b)=>normalizeHost(a?.host??a?.serial)===normalizeHost(b?.host??b?.serial)&&coerceUA(a?.ua??a?.unitAddress)===coerceUA(b?.ua??b?.unitAddress);

  function classifyPendingLabel(value){
    const x=normalizeLabel(value);
    if(!x) return '';
    if(/^carcasas?\b/.test(x)&&( /equipos?/.test(x)||/(falta|sin)/.test(x))) return 'Carcasa';
    if(/^equipos?\b/.test(x)&&( /carcasa|placa/.test(x)||/(falta|sin)/.test(x))) return 'Equipo';
    if(/carcasas?\s*equipos?/.test(x)||(/carcasas?/.test(x)&&/(falta|sin)/.test(x)&&/equipos?/.test(x))) return 'Carcasa';
    if(/equipos?\s*(placa|carcasa)/.test(x)||(/equipos?/.test(x)&&/(falta|sin)/.test(x)&&/carcasa/.test(x))) return 'Equipo';
    if(/placa/.test(x)&&!/carcasa/.test(x)) return 'Equipo';
    return '';
  }

  function presetFromSheetName(name){
    const classified=classifyPendingLabel(name);
    if(classified) return classified;
    const x=normalizeLabel(name);
    if(/carcasa/.test(x)&&!/equipo.*carcasa/.test(x)) return 'Carcasa';
    if(/equipo|placa/.test(x)) return 'Equipo';
    return '';
  }

  const hostNames=new Set(['host sn','hostsn','host','serial','serial no','serial number','sn','sr','host serial','host serial number']);
  const uaNames=new Set(['ua','unit address','ua / unit address','unitaddress','address','ua original','unit_address']);
  const typeNames=new Set(['tipo','type','modo','mode']);

  function headerInfo(rows){
    for(let i=0;i<Math.min(rows.length,20);i++){
      const h=Array.isArray(rows[i])?rows[i]:[];
      const labels=h.map(normalizeLabel);
      const host=labels.findIndex(v=>hostNames.has(v));
      const ua=labels.findIndex(v=>uaNames.has(v));
      if(host>=0&&ua>=0) return {row:i,headers:h,host,ua,type:labels.findIndex(v=>typeNames.has(v))};
    }
    return null;
  }

  function detectSideBySide(rows){
    for(let i=0;i<Math.min(rows.length,14);i++){
      const row=Array.isArray(rows[i])?rows[i]:[];
      const blocks=[];
      row.forEach((cell,index)=>{
        const type=classifyPendingLabel(cell);
        if(type) blocks.push({type,index,label:String(cell??'').trim()});
      });
      if(blocks.length<2) continue;
      const equipo=blocks.find(b=>b.type==='Equipo');
      const carcasa=blocks.find(b=>b.type==='Carcasa');
      if(!equipo||!carcasa) continue;
      const make=block=>({
        label:block.label|| (block.type==='Equipo'?'Equipos sin carcasa':'Carcasas sin equipo'),
        type:block.type,
        host:block.index,
        ua:block.index+1,
        start:i+2
      });
      return [make(equipo),make(carcasa)];
    }
    return null;
  }

  function detectSheetPlans(rows,sheetName='Hoja1'){
    const side=detectSideBySide(rows);
    if(side) return side.map(b=>({sheet:sheetName,label:`${sheetName} — ${b.label}`,kind:'fixed',start:b.start,typePreset:b.type,h:{host:b.host,ua:b.ua,type:-1,headers:[]}}));
    const h=headerInfo(rows);
    if(!h) return [];
    const normalizedName=normalizeLabel(sheetName);
    if(/encontrad/.test(normalizedName)) return [{sheet:sheetName,label:`${sheetName} — encontrados previos`,kind:'found',start:h.row+1,typePreset:'Encontrado previo',h}];
    const preset=h.type>=0?'AUTO':presetFromSheetName(sheetName);
    return [{sheet:sheetName,label:sheetName,kind:'generic',start:h.row+1,typePreset:preset,h}];
  }

  function inferDirection(fileName,requested='auto'){
    if(requested&&requested!=='auto') return requested==='entrada'?'Entrada':requested==='salida'?'Salida':'Base TXT';
    const n=normalizeLabel(fileName);
    if(/\b(salida|out|outbound|despacho)\b/.test(n)) return 'Salida';
    if(/\b(entrada|ingreso|inbound|recepcion)\b/.test(n)) return 'Entrada';
    return 'Base TXT';
  }

  function extractHost(line){
    const m=String(line??'').toUpperCase().match(HOST_RE);
    return m?normalizeHost(m[0]):'';
  }
  function extractUA(line){
    const text=String(line??'');
    const dashed=(text.match(UA_DASHED_RE)||[]).find(v=>validUA(v).valid);
    if(dashed) return {raw:dashed,normalized:coerceUA(dashed)};
    const compact=(text.match(UA_COMPACT_RE)||[]).find(v=>validUA(v).valid);
    if(compact) return {raw:compact,normalized:coerceUA(compact)};
    return null;
  }

  function parseLocationText(text,fileName='ubicacion.txt',requested='auto'){
    const direction=inferDirection(fileName,requested);
    const lines=String(text??'').split(/\r?\n/);
    const entries=[];
    const invalid=[];
    const used=new Set();
    const add=(host,ua,lineStart,lineEnd,raw)=>{
      const hv=validHost(host),uv=validUA(ua?.normalized??ua?.raw??ua);
      if(!hv.valid||!uv.valid){invalid.push({line:lineStart,raw,reason:!hv.valid?hv.reason:uv.reason});return;}
      const key=`${hv.value}|${uv.value}|${lineStart}|${lineEnd}`;
      if(used.has(key)) return;
      used.add(key);
      entries.push({file:fileName,direction,lineStart,lineEnd,host:hv.value,uaRaw:String(ua?.raw??ua??''),uaNorm:uv.value,raw:String(raw??'')});
    };

    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      const host=extractHost(line);
      const ua=extractUA(line);
      if(host&&ua){add(host,ua,i+1,i+1,line);continue;}
      if(host&&!ua&&i+1<lines.length){
        const nextUA=extractUA(lines[i+1]);
        const nextHost=extractHost(lines[i+1]);
        if(nextUA&&!nextHost){add(host,nextUA,i+1,i+2,`${line}\n${lines[i+1]}`);i++;continue;}
      }
      if(ua&&!host&&i+1<lines.length){
        const nextHost=extractHost(lines[i+1]);
        const nextUA=extractUA(lines[i+1]);
        if(nextHost&&!nextUA){add(nextHost,ua,i+1,i+2,`${line}\n${lines[i+1]}`);i++;continue;}
      }
      if(line.trim()&&(host||ua)) invalid.push({line:i+1,raw:line,reason:'Línea incompleta: se requiere Serial y UA asociados.'});
    }
    return {file:fileName,direction,entries,invalid,totalLines:lines.length};
  }

  return {normalizeLabel,normalizeHost,normalizeUA,coerceUA,validHost,validUA,exactPair,classifyPendingLabel,presetFromSheetName,headerInfo,detectSideBySide,detectSheetPlans,inferDirection,parseLocationText};
});