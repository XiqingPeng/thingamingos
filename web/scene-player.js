export function readingDelay(text) {
  const length = Array.from(String(text ?? '').trim()).length;
  return Math.min(8500, Math.max(2800, 1200 + length * 85));
}

// Owns only reading progress and time. Scene content and rendering stay outside.
export function createScenePlayer({ onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  let sceneKey = null, lines = [], visibleCount = 0, status = 'idle', loaded = false;
  let timer = null, deadline = null, remaining = 0, generation = 0;
  const snapshot = () => ({ sceneKey, visibleCount, total: lines.length, status });
  const changed = () => { onChange(snapshot()); return snapshot(); };

  function cancelTimer() {
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null;
    deadline = null;
  }

  function schedule(delay) {
    cancelTimer();
    remaining = delay;
    deadline = now() + delay;
    const scheduledGeneration = generation;
    timer = setTimer(() => {
      // Clearing a timer may race with a queued callback. Its generation also
      // protects a replacement scene and same-scene replays from old callbacks.
      if (scheduledGeneration !== generation || status !== 'playing') return;
      timer = null;
      deadline = null;
      remaining = 0;
      next();
    }, delay);
  }

  function install(key, values) {
    cancelTimer();
    sceneKey = key;
    lines = Array.isArray(values) ? values.map(line => typeof line === 'string' ? line : line?.text ?? '') : [];
    loaded = true;
    visibleCount = 0;
    remaining = 0;
    status = 'idle';
  }

  function start(key, values) {
    install(key, values);
    if (lines.length) {
      visibleCount = 1;
      status = lines.length === 1 ? 'complete' : 'playing';
      if (status === 'playing') schedule(readingDelay(lines[0]));
    }
    return changed();
  }

  function load(key, values, { autoplay = false } = {}) {
    if (loaded && Object.is(key, sceneKey)) {lines=Array.isArray(values)?values.map(line=>typeof line==='string'?line:line?.text??''):[];return snapshot();}
    if (autoplay) return start(key, values);
    install(key, values);
    visibleCount = lines.length;
    status = lines.length ? 'complete' : 'idle';
    return changed();
  }

  function pause() {
    if (status !== 'playing') return snapshot();
    remaining = Math.max(0, deadline - now());
    cancelTimer();
    status = 'paused';
    return changed();
  }

  function resume() {
    if (status !== 'paused') return snapshot();
    status = 'playing';
    schedule(remaining);
    return changed();
  }

  function next() {
    if (status !== 'playing' && status !== 'paused') return snapshot();
    const wasPlaying = status === 'playing';
    cancelTimer();
    visibleCount = Math.min(lines.length, visibleCount + 1);
    if (visibleCount === lines.length) {
      status = 'complete';
      remaining = 0;
    } else {
      remaining = readingDelay(lines[visibleCount - 1]);
      if (wasPlaying) schedule(remaining);
    }
    return changed();
  }

  function finish() {
    if (status === 'idle' || status === 'complete') return snapshot();
    cancelTimer();
    visibleCount = lines.length;
    status = 'complete';
    remaining = 0;
    return changed();
  }

  function reset() {
    cancelTimer();
    sceneKey = null;
    lines = [];
    visibleCount = 0;
    status = 'idle';
    loaded = false;
    remaining = 0;
    return changed();
  }

  return { snapshot, load, start, pause, resume, next, finish, reset };
}
