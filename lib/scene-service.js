import {sceneLanguage,nativeDialogue} from '../web/scene-language.js';
import {isSceneCurrent} from '../web/theater.js';
import { USERS, OBJECT_LABELS, ids, uid, text, Problem } from './shared.js';
import { buildScene, selectSceneMemories } from './theater.js';

export const DEFAULT_SCENE_LIMITS = Object.freeze({ perHour: 10, perDay: 30, cooldownMs: 10_000, leaseMs: 45_000 });
const usable = new Set(['recorded', 'pending', 'confirmed']);
const names = Object.fromEntries(USERS.map(user => [user.id, user.name]));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const revision = memory => Number.isSafeInteger(memory.revision) && memory.revision >= 1 ? memory.revision : 1;
const providerErrorCodes = new Set(['timeout', 'authentication', 'budget', 'rate_limit', 'provider_unavailable', 'invalid_output']);
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
function log(logger, level, metadata) {
  try { logger?.[level]?.('Object Stories theater', metadata); } catch { /* Logging cannot change a persisted result. */ }
}

function memorySnapshot(memory) {
  return { id: memory.id, object_id: memory.object_id, author_id: memory.author_id,
    tagged_user_id: memory.tagged_user_id ?? null, status: memory.status, text: memory.text,
    response: memory.response || '', revision: revision(memory), kind: memory.kind,
    created_at: memory.created_at, responded_at: memory.responded_at ?? null };
}

function prepare(state, data) {
  const language=data.language==='en'?'en':'zh';
  const topic = text(data, 'topic', 80) || '今天有什么想对我们说的？';
  const selected = data.object_ids;
  if (!Array.isArray(selected) || !selected.length || selected.length > 3 || new Set(selected).size !== selected.length
    || selected.some(id => !state.objects.some(object => object.id === id))) throw new Problem('请选择一到三件不同的物品');
  const objects = selected.map(id => {
    const object = state.objects.find(object => object.id === id);
    return { id: object.id, name: object.name, kind: object.kind,
      object_type: object.object_type || OBJECT_LABELS[object.kind] || '其他物品', personality: object.personality,
      owner_id: object.owner_id, media_id: object.media_id ?? null, created_at: object.created_at };
  });
  const memories = selectSceneMemories(state, selected, topic, 2).map(memorySnapshot);
  const snapshot = { objects, memories };
  return { language, names: Object.fromEntries((state.users||USERS).map(u=>[u.id,u.name])), topic, selected: [...selected], snapshot, fingerprint: JSON.stringify(snapshot),
    context: { language, topic, objects: structuredClone(objects), users: structuredClone(state.users||USERS),
      memories: memories.map(memory => ({ ...memory, response: memory.status === 'confirmed' ? memory.response : '' })) } };
}

function snapshotFields(prepared) {
  const memories = structuredClone(prepared.snapshot.memories);
  return { context_memory_ids: memories.map(memory => memory.id), memory_snapshots: memories,
    memory_revisions: Object.fromEntries(memories.map(memory => [memory.id, memory.revision])) };
}

function sourceNote(memory, prepared) {
  const names=prepared.names;
  if(prepared.language==='en'){const author=names[memory.author_id]||'The author',partner=names[memory.tagged_user_id]||'the tagged person';return memory.status==='pending'?`${author}’s record; awaiting ${partner}`:memory.status==='confirmed'?`Record confirmed by ${author} and ${partner}`:`${author}’s personal record`;}
  const author = names[memory.author_id] || '记录者';
  const partner = names[memory.tagged_user_id] || '被标注的人';
  if (memory.status === 'pending') return `${author}的记录，待${partner}确认`;
  if (memory.status === 'confirmed') return `${author}与${partner}双方已确认的记录`;
  return `${author}的本人记录`;
}

// Confirmation labels are supplied by code, never by the model. Model dialogue
// must not pretend to update confirmation, or present an unconfirmed recollection
// as an agreed fact. These checks complement the prompt and source annotations.
const statusClaim = /(?:双方|共同|对方|大家|我们都)(?:已经|已|都)?(?:一致)?确认|(?:已经|已)(?:被.{0,8})?确认|本人记录|待(?:对方|.{1,8})确认|(?:both|mutually|jointly)[ -]confirmed|(?:we|they|both).{0,12}(?:have |has |already )confirmed|\bconfirmed (?:fact|memory)\b/iu;
const certaintyClaim = /(?:我们|大家)(?:都|一起|共同)?(?:亲身)?(?:记得|经历过)|(?:确实|真实)(?:发生|经历)|(?:事实就是|事实是)|\b(?:we all remember|we both remember|definitely happened|confirmed fact)\b/iu;

function validateOutput(output, prepared) {
  if (!output || typeof output !== 'object' || !Array.isArray(output.lines)
    || output.lines.length !== prepared.selected.length * 2) throw new Error('invalid_scene_shape');
  const memories = new Map(prepared.snapshot.memories.map(memory => [memory.id, memory]));
  const objects = new Map(prepared.snapshot.objects.map(object => [object.id, object]));
  const lines = output.lines.map((line, index) => {
    if (!line || typeof line !== 'object' || line.object_id !== prepared.selected[index % prepared.selected.length]
      || typeof line.text !== 'string' || !line.text.trim() || line.text.trim().length > 320
      || typeof line.mood !== 'string' || !line.mood.trim() || line.mood.trim().length > 20
      || !Array.isArray(line.memory_ids) || line.memory_ids.length > 3
      || new Set(line.memory_ids).size !== line.memory_ids.length
      || line.memory_ids.some(id => typeof id !== 'string' || !memories.has(id) || !usable.has(memories.get(id).status))) {
      throw new Error('invalid_scene_line');
    }
    const cited = line.memory_ids.map(id => memories.get(id));
    if (statusClaim.test(line.text) || (!cited.length || cited.some(memory => memory.status !== 'confirmed')) && certaintyClaim.test(line.text)) {
      throw new Error('model_confirmation_claim');
    }
    return { object_id: line.object_id, name: objects.get(line.object_id).name, text: line.text.trim(), mood: line.mood.trim(),
      memory_ids: [...line.memory_ids], source_note: cited.length ? [...new Set(cited.map(memory=>sourceNote(memory,prepared)))].join('；') : prepared.language==='en'?'A companion’s thoughts and questions':'物品的想法与提问' };
  });
  // Every character with supplied memories must ground at least one of its turns
  // in its own record. Context-free turns remain opinions/questions, not memories.
  for (const object of prepared.snapshot.objects) {
    const ownMemories = new Set(prepared.snapshot.memories.filter(memory => memory.object_id === object.id).map(memory => memory.id));
    if (ownMemories.size && !lines.some(line => line.object_id === object.id && line.memory_ids.some(id => ownMemories.has(id)))) {
      throw new Error('ungrounded_character');
    }
  }
  const model = typeof output.model === 'string' && /^[a-z\d./:_-]{1,120}$/i.test(output.model) ? output.model : undefined;
  const localized=validateLocalized(output.localized,lines,prepared.snapshot.memories,[...Object.values(prepared.names),...prepared.snapshot.objects.map(o=>o.name)]);
  return { lines, ...(localized?{localized}:{}), ...(model ? { model } : {}) };
}

function validateLocalized(localized,lines,memories,names=[],required=['zh','en']){
 if(localized===undefined)return undefined;
 if(!localized||typeof localized!=='object'||Object.keys(localized).some(key=>!['zh','en'].includes(key)))throw new Error('invalid_localized_scene');
 return Object.fromEntries(required.map(language=>{
  const variant=localized[language];
  if(!variant||typeof variant.topic!=='string'||!variant.topic.trim()||variant.topic.length>160||!Array.isArray(variant.lines)||variant.lines.length!==lines.length)throw new Error('invalid_localized_scene');
  if(!nativeDialogue(variant.topic,language,names))throw new Error('wrong_topic_language');
  const translated=variant.lines.map((line,index)=>{
   if(!line||Object.keys(line).some(key=>!['text','mood'].includes(key))||typeof line.text!=='string'||!line.text.trim()||line.text.length>320||typeof line.mood!=='string'||!line.mood.trim()||line.mood.length>20)throw new Error('invalid_localized_line');
   if(!nativeDialogue(line.text,language,names)||!nativeDialogue(line.mood,language))throw new Error('wrong_translation_language');
   const cited=lines[index].memory_ids.map(id=>memories.find(m=>m.id===id));
   if(statusClaim.test(line.text)||(!cited.length||cited.some(m=>m?.status!=='confirmed'))&&certaintyClaim.test(line.text))throw new Error('translated_confirmation_claim');
   return {text:line.text.trim(),mood:line.mood.trim()};
  });return [language,{topic:variant.topic.trim(),lines:translated}];
 }));
}

function rules(state, data, fallbackReason) {
  const prepared = prepare(state, data);
  const scene = buildScene(state, data);
  Object.assign(scene, snapshotFields(prepared), { fallback_reason: fallbackReason });
  return scene;
}

function generationState(previous, milliseconds) {
  const day = new Date(milliseconds).toISOString().slice(0, 10), hour = Math.floor(milliseconds / 3_600_000);
  const validCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return { day, day_count: previous?.day === day ? validCount(previous.day_count) : 0,
    hour, hour_count: previous?.hour === hour ? validCount(previous.hour_count) : 0,
    last_started_at: Number.isFinite(previous?.last_started_at) ? previous.last_started_at : null,
    lease: previous?.lease && typeof previous.lease.id === 'string' && Number.isFinite(previous.lease.expires_at) ? previous.lease : null };
}

/**
 * Reserve one model call with an atomic, persisted room lease and allowance.
 * The provider runs exactly once, outside repository.update's retry callback.
 * Only the lease holder may commit, after rechecking all supplied context.
 */
export async function createScene({ repository, room, actor, data, generate = null, clock = Date.now, limits = {}, logger = console }) {
  if (!((await repository.read(room)).state.users||USERS).some(user=>user.id===actor)) throw new Problem('请选择有效的演示身份', 403);
  const policy = { ...DEFAULT_SCENE_LIMITS, ...limits };
  for (const key of Object.keys(DEFAULT_SCENE_LIMITS)) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < (key === 'cooldownMs' ? 0 : 1)) throw new Error('invalid_scene_limits');
  }
  const leaseId = uid();
  const reservation = await repository.update(room, state => {
    const prepared = prepare(state, data), milliseconds = clock();
    const budget = generationState(state.scene_generation, milliseconds);
    if (budget.lease?.expires_at > milliseconds) throw new Problem('小屋里的物品正在排练，请等这一幕完成后再开场', 409);
    if (typeof generate !== 'function') return { scene: rules(state, data, 'unconfigured') };
    if (budget.day_count >= policy.perDay || budget.hour_count >= policy.perHour
      || budget.last_started_at !== null && milliseconds - budget.last_started_at < policy.cooldownMs) {
      return { scene: rules(state, data, 'rate_limited') };
    }
    budget.day_count++; budget.hour_count++; budget.last_started_at = milliseconds;
    budget.lease = { id: leaseId, expires_at: milliseconds + policy.leaseMs };
    state.scene_generation = budget;
    return { prepared };
  });
  if (own(reservation, 'scene')) {
    log(logger, 'info', { event: 'scene_complete', mode: 'rules', fallback_reason: reservation.scene.fallback_reason });
    return reservation.scene;
  }

  const prepared = reservation.prepared;
  let generated, fallbackReason, usage = { input_tokens: 0, output_tokens: 0 };
  try {
    // A provider cannot mutate the original snapshot used for commit validation.
    const result = await generate(structuredClone(prepared.context));
    usage = { input_tokens: tokenCount(result?.usage?.input_tokens), output_tokens: tokenCount(result?.usage?.output_tokens) };
    try { generated = validateOutput(result, prepared); } catch {
      fallbackReason = 'invalid_output';
      log(logger, 'warn', { event: 'scene_model_error', code: 'invalid_output' });
    }
  } catch (error) {
    fallbackReason = 'provider_error';
    const code = error?.name === 'SceneModelError' && providerErrorCodes.has(error.code) ? error.code : 'provider_unavailable';
    log(logger, 'warn', { event: 'scene_model_error', code });
  }

  const saved = await repository.update(room, state => {
    if (state.scene_generation?.lease?.id !== leaseId) throw new Problem('这一幕排练已过期，请重新开场', 409);
    let current;
    try { current = prepare(state, data); } catch { throw new Problem('出场物品已经变化，请重新选择后开场', 409); }
    if (current.fingerprint !== prepared.fingerprint) fallbackReason = 'context_changed';
    let scene;
    if (fallbackReason) scene = rules(state, data, fallbackReason);
    else {
      scene = { id: uid(), language:prepared.language, topic: prepared.topic, mode: 'llm', ...generated,
        memory_ids: [...new Set(generated.lines.flatMap(line => line.memory_ids))], ...snapshotFields(prepared),
        created_at: new Date(clock()).toISOString() };
      state.latest_scene = scene;
    }
    state.scene_generation.lease = null;
    return scene;
  });
  log(logger, 'info', { event: 'scene_complete', mode: saved.mode,
    ...(generated?.model ? { model: generated.model } : {}), ...usage,
    ...(saved.fallback_reason ? { fallback_reason: saved.fallback_reason } : {}) });
  return saved;
}

// Translate an existing scene; never generate a new plot or accept model-supplied IDs.
export async function translateSavedScene({repository,room,actor,sceneId,language,translate,clock=Date.now}){
 if(!['zh','en'].includes(language))throw new Problem('请选择中文或英文');
 const leaseId=uid(), policy=DEFAULT_SCENE_LIMITS;
 const reservation=await repository.update(room,state=>{
  if(!(state.users||USERS).some(user=>user.id===actor))throw new Problem('请选择有效的演示身份',403);
  const scene=state.latest_scene;if(!scene||scene.id!==sceneId||!isSceneCurrent(scene,state))throw new Problem('剧场或记忆已变化，请查看最新内容',409);
  if(scene.localized?.[language])return {cached:structuredClone(scene.localized)};
  if(typeof translate!=='function')throw new Problem('当前暂时无法同步这场剧场的语言，请稍后重试',503);
  const budget=generationState(state.scene_generation,clock());
  if(budget.lease?.expires_at>clock()||budget.day_count>=policy.perDay||budget.hour_count>=policy.perHour||budget.last_started_at!==null&&clock()-budget.last_started_at<policy.cooldownMs)throw new Problem('请稍后再同步剧场语言',429);
  budget.day_count++;budget.hour_count++;budget.last_started_at=clock();budget.lease={id:leaseId,expires_at:clock()+policy.leaseMs};state.scene_generation=budget;
  return {scene:structuredClone(scene),fingerprint:JSON.stringify({...scene,localized:undefined})};
 });
 if(reservation.cached)return {id:sceneId,localized:reservation.cached};
 try{
  const result=await translate({language,topic:reservation.scene.topic,lines:reservation.scene.lines.map(({name,text,mood})=>({name,text,mood}))});
  return await repository.update(room,state=>{
   const scene=state.latest_scene;
   if(state.scene_generation?.lease?.id!==leaseId||!scene||scene.id!==sceneId||!isSceneCurrent(scene,state)||JSON.stringify({...scene,localized:undefined})!==reservation.fingerprint)throw new Problem('剧场或记忆已变化，请查看最新内容',409);
   const translated=validateLocalized({[language]:result},scene.lines,state.memories,[...(state.users||USERS).map(u=>u.name),...scene.lines.map(l=>l.name)],[language]);
   const localized={...scene.localized,...translated};
   scene.localized=localized;state.scene_generation.lease=null;
   return {id:sceneId,localized};
  });
 }catch(error){await repository.update(room,state=>{if(state.scene_generation?.lease?.id===leaseId)state.scene_generation.lease=null;return null;}).catch(()=>{});if(error instanceof Problem)throw error;throw new Problem('当前暂时无法同步这场剧场的语言，请稍后重试',503);}
}
