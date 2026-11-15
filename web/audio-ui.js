import {createRoomAudio} from './audio.js';
import {t,getLanguage} from './i18n.js';

const speaker='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const note='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" shape-rendering="crispEdges" aria-hidden="true"><path d="M12 24V8l14-3v16M12 12l14-3"/><path d="M12 24c0 3-7 5-7 1s7-5 7-1m14-3c0 3-7 5-7 1s7-5 7-1"/></svg>';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The audio graph lives outside app rendering; changing rooms/languages cannot layer music.
export function createRoomAudioUI({document=globalThis.document}={}){
 if(!document?.createElement||!document.body?.append)return {mount(){},play(){},destroy(){}};
 let audio,language,opener;
 const dialog=document.createElement('dialog');dialog.id='room-audio-dialog';dialog.className='room-audio-dialog';dialog.setAttribute('aria-labelledby','room-audio-title');document.body.append(dialog);
 const query=selector=>dialog.querySelector(selector);
 function draw(){
  language=getLanguage();
  dialog.innerHTML=`<div class="modal-header"><div><h2 id="room-audio-title">${t('小屋的声音')}</h2><p>${t('给小屋一点轻轻的声音。')}</p></div><button type="button" class="close-modal" data-sound="close" aria-label="${t('关闭')}">×</button></div>
  <div class="room-audio-track"><span class="room-audio-art">${note}<span class="room-audio-spark">✦</span></span><div><small>THINGAMINGOS ORIGINAL</small><h3>${t('午后的小屋')}</h3><p>${t('木琴、拨弦和一点点笛声。')}</p></div></div>
  <label class="room-audio-row"><span><strong>${t('背景音乐')}</strong><small>${t('在小屋里，慢慢听。')}</small></span><input type="checkbox" role="switch" data-sound="music" aria-label="${t('背景音乐')}"><span class="room-audio-switch" aria-hidden="true"></span></label>
  <label class="room-audio-row"><span><strong>${t('点击音效')}</strong><small>${t('点一点，也有小回应。')}</small></span><input type="checkbox" role="switch" data-sound="effects" aria-label="${t('点击音效')}"><span class="room-audio-switch" aria-hidden="true"></span></label>
  <div class="room-audio-volume"><label for="room-audio-volume">${t('总音量')}</label><output for="room-audio-volume" id="room-audio-level"></output><input id="room-audio-volume" type="range" min="0" max="100" step="5" data-sound="volume" aria-label="${t('总音量')}"></div>
  <p class="room-audio-status" role="status" aria-live="polite"></p><div class="room-audio-footer"><button class="secondary" type="button" data-sound="preview">${t('试听提示音')}</button><button class="primary" type="button" data-sound="close">${t('完成')}</button></div>`;
 }
 function sync(){
  if(!audio)return;
  const state=audio.getState(),unsupported=state.status==='unsupported';
  for(const host of document.querySelectorAll('[data-room-sound]')){
   const button=host.querySelector('button');if(!button)continue;
   button.dataset.audioStatus=state.status;
   button.classList.toggle('is-playing',state.status==='playing'&&state.music);
   button.classList.toggle('is-muted',(!state.music&&!state.effects)||state.volume===0||unsupported);
   button.title=t('小屋的声音')+' · '+t(state.status==='playing'&&state.music?'音乐播放中':state.status==='waiting'?'点一下，听听小屋':'声音设置');
  }
  if(!query('[data-sound="music"]'))return;
  for(const key of ['music','effects']){query(`[data-sound="${key}"]`).checked=state[key];query(`[data-sound="${key}"]`).disabled=unsupported;}
  const volume=query('[data-sound="volume"]');volume.value=String(Math.round(state.volume*100));volume.disabled=unsupported;
  query('#room-audio-level').textContent=Math.round(state.volume*100)+'%';
  query('[data-sound="preview"]').disabled=unsupported||!state.effects||state.volume===0;
  const message=unsupported?'这个浏览器暂时无法播放声音。':state.status==='error'?'声音还没接上，点一下再试试。':state.volume===0||!state.music&&!state.effects?'现在很安静。':state.status==='waiting'?'点一下页面，音乐就会响起。':state.status==='paused'?'回到小屋后继续播放。':state.music?'正在播放：午后的小屋':'只保留点击声。';
  const status=query('.room-audio-status');if(status.textContent!==t(message))status.textContent=t(message);
 }
 audio=createRoomAudio({document,onChange:sync});draw();sync();
 function close(){dialog.close();opener?.isConnected&&opener.focus();}
 function open(button){opener=button;if(language!==getLanguage())draw();sync();if(!dialog.open)dialog.showModal();}
 function gesture(event){if(event.isTrusted===false||event.type==='keydown'&&(event.repeat||!['Enter',' '].includes(event.key)))return;audio.unlock().catch(()=>{});}
 function clicks(event){
  const button=event.target.closest('button,a,summary,[role="button"]');if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return;
  if(button.closest('#room-audio-dialog')||button.hasAttribute('data-sound-settings'))return;
  const action=button.dataset.action||'';
  const kind=action==='select'||action==='room-next'?'select':['create','add-memory','source','detail','account','invite','install'].includes(action)?'open':'click';
  audio.play(kind);
 }
 function dialogClick(event){const button=event.target.closest('button[data-sound]');if(!button)return;if(button.dataset.sound==='close'){audio.play('click');close();}if(button.dataset.sound==='preview')audio.unlock().then(()=>audio.play('success')).catch(()=>{});}
 function settings(event){const key=event.target.dataset.sound;if(key==='music')audio.setMusic(event.target.checked);if(key==='effects')audio.setEffects(event.target.checked);if(key==='volume')audio.setVolume(Number(event.target.value)/100);sync();}
 document.addEventListener('pointerdown',gesture,true);document.addEventListener('keydown',gesture,true);document.addEventListener('click',clicks,true);
 dialog.addEventListener('click',dialogClick);dialog.addEventListener('change',settings);dialog.addEventListener('input',event=>{if(event.target.dataset.sound==='volume')settings(event);});
 dialog.addEventListener('cancel',()=>audio.play('click'));
 return {mount(){
  if(language!==getLanguage())draw();
  for(const host of document.querySelectorAll('[data-room-sound]')){
   if(!host.querySelector('button')){host.innerHTML=`<button type="button" class="quiet-button room-audio-trigger" data-sound-settings aria-label="${escape(t('小屋的声音'))}" aria-haspopup="dialog" aria-controls="room-audio-dialog">${speaker}<span class="room-audio-bars" aria-hidden="true"><i></i><i></i><i></i></span></button>`;host.querySelector('button').addEventListener('click',event=>open(event.currentTarget));}
  }
  sync();
 },play:kind=>audio.play(kind),destroy(){audio.destroy();dialog.remove();document.removeEventListener('pointerdown',gesture,true);document.removeEventListener('keydown',gesture,true);document.removeEventListener('click',clicks,true);}};
}
