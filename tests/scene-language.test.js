import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,publicState} from '../lib/domain.js';
import {buildScene} from '../lib/theater.js';
import {createScene,translateSavedScene} from '../lib/scene-service.js';
import {createSceneGenerator,createSceneTranslator} from '../lib/llm-provider.js';
import {sceneMarkup,sceneKey} from '../web/theater.js';
import {displayScene} from '../web/scene-language.js';
import {setLanguage} from '../web/i18n.js';
import {createScenePlayer} from '../web/scene-player.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const room='ab'.repeat(16),memoryId='00000000000000000000000000000001';
function repository(){let state=seed();return {async read(){return {state:structuredClone(state)};},async update(fnRoom,fn){const next=structuredClone(state),result=fn(next);state=next;return result;}};}
function languageAnswer(context){const lines=[0,1].flatMap(round=>context.objects.map(object=>({object_id:object.id,text:round?'你愿意再讲讲吗？':'我想听听你自己记得的那份心意。',mood:'好奇',memory_ids:[context.memories[0].id]})));return {lines,localized:{zh:{topic:'那份礼物',lines:lines.map(l=>({text:l.text,mood:l.mood}))},en:{topic:'That little gift',lines:lines.map(()=>({text:'I would love to hear how you remember that gift.',mood:'curious'}))}}};}

test('the reported legacy English rule scene follows both UI languages without changing history or source IDs',()=>{
 const state=publicState(seed(),'a',room);state.latest_scene={id:'f'.repeat(32),mode:'rules',topic:'Our first journeyThe little things we cannot let go of',memory_ids:[memoryId],lines:[{object_id:'cup',name:'老朋友',text:'Thinking about our journey: I have no recorded memory yet.',mood:'curious',memory_ids:[memoryId]}]};
 const original=structuredClone(state),key=sceneKey(state.latest_scene);
 try{
  setLanguage('zh');const chinese=sceneMarkup(state.latest_scene,state,()=>'',()=>'',esc);assert.match(chinese,/嘴硬心软/);assert.doesNotMatch(chinese,/<p>Thinking about/);assert.match(chinese,/小满的记录，待小北回应/);assert.match(chinese,/话题原文/);
  setLanguage('en');const english=sceneMarkup(state.latest_scene,state,()=>'',()=>'',esc);assert.match(english,/soft-hearted/);assert.match(english,/Original memory/);assert.match(english,/awaiting 小北/);
  const enView=displayScene(state.latest_scene,state,'en');assert.doesNotMatch(enView.lines[0].text,/这个杯子是小北/);assert.deepEqual(enView.lines[0].memory_ids,[memoryId]);assert.equal(enView.lines[0].name,'老朋友');
  assert.deepEqual(state,original);assert.equal(sceneKey(state.latest_scene),key);
 }finally{setLanguage('zh');}
});

test('new rules persist bilingual display variants and keep confirmed responses as original records',()=>{
 const state=seed(),before=structuredClone(state.memories);const scene=buildScene(state,{object_ids:['cup','keys'],language:'en',topic:'礼物'});
 assert.equal(scene.language,'en');assert.equal(scene.localized.zh.lines.length,2);assert.equal(scene.localized.en.lines.length,2);assert.match(scene.localized.zh.lines[0].mood,/嘴硬心软/);assert.match(scene.localized.en.lines[0].mood,/soft-hearted/);assert.deepEqual(state.memories,before);
 const poisoned=structuredClone(scene);poisoned.localized.en.lines[0].memory_ids=['forged'];poisoned.localized.en.lines[0].name='forged';const view=displayScene(poisoned,publicState(state,'a',room),'en');assert.deepEqual(view.lines[0].memory_ids,scene.lines[0].memory_ids);assert.equal(view.lines[0].name,scene.lines[0].name);
});

test('bilingual model output is validated, stores two views and cannot invent confirmation in either',async()=>{
 const repo=repository(),data={object_ids:['cup'],topic:'礼物',language:'zh'};let calls=0;
 const scene=await createScene({repository:repo,room,actor:'a',data,logger:{},generate:async context=>{calls++;return languageAnswer(context);}});
 assert.equal(scene.mode,'llm');assert.equal(calls,1);assert.equal(scene.language,'zh');assert.equal(scene.localized.en.topic,'That little gift');assert.equal(scene.localized.en.lines.length,2);
 const badRepo=repository();const bad=await createScene({repository:badRepo,room,actor:'a',data,logger:{},generate:async context=>{const result=languageAnswer(context);result.localized.en.lines[0].text='We both confirmed this memory.';return result;}});assert.equal(bad.mode,'rules');assert.equal(bad.fallback_reason,'invalid_output');
 const wrongRepo=repository();const wrong=await createScene({repository:wrongRepo,room,actor:'a',data,logger:{},generate:async context=>{const result=languageAnswer(context);result.localized.en.lines[0].mood='好奇';return result;}});assert.equal(wrong.mode,'rules');
});

test('single bilingual provider call returns paired dialogue and uses the same citation IDs',async()=>{
 const repo=repository();let options,calls=0;
 const generate=createSceneGenerator({env:{DEEPSEEK_API_KEY:'test-only'},bilingual:true,generate:async request=>{options=request;calls++;const ctx=JSON.parse(request.prompt.split('\n').slice(1).join('\n'));return {finishReason:'stop',output:{localized_topic:'那份礼物',alternate_topic:'That little gift',lines:[0,1].map(()=>({object_id:'cup',text:'我想听听你记得的那份心意。',mood:'好奇',memory_ids:[ctx.memories[0].id],alternate_text:'I would love to hear how you remember that gift.',alternate_mood:'curious'}))}};}});
 const scene=await createScene({repository:repo,room,actor:'a',data:{object_ids:['cup'],topic:'礼物'},generate,logger:{}});assert.equal(scene.mode,'llm');assert.equal(calls,1);assert.equal(options.maxRetries,0);assert.equal(options.maxOutputTokens,3200);assert.match(options.system,/中英双语/);assert.equal(scene.localized.en.lines[0].mood,'curious');assert.deepEqual(scene.lines[0].memory_ids,[memoryId]);
});

test('legacy model translations are cached without replacing the scene, its citations or playback identity',async()=>{
 const repo=repository();await repo.update(room,state=>{state.latest_scene={id:'e'.repeat(32),mode:'llm',language:'en',topic:'A gift',memory_ids:[memoryId],lines:[{object_id:'cup',name:'老朋友',text:'I would love to hear how you remember that gift.',mood:'curious',memory_ids:[memoryId]}]};});
 const before=(await repo.read(room)).state,key=sceneKey(before.latest_scene);let calls=0;
 const request={repository:repo,room,actor:'a',sceneId:before.latest_scene.id,language:'zh',translate:async context=>{calls++;assert.equal(context.lines[0].name,'老朋友');return {topic:'那份礼物',lines:[{text:'我想听听你自己记得的那份心意。',mood:'好奇'}]};}};
 const result=await translateSavedScene(request);assert.equal(result.localized.zh.lines[0].mood,'好奇');await translateSavedScene(request);assert.equal(calls,1);
 const after=(await repo.read(room)).state;assert.equal(sceneKey(after.latest_scene),key);assert.deepEqual(after.memories,before.memories);assert.deepEqual(after.latest_scene.lines,before.latest_scene.lines);assert.equal(after.latest_scene.id,before.latest_scene.id);
 const player=createScenePlayer({setTimer:()=>1,clearTimer:()=>{}});player.start(key,[...before.latest_scene.lines,...before.latest_scene.lines]);player.pause();const position=player.snapshot();player.load(sceneKey(after.latest_scene),[...after.latest_scene.localized.zh.lines,...after.latest_scene.localized.zh.lines]);assert.deepEqual(player.snapshot(),position);
});

test('a delayed translation cannot resurrect forgotten sources or replace another scene',async()=>{
 const repo=repository();await repo.update(room,state=>{state.latest_scene={id:'e'.repeat(32),mode:'llm',language:'en',topic:'A gift',memory_ids:[memoryId],lines:[{object_id:'cup',name:'老朋友',text:'I wonder about that gift.',mood:'curious',memory_ids:[memoryId]}]};});
 let resolve,started;const entered=new Promise(r=>started=r),answer=new Promise(r=>resolve=r);
 const pending=translateSavedScene({repository:repo,room,actor:'a',sceneId:'e'.repeat(32),language:'zh',translate:async()=>{started();return answer;}});await entered;
 await repo.update(room,state=>{state.memories=state.memories.filter(m=>m.id!==memoryId);state.latest_scene=null;});resolve({topic:'那份礼物',lines:[{text:'我想听听你的想法。',mood:'好奇'}]});await assert.rejects(pending,{status:409});const after=(await repo.read(room)).state;assert.equal(after.latest_scene,null);assert.equal(after.scene_generation.lease,null);
});

test('legacy translation provider receives only the saved plot and returns bounded translated text',async()=>{
 let calls=0;const translator=createSceneTranslator({env:{DEEPSEEK_API_KEY:'test-only'},generate:async options=>{calls++;assert.match(options.system,/不续写/);assert.equal(options.maxRetries,0);return {finishReason:'stop',output:{topic:'那份礼物',lines:[{text:'我想听听你的想法。',mood:'好奇'}]}};}});
 const result=await translator({language:'zh',topic:'A gift',lines:[{name:'老朋友',text:'I wonder about that gift.',mood:'curious'}]});assert.equal(calls,1);assert.equal(result.lines[0].mood,'好奇');
});
