// Public offline fallback only. Account, API and user media never enter Cache Storage.
const CACHE='thingamingos-offline-v1';
const PUBLIC=['/offline.html','/offline.css','/offline.js','/icons/app-192.png','/icons/app-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('thingamingos-offline-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return;
 if(request.mode==='navigate')event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));
 else if(PUBLIC.includes(url.pathname)&&!url.search)event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
