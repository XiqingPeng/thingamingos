import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomAudio,ROOM_MUSIC,scheduleRoomMusic} from '../web/audio.js';

function setup({saved,blocked=false,delayedResume=false,delayedSuspend=false}={}) {
 let time=0,nextTimer=0,created=0;
 const timers=new Map(),contexts=[],changes=[],errors=[],writes=[];
 class Target {
  handlers=new Map();
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  fire(type){for(const fn of this.handlers.get(type)||[])fn();}
 }
 const page=new Target(),document=new Target();document.hidden=false;document.visibilityState='visible';document.defaultView=page;
 class Param {
  value=0;events=[];
  cancelScheduledValues(at){this.events.push(['cancel',at]);}
  cancelAndHoldAtTime(at){this.events.push(['hold',at]);}
  setValueAtTime(value,at){assert.ok(Number.isFinite(value)&&Number.isFinite(at));this.value=value;this.events.push(['set',value,at]);}
  setTargetAtTime(value,at,tau){this.value=value;this.events.push(['target',value,at,tau]);}
  linearRampToValueAtTime(value,at){assert.ok(Number.isFinite(value)&&Number.isFinite(at));this.value=value;this.events.push(['linear',value,at]);}
  exponentialRampToValueAtTime(value,at){assert.ok(value>0&&Number.isFinite(at));this.value=value;this.events.push(['exponential',value,at]);}
 }
 class Node { connections=[]; disconnected=false; connect(to){this.connections.push(to);return to;} disconnect(){this.disconnected=true;this.connections=[];} }
 class Context extends Target {
  state='suspended';destination=new Node();sources=[];nodes=[];resumes=0;suspends=0;closes=0;resumeQueue=[];suspendQueue=[];
  constructor(){super();this.born=time;created++;contexts.push(this);}
  get currentTime(){return (time-this.born)/1000;}
  createGain(){const node=new Node();node.gain=new Param();this.nodes.push(node);return node;}
  createBiquadFilter(){const node=new Node();node.frequency=new Param();node.Q=new Param();this.nodes.push(node);return node;}
  createOscillator(){const node=new Node();node.frequency=new Param();node.start=at=>{assert.ok(at>=this.currentTime);node.started=at;};node.stop=at=>{node.stopped=at??this.currentTime;};this.sources.push(node);this.nodes.push(node);return node;}
  change(state){this.state=state;this.fire('statechange');}
  resume(){this.resumes++;if(blocked){const err=new Error('gesture required');err.name='NotAllowedError';return Promise.reject(err);}if(delayedResume)return new Promise((resolve,reject)=>this.resumeQueue.push({resolve:()=>{this.change('running');resolve();},reject}));this.change('running');return Promise.resolve();}
  suspend(){this.suspends++;if(delayedSuspend)return new Promise(resolve=>this.suspendQueue.push(()=>{this.change('suspended');resolve();}));this.change('suspended');return Promise.resolve();}
  close(){this.closes++;this.change('closed');return Promise.resolve();}
 }
 function ended(){for(const context of contexts)for(const node of context.sources)if(node.stopped!==undefined&&node.stopped<=context.currentTime&&!node.ended){node.ended=true;node.onended?.();}}
 function advance(ms){const target=time+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);ended();due[1].fn();}time=target;ended();}
 const storage={getItem:()=>saved??null,setItem:(key,value)=>writes.push({key,value})};
 const audio=createRoomAudio({AudioContextClass:Context,document,storage,setTimer:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:time+delay});return id;},clearTimer:id=>timers.delete(id),onChange:state=>changes.push(state),onError:failure=>errors.push(failure)});
 return {audio,contexts,timers,document,page,changes,errors,writes,advance,get created(){return created;},get context(){return contexts.at(-1);},setBlocked:value=>blocked=value,setDelayedResume:value=>delayedResume=value,setDelayedSuspend:value=>delayedSuspend=value};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('audio waits for a gesture, starts once and repeated unlocks never layer music',async()=>{
 const h=setup();assert.equal(h.created,0);assert.deepEqual(h.audio.getState(),{music:true,effects:true,volume:0.35,status:'waiting'});
 const first=h.audio.unlock();assert.equal(h.created,1);assert.equal(h.context.resumes,1);await first;
 assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);
 const scheduled=h.context.sources.length;for(let i=0;i<30;i++)await h.audio.unlock();assert.equal(h.created,1);assert.equal(h.context.sources.length,scheduled);assert.equal(h.timers.size,1);
 h.advance(3000);assert.ok(h.context.sources.length>scheduled);assert.ok(h.context.sources.length<70);assert.ok(h.context.sources.some(n=>n.disconnected));
 h.audio.destroy();
});

test('music and effects can be switched independently, with a real zero-volume mute',async()=>{
 const h=setup();await h.audio.unlock();h.audio.setMusic(false);assert.equal(h.timers.size,0);assert.equal(h.audio.getState().effects,true);
 const before=h.context.sources.length;assert.equal(h.audio.play('open'),true);assert.ok(h.context.sources.length>before);
 h.audio.setEffects(false);h.advance(100);const mutedCount=h.context.sources.length;assert.equal(h.audio.play('click'),false);h.advance(1500);assert.equal(h.context.sources.length,mutedCount);
 h.audio.setMusic(true);await flush();assert.equal(h.timers.size,1);assert.equal(h.audio.getState().effects,false);assert.equal(h.audio.play('select'),false);
 h.audio.setEffects(true);h.audio.setVolume(0);assert.equal(h.audio.getState().status,'muted');assert.equal(h.timers.size,0);const zeroCount=h.context.sources.length;h.advance(3000);assert.equal(h.context.sources.length,zeroCount);assert.equal(h.audio.play('success'),false);assert.ok(h.context.sources.every(n=>n.disconnected));
 h.audio.setVolume(0.25);await flush();assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);h.audio.destroy();
});

test('preferences restore safely and persist only audio settings without duplicate notifications',async()=>{
 const h=setup({saved:JSON.stringify({music:false,effects:true,volume:0.2,account:'never-copy'})});assert.equal(h.audio.getState().music,false);await h.audio.unlock();assert.equal(h.timers.size,0);
 const before=h.changes.length;h.audio.setMusic(false);h.audio.setVolume(0.2);assert.equal(h.changes.length,before);assert.equal(h.writes.length,0);
 h.audio.setMusic(true);h.audio.setVolume(5);assert.equal(h.audio.getState().volume,1);assert.ok(h.writes.every(x=>x.key==='thingamingos-audio-v1'));assert.deepEqual(Object.keys(JSON.parse(h.writes.at(-1).value)).sort(),['effects','music','volume']);h.audio.destroy();
 const broken=setup({saved:'{bad json'});assert.equal(broken.audio.getState().volume,0.35);await broken.audio.unlock();assert.equal(broken.audio.getState().status,'playing');broken.audio.destroy();
});

test('storage denial and absent Web Audio are safe before and after a click',async()=>{
 const errors=[];const audio=createRoomAudio({AudioContextClass:undefined,storage:{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}},onError:error=>errors.push(error)});
 assert.equal(audio.getState().status,'unsupported');assert.equal((await audio.unlock()).status,'unsupported');audio.setVolume(0.4);assert.equal(audio.play('click'),false);audio.destroy();assert.equal(errors.length,0);
});

test('a denied gesture remains recoverable and resume fulfillment alone does not mean playing',async()=>{
 const h=setup({blocked:true});await h.audio.unlock();assert.equal(h.audio.getState().status,'waiting');assert.equal(h.timers.size,0);assert.equal(h.context.sources.length,0);
 h.setBlocked(false);await h.audio.unlock();assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);
 h.context.change('interrupted');assert.equal(h.audio.getState().status,'waiting');assert.equal(h.timers.size,0);assert.ok(h.context.sources.every(n=>n.disconnected));
 h.context.resume=()=>Promise.resolve();await h.audio.unlock();assert.equal(h.audio.getState().status,'waiting');assert.equal(h.timers.size,0);h.audio.destroy();
});

test('backgrounding clears all scheduled sounds and returning starts one clean musical phrase',async()=>{
 const h=setup();await h.audio.unlock();h.audio.play('success');h.advance(50);h.document.hidden=true;h.document.visibilityState='hidden';h.document.fire('visibilitychange');
 assert.equal(h.audio.getState().status,'paused');assert.equal(h.timers.size,0);assert.ok(h.context.sources.every(n=>n.disconnected));const count=h.context.sources.length;h.advance(300000);assert.equal(h.context.sources.length,count);assert.equal(h.audio.play('click'),false);
 h.document.hidden=false;h.document.visibilityState='visible';h.document.fire('visibilitychange');await flush();assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);assert.ok(h.context.sources.slice(count).every(n=>n.started>=h.context.currentTime));
 h.page.fire('pagehide');assert.equal(h.audio.getState().status,'paused');assert.equal(h.timers.size,0);h.page.fire('pageshow');await flush();assert.equal(h.timers.size,1);h.audio.destroy();
});

test('late resumes cannot restart hidden or destroyed audio',async()=>{
 const h=setup({delayedResume:true});const first=h.audio.unlock();h.document.hidden=true;h.document.fire('visibilitychange');h.context.resumeQueue.shift().resolve();await first;
 assert.equal(h.audio.getState().status,'paused');assert.equal(h.timers.size,0);assert.equal(h.context.sources.length,0);
 h.document.hidden=false;h.document.fire('visibilitychange');await flush();if(h.context.resumeQueue.length)h.context.resumeQueue.shift().resolve();await flush();h.context.change('suspended');const pending=h.audio.unlock();const original=h.context;h.audio.destroy();original.resumeQueue.shift().resolve();await pending;assert.equal(h.timers.size,0);assert.ok(original.sources.every(n=>n.disconnected));assert.equal(original.closes,1);assert.equal(h.audio.play('click'),false);assert.equal(h.page.handlers.get('pageshow').size,0);assert.equal(h.document.handlers.get('visibilitychange').size,0);
});

test('closed contexts are recreated only on a later gesture and rapid effects stay bounded',async()=>{
 const h=setup();await h.audio.unlock();const first=h.context;for(let i=0;i<100;i++)h.audio.play('click');assert.ok(first.sources.length<20);h.advance(100);assert.equal(h.audio.play('select'),true);h.context.change('closed');assert.equal(h.audio.getState().status,'waiting');assert.equal(h.created,1);h.audio.setMusic(false);assert.equal(h.created,1);await h.audio.unlock();assert.equal(h.created,2);assert.equal(h.timers.size,0);h.audio.destroy();assert.ok(first.nodes.every(n=>n.disconnected));
});

test('the offline scheduling helper uses the same complete, finite original music score',()=>{
 const h=setup();const context=new (class{currentTime=0;destination={};createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(at){assert.ok(at>=0&&at<95);},stop(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}})();
 assert.equal(ROOM_MUSIC.bpm,84);assert.ok(ROOM_MUSIC.duration>40&&ROOM_MUSIC.duration<60);assert.ok(ROOM_MUSIC.notes.length>150);assert.ok(ROOM_MUSIC.notes.every(n=>n.at>=0&&n.at<ROOM_MUSIC.duration&&n.level<=0.2&&n.duration>0));const stop=scheduleRoomMusic(context,context.destination,0,2);stop();h.audio.destroy();
});


test('a delayed background suspend cannot leave a visible page or quick unmute stuck',async()=>{
 const h=setup({delayedSuspend:true});await h.audio.unlock();h.document.hidden=true;h.document.fire('visibilitychange');h.document.hidden=false;h.document.fire('visibilitychange');await flush();
 h.context.suspendQueue.shift()();await flush();assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);
 h.audio.setVolume(0);h.audio.setVolume(0.4);h.context.suspendQueue.shift()();await flush();assert.equal(h.audio.getState().status,'playing');assert.equal(h.timers.size,1);h.audio.destroy();
});

test('an interrupted foreground context discards pending effects and a recreated clock accepts clicks',async()=>{
 const h=setup();await h.audio.unlock();h.advance(100000);h.audio.play('success');const old=h.context;old.change('interrupted');assert.ok(old.sources.every(n=>n.disconnected));old.change('closed');await h.audio.unlock();assert.equal(h.context.currentTime,0);assert.equal(h.audio.play('click'),true);h.audio.destroy();
});

test('partial graph creation failure is cleaned up before retrying on a later gesture',async()=>{
 let calls=0,closed=0,disconnected=0;
 class Context {
  state='suspended';currentTime=0;destination={};
  createGain(){return {gain:{setValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}},connect(){},disconnect(){disconnected++;}};}
  createBiquadFilter(){if(++calls===1)throw new Error('temporary audio device');return {frequency:{setValueAtTime(){}},Q:{setValueAtTime(){}},connect(){},disconnect(){}};}
  resume(){this.state='running';return Promise.resolve();}
  close(){this.state='closed';closed++;return Promise.resolve();}
  suspend(){this.state='suspended';return Promise.resolve();}
 }
 const audio=createRoomAudio({AudioContextClass:Context,storage:{getItem:()=>JSON.stringify({music:false,effects:true,volume:0.35})}});
 await audio.unlock();assert.equal(audio.getState().status,'error');assert.equal(closed,1);assert.equal(disconnected,3);await audio.unlock();assert.equal(audio.getState().status,'playing');assert.equal(calls,2);audio.destroy();
});
