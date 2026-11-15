import {createRoomAudioUI} from '../web/audio-ui.js';
import {displayScene} from '../web/scene-language.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { seed, publicState } from '../lib/domain.js';
import { sceneMarkup, sceneKey, isSceneCurrent, playbackMarkup } from '../web/theater.js';
import { createScenePlayer, readingDelay } from '../web/scene-player.js';
import { createRequestGate, defaultSceneIds, prepareObjectData, createUploadCache } from '../web/ui-state.js';

import {t,ui,getLanguage,setLanguage,locale,translateError} from '../web/i18n.js';
import {collectionPage,roomCast,objectIcon} from '../web/collection.js';

// These race tests start after capability/bootstrap detection; real account startup is integration-tested.
const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('startApp().catch','refresh().catch');
const tick = () => new Promise(resolve => setImmediate(resolve));
const room = 'ab'.repeat(16);

// Minimal DOM boundary: run the real app handlers, with deliberately reordered
// fetch responses. No browser/network/database is used by this test harness.
function harness(initialActor = 'a') {
  const pending = [], handlers = {}, timers = [];
  let time = 0, timerId = 0;
  const playbackTimers = new Map();
  const values = new Map([['object-stories-user', initialActor]]);
  const local = new Map();
  const classes = { add() {}, remove() {} };
  const toast = { textContent: '', classList: classes };
  const app = { innerHTML: '' };
  const launcher = { disabled: false, innerHTML: '' };
  const modal = {
    open: false, _html: '', form: null, listeners: {},
    set innerHTML(value) {
      this._html = value;
      const match = /<form id="([^"]+)" data-actor="([^"]+)" data-generation="([^"]+)">/.exec(value);
      this.form = null;
      if (!match) return;
      const form = { id: match[1], dataset: { actor: match[2], generation: match[3] },
        values: {}, checks: [], button: { textContent: '保存', disabled: false },
        error: { textContent: '' }, media: { files: [] }, status: { textContent: '' },
        progress: { textContent: '' }, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        elements: { is_gift: { checked: false } },
        querySelector(selector) {
          return selector === 'button[type="submit"]' ? this.button
            : selector === '.inline-error' ? this.error : selector === '#media-input' ? this.media
            : selector === '.scene-generation-status' ? this.progress : null;
        },
      };
      for (const input of value.matchAll(/<input\b([^>]+)>/g)) {
        const name = /name="([^"]+)"/.exec(input[1])?.[1];
        const inputValue = /value="([^"]*)"/.exec(input[1])?.[1] || '';
        if (!name) continue;
        if (name === 'object_ids') form.checks.push({ name, value: inputValue, checked: /\bchecked\b/.test(input[1]), disabled: false });
        else form.values[name] = inputValue;
      }
      this.form = form;
    },
    get innerHTML() { return this._html; },
    close() { this.open = false; }, showModal() { this.open = true; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll(selector) { return selector === '[name="object_ids"]' ? this.form?.checks || [] : []; },
    querySelector(selector) { return selector === '.scene-selection-status' ? this.form?.status : this.form?.querySelector(selector); },
  };
  const document = {
    hidden: false, body: { classList: classes },
    querySelector(selector) {
      if (selector === '#modal') return modal;
      if (selector === '#app') return app;
      if (selector === '#toast') return toast;
      if (selector === '#theater') return { scrollIntoView() {}, focus() {}, querySelectorAll() { return []; } };
      return null;
    },
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    querySelectorAll(selector) { return selector === '[data-action="scene"]' ? [launcher] : []; },
  };
  class FormDataStub {
    constructor(form) {
      this.entries = form ? Object.entries(form.values).filter(([key]) => key !== 'object_ids') : [];
      for (const input of form?.checks || []) if (input.checked && !input.disabled) this.entries.push([input.name, input.value]);
    }
    append(name, value) { this.entries.push([name, value]); }
    *[Symbol.iterator]() { yield* this.entries; }
    getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
  }
  const context = {
    displayScene,t,ui,getLanguage,setLanguage,locale,translateError,collectionPage,roomCast,objectIcon,createRoomAudioUI,
    document, window: { scrollTo() {} }, sceneMarkup, sceneKey, isSceneCurrent, playbackMarkup,
    createScenePlayer: options => createScenePlayer({ ...options, now: () => time,
      setTimer: (fn, delay) => { const id = ++timerId; playbackTimers.set(id, { fn, at: time + delay }); return id; },
      clearTimer: id => playbackTimers.delete(id),
    }),
    createRequestGate, defaultSceneIds, prepareObjectData, createUploadCache,
    URLSearchParams, URL, AbortController,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    location: { search: '?room=' + room, origin: 'https://test.invalid', reload() {} },
    localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
    sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    setInterval: fn => timers.push(fn), setTimeout: () => 1, clearTimeout() {},
    FormData: FormDataStub,
    fetch: (path, options) => new Promise((resolve, reject) => pending.push({ path, options, resolve, reject })),
  };
  vm.createContext(context);
  vm.runInContext(source + `\nglobalThis.actions={refresh,openCreate,openScene,openRespond,closeModal,
    select(id){selected=id;},inspect(){return {actorId,state,selected,view,pendingRender,busy,switching,scenePending,pickingCompanions,collectionPicks,playback:player.snapshot(),returnSceneKey};}};`, context);
  const snapshot = actor => publicState(seed(), actor, room);
  const respond = (request, body, status = 200) => request.resolve({ ok: status < 400, status, json: async () => body });
  const take = path => {
    const request = pending.shift();
    assert.ok(request, 'expected a pending request: ' + path);
    assert.equal(request.path, path);
    return request;
  };
  return { pending, handlers, timers, modal, app, toast, launcher, values, local, snapshot, respond, take, actions: context.actions,
    async boot() { respond(take('/api/state'), snapshot(initialActor)); await tick(); },
    submit() { return handlers.submit[0]({ target: modal.form, preventDefault() {} }); },
    switchActor(actor) { return handlers.change[0]({ target: { id: 'user-select', value: actor } }); },
    click(action, extra = {}, fromTheater = false) {
      const button = { dataset: { action, ...extra }, closest: selector => selector === '#theater' && fromTheater ? {} : null };
      for (const fn of handlers.click) fn({ target: { closest: selector => selector === '[data-action]' ? button : null } });
    },
    hide() { document.hidden = true; for (const fn of handlers.visibilitychange || []) fn(); },
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const next = [...playbackTimers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        time = next[1].at; playbackTimers.delete(next[0]); next[1].fn();
      }
      time = target;
    },
  };
}

test('logo keeps its own room even if another tab updates localStorage', async () => {
  const h = harness(); await h.boot();
  h.local.set('object-stories-room', 'cd'.repeat(16));
  const updating = h.actions.refresh();
  h.respond(h.take('/api/state'), h.snapshot('a')); await updating;
  assert.ok(h.app.innerHTML.includes('class="brand" href="/?room=' + room + '"'));
});

test('scene defaults include the selected fourth object and enforce the limit immediately', async () => {
  const h = harness();
  const state = h.snapshot('a'); state.objects.push({ ...state.objects[0], id: 'four', name: '新杯子' });
  h.respond(h.take('/api/state'), state); await tick();
  h.actions.select('four'); h.actions.openScene();
  const form = h.modal.form;
  assert.ok(form.checks.find(input => input.value === 'four').checked);
  assert.equal(form.checks.filter(input => input.checked).length, 3);
  const replacement = form.checks.find(input => !input.checked);
  assert.equal(replacement.disabled, true);
  assert.match(form.status.textContent, /3\/3.*取消/);
  const checked = form.checks.find(input => input.checked);
  checked.checked = false; await h.handlers.change[0]({ target: checked });
  assert.equal(replacement.disabled, false);
  replacement.checked = true; await h.handlers.change[0]({ target: replacement });
  assert.equal(form.checks.filter(input => input.checked).length, 3);
});

test('an older polling response cannot undo a completed identity switch', async () => {
  const h = harness(); await h.boot();
  h.timers[0](); const old = h.take('/api/state');
  const switching = h.switchActor('b');
  h.respond(h.take('/api/session'), { ok: true }); await tick();
  h.respond(h.take('/api/state'), h.snapshot('b')); await switching;
  h.respond(old, h.snapshot('a')); await tick();
  assert.equal(h.actions.inspect().actorId, 'b');
  assert.equal(h.actions.inspect().state.current_user_id, 'b');
  assert.equal(h.values.get('object-stories-user'), 'b');
});

test('out-of-order reads for the same identity cannot replace newer state', async () => {
  const h = harness(); await h.boot();
  const first = h.actions.refresh(), old = h.take('/api/state');
  const second = h.actions.refresh(), newest = h.take('/api/state');
  const state = h.snapshot('a'); state.objects[0].name = '刚保存的新名字';
  h.respond(newest, state); await second;
  h.respond(old, h.snapshot('a')); await first;
  assert.equal(h.actions.inspect().state.objects[0].name, '刚保存的新名字');
});

test('a read completed during a dialog preserves its draft and renders when closed', async () => {
  const h = harness(); await h.boot();
  const loading = h.actions.refresh(true), request = h.take('/api/state');
  h.actions.openCreate(); h.modal.form.values.name = '还没保存的草稿';
  const state = h.snapshot('a'); state.objects[0].name = '朋友刚改好的名字';
  h.respond(request, state); await loading;
  assert.equal(h.modal.form.values.name, '还没保存的草稿');
  assert.ok(!h.app.innerHTML.includes('朋友刚改好的名字'));
  h.actions.closeModal();
  assert.ok(h.app.innerHTML.includes('朋友刚改好的名字'));
});

test('an older submission cannot close or overwrite a replacement dialog', async () => {
  const h = harness(); await h.boot();
  h.actions.openScene(); const submitting = h.submit(), post = h.take('/api/scenes');
  h.actions.closeModal(); h.actions.openCreate();
  const draft = h.modal.form; draft.values.name = '后打开的草稿';
  h.respond(post, { ok: true }); await tick();
  h.respond(h.take('/api/state'), h.snapshot('a')); await submitting;
  assert.equal(h.modal.open, true);
  assert.equal(h.modal.form, draft);
  assert.equal(draft.values.name, '后打开的草稿');
});

test('create validates trimmed text and gift tags before uploading', async () => {
  const h = harness(); await h.boot(); h.actions.openCreate();
  const form = h.modal.form;
  form.values = { name: '   ', object_type: ' 杯子 ', text: '' };
  form.media.files = [{ name: 'cup.png', size: 10 }];
  await h.submit();
  assert.equal(h.pending.length, 0);
  assert.match(form.error.textContent, /空格/);
  form.values.name = '杯子'; form.elements.is_gift.checked = true;
  await h.submit();
  assert.equal(h.pending.length, 0);
  assert.match(form.error.textContent, /赠送者/);
});

test('retrying a failed create reuses the successful upload for the same file', async () => {
  const h = harness(); await h.boot(); h.actions.openCreate();
  const form = h.modal.form;
  form.values = { name: ' 验收杯 ', object_type: ' 杯子 ', text: '' };
  form.media.files = [{ name: 'cup.png', size: 10 }];
  const first = h.submit(); await tick();
  const upload = h.take('/api/uploads');
  assert.match(upload.options.body.getAll('upload_id')[0], /^[a-f0-9]{32}$/);
  h.respond(upload, { id: 'saved-media' }); await tick();
  const firstCreate = h.take('/api/objects');
  assert.equal(JSON.parse(firstCreate.options.body).name, '验收杯');
  h.respond(firstCreate, { error: '暂时不能创建' }, 503); await first;
  const retry = h.submit(); await tick();
  const secondCreate = h.take('/api/objects');
  assert.equal(JSON.parse(secondCreate.options.body).media_id, 'saved-media');
  h.respond(secondCreate, { error: '暂时不能创建' }, 503); await retry;
  assert.equal(h.pending.length, 0);
});

test('lost upload responses retry the same upload_id and never transfer IDs across actors', async () => {
  const upload = createUploadCache(() => 'ef'.repeat(16));
  const file = {}, sent = [];
  const send = async (value, uploadId, actor) => {
    sent.push({ value, uploadId, actor });
    if (sent.length === 1) throw new Error('connection lost after server stored upload');
    return { id: 'media-' + actor };
  };
  await assert.rejects(upload(file, 'a', send));
  assert.equal(await upload(file, 'a', send), 'media-a');
  assert.equal(sent[0].uploadId, sent[1].uploadId);
  assert.equal(await upload(file, 'a', send), 'media-a');
  assert.equal(sent.length, 2);
  assert.equal(await upload(file, 'b', send), 'media-b');
  assert.equal(sent[2].actor, 'b');
});

test('an in-flight upload and create retain the submitting actor across identity changes', async () => {
  const h = harness(); await h.boot(); h.actions.openCreate();
  h.modal.form.values = { name: '验收杯', object_type: '杯子', text: '' };
  h.modal.form.media.files = [{ name: 'cup.png', size: 10 }];
  const saving = h.submit(); await tick(); const upload = h.take('/api/uploads');
  h.actions.closeModal(); const switching = h.switchActor('b');
  h.respond(h.take('/api/session'), { ok: true }); await tick();
  h.respond(h.take('/api/state'), h.snapshot('b')); await switching;
  h.actions.openCreate(); h.modal.form.values.name = 'B的新草稿';
  h.respond(upload, { id: 'media-a' }); await tick();
  const create = h.take('/api/objects');
  assert.equal(create.options.headers['X-Demo-User'], 'a');
  h.respond(create, { id: 'created-for-a' }); await tick();
  const refresh = h.take('/api/state');
  assert.equal(refresh.options.headers['X-Demo-User'], 'b');
  h.respond(refresh, h.snapshot('b')); await saving;
  assert.equal(h.actions.inspect().actorId, 'b');
  assert.notEqual(h.actions.inspect().selected, 'created-for-a');
  assert.equal(h.modal.form.values.name, 'B的新草稿');
  assert.equal(h.modal.open, true);
});

test('a stale response sends the displayed revision and requires explicit reopening after 409', async () => {
  const h = harness('b'); await h.boot();
  const state = h.actions.inspect().state, memory = state.memories.find(item => item.kind === 'gift');
  memory.revision = 3; h.actions.openRespond(memory.id);
  const form = h.modal.form; form.values.action = 'confirm'; form.values.response = '自己的补充';
  const submitting = h.submit(), request = h.take('/api/memories/' + memory.id + '/respond');
  assert.equal(JSON.parse(request.options.body).expected_revision, 3);
  h.respond(request, { error: '记忆已更新' }, 409); await tick();
  const latest = h.snapshot('b');
  const changed = latest.memories.find(item => item.id === memory.id);
  changed.revision = 4; changed.text = '朋友修改后的新版本';
  h.respond(h.take('/api/state'), latest); await submitting;
  assert.equal(form.button.disabled, true);
  assert.equal(form.values.response, '自己的补充');
  assert.match(form.error.textContent, /关闭.*重新查看/);
  await h.submit(); assert.equal(h.pending.length, 0, '409 must not auto-retry confirmation');
  h.actions.closeModal(); h.actions.openRespond(memory.id);
  assert.equal(h.modal.form.values.expected_revision, '4');
  assert.ok(h.modal.innerHTML.includes('朋友修改后的新版本'));
});

test('legacy records use revision 1 and a completed save remains successful if refreshing fails', async () => {
  const h = harness('b'); await h.boot();
  const memory = h.actions.inspect().state.memories.find(item => item.kind === 'gift');
  delete memory.revision; h.actions.openRespond(memory.id);
  const form = h.modal.form; form.values.action = 'confirm';
  const submitting = h.submit(), request = h.take('/api/memories/' + memory.id + '/respond');
  assert.equal(JSON.parse(request.options.body).expected_revision, 1);
  h.respond(request, { ok: true }); await tick();
  h.respond(h.take('/api/state'), { error: 'temporary outage' }, 503); await submitting;
  assert.equal(h.modal.open, false);
  assert.match(h.toast.textContent, /已保存.*刷新/);
});

function llmScene(state) {
  return { mode: 'llm', topic: '验收：慢对话', memory_ids: [],
    lines: Array.from({ length: 6 }, (_, index) => ({ object_id: state.objects[index % 3].id,
      name: state.objects[index % 3].name, text: '第' + (index + 1) + '句', mood: '平静', memory_ids: [], source_note: '物品的想法与提问' })),
  };
}

test('a slow model generation announces its progress, prevents duplicates and sends no client mode', async () => {
  const h = harness(); await h.boot(); h.actions.openScene();
  const form = h.modal.form, submitting = h.submit(), post = h.take('/api/scenes');
  assert.equal(form.button.disabled, true);
  assert.equal(form.attributes['aria-busy'], 'true');
  assert.equal(form.progress.textContent, '物品们正在酝酿对话…');
  assert.equal(form.button.textContent, '物品们正在酝酿对话…');
  assert.equal(h.launcher.disabled, true);
  assert.equal(h.actions.inspect().scenePending, true);
  const payload = JSON.parse(post.options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['language', 'object_ids', 'topic']);
  assert.equal(payload.language,'zh');
  await h.submit();
  for (const click of h.handlers.click) click({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action: 'scene' } } : null } });
  assert.equal(h.pending.length, 0);
  assert.equal(h.modal.form, form, 'blocked launcher must not replace the in-flight form');
  const latest = h.snapshot('a'); latest.latest_scene = llmScene(latest);
  h.respond(post, latest.latest_scene); await tick();
  h.respond(h.take('/api/state'), latest); await submitting;
  assert.equal(h.modal.open, false);
  assert.equal(h.launcher.disabled, false);
  assert.equal(h.actions.inspect().scenePending, false);
  assert.equal(form.attributes['aria-busy'], 'false');
  assert.match(h.app.innerHTML, /AI 生成 · LLM/);
  assert.equal((h.app.innerHTML.match(/class="dialogue"/g) || []).length, 6);
  assert.match(h.toast.textContent, /AI 小剧场开场/);
});

test('a delayed model response cannot replace another identity or close its newer draft', async () => {
  const h = harness(); await h.boot(); h.actions.openScene();
  const original = h.modal.form, submitting = h.submit(), post = h.take('/api/scenes');
  h.actions.closeModal(); const switching = h.switchActor('b');
  h.respond(h.take('/api/session'), { ok: true }); await tick();
  h.respond(h.take('/api/state'), h.snapshot('b')); await switching;
  h.actions.openCreate(); const draft = h.modal.form; draft.values.name = 'B的未完成草稿';
  h.respond(post, llmScene(h.snapshot('a'))); await tick();
  const refresh = h.take('/api/state');
  assert.equal(post.options.headers['X-Demo-User'], 'a');
  assert.equal(refresh.options.headers['X-Demo-User'], 'b');
  h.respond(refresh, h.snapshot('b')); await submitting;
  assert.equal(h.actions.inspect().state.current_user_id, 'b');
  assert.equal(h.modal.open, true);
  assert.equal(h.modal.form, draft);
  assert.equal(draft.values.name, 'B的未完成草稿');
  assert.equal(draft.button.disabled, false);
  assert.equal(draft.attributes['aria-busy'], undefined);
  assert.equal(original.attributes['aria-busy'], 'false');
  assert.equal(h.actions.inspect().scenePending, false);
});

test('server fallback success is visible and retains the rule scene source links', async () => {
  const h = harness(); await h.boot(); h.actions.openScene();
  const submitting = h.submit(), post = h.take('/api/scenes'), latest = h.snapshot('a');
  latest.latest_scene = { ...llmScene(latest), mode: 'rules', fallback_reason: 'provider_error' };
  const id = latest.memories.find(memory => memory.status === 'pending').id;
  latest.latest_scene.memory_ids = [id]; latest.latest_scene.lines[0].memory_ids = [id];
  h.respond(post, latest.latest_scene); await tick();
  h.respond(h.take('/api/state'), latest); await submitting;
  assert.match(h.app.innerHTML, /规则生成 · 回退/);
  assert.match(h.app.innerHTML, /待对方确认/);
  assert.match(h.toast.textContent, /已用规则小剧场开场/);
  assert.equal(h.launcher.disabled, false);
});

test('a generation error keeps the chosen draft, restores controls and hides provider details', async () => {
  for (const status of [409, 503]) {
    const h = harness(); await h.boot(); h.actions.openScene();
    const form = h.modal.form; form.values.topic = '验收：保留这个话题';
    const submitting = h.submit(), post = h.take('/api/scenes');
    h.respond(post, { error: 'VENDOR_API_KEY provider response <internal>' }, status); await submitting;
    assert.equal(h.modal.form, form);
    assert.equal(h.modal.open, true);
    assert.equal(form.values.topic, '验收：保留这个话题');
    assert.equal(form.button.disabled, false);
    assert.equal(form.attributes['aria-busy'], 'false');
    assert.equal(form.progress.textContent, '');
    assert.equal(h.launcher.disabled, false);
    assert.equal(h.actions.inspect().busy, false);
    assert.equal(h.actions.inspect().scenePending, false);
    assert.match(form.error.textContent, /稍后/);
    assert.doesNotMatch(form.error.textContent, /VENDOR|provider|internal/);
  }
});

async function openPlayingScene() {
  const h = harness(); await h.boot(); h.actions.openScene();
  const submitting = h.submit(), latest = h.snapshot('a');
  latest.latest_scene = llmScene(latest);
  h.respond(h.take('/api/scenes'), latest.latest_scene); await tick();
  h.respond(h.take('/api/state'), latest); await submitting;
  return { h, latest };
}

test('new theater starts with one sentence and polling preserves the reading deadline', async () => {
  const { h, latest } = await openPlayingScene();
  assert.equal(h.actions.inspect().playback.visibleCount, 1);
  assert.equal(h.actions.inspect().playback.status, 'playing');
  assert.equal((h.app.innerHTML.match(/data-line-index="\d+"[^>]*hidden/g) || []).length, 5);
  const delay = readingDelay(latest.latest_scene.lines[0].text);
  h.advance(delay - 100);
  const updating = h.actions.refresh();
  h.respond(h.take('/api/state'), structuredClone(latest)); await updating;
  assert.equal(h.actions.inspect().playback.visibleCount, 1);
  h.advance(100);
  assert.equal(h.actions.inspect().playback.visibleCount, 2);
});

test('source inspection pauses playback and return retains position without a model request', async () => {
  const { h, latest } = await openPlayingScene();
  const count = h.actions.inspect().playback.visibleCount;
  h.click('source', { id: latest.memories[0].id }, true);
  assert.equal(h.actions.inspect().view, 'memories');
  assert.equal(h.actions.inspect().playback.status, 'paused');
  assert.match(h.app.innerHTML, /返回小剧场/);
  h.advance(60000);
  h.click('playback-return');
  assert.equal(h.actions.inspect().view, 'home');
  assert.equal(h.actions.inspect().playback.visibleCount, count);
  assert.equal(h.actions.inspect().playback.status, 'paused');
  h.click('playback-next');
  assert.equal(h.actions.inspect().playback.visibleCount, count + 1);
  assert.equal(h.actions.inspect().playback.status, 'paused');
  h.click('playback-finish');
  assert.equal(h.actions.inspect().playback.status, 'complete');
  h.click('playback-replay');
  assert.equal(h.actions.inspect().playback.visibleCount, 1);
  assert.equal(h.pending.length, 0, 'reading controls must not call the backend');
});

test('modal, navigation and a hidden tab stop automatic reading', async () => {
  for (const action of ['modal', 'nav', 'hidden']) {
    const { h } = await openPlayingScene();
    if (action === 'modal') h.actions.openCreate();
    if (action === 'nav') h.click('nav', { view: 'people' });
    if (action === 'hidden') h.hide();
    h.advance(60000);
    assert.equal(h.actions.inspect().playback.visibleCount, 1, action);
    assert.equal(h.actions.inspect().playback.status, 'paused', action);
  }
});

test('history loads in full while a changed memory clears both playback and the source return', async () => {
  const h = harness(), latest = h.snapshot('a'); latest.latest_scene = llmScene(latest);
  latest.latest_scene.memory_ids = [latest.memories[0].id];
  latest.latest_scene.memory_snapshots = [structuredClone(latest.memories[0])];
  h.respond(h.take('/api/state'), latest); await tick();
  assert.equal(h.actions.inspect().playback.status, 'complete');
  h.click('playback-replay');
  h.click('source', { id: latest.memories[0].id }, true);
  const updated = structuredClone(latest); updated.memories[0].text = '刚修改的新记忆';
  const loading = h.actions.refresh(); h.respond(h.take('/api/state'), updated); await loading;
  assert.equal(h.actions.inspect().playback.status, 'idle');
  assert.equal(h.actions.inspect().returnSceneKey, null);
  assert.doesNotMatch(h.app.innerHTML, /返回小剧场/);
  h.advance(60000);
  assert.equal(h.actions.inspect().playback.visibleCount, 0);
});

test('leaving a generation dialog never starts an unsolicited performance', async () => {
  const h = harness(); await h.boot(); h.actions.openScene();
  const submitting = h.submit(), post = h.take('/api/scenes'), latest = h.snapshot('a');
  latest.latest_scene = llmScene(latest);
  h.actions.closeModal(); h.click('nav', { view: 'people' });
  h.respond(post, latest.latest_scene); await tick();
  h.respond(h.take('/api/state'), latest); await submitting;
  assert.equal(h.actions.inspect().view, 'people');
  assert.equal(h.actions.inspect().playback.status, 'complete');
  h.advance(60000);
  assert.equal(h.actions.inspect().playback.visibleCount, 6);
});

test('language toggle changes the same scene text and mood while preserving paused progress and citations',async()=>{
 const {h,latest}=await openPlayingScene();
 const english={topic:'A little shared story',lines:latest.latest_scene.lines.map((line,index)=>({text:'I would love to hear your side of the story. '+index,mood:'curious'}))};
 const translated=structuredClone(latest);translated.latest_scene.localized={en:english};
 const update=h.actions.refresh();h.respond(h.take('/api/state'),translated);await update;
 const before=h.actions.inspect().playback;
 try{
  h.click('language',{language:'en'});
  assert.equal(h.actions.inspect().playback.visibleCount,before.visibleCount);assert.equal(h.actions.inspect().playback.status,'paused');assert.equal(h.actions.inspect().playback.sceneKey,before.sceneKey);
  assert.match(h.app.innerHTML,/I would love to hear your side/);assert.match(h.app.innerHTML,/curious/);assert.match(h.app.innerHTML,/Memory drawer/);assert.equal(h.pending.length,0);
  const poll=h.actions.refresh();h.respond(h.take('/api/state'),structuredClone(latest));await poll;
  assert.match(h.app.innerHTML,/I would love to hear your side/,'an older poll cannot remove the completed translation cache');
  h.click('language',{language:'zh'});assert.doesNotMatch(h.app.innerHTML,/<p>I would love to hear your side/);assert.equal(h.actions.inspect().playback.visibleCount,before.visibleCount);
 }finally{setLanguage('zh');}
});

test('legacy scene translation arriving after another language choice is cached without replacing the active language',async()=>{
 const {h,latest}=await openPlayingScene();const id=latest.latest_scene.id,count=h.actions.inspect().playback.visibleCount;
 try{
  h.click('language',{language:'en'});const request=h.take('/api/scenes/'+id+'/language');assert.equal(JSON.parse(request.options.body).language,'en');assert.match(h.app.innerHTML,/Synchronizing scene language/);assert.doesNotMatch(h.app.innerHTML,/<p>验收台词/);
  h.click('language',{language:'zh'});h.respond(request,{id,localized:{en:{topic:'A little shared story',lines:latest.latest_scene.lines.map(()=>({text:'I would love to hear your side.',mood:'curious'}))}}});await tick();
  assert.equal(getLanguage(),'zh');assert.equal(h.actions.inspect().playback.visibleCount,count);assert.doesNotMatch(h.app.innerHTML,/<p>I would love to hear your side/);
  h.click('language',{language:'en'});assert.equal(h.pending.length,0);assert.match(h.app.innerHTML,/<p>I would love to hear your side/);assert.equal(h.actions.inspect().playback.visibleCount,count);
 }finally{setLanguage('zh');}
});


test('collection multi-selection carries exactly the chosen companions into the scene', async()=>{
 const h=harness();await h.boot();h.click('pick-mode');h.click('pick-companion',{id:'cup'});h.click('pick-companion',{id:'keys'});
 assert.deepEqual(Array.from(h.actions.inspect().collectionPicks),['cup','keys']);assert.match(h.app.innerHTML,/aria-pressed="true"/);assert.match(h.app.innerHTML,/已选 2\/3/);
 h.click('scene-picked');assert.deepEqual(h.modal.form.checks.filter(input=>input.checked).map(input=>input.value),['cup','keys']);
 const cup=h.modal.form.checks.find(input=>input.value==='cup');cup.checked=false;await h.handlers.change[0]({target:cup});h.actions.closeModal();
 assert.deepEqual(Array.from(h.actions.inspect().collectionPicks),['keys']);assert.match(h.app.innerHTML,/已选 1\/3/);
});

test('collection selection limits three, allows replacing and keeps ordinary memory viewing separate', async()=>{
 const h=harness(),state=h.snapshot('a');state.objects.push({...state.objects[0],id:'four',name:'晚安灯'});h.respond(h.take('/api/state'),state);await tick();
 h.click('pick-mode');for(const id of ['cup','keys','leaf'])h.click('pick-companion',{id});h.click('pick-companion',{id:'four'});
 assert.deepEqual(Array.from(h.actions.inspect().collectionPicks),['cup','keys','leaf']);assert.match(h.toast.textContent,/最多选择三位/);
 h.click('pick-remove',{id:'keys'});h.click('pick-companion',{id:'four'});h.click('pick-mode');h.click('select',{id:'keys'});
 assert.equal(h.actions.inspect().selected,'keys');assert.equal(h.actions.inspect().pickingCompanions,false);
 h.actions.openScene();assert.deepEqual(h.modal.form.checks.filter(input=>input.checked).map(input=>input.value),['cup','leaf','four']);
});

test('multi-selection survives collection search, pagination and language changes without translating names', async()=>{
 const h=harness(),state=h.snapshot('a');for(let i=3;i<10;i++)state.objects.push({...state.objects[0],id:'item'+i,name:i===3?'清除选择小伙伴':'伙伴'+i});h.respond(h.take('/api/state'),state);await tick();
 try{
  h.click('pick-mode');h.click('pick-companion',{id:'cup'});h.handlers.input[0]({target:{id:'collection-query',value:'清除选择小伙伴'}});h.click('pick-companion',{id:'item3'});
  h.handlers.input[0]({target:{id:'collection-query',value:''}});h.click('library-next');h.click('pick-companion',{id:'item7'});
  assert.deepEqual(Array.from(h.actions.inspect().collectionPicks),['cup','item3','item7']);
  h.click('language',{language:'en'});assert.match(h.app.innerHTML,/Done selecting/);assert.match(h.app.innerHTML,/Selected 3\/3/);assert.match(h.app.innerHTML,/清除选择小伙伴/);assert.match(h.app.innerHTML,/Start a scene together/);
  h.click('scene-picked');assert.deepEqual(h.modal.form.checks.filter(input=>input.checked).map(input=>input.value),['cup','item3','item7']);
 }finally{setLanguage('zh');}
});

test('clearing selection and a room refresh do not resurrect removed companions',async()=>{
 const h=harness();await h.boot();h.click('pick-mode');h.click('pick-companion',{id:'keys'});h.click('pick-companion',{id:'leaf'});
 const state=h.snapshot('a');state.objects=state.objects.filter(o=>o.id!=='keys');const refreshing=h.actions.refresh();h.respond(h.take('/api/state'),state);await refreshing;
 assert.deepEqual(Array.from(h.actions.inspect().collectionPicks),['leaf']);h.click('pick-clear');assert.equal(h.actions.inspect().collectionPicks.length,0);h.click('scene-picked');assert.equal(h.modal.open,false);assert.match(h.toast.textContent,/至少一位/);
});

test('switching accounts clears the collection cast draft',async()=>{
 const h=harness();await h.boot();h.click('pick-mode');h.click('pick-companion',{id:'cup'});const switching=h.switchActor('b');h.respond(h.take('/api/session'),{ok:true});await tick();h.respond(h.take('/api/state'),h.snapshot('b'));await switching;
 assert.equal(h.actions.inspect().collectionPicks.length,0);assert.equal(h.actions.inspect().pickingCompanions,false);
});
