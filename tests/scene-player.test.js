import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePlayer, readingDelay } from '../web/scene-player.js';

function harness() {
  let time = 0, sequence = 0;
  const pending = new Map(), callbacks = new Map(), updates = [];
  const player = createScenePlayer({
    onChange: value => updates.push(value),
    now: () => time,
    setTimer: (callback, delay) => {
      const id = sequence++;
      pending.set(id, { callback, at: time + delay });
      callbacks.set(id, callback);
      return id;
    },
    clearTimer: id => pending.delete(id),
  });
  function advance(milliseconds) {
    const target = time + milliseconds;
    while (true) {
      const task = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!task || task[1].at > target) break;
      const [id, { at, callback }] = task;
      pending.delete(id);
      time = at;
      callback();
    }
    time = target;
  }
  return { player, pending, updates, advance, stale: id => callbacks.get(id)(), timer: () => [...pending.keys()][0] };
}

const dialogue = [{ text: '第一句。' }, { text: '第二句。' }, { text: '最后一句。' }];

test('reading delay counts Unicode code points and has readable minimum/maximum', () => {
  assert.equal(readingDelay(''), 2800);
  assert.equal(readingDelay('短句'), 2800);
  assert.equal(readingDelay('😀'.repeat(30)), 3750);
  assert.equal(readingDelay('字'.repeat(40)), 4600);
  assert.equal(readingDelay('字'.repeat(1000)), 8500);
});

test('start shows a whole first line immediately and completes as soon as the last appears', () => {
  const h = harness();
  assert.deepEqual(h.player.start('new', dialogue), { sceneKey: 'new', visibleCount: 1, total: 3, status: 'playing' });
  h.advance(2799); assert.equal(h.player.snapshot().visibleCount, 1);
  h.advance(1); assert.equal(h.player.snapshot().visibleCount, 2);
  h.advance(2800);
  assert.deepEqual(h.player.snapshot(), { sceneKey: 'new', visibleCount: 3, total: 3, status: 'complete' });
  assert.equal(h.pending.size, 0);
  h.advance(100_000); assert.equal(h.updates.length, 3);
});

test('load opens historical scenes in full and a polling load never resets progress or timing', () => {
  const h = harness();
  assert.equal(h.player.load('history', dialogue).status, 'complete');
  assert.equal(h.pending.size, 0);
  h.player.start('new', dialogue); h.advance(1000);
  const updateCount = h.updates.length, timer = h.timer();
  assert.equal(h.player.load('new', dialogue, { autoplay: true }).visibleCount, 1);
  assert.equal(h.timer(), timer); assert.equal(h.updates.length, updateCount);
  h.advance(1800); assert.equal(h.player.snapshot().visibleCount, 2);
  h.player.load('other', dialogue);
  assert.deepEqual(h.player.snapshot(), { sceneKey: 'other', visibleCount: 3, total: 3, status: 'complete' });
  assert.equal(h.pending.size, 0);
});

test('pause/resume retains remaining reading time even across a long pause and repeated controls', () => {
  const h = harness();
  h.player.start('a', [{ text: '字'.repeat(40) }, ...dialogue]); h.advance(1000);
  h.player.pause(); h.player.pause();
  h.advance(100_000);
  assert.equal(h.player.snapshot().visibleCount, 1); assert.equal(h.pending.size, 0);
  h.player.load('a', dialogue);
  assert.equal(h.player.snapshot().status, 'paused');
  h.player.resume(); h.player.resume();
  h.advance(3599); assert.equal(h.player.snapshot().visibleCount, 1);
  h.advance(1); assert.equal(h.player.snapshot().visibleCount, 2);
});

test('next while paused keeps the next line paused and assigns it a full reading interval', () => {
  const h = harness();
  h.player.start('a', ['短句', '字'.repeat(40), '结尾']); h.advance(1000);
  h.player.pause(); h.player.next();
  assert.deepEqual(h.player.snapshot(), { sceneKey: 'a', visibleCount: 2, total: 3, status: 'paused' });
  assert.equal(h.pending.size, 0);
  h.player.resume(); h.advance(4599); assert.equal(h.player.snapshot().visibleCount, 2);
  h.advance(1); assert.equal(h.player.snapshot().status, 'complete');
  h.player.next(); assert.equal(h.player.snapshot().visibleCount, 3);
});

test('next during playback restarts the newly displayed line interval instead of using the old deadline', () => {
  const h = harness();
  h.player.start('a', ['短句', '字'.repeat(40), '结尾']);
  const firstTimer = h.timer(); h.advance(1000); h.player.next();
  h.stale(firstTimer); assert.equal(h.player.snapshot().visibleCount, 2);
  h.advance(1800); assert.equal(h.player.snapshot().visibleCount, 2);
  h.advance(2800); assert.equal(h.player.snapshot().status, 'complete');
  assert.equal(h.pending.size, 0);
});

test('callbacks from replaced scenes, finish and same-key replay cannot advance the active scene', () => {
  const h = harness();
  h.player.start('a', dialogue); const oldScene = h.timer();
  h.player.start('b', dialogue); const beforeFinish = h.timer();
  h.stale(oldScene); assert.equal(h.player.snapshot().visibleCount, 1);
  h.player.finish(); h.stale(beforeFinish);
  assert.equal(h.player.snapshot().status, 'complete');
  h.player.start('b', dialogue); const replayTimer = h.timer();
  h.stale(oldScene); h.stale(beforeFinish);
  assert.equal(h.player.snapshot().visibleCount, 1); assert.equal(h.timer(), replayTimer);
  h.advance(2800); assert.equal(h.player.snapshot().visibleCount, 2);
});

test('reset cancels even timer id zero and invalidates any queued callback', () => {
  const h = harness();
  h.player.start('a', dialogue); const old = h.timer(); assert.equal(old, 0);
  assert.deepEqual(h.player.reset(), { sceneKey: null, visibleCount: 0, total: 0, status: 'idle' });
  assert.equal(h.pending.size, 0); h.stale(old);
  assert.equal(h.player.snapshot().status, 'idle');
  h.player.load('a', dialogue, { autoplay: true });
  h.stale(old); assert.equal(h.player.snapshot().visibleCount, 1);
});

test('empty and one-line scenes never schedule timers or step outside their bounds', () => {
  const h = harness();
  h.player.start('empty', []);
  for (const action of ['pause', 'resume', 'next', 'finish']) h.player[action]();
  assert.deepEqual(h.player.snapshot(), { sceneKey: 'empty', visibleCount: 0, total: 0, status: 'idle' });
  assert.equal(h.player.start('one', [dialogue[0]]).status, 'complete');
  h.player.next(); h.player.resume(); h.player.finish();
  assert.equal(h.player.snapshot().visibleCount, 1); assert.equal(h.pending.size, 0);
});

test('callers cannot mutate playback through snapshots or the original lines', () => {
  const h = harness(), values = [{ text: '短句' }, { text: '下一句' }, { text: '末句' }];
  const state = h.player.start('a', values);
  state.visibleCount = 99; h.updates[0].status = 'complete'; values[1].text = '字'.repeat(1000); values.push({ text: '多余句' });
  h.advance(2800); assert.equal(h.player.snapshot().visibleCount, 2);
  h.advance(2800);
  assert.deepEqual(h.player.snapshot(), { sceneKey: 'a', visibleCount: 3, total: 3, status: 'complete' });
});
