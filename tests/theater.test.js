import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seed, mutate, USERS } from '../lib/domain.js';
import { buildScene } from '../lib/theater.js';

const GIFT = '10000000000000000000000000000001';
const WORK = '10000000000000000000000000000002';
const KEY = '10000000000000000000000000000003';
const LEAF = '10000000000000000000000000000004';
const giftText = '小北送了我一份生日礼物：这个蓝色杯子，我一直珍藏着。';
const workText = '昨晚加班赶项目，杯子陪我工作到深夜两点。';
const negatedPersonalityCases = [
  ['不太喜欢吐槽，温柔', '温柔'],
  ['不算活泼，很安静', '安静'],
  ['不是很害羞，理性', '理性'],
  ['并非乐观，认真', '认真'],
  ['not really shy, rational', 'rational'],
  ["isn't shy, very lively", 'lively'],
  ['not shy, rational', 'rational'],
  ['not very playful, caring', 'caring'],
];
const excludedTopicCases = [
  ['不聊生日礼物，只聊工作加班', '工作加班'],
  ['不是生日礼物，而是工作加班', '工作加班'],
  ['not birthday gift, only overtime work', 'overtime work'],
  ['not birthday gift but overtime work', 'overtime work'],
];

function memory(id, object_id, text, extra = {}) {
  return { id, object_id, author_id: 'a', text, tagged_user_id: null,
    status: 'recorded', kind: 'story', response: '',
    created_at: '2026-11-14T02:00:00.000Z', responded_at: null, ...extra };
}

function fixture(personality = '温柔，细心，关心别人') {
  const s = seed();
  s.objects.find(o => o.id === 'cup').personality = personality;
  s.objects.find(o => o.id === 'keys').personality = '理性，认真，说话有条理';
  s.objects.find(o => o.id === 'leaf').personality = '活泼，乐观，热情';
  s.memories = [
    memory(GIFT, 'cup', giftText, { tagged_user_id: 'b', status: 'pending', kind: 'gift' }),
    memory(WORK, 'cup', workText, { tagged_user_id: 'b', status: 'confirmed',
      response: '我也在一起改那个项目。', created_at: '2026-11-14T03:00:00.000Z',
      responded_at: '2026-11-14T03:30:00.000Z' }),
    memory(KEY, 'keys', '完成报告后，大家一起关掉了办公室的灯。'),
    memory(LEAF, 'leaf', '周末在公园拍照，绿萝的新叶迎着阳光。', { author_id: 'b' }),
  ];
  s.latest_scene = null;
  return s;
}

const scene = (s, topic = '生日礼物', selected = ['cup']) =>
  mutate(s, 'scenes', { topic, object_ids: selected }, 'a');
const sourceLines = result => result.lines.filter(line => line.memory_ids.length);
const dialogue = result => result.lines.map(line => line.text).join('\n');
const normalizeLines = lines => lines.map(({ object_id, name, text, mood, memory_ids }) =>
  ({ object_id, name, text, mood, memory_ids }));

function assertPendingAttribution(result) {
  const line = sourceLines(result).find(item => item.memory_ids.includes(GIFT));
  assert.ok(line, 'the selected pending memory keeps its source');
  assert.match(line.text, /小满/, 'the recording author remains visible');
  assert.match(line.text, /小北/, 'the tagged participant remains visible');
  assert.match(line.text, /等待|等|待回应|尚未|还未|未确认/, 'pending status remains explicit');
  assert.doesNotMatch(line.text, /双方(?:都|已|已经)?确认|你们两个人都确认|两人都确认/,
    'pending recollections must not become jointly confirmed facts');
}

test('personality changes both dialogue and mood without changing memory facts or attribution', () => {
  const traits = ['温柔，细心，关心别人', '理性，认真，说话有条理', '活泼，乐观，热情'];
  const results = traits.map(trait => scene(fixture(trait)));
  assert.equal(new Set(results.map(dialogue)).size, traits.length);
  assert.equal(new Set(results.map(r => r.lines[0].mood)).size, traits.length);
  for (const result of results) {
    assert.equal(result.mode, 'rules');
    assert.deepEqual(result.memory_ids, [GIFT]);
    assert.ok(dialogue(result).includes(giftText), 'the quoted source is preserved verbatim');
    assertPendingAttribution(result);
  }
});

test('negated Chinese and English traits cannot override the remaining positive personality', () => {
  for (const [description, positive] of negatedPersonalityCases) {
    const actual = scene(fixture(description));
    const expected = scene(fixture(positive));
    assert.deepEqual(normalizeLines(actual.lines), normalizeLines(expected.lines), description);
    assertPendingAttribution(actual);
    assert.deepEqual(actual.memory_ids, [GIFT], description);
  }
});

test('Chinese and English topics select relevant birthday or overtime memories', () => {
  for (const [topic, expected] of [
    ['生日礼物', GIFT], ['birthday gift', GIFT],
    ['工作加班', WORK], ['overtime work', WORK],
  ]) {
    const result = scene(fixture(), topic);
    assert.deepEqual(result.memory_ids, [expected], topic);
    assert.ok(dialogue(result).includes(expected === GIFT ? giftText : workText), topic);
  }
});

test('explicitly excluded topics affect neither the selected source nor the substantive follow-up', () => {
  const lastQuestion = result => {
    const match = result.lines[0].text.match(/[^。！？]*[？?]$/u);
    assert.ok(match, 'the response ends with a substantive question');
    return match[0];
  };
  for (const [description, positive] of excludedTopicCases) {
    const actual = scene(fixture(), description);
    const expected = scene(fixture(), positive);
    assert.deepEqual(actual.memory_ids, [WORK], description);
    assert.ok(dialogue(actual).includes(workText), description);
    assert.ok(!dialogue(actual).includes(giftText), description);
    assert.equal(lastQuestion(actual), lastQuestion(expected), description);
  }
});

test('a relevant pending memory beats an unrelated confirmed one while retaining attribution', () => {
  const result = scene(fixture(), '生日礼物');
  assert.deepEqual(result.memory_ids, [GIFT]);
  assertPendingAttribution(result);
  assert.ok(!dialogue(result).includes('我也在一起改那个项目。'));
});

test('topic affects the response even when there is only one available memory', () => {
  const s = fixture();
  s.memories = s.memories.filter(m => m.id === GIFT);
  const gift = scene(structuredClone(s), '生日礼物');
  const work = scene(structuredClone(s), '工作加班');
  const stripLiteralTopic = result => dialogue(result).replaceAll(result.topic, 'TOPIC');
  assert.notEqual(stripLiteralTopic(gift), stripLiteralTopic(work),
    'changing only the topic title or literal topic interpolation is insufficient');
  for (const result of [gift, work]) {
    assert.deepEqual(result.memory_ids, [GIFT]);
    assertPendingAttribution(result);
  }
});

test('confirmation retains both participants and their response; editing resets them safely', () => {
  const s = fixture();
  const response = '生日那天我挑了很久，希望这个杯子陪你很多年。';
  mutate(s, `memories/${GIFT}/respond`, { expected_revision: 1, action: 'confirm', response }, 'b');
  const confirmed = scene(s);
  assert.ok(dialogue(confirmed).includes(response));
  assert.match(dialogue(confirmed), /小满/);
  assert.match(dialogue(confirmed), /小北/);
  assert.match(dialogue(confirmed), /确认/);
  assert.deepEqual(confirmed.memory_ids, [GIFT]);

  const updated = '更正一下，这是毕业时收到的生日礼物，是一个绿色杯子。';
  mutate(s, `memories/${GIFT}/edit`, { text: updated }, 'a');
  assert.equal(s.latest_scene, null);
  assert.equal(s.memories.find(m => m.id === GIFT).status, 'pending');
  const edited = scene(s);
  assertPendingAttribution(edited);
  assert.ok(dialogue(edited).includes(updated));
  assert.ok(!dialogue(edited).includes(giftText));
  assert.ok(!dialogue(edited).includes(response), 'an obsolete response is not repeated');
});

test('declining and forgetting exclude the source and invalidate the saved scene', () => {
  for (const operation of ['decline', 'forget']) {
    const s = fixture();
    scene(s);
    if (operation === 'decline') {
      mutate(s, `memories/${GIFT}/respond`, { expected_revision: 1, action: 'decline', response: '那不是我送的。' }, 'b');
    } else {
      mutate(s, `memories/${GIFT}/forget`, {}, 'a');
    }
    assert.equal(s.latest_scene, null, operation);
    const after = scene(s);
    assert.ok(!after.memory_ids.includes(GIFT), operation);
    assert.ok(after.lines.every(line => !line.memory_ids.includes(GIFT)), operation);
    assert.ok(!dialogue(after).includes(giftText), operation);
    assert.ok(!dialogue(after).includes('那不是我送的。'), operation);
  }
});

test('unknown free-text personalities fall back deterministically without changing facts', () => {
  const s = fixture('像冬天早晨的雾一样，喜欢收集问号');
  const first = scene(structuredClone(s));
  const second = scene(structuredClone(s));
  assert.deepEqual(normalizeLines(first.lines), normalizeLines(second.lines));
  assert.ok(first.lines.every(line => typeof line.text === 'string' && line.text.length > 0));
  assertPendingAttribution(first);
  assert.deepEqual(first.memory_ids, [GIFT]);
  assert.ok(dialogue(first).includes(giftText));
});

test('one to three actors follow selection order and never borrow another objects source', () => {
  for (const selected of [['leaf'], ['keys', 'cup'], ['leaf', 'cup', 'keys']]) {
    const s = fixture();
    const result = scene(s, '今天有什么想说的', selected);
    const appearanceOrder = [...new Set(result.lines.map(line => line.object_id))];
    assert.deepEqual(appearanceOrder, selected);
    for (const line of result.lines) {
      assert.ok(selected.includes(line.object_id));
      for (const id of line.memory_ids) {
        const memory = s.memories.find(item => item.id === id);
        assert.ok(memory, 'every source exists');
        assert.equal(memory.object_id, line.object_id, 'a speaker cites only its own memory');
        assert.ok(line.text.includes(memory.text));
      }
      for (const other of s.memories.filter(item => item.object_id !== line.object_id)) {
        assert.ok(!line.text.includes(other.text), 'facts do not leak between speakers');
      }
    }
    assert.deepEqual(result.memory_ids, [...new Set(result.lines.flatMap(line => line.memory_ids))]);
  }
});

test('unknown topics and no eligible memories cannot invent citations or revive rejected stories', () => {
  const s = fixture();
  s.memories = [memory(GIFT, 'cup', '去年我们坐飞船去火星种了土豆。',
    { tagged_user_id: 'b', status: 'declined' })];
  const result = scene(s, '去火星种土豆');
  assert.deepEqual(result.memory_ids, []);
  assert.ok(result.lines.every(line => line.memory_ids.length === 0));
  assert.ok(!dialogue(result).includes(s.memories[0].text));
  assert.ok(!dialogue(result).includes(giftText));
  assert.match(dialogue(result), /[？?]|想|愿|希望|如果|讲|听/,
    'a source-free response stays in questions, wishes or invitations');
  assert.equal(result.mode, 'rules');
});

test('Python and Node produce equivalent lines for personalities, topics, sources and actor order', () => {
  const cases = [];
  for (const trait of ['温柔，细心，关心别人', '理性，认真，说话有条理', '活泼，乐观，热情', '像雾一样']) {
    for (const topic of ['生日礼物', 'birthday gift', '工作加班', 'overtime work', '去火星种土豆']) {
      cases.push({ state: fixture(trait), selected: ['cup'], topic, users: USERS });
    }
  }
  for (const [description, positive] of negatedPersonalityCases) {
    for (const trait of [description, positive]) {
      cases.push({ state: fixture(trait), selected: ['cup'], topic: '生日礼物', users: USERS });
    }
  }
  for (const [description, positive] of excludedTopicCases) {
    for (const topic of [description, positive]) {
      cases.push({ state: fixture(), selected: ['cup'], topic, users: USERS });
    }
  }
  cases.push({ state: fixture(), selected: ['leaf', 'cup', 'keys'], topic: '周末公园', users: USERS });
  const empty = fixture(); empty.memories = [];
  cases.push({ state: empty, selected: ['keys', 'leaf'], topic: '从未聊过的话题', users: USERS });
  const declined = fixture(); declined.memories.find(m => m.id === GIFT).status = 'declined';
  cases.push({ state: declined, selected: ['cup'], topic: '生日礼物', users: USERS });
  const expected = cases.map(c => normalizeLines(buildScene(structuredClone(c.state),
    { object_ids: c.selected, topic: c.topic }).lines));
  const python = spawnSync('python3', ['-B', '-c', [
    'import json, sys',
    'from theater import compose_lines',
    'cases = json.load(sys.stdin)',
    'result = [compose_lines(c["state"], c["selected"], c["topic"], c["users"]) for c in cases]',
    'print(json.dumps(result, ensure_ascii=False))',
  ].join('\n')], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    input: JSON.stringify(cases), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(python.error);
  assert.equal(python.status, 0, python.stderr);
  const actual = JSON.parse(python.stdout).map(normalizeLines);
  assert.deepEqual(actual, expected);
});
