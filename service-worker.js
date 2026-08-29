const VERSION='1.0.0';
const CACHE=`match-equipos-${VERSION}`;
const SHELL=['./','./index.html','./styles.css','./search-mode.css','./file-index.css','./equipment-register.css','./operator-session.css','./theme-control.css','./tts-control.css','./app.js','./search-mode.js','./file-index.js','./matches-export.js','./equipment-register.js','./equipment-process.js','./equipment-capacity.js','./equipment-entry-flow.js','./equipment-access-import.js','./equipment-auto-focus.js','./equipment-input-lock.js','./operator-counter-fix.js','./equipment-box-print.js','./registry-export.js','./audit-fixes.js','./unified-export.js','./export-summary.js','./voice-notifications.js','./config.js','./production-core.js','./cloud-session.js','./app-integration.js','./manifest.json','./icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('match-equipos-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(event.request);
      const cache=await caches.open(CACHE);
      cache.put(event.request,fresh.clone());
      return fresh;
    }catch{
      return (await caches.match(event.request)) || (event.request.mode==='navigate' ? await caches.match('./index.html') : Response.error());
    }
  })());
});
