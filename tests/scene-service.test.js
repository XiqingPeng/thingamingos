import test from 'node:test';
import assert from 'node:assert/strict';
import { mutate } from '../lib/domain.js';
import { repository } from '../lib/store.js';
import { createScene, DEFAULT_SCENE_LIMITS } from '../lib/scene-service.js';

const gift = '00000000000000000000000000000001';
const promise = '00000000000000000000000000000002';
const initialTime = Date.parse('2026-11-14T08:00:00.000Z');
class BlobAlreadyExistsError extends Error {}
class BlobPreconditionFailedError extends Error {}
function fixture() {
  const files = new Map(); let conflicts = 0, forcedConflicts = 0, time = initialTime;
  const driver = {
    async get(path) {
      const record = files.get(path);
      await new Promise(resolve => setImmediate(resolve));
      return record ? { statusCode: 200, blob: { etag: `"${record.etag}"` }, stream: new Response(record.text).body } : null;
    },
    async put(path, value, options) {
      const previous = files.get(path);
      if (forcedConflicts) { forcedConflicts--; conflicts++; throw new BlobPreconditionFailedError(); }
      if (!options.allowOverwrite && previous) { conflicts++; throw new BlobAlreadyExistsError(); }
      if (options.ifMatch && options.ifMatch !== previous?.etag) { conflicts++; throw new BlobPreconditionFailedError(); }
      files.set(path, { text: value, etag: String(Number(previous?.etag || 0) + 1) });
    },
  };
  const repo = repository(driver);
  const request = { repository: repo, room: 'test-room', actor: 'a', data: { object_ids: ['cup'], topic: '礼物' }, clock: () => time, logger: {} };
  return { repo, driver, request, files, setTime(value) { time = value; }, advance(ms) { time += ms; },
    forceConflicts(count) { forcedConflicts = count; }, get conflicts() { return conflicts; } };
}
function answer(context) {
  const lines = [0, 1].flatMap(round => context.objects.map(object => ({ object_id: object.id,
    text: round ? '听了你的想法，我也想问问，你愿意再讲讲那份心意吗？' : '我把这份心意放在心上，也想听听你自己的说法。',
    mood: round ? '好奇' : '温柔', memory_ids: context.memories.filter(memory => memory.object_id === object.id).slice(0, 1).map(memory => memory.id) })));
  return { lines, model: 'test/model', usage: { input_tokens: 50, output_tokens: 20 } };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('configured model gets selected, eligible context and saves two grounded rounds with server attribution', async () => {
  const f = fixture();
  await f.repo.update(f.request.room, state => {
    state.memories.find(memory => memory.id === gift).response = 'unconfirmed-response-must-not-be-shared';
    state.memories.push({ ...state.memories[0], id: 'd'.repeat(32), status: 'declined', text: 'rejected secret' });
  });
  let calls = 0;
  const scene = await createScene({ ...f.request, generate: async context => {
    calls++;
    assert.deepEqual(context.objects.map(object => object.id), ['cup']);
    assert.ok(context.memories.every(memory => memory.object_id === 'cup' && memory.status !== 'declined'));
    assert.equal(context.memories.find(memory => memory.id === gift).response, '');
    const result = answer(context);
    result.lines[0].name = '伪造名字'; result.lines[0].source_note = '已经替小北确认';
    result.memories = []; result.mode = 'rules';
    return result;
  } });
  assert.equal(calls, 1); assert.equal(scene.mode, 'llm'); assert.equal(scene.lines.length, 2);
  assert.equal(scene.lines[0].name, '老朋友'); assert.equal(scene.lines[0].source_note, '小满的记录，待小北确认');
  assert.equal(scene.memory_revisions[gift], 1); assert.ok(scene.context_memory_ids.includes(promise));
  const state = (await f.repo.read(f.request.room)).state;
  assert.equal(state.memories.find(memory => memory.id === gift).status, 'pending');
  assert.equal(state.memories.length, 5); assert.equal(state.scene_generation.day_count, 1); assert.equal(state.scene_generation.lease, null);
});

test('unconfigured provider and exhausted allowance use working rules without calling a model', async () => {
  const f = fixture();
  let calls = 0;
  const first = await createScene(f.request);
  assert.equal(first.mode, 'rules'); assert.equal(first.fallback_reason, 'unconfigured');
  assert.equal((await f.repo.read(f.request.room)).state.scene_generation, undefined);
  const generate = async context => { calls++; return answer(context); };
  await createScene({ ...f.request, generate, limits: { perHour: 1 } });
  f.advance(60_000);
  const second = await createScene({ ...f.request, generate, limits: { perHour: 1 } });
  assert.equal(second.mode, 'rules'); assert.equal(second.fallback_reason, 'rate_limited'); assert.equal(calls, 1);
  // Persisted allowance works for a new repository instance (a new function invocation).
  const third = await createScene({ ...f.request, repository: repository(f.driver), generate, limits: { perHour: 1 } });
  assert.equal(third.fallback_reason, 'rate_limited'); assert.equal(calls, 1);
});

test('hourly allowance resets without bypassing daily count, and a new UTC day resets both', async () => {
  const f = fixture(); let calls = 0;
  const options = { ...f.request, limits: { perHour: 1, perDay: 2 }, generate: async context => { calls++; return answer(context); } };
  await createScene(options);
  f.advance(3_600_000); await createScene(options);
  f.advance(3_600_000);
  assert.equal((await createScene(options)).fallback_reason, 'rate_limited'); assert.equal(calls, 2);
  f.setTime(Date.parse('2026-11-15T00:00:00.000Z'));
  assert.equal((await createScene(options)).mode, 'llm'); assert.equal(calls, 3);
});

test('single-flight room lease prevents concurrent model calls even across first-write conflicts', async () => {
  const f = fixture(), started = deferred(), release = deferred(); let calls = 0;
  const generate = async context => { calls++; started.resolve(); await release.promise; return answer(context); };
  const first = createScene({ ...f.request, generate });
  await started.promise;
  await assert.rejects(createScene({ ...f.request, actor: 'b', repository: repository(f.driver), generate }), { status: 409 });
  assert.equal(calls, 1); release.resolve(); assert.equal((await first).mode, 'llm');
  assert.equal((await f.repo.read(f.request.room)).state.scene_generation.day_count, 1);
});

test('simultaneous uninitialized-room requests reserve one call using Blob compare-and-swap', async () => {
  const f = fixture(), started = deferred(), release = deferred(); let calls = 0;
  const generate = async context => { calls++; started.resolve(); await release.promise; return answer(context); };
  const one = createScene({ ...f.request, generate });
  const two = createScene({ ...f.request, repository: repository(f.driver), actor: 'b', generate });
  const results = Promise.allSettled([one, two]);
  const firstSettled = Promise.race([one, two].map(promise => promise.then(
    value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))));
  await started.promise;
  assert.equal((await firstSettled).status, 'rejected', 'the contender must finish while the lease holder is still generating');
  release.resolve();
  const settled = await results;
  assert.equal(calls, 1); assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(settled.find(result => result.status === 'rejected').reason.status, 409); assert.ok(f.conflicts >= 1);
});

test('Blob retries during reservation and final save do not repeat model billing or count', async () => {
  const f = fixture(); let calls = 0;
  f.forceConflicts(2);
  const scene = await createScene({ ...f.request, generate: async context => { calls++; f.forceConflicts(2); return answer(context); } });
  assert.equal(scene.mode, 'llm'); assert.equal(calls, 1); assert.equal(f.conflicts, 4);
  assert.equal((await f.repo.read(f.request.room)).state.scene_generation.day_count, 1);
});

test('provider failure returns attributed rules, releases lease and still counts attempted work', async () => {
  const f = fixture();
  const scene = await createScene({ ...f.request, generate: async () => { throw new Error('provider private details'); } });
  assert.equal(scene.mode, 'rules'); assert.equal(scene.fallback_reason, 'provider_error');
  assert.ok(scene.lines[0].text.includes('小满记得'));
  assert.ok(!JSON.stringify(scene).includes('provider private details'));
  const state = (await f.repo.read(f.request.room)).state;
  assert.equal(state.scene_generation.day_count, 1); assert.equal(state.scene_generation.lease, null);
});

test('unknown IDs, unselected speakers, fabricated confirmations and missing grounding fall back safely', async () => {
  const alterations = [
    output => { output.lines[0].memory_ids = ['f'.repeat(32)]; },
    output => { output.lines[0].object_id = 'leaf'; },
    output => { output.lines[0].text = '这份礼物双方已经确认。'; },
    output => { output.lines[0].text = '我们都记得这件事确实发生。'; },
    output => { for (const line of output.lines) line.memory_ids = []; },
    output => { output.lines.pop(); },
  ];
  for (const alter of alterations) {
    const f = fixture();
    const scene = await createScene({ ...f.request, generate: async context => { const output = answer(context); alter(output); return output; } });
    assert.equal(scene.mode, 'rules'); assert.equal(scene.fallback_reason, 'invalid_output');
    assert.equal((await f.repo.read(f.request.room)).state.memories.find(memory => memory.id === gift).status, 'pending');
  }
});

test('all supplied memories, including an uncited record, are rechecked before save', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const running = createScene({ ...f.request, generate: async context => {
    assert.ok(context.memories.some(memory => memory.id === promise));
    const output = answer(context); assert.ok(output.lines.every(line => !line.memory_ids.includes(promise)));
    entered.resolve(); await release.promise; return output;
  } });
  await entered.promise;
  await f.repo.update(f.request.room, state => mutate(state, `memories/${promise}/edit`, { text: '约定已经改成在家休息' }, 'a'));
  release.resolve(); const scene = await running;
  assert.equal(scene.mode, 'rules'); assert.equal(scene.fallback_reason, 'context_changed');
  assert.equal(scene.memory_revisions[promise], 2);
});

test('confirmation or rejection without a revision increment invalidates an in-flight generation', async () => {
  for (const action of ['confirm', 'decline']) {
    const f = fixture(), entered = deferred(), release = deferred();
    const running = createScene({ ...f.request, generate: async context => { entered.resolve(); await release.promise; return answer(context); } });
    await entered.promise;
    await f.repo.update(f.request.room, state => mutate(state, `memories/${gift}/respond`, { expected_revision: 1, action, response: '这才是我自己的说法' }, 'b'));
    release.resolve(); const scene = await running;
    assert.equal(scene.mode, 'rules'); assert.equal(scene.fallback_reason, 'context_changed');
    if (action === 'decline') assert.ok(!scene.memory_ids.includes(gift));
    else assert.ok(scene.lines[0].text.includes('这才是我自己的说法'));
  }
});

test('deleted context and changed selected-object personality cannot be resurrected by a delayed model', async () => {
  for (const change of ['forget', 'personality']) {
    const f = fixture(), entered = deferred(), release = deferred();
    const running = createScene({ ...f.request, generate: async context => { entered.resolve(); await release.promise; return answer(context); } });
    await entered.promise;
    await f.repo.update(f.request.room, state => {
      if (change === 'forget') mutate(state, `memories/${gift}/forget`, {}, 'a');
      else state.objects.find(object => object.id === 'cup').personality = '理性，善于分析';
    });
    release.resolve(); const scene = await running;
    assert.equal(scene.mode, 'rules'); assert.equal(scene.fallback_reason, 'context_changed');
    if (change === 'forget') assert.ok(!scene.context_memory_ids.includes(gift));
  }
});

test('provider mutations cannot rewrite the captured snapshot or stored source state', async () => {
  const f = fixture();
  const scene = await createScene({ ...f.request, generate: async context => {
    const output = answer(context);
    context.memories[0].status = 'confirmed'; context.memories[0].text = 'forged'; context.objects[0].name = 'forged';
    return output;
  } });
  assert.equal(scene.mode, 'llm'); assert.equal(scene.lines[0].name, '老朋友');
  assert.equal(scene.memory_snapshots.find(memory => memory.id === gift).status, 'pending');
  assert.notEqual((await f.repo.read(f.request.room)).state.memories.find(memory => memory.id === gift).text, 'forged');
});

test('expired lease permits recovery and the old provider result cannot replace a newer scene', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const old = createScene({ ...f.request, generate: async context => { entered.resolve(); await release.promise; return answer(context); } });
  await entered.promise; f.advance(DEFAULT_SCENE_LIMITS.leaseMs + 1);
  const fresh = await createScene({ ...f.request, generate: async context => answer(context) });
  release.resolve(); await assert.rejects(old, { status: 409 });
  assert.equal((await f.repo.read(f.request.room)).state.latest_scene.id, fresh.id);
});

test('different rooms keep independent leases and budgets and never share context', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  await f.repo.update('other-room', state => { state.objects[0].name = '另一个小屋的杯子'; });
  const first = createScene({ ...f.request, generate: async context => { entered.resolve(); await release.promise; return answer(context); } });
  await entered.promise;
  const second = await createScene({ ...f.request, room: 'other-room', generate: async context => {
    assert.equal(context.objects[0].name, '另一个小屋的杯子'); return answer(context);
  } });
  release.resolve(); await first;
  assert.equal(second.mode, 'llm');
  assert.equal((await f.repo.read('other-room')).state.scene_generation.day_count, 1);
});

test('invalid requests never reserve quota or call the provider', async () => {
  const f = fixture(); let called = false;
  await assert.rejects(createScene({ ...f.request, data: { object_ids: ['cup', 'cup'] }, generate: async () => { called = true; } }), { status: 400 });
  await assert.rejects(createScene({ ...f.request, actor: 'unknown', generate: async () => { called = true; } }), { status: 403 });
  assert.equal(called, false); assert.equal(f.files.size, 0);
});

test('observability records only allowlisted error codes and aggregate usage, never prompt or raw errors', async () => {
  const f = fixture(), logs = [];
  const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  const privateError = Object.assign(new Error('secret prompt and credential'), { name: 'SceneModelError', code: 'authentication', stack: 'private stack' });
  await createScene({ ...f.request, logger, generate: async () => { throw privateError; } });
  assert.ok(logs.some(([, metadata]) => metadata.code === 'authentication'));
  assert.ok(!JSON.stringify(logs).includes('secret')); assert.ok(!JSON.stringify(logs).includes('private stack'));
  f.advance(60_000);
  await createScene({ ...f.request, logger, generate: async context => answer(context) });
  assert.ok(logs.some(([, metadata]) => metadata.mode === 'llm' && metadata.model === 'test/model'
    && metadata.input_tokens === 50 && metadata.output_tokens === 20));
  assert.ok(!JSON.stringify(logs).includes('小北')); assert.ok(!JSON.stringify(logs).includes(gift));
});
