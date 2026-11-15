"""Pure rules theater, sharing vocabulary with the cloud implementation."""
import json
import re
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent / 'lib' / 'theater-rules.json').read_text(encoding='utf-8'))


def term_positions(value, term):
    pattern = re.escape(term)
    if re.fullmatch('[a-z ]+', term):
        # Match the ASCII word boundaries used by JavaScript, also beside Chinese text.
        pattern = r'(?<![a-z0-9_])' + pattern + r'(?![a-z0-9_])'
    return [match.start() for match in re.finditer(pattern, value.lower())]


def voice_for(personality):
    value = (personality or '').lower()
    matches = []
    for priority, voice in enumerate(RULES['voices']):
        positions = [position for term in voice['terms'] for position in term_positions(value, term)
                     if not re.search(r"(?:不(?:(?:太|怎么|是很|算|喜欢|爱|再|会))*|并非|从不|没有|不要|(?:not|isn't|aren't|wasn't|weren't|never|no longer)\s+(?:(?:very|so|too|really)\s+)*)$", value[:position])]
        if positions:
            matches.append((min(positions), priority, voice))
    matches.sort(key=lambda item: item[:2])
    primary = matches[0][2] if matches else RULES['neutral']
    return primary, matches[1][2] if len(matches) > 1 else primary


def topic_context(topic):
    active = re.sub(r'(?:不聊|不谈|不要聊|别聊|不是|不讨论|不要讨论).*?(?=而是|只聊|改聊|[，,；;。！？!?]|$)', ' ', topic.lower())
    active = re.sub(r"\b(?:not|don't discuss|do not discuss)\s+.*?(?=\bbut\b|[,;.!?]|$)", ' ', active)
    groups = [(sum(bool(term_positions(active, term)) for term in group['terms']), group) for group in RULES['topics']]
    groups = sorted([item for item in groups if item[0]], key=lambda item: -item[0])
    value = active
    for phrase in RULES['stop_phrases']:
        value = value.replace(phrase, ' ')
    tokens = {word for word in re.findall('[a-z0-9]+', value) if len(word) > 1 and word not in RULES['stop_words']}
    for run in re.findall('[\u3400-\u9fff]+', value):
        tokens.update(run[index:index + 2] for index in range(len(run) - 1))
    return {'groups': [group for _, group in groups], 'tokens': tokens,
            'focus': groups[0][1]['focus'] if groups else '「%s」' % topic,
            'question': groups[0][1]['question'] if groups else RULES['default_question'].replace('{topic}', topic)}


def relevance(memory, context):
    content = memory['text'] + (' ' + memory.get('response', '') if memory['status'] == 'confirmed' else '')
    groups = [group for group in context['groups'] if group.get('kind') == memory['kind']
              or any(term_positions(content, term) for term in group['terms'])]
    return len(groups) * 4 + sum(bool(term_positions(content, token)) for token in context['tokens'])


def quotation(memory, names):
    result = '%s记得「%s」。' % (names.get(memory['author_id'], '记录者'), memory['text'])
    if memory['status'] == 'pending':
        return result + '这仍是记录者的说法，等%s回应后再确认。' % names.get(memory['tagged_user_id'], '被标注的人')
    if memory['status'] == 'confirmed':
        if memory.get('response'):
            result += '%s还说「%s」。' % (names.get(memory['tagged_user_id'], '被标注的人'), memory['response'])
        return result + '这段记录已由%s和%s双方确认。' % (names.get(memory['author_id'], '记录者'), names.get(memory['tagged_user_id'], '被标注的人'))
    return result + '这是本人记录。' + ('约定是否完成，还等你来补充。' if memory['kind'] == 'promise' else '')


def compose_lines(state, selected, topic, users):
    names = {user['id']: user['name'] for user in users}
    context = topic_context(topic)
    objects = [next(obj for obj in state['objects'] if obj['id'] == oid) for oid in selected]
    lines = []
    for index, obj in enumerate(objects):
        voice, accent = voice_for(obj.get('personality', ''))
        candidates = [memory for memory in state['memories'] if memory['object_id'] == obj['id']
                      and memory['status'] in ('recorded', 'pending', 'confirmed')]
        candidates.sort(key=lambda memory: memory['id'])
        candidates.sort(key=lambda memory: (relevance(memory, context), memory['status'] == 'confirmed', memory['created_at']), reverse=True)
        memory = candidates[0] if candidates else None
        lead = '接着「%s」的话，我也想聊聊「%s」。' % (objects[index - 1]['name'], topic) if index else '聊到「%s」，' % topic
        if not memory:
            recall = '我还没有能引用的记忆，等你亲口讲给我听。'
        else:
            recall = ('我翻到这段相关记录：' if relevance(memory, context) else '还没有找到直接相关的记忆，先把已有记录放在旁边：') + quotation(memory, names)
        lines.append({'object_id': obj['id'], 'name': obj['name'],
                      'text': voice['opening'] + lead + recall + voice['stance'].replace('{focus}', context['focus']) + accent['invite'] + context['question'],
                      'mood': voice['mood'] if voice['id'] == accent['id'] else voice['mood'] + ' · ' + accent['mood'],
                      'memory_ids': [memory['id']] if memory else []})
    return lines
