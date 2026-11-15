import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';

test('campus release: isolated subpath accounts, member media, assets and home-screen scope',async()=>{
 const release=resolve('data/campus-release/integration-'+Date.now()),data=await mkdtemp(join(tmpdir(),'thingamingos-campus-'));
 execFileSync(process.execPath,['scripts/build-campus.mjs','thingamingos',release]);
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port,base='/apps/thingamingos',room='ab'.repeat(16);
 const child=spawn(process.execPath,['server.js'],{cwd:release,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_BASE_PATH:base,OBJECT_STORIES_DATA:data,BETTER_AUTH_URL:origin,DATABASE_URL:'',BETTER_AUTH_SECRET:''},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
 let cookie='';const request=async(path,payload,extra={})=>{const response=await fetch(origin+base+path,{method:payload===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'X-Room-Key':room,...(payload===undefined?{}:{'Content-Type':'application/json'}),...extra},...(payload===undefined?{}:{body:JSON.stringify(payload)})});return response;};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.ok(ready,log);
  assert.equal((await fetch(origin+'/api/health')).status,404);assert.equal((await request('/__preview/iphone')).status,404);
  const page=await (await request('/')).text();assert.match(page,/\/apps\/thingamingos\/app.js/);assert.match(page,/\/apps\/thingamingos\/style.css/);
  for(const path of ['/app.js','/style.css','/mobile.css','/collection.js','/assets/cottage-room-v3.webp'])assert.equal((await request(path)).status,200,path);
  const js=await (await request('/app.js')).text();assert.match(js,/fetch\('\/apps\/thingamingos\/api\/auth\//);assert.match(js,/location.origin\+'\/apps\/thingamingos\/\?room='/);assert.doesNotMatch(js,/register\('\/sw.js'/);
  assert.equal((await request('/api/state')).status,401);
  const signup=await request('/api/auth/sign-up/email',{name:'校园测试者',email:'campus-test@example.com',password:'campus-synthetic-test-1834'});assert.equal(signup.status,200,await signup.clone().text());const cookies=signup.headers.getSetCookie();assert.ok(cookies.some(c=>c.includes('Path=/apps/thingamingos/')));assert.ok(cookies.every(c=>!c.includes('Path=/;')));assert.ok(cookies.some(c=>c.includes('thingamingos-thingamingos.')));cookie=cookies.map(c=>c.split(';')[0]).join('; ');assert.notEqual((await signup.json()).user.role,'admin');
  assert.equal((await request('/api/auth/get-session')).status,200);assert.equal((await request('/api/state')).status,403);assert.equal((await request('/api/room/join',{})).status,200);
  const png=Buffer.from('89504e470d0a1a0a','hex'),form=new FormData();form.append('file',new Blob([png]),'test.png');form.append('upload_id','11'.repeat(16));const uploaded=await fetch(origin+base+'/api/uploads',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Room-Key':room},body:form});assert.equal(uploaded.status,200);const media=(await uploaded.json()).id;
  const object=await request('/api/objects',{name:'相机',object_type:'相机',media_id:media,pixel_media_id:media});assert.equal(object.status,200,await object.clone().text());
  const state=await (await request('/api/state')).json(),item=state.objects.find(o=>o.id!== 'cup'&&o.media_id===media);assert.ok(item);assert.equal(item.media_url,base+'/media/'+media+'?room='+room);assert.equal(item.pixel_media_url,item.media_url);
  assert.equal((await fetch(origin+item.media_url)).status,401);const bytes=await fetch(origin+item.media_url,{headers:{Cookie:cookie}});assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png);
  const manifest=await (await request('/api/manifest?room='+room)).json();assert.equal(manifest.scope,base+'/');assert.equal(manifest.id,base+'/');assert.equal(manifest.start_url,base+'/?room='+room+'&source=homescreen');assert.equal(manifest.icons[0].src,base+'/icons/app-192.png');
  const fallback=await (await request('/api/manifest?room=invalid')).json();assert.equal(fallback.start_url,base+'/?source=homescreen');
  const staticManifest=await (await request('/manifest.webmanifest')).json();assert.equal(staticManifest.scope,base+'/');assert.equal(staticManifest.icons[0].src,base+'/icons/app-192.png');
  const sw=await request('/sw.js');assert.equal(sw.headers.get('service-worker-allowed'),base+'/');const swText=await sw.text();assert.match(swText,/thingamingos-campus-offline-/);assert.match(swText,/\/apps\/thingamingos\/offline.html/);assert.match(swText,/\/apps\/thingamingos\/api\//);
  await request('/api/auth/sign-out',{});assert.equal((await request('/api/auth/get-session')).status,200);assert.equal((await request('/api/state')).status,401);
  const top=await readdir(release);assert.ok(!top.includes('data'));assert.ok(!top.includes('.env'));assert.ok(!top.includes('node_modules'));assert.ok(!top.includes('.git'));const checks=await readFile(join(release,'SHA256SUMS'),'utf8');assert.doesNotMatch(checks,/accounts.sqlite|auth-secret|runtime.env/);
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}await rm(data,{recursive:true,force:true});await rm(release,{recursive:true,force:true});}
});
