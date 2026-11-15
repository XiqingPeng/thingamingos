import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, mutate } from '../lib/domain.js';
import { sceneMarkup, scenePresentation, sceneKey, isSceneCurrent, playbackMarkup } from '../web/theater.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const render = (state, playback = null) => sceneMarkup(state.latest_scene, state, () => '', () => '', esc, playback);
test('theater source links preserve IDs, confirmation labels and escape user content', () => {
  const state = seed(), gift = state.memories[0].id;
  mutate(state, 'scenes', { object_ids: ['cup'], topic: '毕业礼物<script>alert(1)</script>' }, 'a');
  let html = render(state);
  assert.ok(html.includes('data-id="' + gift + '"'));
  assert.ok(html.includes('待对方确认'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  mutate(state, 'memories/' + gift + '/respond', { expected_revision: 1, action: 'confirm', response: '<img onerror=alert(1)>' }, 'b');
  mutate(state, 'scenes', { object_ids: ['cup'], topic: '毕业礼物' }, 'a');
  html = render(state);
  assert.ok(html.includes('双方已确认'));
  assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
});
test('a missing or declined source prevents rendering a stale theater', () => {
  for (const status of ['missing', 'declined']) {
    const state = seed();
    mutate(state, 'scenes', { object_ids: ['cup'], topic: '毕业礼物' }, 'a');
    const id = state.latest_scene.memory_ids[0];
    if (status === 'missing') state.memories = state.memories.filter(m => m.id !== id);
    else state.memories.find(m => m.id === id).status = 'declined';
    assert.equal(render(state), '');
  }
});

function modelScene(state) {
  const memories = state.memories.filter(memory => memory.status !== 'declined');
  const ids = memories.map(memory => memory.id);
  return {
    mode: 'llm', topic: '验收：两轮对话', memory_ids: [ids[0]], context_memory_ids: ids,
    memory_revisions: Object.fromEntries(memories.map(memory => [memory.id, memory.revision ?? 1])),
    memory_snapshots: memories.map(memory => ({ ...memory, revision: memory.revision ?? 1 })),
    lines: Array.from({ length: 6 }, (_, index) => ({
      object_id: state.objects[index % 3].id, name: state.objects[index % 3].name,
      text: '验收台词' + index, mood: '平静', memory_ids: index === 0 ? [ids[0]] : [],
      source_note: index === 0 ? '小满的记录，待小北确认 <script>unsafe</script>' : '物品的想法与提问',
    })),
  };
}

test('actual scene mode labels model and rules independently of the server capability', () => {
  const state = seed(); state.latest_scene = modelScene(state); state.mode = 'rules';
  assert.match(render(state), /mode-llm.*AI 生成 · LLM/);
  state.latest_scene.mode = 'rules'; state.mode = 'hybrid';
  assert.match(render(state), /mode-rules.*规则生成/);
  assert.doesNotMatch(render(state), /AI 生成 · LLM/);
  delete state.latest_scene.mode;
  assert.match(render(state), /mode-rules.*规则生成/, 'legacy scenes remain ordinary rule scenes');
});

test('all six model lines retain their order and source attribution stays separate and escaped', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  const html = render(state);
  assert.equal((html.match(/class="dialogue"/g) || []).length, 6);
  assert.equal((html.match(/class="dialogue-name"/g) || []).length, 6);
  for (let index = 1; index < 6; index++) assert.ok(html.indexOf('验收台词' + index) > html.indexOf('验收台词' + (index - 1)));
  assert.match(html, /<p>验收台词0<\/p><p class="dialogue-source-note">小满的记录，待小北确认 &lt;script&gt;unsafe&lt;\/script&gt;<\/p>/);
  assert.match(html, /data-action="source"/);
  assert.match(html, /待对方确认/);
  assert.doesNotMatch(html, /<script>/);
});

test('fallback labels use only safe user text, while unconfigured rules are not a failure', () => {
  for (const reason of ['provider_error', 'invalid_output', 'context_changed', 'rate_limited', 'VENDOR_SECRET unexpected error']) {
    const state = seed(); state.latest_scene = { ...modelScene(state), mode: 'rules', fallback_reason: reason, model: 'private-vendor-model' };
    const html = render(state);
    assert.match(html, /规则生成 · 回退/);
    assert.match(html, /AI 对话暂时没能完成/);
    assert.doesNotMatch(html, /private-vendor-model|VENDOR_SECRET|provider_error|invalid_output|context_changed|rate_limited/);
    assert.match(html, /待对方确认/);
  }
  assert.deepEqual(scenePresentation({ mode: 'rules', fallback_reason: 'unconfigured' }), { mode: 'rules', label: '规则生成', note: '' });
});

test('a removed or declined uncited model context memory hides the entire saved scene', () => {
  for (const change of ['removed', 'declined']) {
    const state = seed(); state.latest_scene = modelScene(state);
    const id = state.latest_scene.context_memory_ids[1];
    assert.ok(!state.latest_scene.memory_ids.includes(id));
    if (change === 'removed') state.memories = state.memories.filter(memory => memory.id !== id);
    else state.memories.find(memory => memory.id === id).status = 'declined';
    assert.equal(render(state), '');
  }
});

test('model context snapshots invalidate same-revision changes to facts, confirmation and authorship', () => {
  const changes = { text: '已经更正的新事实', status: 'confirmed', response: '新补充', author_id: 'b', tagged_user_id: 'c', kind: 'promise', created_at: 'later', responded_at: 'now', object_id: 'leaf' };
  for (const [field, value] of Object.entries(changes)) {
    const state = seed(); state.latest_scene = modelScene(state);
    assert.notEqual(render(state), '', 'unchanged context must render');
    state.memories[0][field] = value;
    assert.equal(render(state), '', field + ' must invalidate context even when its revision is unchanged');
  }
});

test('revision checks cover uncited context and legacy defaults normalize without losing compatibility', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  state.latest_scene.memory_snapshots.forEach(memory => {
    if (!memory.response) delete memory.response;
    if (!memory.tagged_user_id) delete memory.tagged_user_id;
    if (!memory.responded_at) delete memory.responded_at;
  });
  assert.notEqual(render(state), '');
  state.memories[1].revision = 2;
  assert.equal(render(state), '');
  delete state.latest_scene.memory_snapshots;
  assert.equal(render(state), '', 'revision-only scenes still fail closed on changed context');
  delete state.latest_scene.memory_revisions;
  assert.notEqual(render(state), '', 'legacy scenes retain existence/status checks');
});

const dialogueTags = html => [...html.matchAll(/<article class="dialogue"[^>]*>/g)].map(match => match[0]);

test('playing reveals whole lines through the current turn and keeps later source buttons hidden', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  const html = render(state, { status: 'playing', visibleCount: 2 });
  const tags = dialogueTags(html);
  assert.equal(tags.length, 6);
  tags.forEach((tag, index) => {
    assert.match(tag, new RegExp(`data-line-index="${index}"`));
    assert.equal(/\shidden[ >]/.test(tag), index >= 2);
    assert.equal(tag.includes('data-current="true"'), index === 1);
  });
  assert.match(html, /<p>验收台词1<\/p>/, 'whole sentences are rendered instead of character fragments');
  assert.match(html, /data-action="playback-toggle"[^>]*>暂停<\/button>/);
  assert.match(html, /data-action="playback-next"/);
  assert.match(html, /data-action="playback-finish"/);
  assert.match(html, /<strong>2<\/strong> \/ 6 句/);
  assert.match(html, /正在接话/);
  assert.match(html, /待对方确认/);
  assert.doesNotMatch(html, /animation-delay|data-action="playback-replay"/);
});

test('paused controls resume the same scene without advancing its visible turn', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  const html = render(state, { status: 'paused', visibleCount: 3 });
  assert.equal(dialogueTags(html).filter(tag => !/\shidden[ >]/.test(tag)).length, 3);
  assert.match(html, /data-line-index="2" data-current="true"/);
  assert.match(html, /data-action="playback-toggle"[^>]*>继续<\/button>/);
  assert.match(html, /已暂停/);
  assert.match(html, /aria-label="已呈现 3 句，共 6 句"/);
  const controls = playbackMarkup(state.latest_scene, { status: 'paused', visibleCount: 3 }, esc);
  assert.ok(html.includes(controls));
  assert.doesNotMatch(controls, /id="theater-controls"/, 'partial updates keep the original focusable controls wrapper');
});

test('completed scenes and revisited history show all lines with a local replay control', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  for (const playback of [null, { status: 'complete', visibleCount: 2 }, { status: 'playing', visibleCount: 6 }]) {
    const html = render(state, playback), tags = dialogueTags(html);
    assert.equal(tags.length, 6);
    assert.ok(tags.every(tag => !/\shidden[ >]/.test(tag) && tag.includes('data-current="false"')));
    assert.match(html, /<strong>6<\/strong> \/ 6 句/);
    assert.match(html, /全场结束 · 已完整呈现/);
    assert.match(html, /data-action="playback-replay"[^>]*>重播这场<\/button>/);
    assert.doesNotMatch(html, /data-action="playback-(?:toggle|next|finish)"/);
  }
});

test('scene focus targets, cast and a separate empty announcement are accessible and escaped', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  state.latest_scene.topic = '话题 <script>bad</script>';
  state.latest_scene.lines[0].name = '杯子<img src=x onerror=bad>';
  state.latest_scene.lines[3].name = state.latest_scene.lines[0].name;
  const html = render(state, { status: 'playing', visibleCount: 1 });
  assert.match(html, /<section class="theater" id="theater" tabindex="-1" aria-labelledby="theater-title">/);
  assert.match(html, /<h2 id="theater-title">小剧场 · 话题 &lt;script&gt;bad&lt;\/script&gt;<\/h2>/);
  const cast = /<p class="theater-cast">(.*?)<\/p>/.exec(html)?.[1];
  assert.ok(cast);
  assert.equal((cast.match(/<span>/g) || []).length, 3);
  assert.match(cast, /杯子&lt;img src=x onerror=bad&gt;/);
  assert.match(html, /id="theater-controls" tabindex="-1" aria-label="小剧场播放控制"/);
  assert.match(html, /<div id="theater-announcement" class="theater-announcement" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
  assert.doesNotMatch(html, /<script>|<img|<section[^>]*aria-live|class="dialogue-list"[^>]*aria-live/);
});

test('stale context invalidates a playing scene even when the changed memory is not yet visible', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  const playback = { status: 'playing', visibleCount: 1 };
  assert.equal(isSceneCurrent(state.latest_scene, state), true);
  assert.notEqual(render(state, playback), '');
  state.memories[1].text = '这段上下文已更正';
  assert.equal(isSceneCurrent(state.latest_scene, state), false);
  assert.equal(render(state, playback), '');
  assert.equal(isSceneCurrent(null, state), false);
  assert.equal(isSceneCurrent({ lines: [] }, state), false);
});

test('scene identity is stable across refreshes and distinguishes changed or legacy scenes', () => {
  const state = seed(), scene = { ...modelScene(state), id: 'saved-scene' };
  assert.equal(sceneKey(scene), sceneKey(structuredClone(scene)));
  const changed = structuredClone(scene); changed.lines[0].text = '另一个版本的台词';
  assert.notEqual(sceneKey(scene), sceneKey(changed));
  delete scene.id; delete changed.id;
  assert.equal(sceneKey(scene), sceneKey(structuredClone(scene)));
  assert.notEqual(sceneKey(scene), sceneKey(changed));
  assert.equal(sceneKey(null), '');
});

test('invalid playback counters cannot expose markup or advance beyond the available scene', () => {
  const state = seed(); state.latest_scene = modelScene(state);
  const html = render(state, { status: 'playing', visibleCount: '<script>bad</script>' });
  assert.ok(dialogueTags(html).every(tag => /\shidden[ >]/.test(tag)));
  assert.match(html, /<strong>0<\/strong> \/ 6 句/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(playbackMarkup(state.latest_scene, { status: 'paused', visibleCount: 99 }, esc), /全场结束/);
});
