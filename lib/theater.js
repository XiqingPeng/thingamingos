import {ruleVariants} from '../web/scene-language.js';
import rules from './theater-rules.json' with { type: 'json' };
import { USERS, uid, now, text, Problem } from './shared.js';

// Rules produce questions and opinions; only attributed memory quotations state events.
function termPositions(value, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = /^[a-z ]+$/.test(term) ? `\\b${escaped}\\b` : escaped;
  return [...value.toLowerCase().matchAll(new RegExp(pattern, 'gu'))].map(m => m.index);
}

function voiceFor(personality = '') {
  const value = personality.toLowerCase();
  const matches = rules.voices.map((voice, priority) => {
    const positions = voice.terms.flatMap(term => termPositions(value, term)).filter(position =>
      !/(?:不(?:(?:太|怎么|是很|算|喜欢|爱|再|会))*|并非|从不|没有|不要|(?:not|isn't|aren't|wasn't|weren't|never|no longer)\s+(?:(?:very|so|too|really)\s+)*)$/.test(value.slice(0, position)));
    return { voice, priority, position: positions.length ? Math.min(...positions) : Infinity };
  }).filter(match => Number.isFinite(match.position)).sort((a, b) => a.position - b.position || a.priority - b.priority);
  return [matches[0]?.voice || rules.neutral, matches[1]?.voice || matches[0]?.voice || rules.neutral];
}

function topicContext(topic) {
  // Ignore explicitly excluded clauses, including their lexical tokens.
  const active = topic.toLowerCase()
    .replace(/(?:不聊|不谈|不要聊|别聊|不是|不讨论|不要讨论).*?(?=而是|只聊|改聊|[，,；;。！？!?]|$)/gu, ' ')
    .replace(/\b(?:not|don't discuss|do not discuss)\s+.*?(?=\bbut\b|[,;.!?]|$)/gu, ' ');
  const groups = rules.topics.map(group => ({ group, count: group.terms.filter(term => termPositions(active, term).length).length }))
    .filter(item => item.count).sort((a, b) => b.count - a.count);
  let value = active;
  for (const phrase of rules.stop_phrases) value = value.replaceAll(phrase, ' ');
  const tokens = new Set((value.match(/[a-z0-9]+/g) || []).filter(word => word.length > 1 && !rules.stop_words.includes(word)));
  for (const run of value.match(/[\u3400-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return { groups: groups.map(item => item.group), tokens: [...tokens], focus: groups[0]?.group.focus || `「${topic}」`,
    question: groups[0]?.group.question || rules.default_question.replace('{topic}', topic) };
}

function relevance(memory, context) {
  // An unconfirmed response must never influence the generated scene.
  const content = memory.text + (memory.status === 'confirmed' ? ` ${memory.response || ''}` : '');
  const groups = context.groups.filter(group => group.kind === memory.kind || group.terms.some(term => termPositions(content, term).length));
  return groups.length * 4 + context.tokens.filter(token => termPositions(content, token).length).length;
}

function quotation(memory, names) {
  let result = `${names[memory.author_id] || '记录者'}记得「${memory.text}」。`;
  if (memory.status === 'pending') return result + `这仍是记录者的说法，等${names[memory.tagged_user_id] || '被标注的人'}回应后再确认。`;
  if (memory.status === 'confirmed') {
    if (memory.response) result += `${names[memory.tagged_user_id] || '被标注的人'}还说「${memory.response}」。`;
    return result + `这段记录已由${names[memory.author_id] || '记录者'}和${names[memory.tagged_user_id] || '被标注的人'}双方确认。`;
  }
  return result + '这是本人记录。' + (memory.kind === 'promise' ? '约定是否完成，还等你来补充。' : '');
}

// Share the existing deterministic ranking with model context preparation.
// This function only selects records; it never changes their attribution/status.
export function selectSceneMemories(state, selected, topic, limit = 2) {
  const context = topicContext(topic);
  return selected.flatMap(id => state.memories
    .filter(memory => memory.object_id === id && ['recorded', 'pending', 'confirmed'].includes(memory.status))
    .sort((a, b) => relevance(b, context) - relevance(a, context)
      || Number(b.status === 'confirmed') - Number(a.status === 'confirmed')
      || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .slice(0, limit));
}

export function composeLines(state, selected, topic) {
  const names = Object.fromEntries((state.users||USERS).map(user => [user.id, user.name]));
  const context = topicContext(topic);
  const objects = selected.map(id => state.objects.find(object => object.id === id));
  return objects.map((object, index) => {
    const [voice, accent] = voiceFor(object.personality);
    const candidates = state.memories.filter(memory => memory.object_id === object.id && ['recorded', 'pending', 'confirmed'].includes(memory.status));
    // Relevance first; confirmation and recency resolve ties. Stable ID resolves timestamp ties across backends.
    candidates.sort((a, b) => relevance(b, context) - relevance(a, context)
      || Number(b.status === 'confirmed') - Number(a.status === 'confirmed')
      || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    const memory = candidates[0];
    const lead = index ? `接着「${objects[index - 1].name}」的话，我也想聊聊「${topic}」。` : `聊到「${topic}」，`;
    const recall = !memory ? '我还没有能引用的记忆，等你亲口讲给我听。'
      : (relevance(memory, context) ? '我翻到这段相关记录：' : '还没有找到直接相关的记忆，先把已有记录放在旁边：') + quotation(memory, names);
    return { object_id: object.id, name: object.name, text: voice.opening + lead + recall
      + voice.stance.replace('{focus}', context.focus) + accent.invite + context.question,
      mood: voice.id === accent.id ? voice.mood : `${voice.mood} · ${accent.mood}`, memory_ids: memory ? [memory.id] : [] };
  });
}

export function buildScene(state, data) {
  const topic = text(data, 'topic', 80) || '今天有什么想对我们说的？';
  const selected = data.object_ids;
  if (!Array.isArray(selected) || !selected.length || selected.length > 3 || new Set(selected).size !== selected.length
    || selected.some(id => !state.objects.some(object => object.id === id))) throw new Problem('请选择一到三件不同的物品');
  const lines = data.language === "en" ? composeEnglishLines(state, selected, topic) : composeLines(state, selected, topic);
  const scene = { id: uid(), language:data.language==='en'?'en':'zh', topic, mode: 'rules', lines, memory_ids: [...new Set(lines.flatMap(line => line.memory_ids))], created_at: now() };
  scene.localized=ruleVariants(scene,{...state,users:state.users||USERS});
  state.latest_scene = scene;
  return scene;
}

function composeEnglishLines(state, selected, topic) {
 const names=Object.fromEntries((state.users||USERS).map(u=>[u.id,u.name]));
 const memories=selectSceneMemories(state,selected,topic,1);
 return selected.map((id,index)=>{
  const object=state.objects.find(o=>o.id===id), memory=memories.find(m=>m.object_id===id);
  let recall="I have no recorded memory yet. What would you like me to remember? ";
  if(memory){recall=`${names[memory.author_id]||'The author'} wrote: “${memory.text}”. `;
   if(memory.status==='pending')recall+=`This is their account, awaiting ${names[memory.tagged_user_id]||'the other person'}'s reply. `;
   else if(memory.status==='confirmed')recall+=`Both people confirmed this record. ${memory.response?`Their reply was: “${memory.response}”. `:''}`;
   else recall+='This is a personal record. ';
  }
  const gentle=/温柔|慢|乐天|gentle|slow/i.test(object.personality);
  const stance=gentle?'Let us take a small, kind step. What matters to you about this?':'I have a few thoughts about that. What should we try next?';
  return {object_id:id,name:object.name,text:`${index?'Picking up the conversation':'Thinking'} about “${topic}”: ${recall}${stance}`,mood:gentle?'gentle':'curious',memory_ids:memory?[memory.id]:[]};
 });
}
