// Display variants never change canonical dialogue, memory IDs, authors or confirmation.
const HAN=/[\u3400-\u9fff]/u;
export function sceneLanguage(scene){if(['en','zh'].includes(scene.language))return scene.language;const text=(scene.lines||[]).map(l=>l.text).join('');return (text.match(/[\u3400-\u9fff]/gu)||[]).length*2>=(text.match(/[a-z]/giu)||[]).length?'zh':'en';}
export function nativeDialogue(text,language,names=[]){const value=names.filter(Boolean).reduce((value,name)=>value.split(name).join(''),text);return language==='en'?!HAN.test(value):HAN.test(value);}
const voices=[
 [/嘴硬|傲娇|tsundere/i,['哼，我只是顺手翻了翻记忆。','别误会，我只是有点在意。','嘴硬心软'],['Hmph. I only happened to open the memory drawer.','Do not get the wrong idea. I care a little, that is all.','soft-hearted']],
 [/温柔|体贴|重感情|gentle|warm|caring/i,['我把声音放轻一点，陪你慢慢聊。','有些小事，我想替你好好记着。','温柔惦念'],['Let me sit with you and speak softly.','Some little moments deserve to be remembered.','gentle']],
 [/一本正经|理性|认真|逻辑|analytical|serious/i,['先把记录和我的想法分开说。','你愿意再补充一个细节吗？','认真琢磨'],['Let us separate the record from my own thoughts.','Would you like to add one more detail?','thoughtful']],
 [/慢|佛系|悠闲|slow|calm|relaxed/i,['别急，我慢慢说，你慢慢听。','不用马上回答，我们还有很多时间。','慢慢道来'],['No rush. I will talk slowly; take your time.','There is no need to answer right away.','calm']],
 [/害羞|安静|内向|quiet|shy/i,['那个……我也想轻轻说两句。','可以悄悄告诉我，你现在怎么想吗？','轻声开口'],['Um… may I say a little something too?','Would you quietly tell me what you think now?','shy']],
 [/吐槽|幽默|俏皮|活泼|playful|witty/i,['叮！物品发言时间到。','你愿意给这个故事再写一小段吗？','俏皮发言'],['Ding! Time for a companion to speak.','Would you like to add a little more to this story?','playful']],
];
const neutral={zh:['我想从你留下的记录聊起。','接下来，你想让我记住什么？','好奇'],en:['I would like to start with the records you shared.','What would you like me to remember next?','curious']};
const knownTopics={
 '今天有什么想对我们说的？':'What would you like to tell us today?',
 '那些舍不得换掉的小东西':'The little things we cannot let go of',
};
function title(topic,language){if(language==='en'&&knownTopics[topic])return knownTopics[topic];if(language==='zh'){const pair=Object.entries(knownTopics).find(([,en])=>en===topic);if(pair)return pair[0];}return sceneLanguage({lines:[{text:topic}]})===language?topic:language==='en'?'Little stories from everyday life':'日常里的小故事';}
export function sourceDescription(line,state,language){
 const names=Object.fromEntries((state.users||[]).map(u=>[u.id,u.name]));
 const memories=(line.memory_ids||[]).map(id=>(state.memories||[]).find(m=>m.id===id)).filter(Boolean);
 if(!memories.length)return language==='en'?"A companion's thoughts and questions":'物品的想法与提问';
 return memories.map(m=>{const author=names[m.author_id]||(language==='en'?'The author':'记录者'),partner=names[m.tagged_user_id]||(language==='en'?'the tagged person':'被标注的人');
  if(language==='en')return m.status==='pending'?`${author}'s record; awaiting ${partner}'s reply`:m.status==='confirmed'?`Record confirmed by ${author} and ${partner}`:`${author}'s personal record`;
  return m.status==='pending'?`${author}的记录，待${partner}回应`:m.status==='confirmed'?`${author}与${partner}双方确认的记录`:`${author}的本人记录`;
 }).join(language==='en'?'; ':'；');
}
export function ruleVariants(scene,state){
 const names=Object.fromEntries((state.users||[]).map(u=>[u.id,u.name]));
 return Object.fromEntries(['zh','en'].map(language=>[language,{topic:title(scene.topic,language),lines:scene.lines.map((line,index)=>{
  const object=(state.objects||[]).find(o=>o.id===line.object_id),voice=voices.find(([pattern])=>pattern.test(object?.personality||''));
  const [opening,question,mood]=voice?voice[language==='zh'?1:2]:neutral[language];
  const memory=(scene.memory_snapshots||state.memories||[]).find(m=>(line.memory_ids||[]).includes(m.id));
  const author=memory&&(names[memory.author_id]||(language==='en'?'The author':'记录者'));
  const previous=index?scene.lines[index-1].name:null;
  let recall=language==='en'?'I have no recorded memory yet. What would you like me to remember? ':'我还没有能引用的记忆，等你亲口讲给我听。';
  if(memory){
   // Quotations stay exact. Opposite-language records are opened through the source link,
   // rather than silently pretending an untranslated quote is localized dialogue.
   const quoteMatches=language==='zh'?HAN.test(memory.text):!HAN.test(memory.text);
   recall=language==='en'?(quoteMatches?`${author} wrote: “${memory.text}”. `:`I found a record from ${author}; you can open its original wording below. `):(quoteMatches?`${author}记下过：「${memory.text}」。`:`我翻到了${author}留下的一段记录，原文可以从下方打开。`);
  }
  if(memory?.status==='confirmed'&&memory.response){const partner=names[memory.tagged_user_id]||(language==='en'?'The other person':'对方');const matches=language==='zh'?HAN.test(memory.response):!HAN.test(memory.response);if(matches)recall+=language==='en'?`${partner} added: “${memory.response}”. `:`${partner}还补充：「${memory.response}」。`;}
  const lead=previous?(language==='en'?`Picking up ${previous}'s thought, `:`接着${previous}的话，`):'';
  return {text:opening+' '+lead+recall+question,mood};
 })}]));
}
export function displayScene(scene,state,language){
 if(!scene)return null;
 const variant=scene.localized?.[language]||((scene.mode==='rules'||!scene.mode)&&scene.id?ruleVariants(scene,state)[language]:null);
 const names=[...(state.users||[]).map(u=>u.name),...scene.lines.map(l=>l.name)];
 const available=!!variant||sceneLanguage(scene)===language&&scene.lines.every(line=>nativeDialogue(line.text,language,names)&&nativeDialogue(line.mood,language));
 const lines=scene.lines.map((line,index)=>({...line,text:variant?.lines[index]?.text??line.text,mood:variant?.lines[index]?.mood??line.mood,source_note:variant?sourceDescription(line,state,language):line.source_note}));
 return {...scene,topic:variant?.topic||scene.topic,original_topic:variant?.topic&&variant.topic!==scene.topic?scene.topic:null,lines,language_available:available};
}
