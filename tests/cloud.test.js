import test from 'node:test';
import assert from 'node:assert/strict';
import { seed,mutate,publicState,sniff } from '../lib/domain.js';
import { repository,normalizeEtag } from '../lib/store.js';
import { persistUpload } from '../api/index.js';
const gift='00000000000000000000000000000001';
test('only tagged participant can confirm; both authors remain visible',()=>{
 const s=seed();assert.throws(()=>mutate(s,`memories/${gift}/respond`,{expected_revision:1,action:'confirm'},'c'),{status:403});
 mutate(s,`memories/${gift}/respond`,{expected_revision:1,action:'confirm',response:'我当时挑了很久'},'b');
 const m=s.memories.find(x=>x.id===gift);assert.equal(m.author_id,'a');assert.equal(m.tagged_user_id,'b');assert.equal(m.status,'confirmed');assert.equal(m.response,'我当时挑了很久');
 const scene=mutate(s,'scenes',{object_ids:['cup'],topic:'那份礼物'},'a');assert.match(scene.lines[0].text,/挑了很久/);assert.deepEqual(scene.memory_ids,[gift]);
});
test('pending memories retain attribution, declined memories do not enter theater',()=>{
 const s=seed();let scene=mutate(s,'scenes',{object_ids:['cup']},'a');assert.match(scene.lines[0].text,/小满记得/);assert.match(scene.lines[0].text,/等小北/);
 mutate(s,`memories/${gift}/respond`,{expected_revision:1,action:'decline'},'b');scene=mutate(s,'scenes',{object_ids:['cup']},'a');assert.ok(!scene.memory_ids.includes(gift));
});
test('editing confirmed content resets confirmation and saved theater',()=>{
 const s=seed();mutate(s,`memories/${gift}/respond`,{expected_revision:1,action:'confirm'},'b');mutate(s,'scenes',{object_ids:['cup']},'a');
 mutate(s,`memories/${gift}/edit`,{text:'更准确的共同故事'},'a');assert.equal(s.latest_scene,null);assert.equal(s.memories[0].status,'pending');assert.equal(s.memories[0].response,'');
 assert.throws(()=>mutate(s,`memories/${gift}/edit`,{text:'不该修改'},'b'),{status:403});
});
test('forgetting removes sources and cached theater',()=>{
 const s=seed();mutate(s,'scenes',{object_ids:['cup']},'a');mutate(s,`memories/${gift}/forget`,{},'a');assert.equal(s.latest_scene,null);assert.ok(!s.memories.some(m=>m.id===gift));assert.ok(!mutate(s,'scenes',{object_ids:['cup']},'a').memory_ids.includes(gift));
});
test('new gifted object connects two users, media and first memory',()=>{
 const s=seed();s.media.push({id:'file',author_id:'a',mime:'image/png'});const result=mutate(s,'objects',{name:'新杯子',kind:'mug',text:'小北送我的生日礼物',tagged_user_id:'b',is_gift:true,media_id:'file'},'a');
 const m=s.memories.find(m=>m.object_id===result.id);assert.equal(m.kind,'gift');assert.equal(m.status,'pending');const o=publicState(s,'b','ab'.repeat(16)).objects.find(o=>o.id===result.id);assert.match(o.media_url,/room=/);
});
test('reject unsupported media and malformed or forged data',()=>{
 assert.throws(()=>sniff(Buffer.from('<svg onload=alert(1)>')));assert.equal(sniff(Buffer.from([137,80,78,71,13,10,26,10])),'image/png');
 assert.throws(()=>mutate(seed(),'memories',{object_id:'cup',text:'x',tagged_user_id:'a'},'a'));
 assert.throws(()=>mutate(seed(),'scenes',{object_ids:['cup','cup']},'a'));
 assert.throws(()=>mutate(seed(),'objects',{name:'x',media_id:'other-users-file'},'a'));
});
class BlobAlreadyExistsError extends Error{};class BlobPreconditionFailedError extends Error{};
function fakeDriver(){
 const files=new Map();let conflicts=0;
 return {files,get conflicts(){return conflicts;},async get(path,opts){assert.equal(opts.access,'private');assert.equal(opts.useCache,false);const rec=files.get(path);await new Promise(resolve=>setImmediate(resolve));return rec?{statusCode:200,blob:{etag:'"'+rec.etag+'"'},stream:new Response(rec.text).body}:null;},async put(path,text,opts){assert.equal(opts.access,'private');const prev=files.get(path);if(!opts.allowOverwrite&&prev){conflicts++;throw new BlobAlreadyExistsError();}if(opts.ifMatch&&prev?.etag!==opts.ifMatch){conflicts++;throw new BlobPreconditionFailedError();}files.set(path,{text,etag:String(Number(prev?.etag||0)+1)});return{};}};
}
test('concurrent first writes and existing writes preserve both users memories',async()=>{
 const driver=fakeDriver(),repo=repository(driver),room='ab'.repeat(16);
 const write=(who,story)=>repo.update(room,s=>mutate(s,'memories',{object_id:'cup',text:story},who));
 await Promise.all([write('a','A第一次记下'),write('b','B第一次记下')]);
 await Promise.all([write('a','A第二次记下'),write('b','B第二次记下')]);
 const {state}=await repo.read(room);for(const story of ['A第一次记下','B第一次记下','A第二次记下','B第二次记下'])assert.ok(state.memories.some(m=>m.text===story));assert.ok(driver.conflicts>=2);
});
test('room state is isolated; persistence survives new repository instance',async()=>{
 const driver=fakeDriver(),r1=repository(driver);await r1.update('one',s=>mutate(s,'memories',{object_id:'cup',text:'只属于这个小屋'},'a'));
 const r2=repository(driver);assert.ok((await r2.read('one')).state.memories.some(m=>m.text==='只属于这个小屋'));assert.ok(!(await r2.read('two')).state.memories.some(m=>m.text==='只属于这个小屋'));
});

test('HTTP quoted ETags normalize to conditional-write versions',()=>{assert.equal(normalizeEtag('\"version-1\"'),'version-1');assert.equal(normalizeEtag('W/\"version-2\"'),'version-2');assert.equal(normalizeEtag('version-3'),'version-3');});

test('free-text object types survive storage and legacy objects keep readable types',async()=>{
 const driver=fakeDriver(),repo=repository(driver);
 const camera=await repo.update('types',s=>mutate(s,'objects',{name:'旅行搭子',object_type:'拍立得相机'},'a'));
 await repo.update('types',s=>mutate(s,'objects',{name:'保温小杯',object_type:'不锈钢保温杯'},'a'));
 const stored=(await repo.read('types')).state;
 assert.equal(stored.objects.find(o=>o.id===camera.id).object_type,'拍立得相机');
 assert.equal(stored.objects.find(o=>o.id===camera.id).kind,'other');
 assert.equal(stored.objects.find(o=>o.name==='保温小杯').kind,'mug');
 assert.equal(publicState(stored,'a','room').objects.find(o=>o.id==='keys').object_type,'键盘');
 assert.throws(()=>mutate(seed(),'objects',{name:'x',object_type:'   '},'a'));
});

test('legacy memories expose revision one without changing stored records; edits increment it',()=>{
 const s=seed(),old=structuredClone(s),m=s.memories.find(m=>m.id===gift);
 assert.equal(publicState(s,'b','room').memories.find(m=>m.id===gift).revision,1);
 assert.deepEqual(s,old,'reading legacy state must not write a migration');
 for(const expected_revision of [undefined,null,'1',true,0,1.5]){
  assert.throws(()=>mutate(s,`memories/${gift}/respond`,{action:'confirm',expected_revision},'b'),{status:409});
  assert.equal(m.status,'pending');
 }
 mutate(s,`memories/${gift}/edit`,{text:'更正后的生日礼物故事'},'a');assert.equal(m.revision,2);
 for(const action of ['confirm','decline'])assert.throws(()=>mutate(s,`memories/${gift}/respond`,{action,expected_revision:1,response:'旧弹窗'},'b'),{status:409});
 assert.equal(m.response,'');assert.equal(m.status,'pending');
 mutate(s,`memories/${gift}/respond`,{action:'confirm',expected_revision:2,response:'重新阅读过了'},'b');
 assert.equal(m.status,'confirmed');assert.equal(m.author_id,'a');assert.equal(m.tagged_user_id,'b');
 mutate(s,`memories/${gift}/edit`,{text:m.text},'a');assert.equal(m.revision,3);assert.equal(m.status,'pending');assert.equal(m.response,'');
 const added=mutate(s,'memories',{object_id:'cup',text:'新记录'},'a');assert.equal(s.memories.find(m=>m.id===added.id).revision,1);
});

test('a concurrent edit invalidates an old response even after Blob conflict retries',async()=>{
 const driver=fakeDriver(),repo=repository(driver),room='revision';
 const [edit,response]=await Promise.allSettled([
  repo.update(room,s=>mutate(s,`memories/${gift}/edit`,{text:'生日礼物的更新版本'},'a')),
  repo.update(room,s=>mutate(s,`memories/${gift}/respond`,{action:'confirm',expected_revision:1,response:'只看过旧版本'},'b')),
 ]);
 assert.equal(edit.status,'fulfilled');assert.equal(response.status,'rejected');assert.equal(response.reason.status,409);assert.ok(driver.conflicts>=1);
 let state=(await repo.read(room)).state;let m=state.memories.find(m=>m.id===gift);
 assert.equal(m.status,'pending');assert.equal(m.revision,2);assert.equal(m.response,'');
 await repo.update(room,s=>mutate(s,`memories/${gift}/respond`,{action:'confirm',expected_revision:m.revision,response:'这次读过新版'},'b'));
 state=(await repo.read(room)).state;m=state.memories.find(m=>m.id===gift);
 assert.equal(m.status,'confirmed');assert.equal(m.response,'这次读过新版');
 const scene=mutate(state,'scenes',{object_ids:['cup'],topic:'生日礼物'},'a');assert.deepEqual(scene.memory_ids,[gift]);assert.ok(scene.lines[0].text.includes(m.text));
});

function uploadFixture(){
 const driver=fakeDriver(),repo=repository(driver),files=new Map();
 const put=async(path,bytes)=>{if(files.has(path))throw new BlobAlreadyExistsError();files.set(path,Buffer.from(bytes));};
 const request={room:'a'.repeat(32),actor:'a',upload_id:'1'.repeat(32),filename:'photo.png',bytes:Buffer.from([137,80,78,71,13,10,26,10]),mime:'image/png'};
 return {repo,files,put,request};
}

test('upload retries after a rejected create and concurrent retries reuse one media record',async()=>{
 const {repo,files,put,request}=uploadFixture();
 const [first,second]=await Promise.all([persistUpload(request,repo,put),persistUpload(request,repo,put)]);
 assert.deepEqual(second,first);assert.equal(files.size,1);
 await assert.rejects(repo.update(request.room,s=>mutate(s,'objects',{name:'   ',object_type:'杯子',media_id:first.id},'a')));
 const retry=await persistUpload(request,repo,put);assert.deepEqual(retry,first);
 const {state}=await repo.read(request.room);assert.equal(state.media.length,1);
 const object=mutate(state,'objects',{name:'有效名字',object_type:'杯子',media_id:retry.id},'a');assert.equal(state.objects.find(o=>o.id===object.id).media_id,first.id);
});

test('a lost upload response can be retried without orphan growth or wrong-content reuse',async()=>{
 const {repo,files,put,request}=uploadFixture();let first=true;
 const lostReply=async(...args)=>{await put(...args);if(first){first=false;throw new Error('connection lost after storing bytes');}};
 await assert.rejects(persistUpload(request,repo,lostReply),/connection lost/);
 const saved=await persistUpload(request,repo,put);assert.equal(files.size,1);
 assert.equal((await repo.read(request.room)).state.media.length,1);
 await assert.rejects(persistUpload({...request,bytes:Buffer.concat([request.bytes,Buffer.from('different')])},repo,put),{status:409});
 const anotherActor=await persistUpload({...request,actor:'b'},repo,put);assert.notEqual(anotherActor.id,saved.id);
 const anotherRoom=await persistUpload({...request,room:'b'.repeat(32)},repo,put);assert.notEqual(anotherRoom.url,saved.url);
 assert.equal((await repo.read('b'.repeat(32))).state.media.length,1);
});

test('upload quota is checked inside the conditional state write',async()=>{
 const {repo,put,request}=uploadFixture();
 await repo.update(request.room,s=>{s.media=Array.from({length:29},(_,i)=>({id:String(i),author_id:'a'}));});
 const results=await Promise.allSettled([persistUpload(request,repo,put),persistUpload({...request,upload_id:'2'.repeat(32)},repo,put)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await repo.read(request.room)).state.media.length,30);
 const successful=results.find(r=>r.status==='fulfilled').value;
 const existing=(await repo.read(request.room)).state.media.find(m=>m.id===successful.id);
 assert.deepEqual(await persistUpload({...request,upload_id:existing.upload_id},repo,put),successful,'an accepted retry still works at the quota');
});
