import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts} from '../lib/accounts.js';
import {accountHandler} from '../lib/account-api.js';

test('real accounts: registration, cookie sessions, room boundaries, attribution and admin enforcement',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'thingamingos-accounts-'));let handler;
 const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const baseURL=`http://127.0.0.1:${server.address().port}`;
 const accounts=await createAccounts({dataDir,baseURL}),mediaFiles=new Map();handler=accountHandler(accounts,{read:async(room,id)=>mediaFiles.get(room+'/'+id),write:async(room,id,bytes)=>mediaFiles.set(room+'/'+id,bytes)});
 const alice={cookie:'',ip:'127.0.0.2'},bob={cookie:'',ip:'127.0.0.3'},eve={cookie:'',ip:'127.0.0.4'},room='ab'.repeat(16),other='cd'.repeat(16);
 async function request(actor,path,data,extra={}){const response=await fetch(baseURL+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:baseURL,Cookie:actor.cookie,'X-Room-Key':room,'X-Forwarded-For':actor.ip,...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});const cookies=response.headers.getSetCookie();if(cookies.length)actor.cookie=cookies.map(c=>c.split(';')[0]).join('; ');return {status:response.status,body:await response.json(),cookies};}
 try{
  assert.equal((await request(eve,'/api/state')).status,401);
  for(const [actor,name,email] of [[alice,'杯子主人','alice@example.com'],[bob,'送礼朋友','bob@example.com'],[eve,'屋外朋友','eve@example.com']]){
   const forged=await request(actor,'/api/auth/sign-up/email',{name,email,password:'test-password-8631',role:'admin'});assert.equal(forged.status,400);
   const result=await request(actor,'/api/auth/sign-up/email',{name,email,password:'test-password-8631'});assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.cookies.some(c=>/httponly/i.test(c)));assert.ok(result.cookies.some(c=>/samesite=lax/i.test(c)));assert.notEqual(result.body.user.role,'admin');
  }
  const aliceSession=(await request(alice,'/api/auth/get-session')).body;
  const bobSession=(await request(bob,'/api/auth/get-session')).body;
  assert.equal((await request(alice,'/api/state')).status,403);
  await request(alice,'/api/room/join',{});await request(bob,'/api/room/join',{});
  assert.equal((await request(eve,'/api/state')).status,403);
  assert.equal((await request(alice,'/api/state',undefined,{'X-Room-Key':other})).status,403);
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const upload=async(bytes=png)=>{const form=new FormData();form.append('file',new Blob([bytes]),'tiny.png');form.append('upload_id','11'.repeat(16));const response=await fetch(baseURL+'/api/uploads',{method:'POST',headers:{Origin:baseURL,Cookie:alice.cookie,'X-Room-Key':room},body:form});return {status:response.status,body:await response.json()};};
  const media=await upload();assert.equal(media.status,200);assert.equal((await upload()).body.id,media.body.id);assert.equal(mediaFiles.size,1);assert.equal((await upload(Buffer.concat([png,Buffer.from('changed')]))).status,409);
  const mediaPath=baseURL+'/media/'+media.body.id+'?room='+room;
  assert.equal((await fetch(mediaPath)).status,401);assert.equal((await fetch(mediaPath,{headers:{Cookie:eve.cookie}})).status,403);
  const partial=await fetch(mediaPath,{headers:{Cookie:alice.cookie,Range:'bytes=0-3'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await partial.arrayBuffer()).toString('hex'),'89504e47');
  const object=(await request(alice,'/api/objects',{name:'小茶杯',object_type:'茶杯',text:'朋友在毕业时送我的',tagged_user_id:bobSession.user.id,is_gift:true},{'X-Demo-User':bobSession.user.id})).body;
  const state=(await request(alice,'/api/state')).body;assert.equal(state.account.id,aliceSession.user.id);assert.equal(state.users.length,2);assert.equal(state.objects.find(o=>o.id===object.id).owner_id,aliceSession.user.id);assert.ok(state.users.every(u=>!u.email));assert.equal(state.identity_mode,'account');
  const memory=state.memories.find(m=>m.object_id===object.id);assert.equal(memory.author_id,aliceSession.user.id);assert.equal(memory.status,'pending');
  const response={action:'confirm',response:'是我送的，希望它陪你很久',expected_revision:memory.revision};
  assert.equal((await request(alice,`/api/memories/${memory.id}/respond`,response)).status,403);
  assert.equal((await request(bob,`/api/memories/${memory.id}/respond`,response)).status,200);
  const scene=(await request(alice,'/api/scenes',{object_ids:[object.id],language:'en',topic:'A lasting gift'})).body;assert.equal(scene.mode,'rules');assert.match(scene.lines[0].text,/杯子主人 wrote/);assert.match(scene.lines[0].text,/朋友在毕业时送我的/);assert.match(scene.lines[0].text,/Both people confirmed/);
  assert.equal((await request(alice,'/api/auth/admin/list-users')).status,403);
  await accounts.query('UPDATE "user" SET role=$1 WHERE id=$2',['admin',aliceSession.user.id]);
  assert.equal((await request(alice,'/api/auth/admin/list-users')).body.total,3);
  assert.equal((await request(alice,'/api/auth/admin/ban-user',{userId:bobSession.user.id,banReason:'Integration test'})).status,200);
  assert.equal((await request(bob,'/api/state')).status,401);
  assert.equal((await request(alice,'/api/auth/admin/unban-user',{userId:bobSession.user.id})).status,200);
  assert.equal((await request(bob,'/api/auth/sign-in/email',{email:'bob@example.com',password:'wrong-password'})).status,401);
  assert.equal((await request(bob,'/api/auth/sign-in/email',{email:'bob@example.com',password:'test-password-8631'})).status,200);
  assert.equal((await request(bob,'/api/auth/update-user',{name:'新昵称'})).status,200);
  assert.equal((await request(bob,'/api/auth/update-user',{name:'   '})).status,400);
  assert.equal((await request(bob,'/api/auth/change-password',{currentPassword:'wrong-password',newPassword:'new-password-5361',revokeOtherSessions:true})).status,400);
  assert.equal((await request(bob,'/api/auth/change-password',{currentPassword:'test-password-8631',newPassword:'new-password-5361',revokeOtherSessions:true})).status,200);
  assert.equal((await request(bob,'/api/auth/sign-out',{})).status,200);
  assert.equal((await request(bob,'/api/state')).status,401);
  assert.equal((await request(bob,'/api/auth/sign-in/email',{email:'bob@example.com',password:'new-password-5361'})).status,200);
  assert.equal((await request(bob,'/api/auth/get-session')).body.user.name,'新昵称');
  assert.equal((await request(alice,'/api/objects',{name:'no',object_type:'cup'},{Origin:'https://evil.invalid'})).status,403);
  const stored=await accounts.query('SELECT password FROM account WHERE "userId"=$1',[bobSession.user.id]);assert.ok(stored[0].password);assert.ok(!stored[0].password.includes('new-password-5361'));
  const persisted=await accounts.repository.read(room);assert.ok(persisted.state.memories.some(m=>m.id===memory.id&&m.status==='confirmed'));
 }finally{await new Promise(resolve=>server.close(resolve));await accounts.close();}
 const reopened=await createAccounts({dataDir,baseURL});try{assert.equal((await reopened.repository.read(room)).state.users.length,2);}finally{await reopened.close();await rm(dataDir,{recursive:true,force:true});}
});
