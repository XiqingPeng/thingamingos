import {t,ui,getLanguage,setLanguage,locale,translateError} from './i18n.js';
import { collectionPage, roomCast, objectIcon } from './collection.js';
import { sceneMarkup, sceneKey, isSceneCurrent, playbackMarkup } from './theater.js';
import { displayScene } from './scene-language.js';
import { createScenePlayer } from './scene-player.js';
import { createRequestGate, defaultSceneIds, prepareObjectData, createUploadCache } from './ui-state.js';
import { convertFileToPixelPng } from './pixelize.js';
import {createRoomAudioUI} from './audio-ui.js';
"use strict";
const $ = (s, root=document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
 memory:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 5V3m8 2V3M4 10h16m-12 5h3m3 0h2"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 star:'<path d="m12 3 2.6 5.5 6.1.9-4.4 4.3 1 6.1-5.3-2.9-5.3 2.9 1-6.1L3.3 9.4l6.1-.9z"/>',
 play:'<path d="m8 4 12 8L8 20z"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
 bell:'<path d="M5 16V9a7 7 0 0 1 14 0v7l2 3H3zM10 22h4"/>',
 leaf:'<path d="M19 3C7 2 1 9 5 16s15 3 14-13zM5 21 16 8"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'
};
const icon = key => ui`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || icons.star}</svg>`;
const art = (kindOrObj, cls='') => {
 if (kindOrObj && typeof kindOrObj === 'object') {
  if (kindOrObj.pixel_media_url) return ui`<img class="${cls} pixel-sprite-art" src="${esc(kindOrObj.pixel_media_url)}" alt="${esc(kindOrObj.name || '')}">`;
  if (kindOrObj.media_url && !kindOrObj.media_type?.startsWith('video')) return ui`<img class="${cls} uploaded-mini-art" src="${esc(kindOrObj.media_url)}" alt="${esc(kindOrObj.name || '')}">`;
  kindOrObj = objectIcon(kindOrObj);
 }
 return ui`<svg class="${cls}" viewBox="0 0 240 240" aria-hidden="true"><use href="#art-${['mug','keyboard','plant','camera','music','plush','book','clock','phone','lamp','brush','mouse'].includes(kindOrObj)?kindOrObj:'other'}"/></svg>`;
};
let state, selected='cup', view='home', filter='all', busy=false, switching=false, lastState='', previewUrl, pixelPreviewUrl, currentPixelFile=null, pixelConverting=false, pixelJobId=0;
let modalGeneration=0, pendingRender=false, scenePending=false;
let rendering=false, returnSceneKey=null, lastAnnouncement='';
const translationCache=new Map(), translationStatus=new Map();
const player=createScenePlayer({onChange:updatePlaybackView});
const roomSound=createRoomAudioUI({document});
if(new URLSearchParams(location.search).get('devicePreview')==='iphone')document.documentElement.classList.add('device-preview');
const providedRoom=new URLSearchParams(location.search).get('room');
const roomKey=/^[a-f0-9]{32}$/.test(providedRoom||'')?providedRoom:(localStorage.getItem('object-stories-room')||crypto.randomUUID().replaceAll('-',''));
localStorage.setItem('object-stories-room',roomKey);
const appManifestLink=document.querySelector('#app-manifest');if(appManifestLink)appManifestLink.href='/api/manifest?room='+encodeURIComponent(roomKey);
if(typeof navigator!=='undefined'&&'serviceWorker' in navigator&&globalThis.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
let actorId = sessionStorage.getItem('object-stories-user') || 'a';
const requests=createRequestGate(actorId);
const uploadFile=createUploadCache(()=>crypto.randomUUID().replaceAll('-',''));
let toastTimer, libraryQuery='', libraryPage=0, roomPage=0, accountMode=false, authTab='login', adminPage=0;
function user(id) { return state.users.find(u => u.id===id) || {name:t('朋友'),color:'#aaa'}; }
function object(id) { return state.objects.find(o => o.id===id); }
function pending() { return state.memories.filter(m => m.tagged_user_id===state.current_user_id && m.status==='pending'); }
const counts = id => state.memories.filter(m=>m.object_id===id).length;
function avatar(id) {const u=user(id);return ui`<span class="avatar" style="background:${esc(u.color)}">${esc(u.name.slice(-1))}</span>`;}
function notice(message) { const t=$('#toast'); t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500); }
async function api(path, data, actor=actorId) {
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
 const opts={signal:controller.signal,headers: {'X-Room-Key':roomKey,'X-Demo-User':actor}};
 if (data!==undefined) {opts.method='POST';if(data instanceof FormData) opts.body=data;else {opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(data);}}
 try {
  const res=await fetch(path,opts);let value;try {value=await res.json();}catch {throw new Error(t('小屋暂时没接上，请稍后重试'));}
  if(!res.ok){if(res.status===401&&accountMode)showAuth();const error=new Error(translateError(value.error || '这次没有保存成功，请再试一次'));error.status=res.status;throw error;}return value;
 }catch(error){if(error.name==='AbortError')throw new Error(t('连接超时，输入已保留，请重试'));throw error;}finally{clearTimeout(timeout);}
}
function applyTranslationCache(scene) {
 if(!scene)return;
 const key=sceneKey(scene);if(!key)return;
 const cached=translationCache.get(key)||{};
 const merged={...cached,...(scene.localized||{})};
 if(Object.keys(merged).length){translationCache.set(key,merged);scene.localized=merged;}
}
function activeSceneLines(scene=state?.latest_scene) {
 if(!scene)return [];
 return displayScene(scene,state,getLanguage())?.lines || scene.lines;
}
function ensureSceneLanguage(force=false) {
 if(!state||!isSceneCurrent(state.latest_scene,state))return;
 const scene=state.latest_scene,language=getLanguage(),key=sceneKey(scene);
 if(!key)return;
 const view=displayScene(scene,state,language);
 if(view.language_available)return;
 const statusKey=key+':'+language,current=translationStatus.get(statusKey);
 if(current?.pending||(current?.error&&!force))return;
 if(!scene.id&&scene.id!==undefined)return;
 translationStatus.set(statusKey,{pending:true,error:null});
 const task=requests.capture(),sceneId=scene.id;
 api('/api/scenes/'+sceneId+'/language',{language},task.actor).then(result=>{
  if(!requests.isCurrent(task)||!state||sceneKey(state.latest_scene)!==key||!isSceneCurrent(state.latest_scene,state))return;
  if(result?.localized){
   const merged={...(translationCache.get(key)||{}),...(state.latest_scene.localized||{}),...result.localized};
   translationCache.set(key,merged);state.latest_scene.localized=merged;lastState=JSON.stringify(state);
  }
  translationStatus.delete(statusKey);
  if($('#modal').open)pendingRender=true;else render();
 }).catch(err=>{
  if(!requests.isCurrent(task)||!state||sceneKey(state.latest_scene)!==key)return;
  translationStatus.set(statusKey,{pending:false,error:err.message||t('当前暂时无法同步这场剧场的语言，请稍后重试')});
  if($('#modal').open)pendingRender=true;else render();
 });
}
async function refresh(silent=false,playbackRequest=null) {
 const ticket=requests.beginRead(),next=await api('/api/state',undefined,ticket.actor);
 if(!requests.accepts(ticket))return false;
 applyTranslationCache(next.latest_scene);
 const serialized=JSON.stringify(next);
 if(silent && serialized===lastState && !playbackRequest)return true;
 state=next;lastState=serialized;actorId=state.current_user_id;sessionStorage.setItem('object-stories-user',actorId);
 if(!object(selected)) selected=state.objects[0]?.id;
 rendering=true;
 if(playbackRequest && requests.isCurrent(playbackRequest.ticket) && playbackRequest.generation===modalGeneration
  && view==='home' && !$('#modal').open && !document.hidden && isSceneCurrent(state.latest_scene,state)
  && sceneKey(state.latest_scene)===playbackRequest.key)player.start(playbackRequest.key,activeSceneLines());
 syncPlayback();rendering=false;
 ensureSceneLanguage();
 if($('#modal').open)pendingRender=true;else{pendingRender=false;render();}
 return true;
}
function syncPlayback() {
 if(!isSceneCurrent(state?.latest_scene,state)){player.reset();returnSceneKey=null;return;}
 const key=sceneKey(state.latest_scene);
 player.load(key,activeSceneLines());
 if(returnSceneKey!==key)returnSceneKey=null;
}
function playbackFocusAction() {
 const action=document.activeElement?.dataset?.action;
 return action?.startsWith('playback-')?action:null;
}
function restorePlaybackFocus(action) {
 if(!action)return;
 const target=$(ui`[data-action="${action}"]`) || $('[data-action="playback-replay"]') || $('#theater-controls');
 target?.focus({preventScroll:true});
}
function updatePlaybackView(snapshot,announce=true) {
 if(rendering || view!=='home' || !state || !isSceneCurrent(state.latest_scene,state)
  || sceneKey(state.latest_scene)!==snapshot.sceneKey)return;
 const host=$('#theater');if(!host)return;
 const projected=displayScene(state.latest_scene,state,getLanguage());
 for(const line of host.querySelectorAll('[data-line-index]')){
  const index=Number(line.dataset.lineIndex);
  line.hidden=index>=snapshot.visibleCount;
  line.dataset.current=String(snapshot.status!=='complete' && index===snapshot.visibleCount-1);
 }
 const controls=$('#theater-controls'),action=playbackFocusAction();
 if(controls){controls.innerHTML=playbackMarkup(projected,snapshot,esc);restorePlaybackFocus(action);}
 const announcement=snapshot.sceneKey+':'+getLanguage()+':'+snapshot.visibleCount;
 if(announce && announcement!==lastAnnouncement && snapshot.status!=='idle' && projected?.language_available){
  const line=projected.lines[snapshot.visibleCount-1],live=$('#theater-announcement');
  if(live && line)live.textContent=ui`第 ${snapshot.visibleCount} 句，共 ${snapshot.total} 句。${line.name}：${line.text}`;
 }
 lastAnnouncement=announcement;
}
function focusTheater() {
 const theater=$('#theater');
 theater?.focus({preventScroll:true});
 theater?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
function memoryMarkup(m,full=false) {
 const statuses={pending:t('等对方回应'),confirmed:t('双方已确认'),recorded:t('本人记录'),declined:t('对方保留不同意见')};
 const types={story:t('共同经历'),gift:t('一份心意'),promise:t('小小约定')};
 const obj=object(m.object_id);
 return ui`<article class="memory-item" id="memory-${esc(m.id)}"><div class="memory-top"><span class="memory-type"><span class="dot"></span>${esc(types[m.kind]||t('共同经历'))}${full?ui` · ${esc(obj?.name||t('物品'))}`:''}</span><span class="status ${esc(m.status)}">${statuses[m.status]}</span></div><p>${esc(m.text)}</p><div class="memory-meta"><span>${esc(user(m.author_id).name)} 记下</span>${m.tagged_user_id?ui`<span>·</span><span class="person-tag">@${esc(user(m.tagged_user_id).name)}</span>`:''}<span>· ${new Date(m.created_at).toLocaleDateString(locale(),{month:'numeric',day:'numeric'})}</span></div>${m.response?ui`<div class="response">${esc(user(m.tagged_user_id).name)}：${esc(m.response)}</div>`:''}${m.tagged_user_id===state.current_user_id&&m.status==='pending'?ui`<div class="response-actions"><button data-action="respond" data-id="${esc(m.id)}">回应这段记忆 ↗</button></div>`:''}${m.author_id===state.current_user_id?ui`<div class="memory-actions"><button data-action="edit-memory" data-id="${esc(m.id)}">修改</button><button data-action="forget" data-id="${esc(m.id)}">让它忘记</button></div>`:''}</article>`;
}
function collectionMarkup(){
 const page=collectionPage(state.objects,libraryQuery,libraryPage);libraryPage=page.page;
 return ui`<section class="shelf-grid" aria-label="物品列表">${page.items.map(o=>ui`<button class="object-card ${o.id===selected?'active':''}" title="${esc(o.name)}" data-action="select" data-id="${esc(o.id)}"><span class="selected-mark">✓</span>${art(o,'mini-art')}<h3>${esc(o.name)}</h3><div class="object-type">${esc(o.object_type||({mug:t('杯子'),keyboard:t('键盘'),plant:t('植物'),other:t('其他物品')}[o.kind]))}</div><p>${esc(o.personality)}</p><div class="memory-total">${icon('memory')}${counts(o.id)} 段记忆 · ${esc(user(o.owner_id).name)}的小伙伴</div></button>`).join('')}</section>${!page.total?t('<p class="empty">没有找到匹配的物品</p>'):''}<div class="collection-pager"><button class="secondary" data-action="library-prev" ${page.page===0?'disabled':''}>← 上一页</button><span>${page.page+1} / ${page.pages} · ${page.total}</span><button class="secondary" data-action="library-next" ${page.page+1>=page.pages?'disabled':''}>下一页 →</button></div>`;
}
function homeMarkup() {
 const current=object(selected);
 const cast=roomCast(state.objects,roomPage).items;
 const memories=state.memories.filter(m=>m.object_id===selected);
 const slogans={mug:t('这段故事，我记得。'),keyboard:t('今天可以早点下班吗？'),plant:t('今天也有好好长大。'),other:t('我有一点小想法。')};
 const allMemories=memories.slice(0,4);
 return ui`<section class="intro"><div><div class="eyebrow">LIFE, IN LITTLE THINGS</div><h1>小东西，<em>也有大心事。</em></h1><p>把日常收进小屋，让它们记住你们的故事。</p></div><button class="primary" data-action="create">${icon('plus')}收进一件物品</button></section>
 <div class="main-grid"><div><section class="room" aria-label="物品小屋"><div class="pixel-window" aria-hidden="true"><span></span></div><div class="pixel-picture" aria-hidden="true">✿</div><div class="room-head"><div class="label">OUR LITTLE ROOM</div><h2>今天，小屋也有话想说</h2><p>点一点，听听谁在惦记你</p></div><div class="room-badge"><span class="live-dot"></span>桌上伙伴 ${cast.length} / ${state.objects.length}</div><div class="scene-floor"></div><div class="table-oval"></div><div class="cast">${cast.map(o=>ui`<button class="character ${o.id===selected?'selected':''}" data-action="select" data-id="${esc(o.id)}" aria-label="查看${esc(o.name)}的记忆" title="${esc(o.name)}"><span class="bubble">${esc(counts(o.id)?slogans[o.kind]: t('给我讲讲你的故事吧。'))}</span>${o.pixel_media_url?ui`<img class="character-art pixel-sprite-art" src="${esc(o.pixel_media_url)}" alt="${esc(o.name)}">`:o.media_url?ui`<${o.media_type.startsWith('video')?'video':'img'} class="uploaded-art" src="${esc(o.media_url)}" ${o.media_type.startsWith('video')?'muted playsinline preload="metadata"':'alt="'+esc(o.name)+'"'}></${o.media_type.startsWith('video')?'video':'img'}>${o.media_type.startsWith('video')?t('<span class="video-label">视频物品</span>'):''}`:art(o,'character-art')}<span class="char-name"><span class="tiny-dot"></span><span class="char-name-text">${esc(o.name)}</span></span><span class="char-subtitle">${esc(o.personality)}</span></button>`).join('')}</div></section>
 <div class="room-switch"><span>桌上伙伴 · ${roomCast(state.objects,roomPage).page+1} / ${roomCast(state.objects,roomPage).pages}</span><button class="secondary" data-action="room-next" ${state.objects.length<=3?'disabled':''}>换一组上桌 →</button></div><div class="under-room"><button class="secondary mobile-memory-link" data-action="drawer">${icon('memory')}${t('看看它的记忆')}</button><p class="selected-object-name">当前物品：${esc(current?.name||t("小屋"))}</p><button class="primary" data-action="scene" ${scenePending?'disabled':''}>${icon('play')}${scenePending?t('物品们正在酝酿对话…'):t('开一场小剧场')}</button></div>
 <div class="section-heading"><h2>住在这里的小伙伴 <span class="sub">${state.objects.length} 位</span></h2><span class="cast-count">点击物品，翻翻它的记忆</span></div>
 <section class="collection-library" aria-label="所有物品"><label class="collection-search"><span>搜索物品</span><input id="collection-query" type="search" placeholder="搜索名称、类型或性格" value="${esc(libraryQuery)}" maxlength="100"></label><div id="collection-region">${collectionMarkup()}</div></section>
 ${sceneMarkup(state.latest_scene,state,art,icon,esc,player.snapshot(),state.latest_scene?translationStatus.get(sceneKey(state.latest_scene)+':'+getLanguage()):null)}</div>
 <aside class="drawer" id="memory-drawer" tabindex="-1"><div class="drawer-title"><h2>${esc(current?.name||t('小屋'))}的记忆抽屉</h2>${icon('memory')}</div><p class="drawer-description">那些被记住的小事，让它成为特别的它。</p><div class="orbs">${allMemories.map((m,i)=>ui`<button class="orb" style="--orb-color:${['#edbb70','#b5a9d9','#9fba94','#dfb0b9'][i]}" title="${esc(m.text)}" aria-label="打开记忆：${esc(m.text)}" data-action="source" data-id="${esc(m.id)}"></button>`).join('')}${!allMemories.length?t('<span class="small-note">还没有记忆，先讲个故事吧。</span>'):''}</div><div class="memory-list">${allMemories.map(m=>memoryMarkup(m)).join('')||t('<div class="empty">第一段故事，<br>就从你开始吧。</div>')}</div><button class="drawer-add" data-action="add-memory">＋ 告诉它一件小事</button>${current?.media_url?ui`<button class="text-button" data-action="detail" data-id="${esc(current.id)}">查看原照片 / 视频 ↗</button>`:''}${memories.length>4?t('<button class="text-button" data-action="nav" data-view="memories">查看全部记忆 ↗</button>'):''}</aside></div>`;
}
function memoriesMarkup() {
 let records=state.memories;
 if(filter==='pending')records=pending();else if(filter!=='all')records=records.filter(m=>m.object_id===filter);
 return ui`${returnSceneKey?t('<div class="theater-return"><button class="secondary" data-action="playback-return">← 返回小剧场</button><span>阅读进度已保留</span></div>'):''}<div class="eyebrow">LITTLE MOMENTS, KEPT SAFE</div><h1 class="view-title">记忆里，都是你们。</h1><p class="view-description">谁记下了什么，谁补充了后来，都在这里。</p><div class="filter-row"><button class="filter-chip ${filter==='all'?'active':''}" data-action="filter" data-filter="all">全部记忆</button><button class="filter-chip ${filter==='pending'?'active':''}" data-action="filter" data-filter="pending">等我回应 · ${pending().length}</button>${state.objects.map(o=>ui`<button class="filter-chip ${filter===o.id?'active':''}" data-action="filter" data-filter="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div><section class="full-memories">${records.map(m=>memoryMarkup(m,true)).join('')||t('<div class="empty">这里暂时还没有故事。<br>回小屋，告诉物品一件小事吧。</div>')}</section>`;
}
function peopleMarkup() {
 const relations=state.memories.filter(m=>m.tagged_user_id);
 return ui`<div class="eyebrow">PEOPLE IN OUR STORIES</div><h1 class="view-title">一件物品，连接两个人。</h1><p class="view-description">你说“这是他送我的”，故事里就多了一个可以回应的人。</p><div class="people-grid">${state.users.map(u=>ui`<article class="person-card">${avatar(u.id)}<h2>${esc(u.name)}${u.id===state.current_user_id?t(' · 当前身份'):''}</h2><p>${state.objects.filter(o=>o.owner_id===u.id).length} 位物品伙伴<br>${state.memories.filter(m=>m.author_id===u.id||m.tagged_user_id===u.id).length} 段与 TA 有关的记忆</p></article>`).join('')}</div><div class="relation-list"><div class="section-heading"><h2>故事里的连线</h2></div>${relations.map(m=>ui`<div class="relation">${avatar(m.author_id)}<span>${esc(user(m.author_id).name)}</span><span class="connection">—</span>${art(object(m.object_id))}<span>${esc(object(m.object_id)?.name)}</span><span class="connection">—</span>${avatar(m.tagged_user_id)}<span>${esc(user(m.tagged_user_id).name)}</span><span class="muted">${m.kind==='gift'?t('赠送故事'):t('共同经历')} · ${{pending:t('待对方回应'),confirmed:t('双方已确认'),declined:t('保留不同意见')}[m.status]||t('已记录')}</span><button class="text-button" data-action="source" data-id="${esc(m.id)}">查看故事 ↗</button></div>`).join('')||t('<div class="empty">给一段故事标注朋友，这里就会长出连线。</div>')}</div>`;
}
function render() {
 const focusAction=playbackFocusAction();
 rendering=true;syncPlayback();rendering=false;
 const n=pending().length;
 $('#app').innerHTML=ui`<div class="shell"><aside class="sidebar"><a class="brand" href="/?room=${esc(roomKey)}" aria-label="thingamingos home"><span class="brand-mark">✿</span><span><span class="brand-name">thingamingos</span><small>LITTLE THINGS, BIG STORIES</small></span></a><div class="side-caption">A PLACE TO BELONG</div><nav class="nav" aria-label="主导航">${[['home','home',t('小小世界')],['memories','memory',t('记忆抽屉')],['people','people',t('故事里的人')],...(state.account?.role==='admin'?[['admin','people',t('用户管理')]]:[])].map(([v,i,label])=>ui`<button class="${view===v?'active':''}" data-action="nav" data-view="${v}" aria-label="${esc(label)}" ${view===v?'aria-current="page"':''}>${icon(i)}<span class="nav-label">${label}</span><span class="nav-label-short">${({home:t('小屋'),memories:t('记忆'),people:t('朋友'),admin:t('管理')})[v]}</span>${v==='memories'?ui`<span class="nav-count">${state.memories.length}</span>`:''}</button>`).join('')}</nav><div class="side-bottom"><div class="little-note"><span>✧</span>有些小东西，<br>替我们记得很久。</div><div class="identity"><div class="identity-row">${avatar(state.current_user_id)}${state.identity_mode==='account'?ui`<button class="account-name" data-action="account">${esc(state.account.name)}</button>`:ui`<select id="user-select" aria-label="切换演示用户">${state.users.map(u=>ui`<option value="${u.id}" ${u.id===state.current_user_id?'selected':''}>${esc(u.name)}</option>`).join('')}</select>`}</div></div></div></aside><div class="workspace"><header class="topbar"><div class="crumb">小小世界 <span>/</span> <strong>我们的记忆小屋</strong></div><div class="top-actions">${languageMarkup()}<span class="room-sound-host" data-room-sound></span><div class="presence" aria-label="小屋成员">${state.users.map(u=>avatar(u.id)).join('')}</div><button class="quiet-button install-entry" data-action="install" aria-label="${t('添加到桌面')}" title="${t('添加到桌面')}">${icon('upload')}<span>${t('添加到桌面')}</span></button><button class="quiet-button" data-action="invite" aria-label="${t('邀请朋友')}" title="${t('邀请朋友')}">${icon('people')}邀请朋友</button><button class="quiet-button" data-action="inbox" aria-label="${t('等我回应')}" title="${t('等我回应')}">${icon('bell')}等我回应${n?ui`<span class="notify-dot">${n}</span>`:''}</button></div></header><main class="content">${view==='home'?homeMarkup():view==='memories'?memoriesMarkup():view==='admin'?adminMarkup():peopleMarkup()}</main></div></div>`;
 $('.memory-total .icon')?.setAttribute('style','width:11px;height:11px');
 roomSound.mount();updatePlaybackView(player.snapshot(),false);restorePlaybackFocus(focusAction);
}
function releaseModalMedia() {
 for(const media of $('#modal').querySelectorAll('video,audio'))media.pause();
 if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
 if(pixelPreviewUrl){URL.revokeObjectURL(pixelPreviewUrl);pixelPreviewUrl=null;}
 currentPixelFile=null;pixelJobId++;
}
function closeModal(expectedGeneration) {
 if(expectedGeneration!==undefined && expectedGeneration!==modalGeneration)return false;
 releaseModalMedia();$('#modal').close();modalGeneration++;document.body.classList.remove('modal-open');
 if(pendingRender && state){pendingRender=false;render();}
 return true;
}
function modal(title,subtitle,body,formId,submit=t('保存这段故事')) {
 player.pause();releaseModalMedia();modalGeneration++;
 const d=$('#modal');d.innerHTML=ui`<div class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close-modal" data-action="close" aria-label="关闭">×</button></div>${formId?ui`<form id="${formId}" data-actor="${esc(actorId)}" data-generation="${modalGeneration}">`:''}<div class="inline-error" role="alert"></div>${body}${formId?ui`<div class="modal-footer"><button type="button" class="secondary" data-action="close">稍后再说</button><button class="primary" type="submit">${esc(submit)}</button></div></form>`:''}`;document.body.classList.add('modal-open');if(!d.open)d.showModal();
}
function tagOptions(chosen='') {return ui`<option value="">先记在我们之间</option>${state.users.filter(u=>u.id!==state.current_user_id).map(u=>ui`<option value="${u.id}" ${u.id===chosen?'selected':''}>@${esc(u.name)}</option>`).join('')}`;}
function openCreate() {
 modal(t('让一件小东西住进来'),t('给它一个名字，再讲讲你们的故事。'),ui`<label class="upload-zone">${icon('upload')}<strong>带一张照片，或一段小视频</strong><span>JPG / PNG / WebP / GIF · MP4 / WebM / MOV · 最大 ${state.max_upload_mb||20} MB</span><input id="media-input" type="file" name="media" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" aria-label="上传物品照片或视频"><span id="media-preview"></span></label><div id="pixel-style-box" class="pixel-style-box hidden"><span class="field-label">图片显示方式</span><div class="pixel-style-options"><label class="pixel-style-chip"><input type="radio" name="pixel_style" value="sprite" checked><span>像素伙伴（自动抠图转化）</span></label><label class="pixel-style-chip"><input type="radio" name="pixel_style" value="card"><span>像素卡片（保留背景转化）</span></label><label class="pixel-style-chip"><input type="radio" name="pixel_style" value="original"><span>原始照片</span></label></div><p class="form-hint" id="pixel-style-note">已自动生成像素小精灵（规则算法转化 · 原图仍会保留）</p></div><div class="form-row"><label class="form-field"><span>它叫什么？</span><input name="name" required maxlength="30" placeholder="比如，老朋友"></label><label class="form-field"><span>它是什么？</span><input name="object_type" required maxlength="40" placeholder="比如，保温杯、相机、毛绒玩具" autocomplete="off"></label></div><label class="form-field"><span>它的性格</span><input name="personality" maxlength="100" placeholder="嘴硬心软，偶尔有点吃醋"></label><label class="form-field"><span>你们之间的第一段故事</span><textarea name="text" maxlength="600" placeholder="比如，这是小北毕业时送我的杯子，一直陪我到现在。"></textarea></label><label class="form-field"><span>故事里，还有谁？</span><select name="tagged_user_id">${tagOptions()}</select><p class="form-hint">标注后，对方可以在“等我回应”中确认和补充。</p></label><label class="check-row"><input type="checkbox" name="is_gift">这是一份 TA 送的礼物</label>`,'create-form',t('欢迎它住进来'));
}
function openMemory(editId) {
 const m=editId?state.memories.find(m=>m.id===editId):null;
 const obj=object(m?.object_id||selected);if(!obj)return;
 modal(m?t('重新讲讲这段记忆'):t('告诉它一件小事'),m?t('修改关联记忆后，会请对方重新回应。'):ui`这是${user(state.current_user_id).name}与${obj.name}之间的故事。`,ui`<input type="hidden" name="object_id" value="${esc(obj.id)}">${m?ui`<input type="hidden" name="memory_id" value="${esc(m.id)}">`:''}<label class="form-field"><span>想让它记住什么？</span><textarea name="text" required maxlength="600" placeholder="一段经历、一个约定，或者一句想说的话…">${esc(m?.text||'')}</textarea></label>${m?ui`<p class="small-note">${m.tagged_user_id?t('关联 @')+esc(user(m.tagged_user_id).name):t('本人记录')}</p>`:ui`<div class="form-row"><label class="form-field"><span>这是什么记忆？</span><select name="kind"><option value="story">共同经历</option><option value="promise">小小约定</option><option value="gift">赠送故事</option></select></label><label class="form-field"><span>故事里，还有谁？</span><select name="tagged_user_id">${tagOptions()}</select></label></div>`}`,'memory-form');
}
function openRespond(id) {
 const m=state.memories.find(m=>m.id===id);if(!m)return;
 modal(t('你也记得这件事吗？'),ui`${user(m.author_id).name}在${object(m.object_id)?.name}的故事里标注了你。`,ui`<input type="hidden" name="memory_id" value="${esc(id)}"><input type="hidden" name="expected_revision" value="${m.revision??1}"><div class="story-context">${esc(m.text)}</div><label class="form-field"><span>补上你的版本（选填）</span><textarea name="response" maxlength="600" placeholder="比如，那天挑了很久，希望它能多陪你几年。"></textarea></label><label class="form-field"><span>这段故事的状态</span><select name="action"><option value="confirm">我记得，确认这段故事</option><option value="decline">我有不同记忆，暂不确认</option></select></label>`,'respond-form',t('留下我的回应'));
}
function openScene() {
 const defaults=defaultSceneIds(state.objects,selected);
 modal(t('让小屋热闹一会儿'),t('选好伙伴和话题，听它们一人一句慢慢聊。'),ui`<div class="field-label">谁来参加？</div><div class="scene-picks">${state.objects.map(o=>ui`<label class="scene-pick"><input type="checkbox" name="object_ids" value="${esc(o.id)}" ${defaults.includes(o.id)?'checked':''}>${art(o)}${esc(o.name)}</label>`).join('')}</div><p class="scene-selection-status form-hint" role="status" aria-live="polite"></p><label class="form-field"><span>今天聊什么？</span><input name="topic" maxlength="80" placeholder="比如，关于那份一直留着的礼物" value="那些舍不得换掉的小东西"></label><p class="form-hint">准备好后自动逐句开场，每句留出阅读时间。随时可以暂停、下一句或立即看完；引用的记忆可以点开查看。</p><p class="small-note">${t('新对话将使用当前语言，已保存的故事保留原文。')}</p><p class="scene-generation-status" role="status" aria-live="polite"></p>`,'scene-form',t('让它们开口'));
 updateSceneSelection();
}
function updateSceneSelection(changed) {
 const inputs=[...$('#modal').querySelectorAll('[name="object_ids"]')];
 if(changed && inputs.filter(input=>input.checked).length>3){changed.checked=false;notice(t('最多选择三位，请先取消一位再换人'));}
 const count=inputs.filter(input=>input.checked).length;
 for(const input of inputs)input.disabled=count>=3&&!input.checked;
 const status=$('.scene-selection-status',$('#modal'));
 if(status)status.textContent=ui`已选 ${count}/3 位${count===3?t('，先取消一位即可换人'):''}`;
}
function setScenePending(value,form) {
 scenePending=value;
 for(const input of form.querySelectorAll?.('input,select,textarea')||[]){
  if(value){input.dataset.beforePending=String(input.disabled);input.disabled=true;}
  else if(input.dataset.beforePending!==undefined){input.disabled=input.dataset.beforePending==='true';delete input.dataset.beforePending;}
 }
 for(const button of document.querySelectorAll('[data-action="scene"]')){
  button.disabled=value;button.innerHTML=icon('play')+(value?t('物品们正在酝酿对话…'):t('开一场小剧场'));
 }
 form.setAttribute('aria-busy',String(value));
 const progress=$('.scene-generation-status',form);
 if(progress)progress.textContent=value?t('物品们正在酝酿对话…'):'';
}
function showSource(id,fromTheater=false) {
 const m=state.memories.find(m=>m.id===id);if(!m){notice(t('这段记忆已经被忘记了'));return;}
 player.pause();if(fromTheater)returnSceneKey=sceneKey(state.latest_scene);
 view='memories';filter='all';render();const el=$('#memory-'+id);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('highlight');
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;
 if(action==='language'){player.pause();setLanguage(b.dataset.language);if(state){ensureSceneLanguage();render();}else showAuth();return;}
 if(action==='scene-language-retry'){ensureSceneLanguage(true);render();return;}
 if(action==='auth-tab'){authTab=b.dataset.tab;showAuth();return;}
 if(action==='logout'){logout();return;}
 if(action==='account'){openAccount();return;}
 if(action==='admin-prev'||action==='admin-next'){adminPage+=action==='admin-next'?1:-1;render();return;}
 if(action==='ban-user'||action==='unban-user'){manageUser(action,id);return;}
 if(action==='install'){openInstall();return;}
 if(action==='drawer'){$('#memory-drawer')?.scrollIntoView({behavior:'smooth',block:'start'});$('#memory-drawer')?.focus({preventScroll:true});return;}
 if(action==='close'){closeModal();return;}
 if(switching){notice(t('正在切换身份，请稍候'));return;}
 if(action.startsWith('playback-')){
  if(!isSceneCurrent(state.latest_scene,state)){player.reset();returnSceneKey=null;render();return;}
  if(action==='playback-return'){view='home';render();focusTheater();return;}
  if(view!=='home'||$('#modal').open)return;
  if(action==='playback-toggle'){if(player.snapshot().status==='playing')player.pause();else player.resume();}
  if(action==='playback-next')player.next();
  if(action==='playback-finish')player.finish();
  if(action==='playback-replay'){player.start(sceneKey(state.latest_scene),activeSceneLines());focusTheater();}
  return;
 }
 if(action==='invite'){
  const link=location.origin+'/?room='+roomKey;
  modal(t('把小屋链接交给朋友'),t('拿到链接的人可以进入这个演示小屋。可用不同浏览器体验多人互动。'),ui`<label class="form-field"><span>共享小屋链接</span><input readonly value="${esc(link)}" aria-label="共享小屋链接"></label><p class="small-note">朋友注册或登录后，可以通过此链接加入小屋，再回应被标注的故事。</p>`);
 }
 if(action==='create')openCreate();
 if(action==='select'){selected=id;roomPage=Math.floor(Math.max(0,state.objects.findIndex(o=>o.id===id))/3);render();}
 if(action==='room-next'){roomPage=roomCast(state.objects,roomPage+1).page;selected=roomCast(state.objects,roomPage).items[0]?.id;render();}
 if(action==='library-prev'||action==='library-next'){libraryPage+=action==='library-next'?1:-1;$('#collection-region').innerHTML=collectionMarkup();}
 if(action==='add-memory')openMemory();
 if(action==='edit-memory')openMemory(id);
 if(action==='respond')openRespond(id);
 if(action==='scene'){if(scenePending){notice(t('物品们正在酝酿对话…'));return;}openScene();}
 if(action==='source')showSource(id,!!b.closest?.('#theater'));
 if(action==='nav'){player.pause();returnSceneKey=null;view=b.dataset.view;filter='all';render();window.scrollTo(0,0);}
 if(action==='filter'){filter=b.dataset.filter;render();}
 if(action==='inbox'){player.pause();returnSceneKey=null;view='memories';filter='pending';render();window.scrollTo(0,0);}
 if(action==='forget'){
  const m=state.memories.find(m=>m.id===id);
  modal(t('把这段记忆放下？'),t('物品会停止在新剧场中引用它，已保存的相关剧场也会清除。'),ui`<input type="hidden" name="memory_id" value="${esc(id)}"><div class="story-context">${esc(m.text)}</div>`,'forget-form',t('让它忘记'));
 }
 if(action==='detail'){
  const o=object(id);modal(o.name,[o.object_type,o.personality].filter(Boolean).join(' · '),ui`${o.media_type?.startsWith('video')?ui`<video class="media-view" src="${esc(o.media_url)}" controls playsinline></video>`:o.pixel_media_url&&o.media_url?ui`<div class="detail-compare"><div><span class="detail-tag">像素效果</span><img class="media-view pixel-sprite-art" src="${esc(o.pixel_media_url)}" alt="${esc(o.name)}"></div><div><span class="detail-tag">原图对比</span><img class="media-view" src="${esc(o.media_url)}" alt="${esc(o.name)}"></div></div>`:o.media_url?ui`<img class="media-view" src="${esc(o.media_url)}" alt="${esc(o.name)}">`:art(o,'detail-art')}<p class="small-note">物品的经历来自用户记录，照片和视频用于呈现它的样子。</p>`);
 }
});
document.addEventListener('input',e=>{if(e.target.id==='collection-query'){libraryQuery=e.target.value;libraryPage=0;$('#collection-region').innerHTML=collectionMarkup();}});
document.addEventListener('change',async e=>{
 if(e.target.id==='user-select'){
  const previous=state.current_user_id,next=e.target.value;
  player.reset();returnSceneKey=null;
  actorId=next;const task=requests.switchActor(next);switching=true;
  try{
   await api('/api/session',{user_id:next},next);
   if(!requests.isCurrent(task))return;
   await refresh();
   if(requests.isCurrent(task))notice(t('现在以')+user(next).name+t('的演示身份体验'));
  }catch(err){
   if(requests.isCurrent(task)){actorId=previous;requests.switchActor(previous);switching=false;sessionStorage.setItem('object-stories-user',previous);render();notice(err.message);}
  }finally{if(requests.isCurrent(task))switching=false;}
 }
 if(e.target.name==='object_ids')updateSceneSelection(e.target);
 if(e.target.name==='pixel_style')refreshPixelPreview();
 if(e.target.id==='media-input'){
  const f=e.target.files[0],host=$('#media-preview'),styleBox=$('#pixel-style-box');
  host.replaceChildren();currentPixelFile=null;pixelConverting=false;pixelJobId++;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  if(!f){styleBox?.classList.add('hidden');return;}
  if(f.size>(state.max_upload_mb||20)*1024*1024){styleBox?.classList.add('hidden');notice(t('文件请控制在 ')+(state.max_upload_mb||20)+t(' MB 以内'));e.target.value='';return;}
  previewUrl=URL.createObjectURL(f);
  if(f.type.startsWith('video')){
   styleBox?.classList.add('hidden');
   const media=document.createElement('video');media.src=previewUrl;media.className='upload-preview';media.controls=true;media.muted=true;host.append(media);
  }else{
   styleBox?.classList.remove('hidden');
   await refreshPixelPreview();
  }
 }
});
async function refreshPixelPreview(){
 const input=$('#media-input',$('#modal')),host=$('#media-preview',$('#modal')),note=$('#pixel-style-note',$('#modal'));
 if(!input||!host)return;
 const f=input.files?.[0];if(!f||!f.type?.startsWith('image/'))return;
 const chosen=$('input[name="pixel_style"]:checked',$('#modal'))?.value||'sprite';
 const job=++pixelJobId;currentPixelFile=null;pixelConverting=false;
 const submit=$('button[type="submit"]',$('#modal'));if(submit&&!busy)submit.disabled=false;
 if(pixelPreviewUrl){URL.revokeObjectURL(pixelPreviewUrl);pixelPreviewUrl=null;}
 if(chosen==='original'||typeof document.createElement!=='function'||typeof ImageData==='undefined'){
  host.innerHTML=ui`<div class="upload-compare"><figure><img class="upload-preview" src="${esc(previewUrl)}" alt="${t('上传预览')}"><figcaption>原始照片</figcaption></figure></div>`;
  if(note)note.textContent=t('保留原始照片展示');
  return;
 }
 pixelConverting=true;if(submit)submit.disabled=true;
 if(note)note.textContent=t('正在转化像素形象…');
 try{
  const converted=await convertFileToPixelPng(f,{mode:chosen});
  if(job!==pixelJobId||!converted){if(converted?.previewUrl)URL.revokeObjectURL(converted.previewUrl);return;}
  currentPixelFile=converted.file;pixelPreviewUrl=converted.previewUrl;
  host.innerHTML=ui`<div class="upload-compare"><figure><img class="upload-preview pixel-preview-art" src="${esc(pixelPreviewUrl)}" alt="${t('像素效果')}"><figcaption>像素效果</figcaption></figure><figure><img class="upload-preview upload-preview-sub" src="${esc(previewUrl)}" alt="${t('原图对比')}"><figcaption>原图对比</figcaption></figure></div>`;
  if(note)note.textContent=t('已自动生成像素小精灵（规则算法转化 · 原图仍会保留）');
 }catch{
  if(job!==pixelJobId)return;
  host.innerHTML=ui`<img class="upload-preview" src="${esc(previewUrl)}" alt="${t('上传预览')}">`;
  if(note)note.textContent=t('像素转换暂时失败，请重新选择图片，或选择原始照片保存。');
 }finally{if(job===pixelJobId){pixelConverting=false;if(submit&&!busy)submit.disabled=false;}}
}
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['create-form','memory-form','respond-form','scene-form','forget-form'].includes(form.id))return;e.preventDefault();
 if(busy){notice(t('上一条提交还在保存，请稍候'));return;}
 if(form.id==='create-form'&&pixelConverting){notice(t('正在转化像素形象…'));return;}
 if(form.id==='create-form'&&$('#media-input',form).files[0]?.type?.startsWith('image/')&&($('input[name="pixel_style"]:checked',form)?.value||'sprite')!=='original'&&!currentPixelFile){notice(t('像素转换暂时失败，请重新选择图片，或选择原始照片保存。'));return;}
 if(switching || form.dataset.actor!==actorId || state.current_user_id!==actorId){notice(t('身份已变化，请关闭表单后重新打开'));return;}
 if(form.dataset.stale==='true'){notice(t('这段记忆已变化，请关闭后重新查看'));return;}
 let data=Object.fromEntries(new FormData(form));const button=$('button[type="submit"]',form);const error=$('.inline-error',form);
 const task={...requests.capture(),generation:Number(form.dataset.generation)};
 const ownsDialog=()=>requests.isCurrent(task)&&task.generation===modalGeneration&&$('#modal').open;
 error.textContent='';busy=true;requests.invalidateReads();button.disabled=true;const label=button.textContent;button.textContent=t('正在收好故事…');
 let saved=false,createdId,generatedScene,startedScene=false;
 try{
  if(form.id==='create-form'){
   const file=$('#media-input',form).files[0],chosenStyle=$('input[name="pixel_style"]:checked',form)?.value||'sprite';
   data.is_gift=form.elements.is_gift.checked;
   data=prepareObjectData(data,task.actor,state.users);
   const sendUpload=(media,uploadId,actor)=>{const upload=new FormData();upload.append('file',media);upload.append('upload_id',uploadId);return api('/api/uploads',upload,actor);};
   if(file){
    data.media_id=await uploadFile(file,task.actor,sendUpload);
    let pxFile=chosenStyle==='original'?null:currentPixelFile;
    if(!pxFile&&chosenStyle!=='original'&&file.type?.startsWith('image/')&&typeof ImageData!=='undefined'){
     const conv=await convertFileToPixelPng(file,{mode:chosenStyle}).catch(()=>null);
     pxFile=conv?.file||null;
    }
    if(pxFile)data.pixel_media_id=await uploadFile(pxFile,task.actor,sendUpload);
   }
   createdId=(await api('/api/objects',data,task.actor)).id;
  }else if(form.id==='memory-form'){
   if(data.memory_id)await api('/api/memories/'+data.memory_id+'/edit',{text:data.text},task.actor);else await api('/api/memories',data,task.actor);
  }else if(form.id==='respond-form'){
   data.expected_revision=Number(data.expected_revision);
   await api('/api/memories/'+data.memory_id+'/respond',data,task.actor);
  }else if(form.id==='forget-form')await api('/api/memories/'+data.memory_id+'/forget',{},task.actor);
  else if(form.id==='scene-form'){
   data.language=getLanguage();data.object_ids=new FormData(form).getAll('object_ids');if(data.object_ids.length<1||data.object_ids.length>3)throw new Error(t('请选一到三位小伙伴'));
   startedScene=true;button.textContent=t('物品们正在酝酿对话…');setScenePending(true,form);
   generatedScene=await api('/api/scenes',data,task.actor);
  }
  saved=true;if(requests.isCurrent(task))roomSound.play('success');const scene=form.id==='scene-form',wasCurrent=ownsDialog();
  if(wasCurrent){if(createdId){selected=createdId;libraryQuery='';libraryPage=Math.floor((state.objects.length)/6);roomPage=Math.floor(state.objects.length/3);}if(scene||createdId)view='home';closeModal(task.generation);}
  const playRequest=scene&&wasCurrent?{key:sceneKey(generatedScene),ticket:task,generation:modalGeneration}:null;
  await refresh(true,playRequest);
  const sceneMessage=generatedScene?.mode==='llm'?t('AI 小剧场开场了，记忆来源可以点开看。'):generatedScene?.fallback_reason&&generatedScene.fallback_reason!=='unconfigured'?t('AI 对话暂时没能完成，已用规则小剧场开场。'):t('规则小剧场开场了，记忆来源可以点开看。');
  if(requests.isCurrent(task))notice(scene?sceneMessage:t('故事已经收进记忆抽屉。'));
  if(playRequest && playRequest.generation===modalGeneration && !$('#modal').open && requests.isCurrent(task)
   && view==='home' && player.snapshot().sceneKey===playRequest.key)focusTheater();
 }catch(err){
  if(!saved&&ownsDialog())roomSound.play('error');
  const message=startedScene?(err.status===409?t('小剧场正在酝酿，或记忆刚有变化，请稍后重新开场。'):t('小剧场暂时没能开场，请稍后重试；刚才的选择已保留。')):err.message;
  if(saved){notice(t('故事已保存，页面暂时没接上，请稍后刷新'));}
  else if(ownsDialog()){
   if(form.id==='respond-form'&&err.status===409){
    form.dataset.stale='true';error.textContent=t('这段记忆已变化。请关闭表单，重新查看最新内容后再回应。');
    button.textContent=t('请关闭后重新查看');
    await refresh(true).catch(()=>{});
   }else{error.textContent=message;button.disabled=false;button.textContent=label;}
  }else{notice(message);}
 }finally{if(startedScene)setScenePending(false,form);busy=false;}
});
$('#modal').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeModal();}});
startApp().catch(err=>{$('#app').innerHTML=t('<div class="error-page"><h1>小屋暂时没有接上</h1><p>')+esc(err.message)+t('</p><button class="secondary" data-action="retry">重新打开</button></div>');});
document.addEventListener('click',e=>{if(e.target.closest('[data-action="retry"]'))location.reload();});
setInterval(()=>{if(state&&!document.hidden&&!busy&&!$('#modal').open)refresh(true).catch(()=>{});},15000);

document.addEventListener('visibilitychange',()=>{if(document.hidden)player.pause();});

function languageMarkup(){return ui`<div class="language-switch" aria-label="Language"><button data-action="language" data-language="zh" aria-pressed="${getLanguage()==='zh'}">中文</button><button data-action="language" data-language="en" aria-pressed="${getLanguage()==='en'}">EN</button></div>`;}
async function authFetch(path,data){
 const response=await fetch('/api/auth/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await response.json();if(!response.ok)throw new Error(authError(value.code,value.message));return value;
}
function authError(code,message){
 const messages={INVALID_NAME:'请输入昵称',INVALID_EMAIL:'请输入有效邮箱',INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'此邮箱已注册，请登录',USER_ALREADY_EXISTS:'此邮箱已注册，请登录',PASSWORD_TOO_SHORT:'密码至少需要八位',USER_BANNED:'该账号已停用，请联系管理员',INVALID_PASSWORD:'当前密码不正确',TOO_MANY_REQUESTS:'操作太频繁，请稍后重试'};
 return t(messages[code]||'操作未完成，请检查输入后重试');
}
function showAuth(){
 player.reset();requests.switchActor('signed-out');actorId='signed-out';state=null;lastState='';
 if($('#modal').open)closeModal();
 const register=authTab==='register';
 $('#app').innerHTML=ui`<main class="auth-shell"><section class="auth-art"><div class="auth-brand">✿ thingamingos</div><div><p class="eyebrow">LITTLE THINGS, BIG STORIES</p><h1>小东西，<br>也有大心事。</h1><p>把日常收进小屋，让它们记住你们的故事。</p></div></section><section class="auth-panel"><div class="auth-language">${languageMarkup()}<span class="room-sound-host" data-room-sound></span><button class="text-button install-entry" data-action="install">${t('添加到桌面')}</button></div><div class="auth-card"><span class="eyebrow">YOUR LITTLE CORNER</span><h2>${register?t('创建账号'):t('欢迎回到小屋')}</h2><p class="small-note">${t('用一个账号，收好你与物品的故事。')}</p><div class="auth-tabs"><button data-action="auth-tab" data-tab="login" aria-pressed="${!register}">${t('登录')}</button><button data-action="auth-tab" data-tab="register" aria-pressed="${register}">${t('注册')}</button></div><form id="auth-form">${register?ui`<label class="form-field"><span>昵称</span><input name="name" required maxlength="30" autocomplete="nickname" placeholder="你的名字"></label>`:''}<label class="form-field"><span>邮箱</span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label><label class="form-field"><span>密码</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}" placeholder="至少八位字符"></label><div class="inline-error" role="alert"></div><button class="primary" type="submit">${register?t('注册并进入小屋'):t('登录并进入小屋')}</button></form><p class="small-note">${t('朋友分享的小屋链接会在登录后自动加入。')}</p></div></section></main>`;
 roomSound.mount();
}
async function enterRoom(session){actorId=session.user.id;requests.switchActor(actorId);await api('/api/room/join',{});await refresh();}
async function startApp(){document.title='thingamingos';const health=await fetch('/api/health').then(r=>r.json());accountMode=health.identity_mode==='account';if(!accountMode)return refresh();const session=await authFetch('get-session');if(session?.user)return enterRoom(session);showAuth();}
async function logout(){try{await authFetch('sign-out',{});showAuth();}catch(error){notice(error.message);}}
function openAccount(){modal(t('我的账号'),state.account.email,ui`<form id="profile-form"><label class="form-field"><span>昵称</span><input name="name" required maxlength="30" value="${esc(state.account.name)}" autocomplete="nickname"></label><div class="inline-error" role="alert"></div><button class="primary" type="submit">保存昵称</button></form><hr><form id="password-form"><label class="form-field"><span>当前密码</span><input name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label class="form-field"><span>新密码</span><input name="newPassword" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><div class="inline-error" role="alert"></div><button class="secondary" type="submit">修改密码</button></form><div class="modal-footer"><button class="text-button" data-action="logout">退出登录</button></div>`);}
function adminMarkup(){queueMicrotask(loadUsers);return ui`<div class="eyebrow">PEOPLE BEHIND THE STORIES</div><h1 class="view-title">用户管理</h1><p class="view-description">查看注册用户，管理账号状态。</p><div id="admin-users" aria-live="polite">正在加载…</div>`;}
let adminLoad=0;
async function loadUsers(){const sequence=++adminLoad;try{const result=await authFetch('admin/list-users?limit=10&offset='+adminPage*10+'&sortBy=createdAt&sortDirection=desc');if(sequence!==adminLoad||view!=='admin'||!state)return;const host=$('#admin-users');if(!host)return;host.innerHTML=ui`<div class="admin-table">${result.users.map(u=>ui`<article class="admin-user"><div><strong>${esc(u.name)}</strong><p>${esc(u.email)}</p><small>${u.role==='admin'?t('管理员'):t('普通用户')} · ${u.banned?t('已停用'):t('正常')}</small></div>${u.id!==state.current_user_id&&u.role!=='admin'?ui`<button class="secondary" data-action="${u.banned?'unban-user':'ban-user'}" data-id="${esc(u.id)}">${u.banned?t('恢复账号'):t('停用账号')}</button>`:''}</article>`).join('')}</div><div class="collection-pager"><button class="secondary" data-action="admin-prev" ${adminPage<=0?'disabled':''}>上一页</button><span>${adminPage+1} / ${Math.max(1,Math.ceil(result.total/10))}</span><button class="secondary" data-action="admin-next" ${(adminPage+1)*10>=result.total?'disabled':''}>下一页</button></div>`;}catch(error){const host=$('#admin-users');if(host)host.textContent=error.message;}}
async function manageUser(action,id){try{await authFetch(action==='ban-user'?'admin/ban-user':'admin/unban-user',{userId:id,...(action==='ban-user'?{banReason:'Disabled by administrator'}:{})});await loadUsers();notice(t('账号状态已更新'));}catch(error){notice(error.message);}}
document.addEventListener('submit',async event=>{
 const form=event.target;if(!['auth-form','profile-form','password-form'].includes(form.id))return;event.preventDefault();
 const data=Object.fromEntries(new FormData(form)),button=$('button[type="submit"]',form),error=$('.inline-error',form);error.textContent='';button.disabled=true;
 try{
  if(form.id==='auth-form'){if(data.name&&!data.name.trim())throw new Error(t('请输入昵称'));if(data.name)data.name=data.name.trim();await authFetch(authTab==='register'?'sign-up/email':'sign-in/email',data);await enterRoom(await authFetch('get-session'));}
  if(form.id==='profile-form'){data.name=data.name.trim();if(!data.name)throw new Error(t('请输入昵称'));await authFetch('update-user',data);closeModal();await refresh();notice(t('昵称已更新'));}
  if(form.id==='password-form'){await authFetch('change-password',{...data,revokeOtherSessions:true});form.reset();notice(t('密码已更新'));}
 }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
});

function openInstall(){
 const standalone=typeof matchMedia==='function'&&matchMedia('(display-mode: standalone)').matches||typeof navigator!=='undefined'&&navigator.standalone===true;
 modal(t('把小屋放到桌面'),standalone?t('你已经在桌面版小屋里了。'):t('下次见面，点一下桌面图标就好。'),ui`<div class="install-preview"><img src="/icons/apple-touch-icon.png" width="64" height="64" alt=""><strong>thingamingos</strong></div><ol class="install-steps"><li>在 iPhone 的 Safari 中打开这个网站。</li><li>点分享按钮，再选“添加到主屏幕”。</li><li>如果看到“作为网页 App 打开”，保持开启，再点“添加”。</li></ol><p class="small-note">桌面图标会保留当前小屋；首次打开若出现登录页，登录后即可继续。</p><p class="small-note">网站需要网络连接。微信内打开时，请先选择“在 Safari 中打开”。</p><button class="secondary" data-action="copy-link">复制小屋链接</button>`);
}
async function copyRoomLink(){
 const link=location.origin+'/?room='+roomKey;
 try{if(!navigator.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(link);notice(t('小屋链接已复制'));}
 catch{let input=$('.copy-link-fallback');if(!input){input=document.createElement('input');input.readOnly=true;input.className='copy-link-fallback';input.setAttribute('aria-label',t('共享小屋链接'));$('#modal').append(input);}input.value=link;input.select();notice(t('请长按链接复制'));}
}
document.addEventListener('click',event=>{if(event.target.closest('[data-action="copy-link"]'))copyRoomLink();});
