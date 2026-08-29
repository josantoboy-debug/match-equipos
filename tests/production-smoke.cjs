const puppeteer=require(process.cwd()+'/node_modules/puppeteer-core');
const assert=require('assert');

async function main(){
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-setuid-sandbox','--autoplay-policy=no-user-gesture-required']});
  const viewports=[{name:'desktop',width:1440,height:900},{name:'tablet',width:1024,height:768},{name:'mobile',width:390,height:844}];
  for(const vp of viewports){
    const page=await browser.newPage();
    await page.setViewport({width:vp.width,height:vp.height});
    await page.evaluateOnNewDocument(()=>{
      window.__spoken=[];
      class U{constructor(text){this.text=String(text||'');this.lang='';this.voice=null;this.rate=1;this.pitch=1;this.volume=1;this.onstart=null;this.onend=null;this.onerror=null;}}
      const synth={getVoices:()=>[{name:'Mock Panama',lang:'es-PA',default:true}],speak:u=>{window.__spoken.push(u.text);setTimeout(()=>{u.onstart&&u.onstart();u.onend&&u.onend()},5)},cancel:()=>{},addEventListener:()=>{}};
      Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:U});
      Object.defineProperty(window,'speechSynthesis',{configurable:true,get:()=>synth});
    });
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:4173/?ci=1',{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForFunction(()=>window.ProductionCore?.ValidationService,{timeout:12000});
    const state=await page.evaluate(()=>({
      hostOk:ProductionCore.ValidationService.isValidHost('M12345678901'),
      hostBad:ProductionCore.ValidationService.isValidHost('M123'),
      uaOk:ProductionCore.ValidationService.isValidUA('0000123456789012'),
      uaBad:ProductionCore.ValidationService.isValidUA('000012345678901'),
      zero:ProductionCore.ValidationService.normalizeUA('0000 1234 5678 9012'),
      register:!!document.querySelector('#registerBtn'),
      boxRegister:!!document.querySelector('#equipmentAddBtn'),
      print:!!document.querySelector('#equipmentPrintBtn'),
      tts:!!window.MatchVoiceTTS,
      status:!!document.querySelector('#productionStatus'),
      operatorShim:typeof window.OperatorSession?.getCurrentOperator==='function',
      manifest:!!document.querySelector('link[rel="manifest"]')
    }));
    assert.strictEqual(state.hostOk,true);assert.strictEqual(state.hostBad,false);assert.strictEqual(state.uaOk,true);assert.strictEqual(state.uaBad,false);assert.strictEqual(state.zero,'0000123456789012');
    assert.ok(state.register&&state.boxRegister&&state.print&&state.tts&&state.status&&state.operatorShim&&state.manifest);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('operator:login',{detail:{id:'ci',name:'Operador CI',role:'operator'}})));
    await page.keyboard.press('Tab');
    await page.waitForFunction(()=>window.__spoken.some(x=>x.includes('Operador CI')),{timeout:3000});
    const qid=await page.evaluate(()=>ProductionCore.SyncService.enqueue('equipment.register',{record_type:'Carcasa',host_sn:'M12345678901',ua:'0000123456789012',source:'ci'}));
    const queued=await page.evaluate(()=>ProductionCore.StorageCache.getAll('syncQueue'));
    assert.ok(queued.some(x=>x.id===qid));
    await page.evaluate(id=>ProductionCore.StorageCache.delete('syncQueue',id),qid);
    assert.strictEqual(errors.length,0,`${vp.name}: ${errors.join(' | ')}`);
    console.log('VIEWPORT_OK',vp.name,state);
    await page.close();
  }
  await browser.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
