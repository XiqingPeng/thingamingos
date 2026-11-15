import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {appManifest,sendManifest} from '../lib/web-app.js';

// Launching from an isolated iOS home-screen storage context must keep the invite room.
test('home-screen launch retains a validated room without leaking sessions or accepting URL injection',()=>{
 const room='ab'.repeat(16),result=appManifest(room);assert.equal(result.display,'standalone');assert.equal(result.id,'/');assert.equal(result.scope,'/');assert.equal(result.start_url,'/?room='+room+'&source=homescreen');
 for(const value of ['https://evil.invalid','x&token=secret','<script>',null,room+'1'])assert.equal(appManifest(value).start_url,'/?source=homescreen');
 result.icons[0].src='mutated';assert.equal(appManifest(room).icons[0].src,'/icons/app-192.png');
 const headers={},res={setHeader:(key,value)=>headers[key]=value,end:value=>res.body=JSON.parse(value)};sendManifest(res,room);assert.equal(headers['Cache-Control'],'private, no-store');assert.match(headers['Content-Type'],/application\/manifest\+json/);assert.equal(res.body.start_url,'/?room='+room+'&source=homescreen');
 for(const icon of result.icons.filter(icon=>icon.src!=='mutated')){const bytes=readFileSync(new URL('../web'+icon.src,import.meta.url));assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));assert.equal(bytes.readUInt32BE(20),Number(icon.sizes.split('x')[1]));}
 const apple=readFileSync(new URL('../web/icons/apple-touch-icon.png',import.meta.url));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
});

test('offline fallback never intercepts private APIs, user media, cross-origin requests or writes',async()=>{
 const listeners={},operations=[],fallback={offline:true};
 const context={URL,self:{location:{origin:'https://room.example'},addEventListener:(type,fn)=>listeners[type]=fn,clients:{claim:async()=>operations.push('claim')}},caches:{open:async()=>({addAll:async paths=>operations.push(paths)}),keys:async()=>['thingamingos-offline-old','unrelated-app'],delete:async key=>operations.push('delete:'+key),match:async path=>path==='/offline.html'?fallback:undefined},fetch:async()=>{throw new Error('offline');}};
 vm.runInNewContext(readFileSync(new URL('../web/sw.js',import.meta.url),'utf8'),context);
 const run=async(type,event={})=>{let waiting;listeners[type]({...event,waitUntil:p=>waiting=p});await waiting;};
 await run('install');assert.ok(operations[0].includes('/offline.html'));assert.ok(operations[0].every(path=>!path.startsWith('/api/')&&!path.startsWith('/media/')));
 await run('activate');assert.ok(operations.includes('delete:thingamingos-offline-old'));assert.ok(!operations.includes('delete:unrelated-app'));
 for(const request of [{url:'https://room.example/api/state',method:'GET',mode:'navigate'},{url:'https://room.example/api/auth/get-session',method:'GET'},{url:'https://room.example/api/manifest?room=private-room',method:'GET'},{url:'https://room.example/media/image?room=private-room',method:'GET'},{url:'https://room.example/api/objects',method:'POST'},{url:'https://another.example/',method:'GET',mode:'navigate'}]){let handled=false;listeners.fetch({request,respondWith:()=>handled=true});assert.equal(handled,false);}
 let navigation;listeners.fetch({request:{url:'https://room.example/?room=private-room',method:'GET',mode:'navigate'},respondWith:p=>navigation=p});assert.equal(await navigation,fallback);
});
