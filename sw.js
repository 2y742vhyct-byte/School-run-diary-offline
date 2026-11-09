/* School Run Diary: online updates, offline fallback. No private diary content is cached here. */
const CACHE='school-run-diary-offline-v7';
const ASSETS=['./','./index.html','./index.html?v=7','./styles.css','./styles.css?v=7','./app.js','./app.js?v=7','./board-ocr.js','./board-ocr.js?v=7','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('school-run-diary-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 const url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   // Prefer fresh code and pages when online; save successful responses for offline use.
   const response=await fetch(request);
   if(response.ok&&response.type!=='opaque')await cache.put(request,response.clone());
   return response;
  }catch(error){
   const saved=await caches.match(request,{ignoreSearch:true});
   if(saved)return saved;
   if(request.mode==='navigate')return caches.match('./index.html');
   return Response.error();
  }
 })());
});