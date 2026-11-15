// Original music and UI sounds, synthesized locally. No recordings or network requests.
const STORAGE_KEY = 'thingamingos-audio-v1';
const DEFAULTS = Object.freeze({ music: true, effects: true, volume: 0.35 });
const BEAT = 60 / 84;
const BAR = BEAT * 4;
const melody = [
 [72,null,76,79,null,76,74,null], [69,null,72,76,null,74,72,null],
 [69,null,72,77,null,76,72,null], [71,null,74,79,null,77,74,null],
 [76,null,79,81,79,null,76,null], [72,null,76,79,76,null,74,null],
 [72,null,69,72,77,null,76,72], [74,null,71,74,79,null,74,null],
 [79,null,76,72,null,74,76,null], [76,null,72,69,null,72,74,null],
 [77,null,76,72,69,null,72,null], [74,null,77,79,null,77,74,null],
 [76,null,79,84,81,null,79,76], [72,null,76,79,76,null,72,null],
 [69,null,72,77,76,null,74,null], [71,null,74,79,76,null,72,null],
];
const chords = [
 [48,60,64,67], [45,57,60,64], [41,57,60,65], [43,59,62,67],
 [48,60,64,67], [45,57,60,64], [41,57,60,65], [43,59,62,67],
 [48,60,64,67], [45,57,60,64], [41,57,60,65], [43,59,62,67],
 [48,60,64,67], [45,57,60,64], [41,57,60,65], [43,59,62,67],
];
const notes = [];
for (let bar = 0; bar < melody.length; bar++) {
 for (let step = 0; step < 8; step++) {
  const note = melody[bar][step];
  if (note !== null) notes.push({ at: bar * BAR + step * BEAT / 2, note, duration: BEAT * (step === 6 ? 0.9 : 0.7), voice: 'flute', level: 0.105 });
 }
 const [bass,...harmony] = chords[bar];
 notes.push({ at: bar * BAR, note: bass, duration: BEAT * 1.8, voice: 'bass', level: 0.095 });
 notes.push({ at: bar * BAR + BEAT * 2, note: bass + 7, duration: BEAT * 1.7, voice: 'bass', level: 0.07 });
 for (let index = 0; index < harmony.length; index++) {
  notes.push({ at: bar * BAR + index * BEAT / 2, note: harmony[index], duration: BEAT * 2.3, voice: 'pluck', level: 0.045 });
  notes.push({ at: bar * BAR + BEAT * 2 + index * BEAT / 2, note: harmony[index], duration: BEAT * 1.8, voice: 'pluck', level: 0.032 });
 }
}
// Used by both the live scheduler and an OfflineAudioContext for repeatable audio QA.
export const ROOM_MUSIC = Object.freeze({ title: 'A little afternoon', bpm: 84, duration: BAR * melody.length, notes: Object.freeze(notes.sort((a,b) => a.at - b.at).map(Object.freeze)) });
const effects = Object.freeze({
 click: [[79,0,0.075,0.13]],
 select: [[76,0,0.09,0.15],[79,0.055,0.13,0.11]],
 open: [[72,0,0.13,0.12],[76,0.065,0.16,0.1],[79,0.13,0.19,0.08]],
 success: [[72,0,0.16,0.12],[76,0.09,0.17,0.12],[79,0.18,0.18,0.1],[84,0.29,0.3,0.08]],
 error: [[69,0,0.13,0.1],[67,0.11,0.2,0.075]],
});
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : DEFAULTS.volume));
const frequency = note => 440 * 2 ** ((note - 69) / 12);

function voice(context, destination, event, when, active) {
 const oscillator = context.createOscillator(), envelope = context.createGain();
 const record = { oscillator, envelope, stopped: false };
 const start = Math.max(context.currentTime, when), duration = Math.max(0.04, event.duration);
 const attack = event.voice === 'flute' ? 0.035 : event.voice === 'bass' ? 0.025 : 0.008;
 const release = event.voice === 'flute' ? 0.13 : 0.09;
 oscillator.type = event.voice === 'pluck' || event.voice === 'effect' ? 'triangle' : 'sine';
 oscillator.frequency.setValueAtTime(frequency(event.note), start);
 const level = Math.max(0, Math.min(0.2, event.level));
 envelope.gain.setValueAtTime(0, start);
 envelope.gain.linearRampToValueAtTime(level, start + attack);
 envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * (event.voice === 'flute' ? 0.75 : 0.35)), start + duration);
 envelope.gain.linearRampToValueAtTime(0, start + duration + release);
 oscillator.connect(envelope); envelope.connect(destination); active?.add(record);
 const dispose = () => { active?.delete(record); oscillator.disconnect(); envelope.disconnect(); };
 oscillator.onended = dispose;
 oscillator.start(start); oscillator.stop(start + duration + release + 0.01);
 return record;
}

export function scheduleRoomMusic(context, destination = context.destination, startAt = context.currentTime, cycles = 1) {
 const active = new Set();
 for (let cycle = 0; cycle < Math.min(8,Math.max(1,Math.trunc(cycles)||1)); cycle++)
  for (const event of ROOM_MUSIC.notes) voice(context,destination,event,startAt + cycle * ROOM_MUSIC.duration + event.at,active);
 return () => { for (const record of [...active]) { try { record.oscillator.stop(); } catch {} record.oscillator.disconnect(); record.envelope.disconnect(); active.delete(record); } };
}

export function createRoomAudio(options = {}) {
 const doc = options.document ?? globalThis.document;
 const page = doc?.defaultView ?? globalThis.window;
 const AudioContextClass = options.AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
 const setTimer = options.setTimer ?? globalThis.setTimeout;
 const clearTimer = options.clearTimer ?? globalThis.clearTimeout;
 let storage = options.storage;
 if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
 let prefs = { ...DEFAULTS };
 try {
  const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
  if (saved && typeof saved === 'object') prefs = { music: typeof saved.music === 'boolean' ? saved.music : DEFAULTS.music, effects: typeof saved.effects === 'boolean' ? saved.effects : DEFAULTS.effects, volume: typeof saved.volume === 'number' ? clamp(saved.volume) : DEFAULTS.volume };
 } catch {}
 let context = null, master = null, musicBus = null, effectBus = null, filter = null;
 let timer = null, index = 0, origin = 0, cycling = false, destroyed = false;
 let unlocked = false, pageHidden = false, error = null, epoch = 0, resumeAttempt = 0, lastEffect = -Infinity;
 const musicNodes = new Set(), effectNodes = new Set();
 const hidden = () => pageHidden || Boolean(doc?.hidden) || doc?.visibilityState === 'hidden';
 const wanted = () => prefs.volume > 0 && (prefs.music || prefs.effects);
 function getState() {
  const status = !AudioContextClass ? 'unsupported' : destroyed || !wanted() ? 'muted' : hidden() ? 'paused' : error ? 'error' : unlocked && context?.state === 'running' ? 'playing' : 'waiting';
  return { ...prefs, status };
 }
 let previous = JSON.stringify(getState());
 function emit() {
  const current = getState(), serialized = JSON.stringify(current);
  if (serialized !== previous) { previous = serialized; try { options.onChange?.(current); } catch {} }
  return current;
 }
 function save() { try { storage?.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {} }
 function setGain(gain, value, smooth = true) {
  if (!context || !gain) return;
  const now = context.currentTime;
  gain.cancelScheduledValues(now);
  if (smooth && typeof gain.setTargetAtTime === 'function') gain.setTargetAtTime(value,now,0.025);
  else gain.setValueAtTime(value,now);
 }
 function stopVoices(group, hard = true) {
  const now = context?.currentTime ?? 0;
  for (const record of [...group]) {
   if (record.stopped && !hard) continue;
   record.stopped = true;
   try {
    if (!hard) {
     if (typeof record.envelope.gain.cancelAndHoldAtTime === 'function') record.envelope.gain.cancelAndHoldAtTime(now);
     else { record.envelope.gain.cancelScheduledValues(now); record.envelope.gain.setValueAtTime(0,now); }
     record.envelope.gain.linearRampToValueAtTime(0,now + 0.015);
    }
    record.oscillator.stop(hard ? now : now + 0.02);
   } catch {}
   if (hard) { record.oscillator.disconnect(); record.envelope.disconnect(); group.delete(record); }
  }
 }
 function stopMusic(hard = false) {
  if (timer !== null) clearTimer(timer);
  timer = null; cycling = false; index = 0;
  stopVoices(musicNodes,hard);
 }
 function audibleMusic() { return !destroyed && !hidden() && unlocked && prefs.music && prefs.volume > 0 && context?.state === 'running'; }
 function pump() {
  timer = null;
  if (!audibleMusic()) { stopMusic(true); return; }
  const now = context.currentTime;
  // Never play a catch-up burst after a delayed timer or interrupted device clock.
  if (origin + ROOM_MUSIC.notes[index].at < now - 0.2) { origin = now + 0.05; index = 0; }
  let scheduled = 0;
  while (origin + ROOM_MUSIC.notes[index].at < now + 0.16 && scheduled++ < 32) {
   const event = ROOM_MUSIC.notes[index];
   voice(context,musicBus,event,origin + event.at,musicNodes);
   index++;
   if (index === ROOM_MUSIC.notes.length) { index = 0; origin += ROOM_MUSIC.duration; }
  }
  timer = setTimer(pump,60);
 }
 function sync() {
  if (destroyed) return;
  setGain(master?.gain,hidden() ? 0 : prefs.volume * 0.8);
  setGain(musicBus?.gain,prefs.music ? 1 : 0);
  setGain(effectBus?.gain,prefs.effects ? 1 : 0);
  if (!prefs.effects || !prefs.volume || hidden() || context?.state !== 'running') stopVoices(effectNodes,true);
  if (audibleMusic()) {
   if (!cycling) { cycling = true; index = 0; origin = context.currentTime + 0.05; pump(); }
  } else stopMusic(hidden() || context?.state !== 'running');
  emit();
 }
 function pause() {
  epoch++;
  setGain(master?.gain,0,false); stopMusic(true); stopVoices(effectNodes,true);
  if (context && context.state !== 'closed') {
   const ownContext = context;
   try { Promise.resolve(ownContext.suspend()).then(() => {
    // A show/unmute can arrive before suspend finishes on iPhone.
    if (!destroyed && context === ownContext && !hidden() && wanted() && unlocked) void attemptResume(false);
   }).catch(() => {}); } catch {}
  }
  emit();
 }
 function stateChanged() {
  if (destroyed) return;
  if (context?.state === 'closed') {
   epoch++; stopMusic(true); stopVoices(effectNodes,true);
   context.removeEventListener?.('statechange',stateChanged);
   master?.disconnect(); musicBus?.disconnect(); effectBus?.disconnect(); filter?.disconnect();
   context = master = musicBus = effectBus = filter = null; lastEffect = -Infinity;
  }
  sync();
 }
 function makeContext() {
  context = new AudioContextClass({ latencyHint: 'interactive' }); lastEffect = -Infinity;
  master = context.createGain(); musicBus = context.createGain(); effectBus = context.createGain(); filter = context.createBiquadFilter();
  master.gain.setValueAtTime(0,context.currentTime);
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(2600,context.currentTime); filter.Q.setValueAtTime(0.4,context.currentTime);
  musicBus.connect(filter); effectBus.connect(filter); filter.connect(master); master.connect(context.destination);
  context.addEventListener?.('statechange',stateChanged);
 }
 function attemptResume(fromGesture) {
  if (destroyed || !AudioContextClass || hidden() || !wanted()) return Promise.resolve(emit());
  if (!context) {
   if (!fromGesture) return Promise.resolve(emit());
   try { makeContext(); } catch (failure) {
    epoch++; stopMusic(true); stopVoices(effectNodes,true);
    context?.removeEventListener?.('statechange',stateChanged);
    master?.disconnect(); musicBus?.disconnect(); effectBus?.disconnect(); filter?.disconnect();
    try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
    context = master = musicBus = effectBus = filter = null;
    error = failure; try { options.onError?.(failure); } catch {} return Promise.resolve(emit());
   }
  }
  if (context.state === 'running') { sync(); return Promise.resolve(getState()); }
  const ownContext = context, ownEpoch = epoch, attempt = ++resumeAttempt;
  let resumed;
  try { resumed = ownContext.resume(); } catch (failure) { resumed = Promise.reject(failure); }
  return Promise.resolve(resumed).then(() => {
   if (destroyed || context !== ownContext || ownEpoch !== epoch || attempt !== resumeAttempt) return getState();
   error = null; sync(); return getState();
  }).catch(failure => {
   if (destroyed || context !== ownContext || ownEpoch !== epoch || attempt !== resumeAttempt) return getState();
   // Autoplay and iOS interruptions are recoverable on the next real user gesture.
   error = failure?.name === 'NotAllowedError' ? null : failure;
   stopMusic(true); stopVoices(effectNodes,true);
   try { options.onError?.(failure); } catch {} return emit();
  });
 }
 function unlock() {
  if (destroyed) return Promise.resolve(getState());
  unlocked = true; error = null;
  // Keep creation and resume in this synchronous gesture call stack, before any await.
  return attemptResume(true);
 }
 function settingsChanged() {
  save();
  if (!wanted()) pause();
  else { sync(); if (unlocked && !hidden()) void attemptResume(false); }
  return emit();
 }
 function setMusic(value) { const next = Boolean(value); if (next === prefs.music) return getState(); prefs.music = next; return settingsChanged(); }
 function setEffects(value) { const next = Boolean(value); if (next === prefs.effects) return getState(); prefs.effects = next; return settingsChanged(); }
 function setVolume(value) { const next = clamp(value); if (next === prefs.volume) return getState(); prefs.volume = next; return settingsChanged(); }
 function play(name = 'click') {
  if (destroyed || hidden() || !unlocked || !prefs.effects || prefs.volume <= 0 || context?.state !== 'running') return false;
  const now = context.currentTime;
  if (now - lastEffect < 0.045) return false;
  lastEffect = now;
  // A rapid series of actions replaces the previous short sound, rather than piling up.
  stopVoices(effectNodes,false);
  for (const [note,offset,duration,level] of effects[name] ?? effects.click) voice(context,effectBus,{note,duration,level,voice:'effect'},now + offset,effectNodes);
  return true;
 }
 function onVisibility() { if (hidden()) pause(); else if (unlocked) void attemptResume(false); else emit(); }
 function onPageHide() { pageHidden = true; pause(); }
 function onPageShow() { pageHidden = false; onVisibility(); }
 doc?.addEventListener?.('visibilitychange',onVisibility);
 page?.addEventListener?.('pagehide',onPageHide);
 page?.addEventListener?.('pageshow',onPageShow);
 function destroy() {
  if (destroyed) return;
  destroyed = true; epoch++;
  stopMusic(true); stopVoices(effectNodes,true);
  doc?.removeEventListener?.('visibilitychange',onVisibility);
  page?.removeEventListener?.('pagehide',onPageHide);
  page?.removeEventListener?.('pageshow',onPageShow);
  if (context) {
   context.removeEventListener?.('statechange',stateChanged);
   setGain(master?.gain,0,false);
   master?.disconnect(); musicBus?.disconnect(); effectBus?.disconnect(); filter?.disconnect();
   try { Promise.resolve(context.close()).catch(() => {}); } catch {}
  }
  emit();
 }
 return { getState, unlock, setMusic, setEffects, setVolume, play, destroy };
}
