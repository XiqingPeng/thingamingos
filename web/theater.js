import {t,ui,getLanguage,setLanguage,locale,translateError} from './i18n.js';
import {displayScene} from './scene-language.js';
const HAN = /[\u3400-\u9fff]/u;
const snapshotFields = ['id', 'object_id', 'author_id', 'tagged_user_id', 'status', 'text', 'response', 'revision', 'kind', 'created_at', 'responded_at'];
function snapshotValue(memory, field) {
  if (field === 'revision') return memory[field] ?? 1;
  if (field === 'response') return memory[field] ?? '';
  if (field === 'tagged_user_id' || field === 'responded_at') return memory[field] ?? null;
  return memory[field];
}

export function scenePresentation(scene) {
  if (scene.mode === 'llm') return { mode: 'llm', label: t('AI 生成 · LLM'), note: '' };
  if (scene.fallback_reason && scene.fallback_reason !== 'unconfigured') return {
    mode: 'fallback', label: t('规则生成 · 回退'),
    note: t('这次 AI 对话暂时没能完成，已改用规则生成。记忆来源与确认状态仍然保留。'),
  };
  return { mode: 'rules', label: t('规则生成'), note: '' };
}

export function sceneKey(scene) {
  return scene ? JSON.stringify({ ...scene, localized: undefined }) : '';
}

export function isSceneCurrent(scene, state) {
  if (!scene || !Array.isArray(scene.lines) || !scene.lines.length || !Array.isArray(state?.memories)) return false;
  const memories = new Map(state.memories.filter(memory => memory.status !== 'declined').map(memory => [memory.id, memory]));
  const referenced = new Set([
    ...(scene.memory_ids || []), ...(scene.context_memory_ids || []),
    ...scene.lines.flatMap(line => line.memory_ids || []),
  ]);
  if ([...referenced].some(id => !memories.has(id))) return false;
  // Supplied model context can include facts a particular line does not cite.
  // Responses can change status without changing revision; compare both.
  // Older saved scenes without snapshots retain their existing compatibility.
  if (scene.memory_snapshots) {
    const snapshots = new Map(scene.memory_snapshots.map(memory => [memory.id, memory]));
    if ([...referenced].some(id => !snapshots.has(id))) return false;
    for (const [id, snapshot] of snapshots) {
      const current = memories.get(id);
      if (!current || snapshotFields.some(field => snapshotValue(snapshot, field) !== snapshotValue(current, field))) return false;
    }
  }
  if (scene.memory_revisions) {
    if ([...referenced].some(id => scene.memory_revisions[id] !== (memories.get(id).revision ?? 1))) return false;
    if (Object.entries(scene.memory_revisions).some(([id, revision]) => !memories.has(id) || revision !== (memories.get(id).revision ?? 1))) return false;
  }
  return true;
}

function playbackView(scene, playback) {
  const total = scene.lines.length;
  let status = ['playing', 'paused'].includes(playback?.status) ? playback.status : 'complete';
  const requested = Number.isFinite(playback?.visibleCount) ? Math.trunc(playback.visibleCount) : 0;
  const visibleCount = status === 'complete' ? total : Math.max(0, Math.min(total, requested));
  if (visibleCount === total) status = 'complete';
  return { status, visibleCount, total };
}

// Inner markup only: the app keeps the controls container and restores focus
// when the last line replaces the in-progress buttons with the replay button.
export function playbackMarkup(scene, playback, esc) {
  if (!scene?.lines?.length) return '';
  const { status, visibleCount, total } = playbackView(scene, playback);
  const label = status === 'playing' ? t('正在接话…') : status === 'paused' ? t('已暂停，慢慢看这一句。') : t('全场结束 · 已完整呈现');
  return ui`<div class="playback-progress-line"><span class="playback-progress" aria-label="${esc(ui`已呈现 ${visibleCount} 句，共 ${total} 句`)}"><strong>${visibleCount}</strong> / ${total} 句</span><span class="playback-state">${label}</span></div><div class="playback-actions">${status === 'complete'
    ? t('<button type="button" class="playback-button" data-action="playback-replay">重播这场</button>')
    : ui`<button type="button" class="playback-button playback-primary" data-action="playback-toggle" aria-label="${status === 'playing' ? t('暂停这场小剧场') : t('继续播放这场小剧场')}">${status === 'playing' ? t('暂停') : t('继续')}</button><button type="button" class="playback-button" data-action="playback-next">下一句</button><button type="button" class="playback-button" data-action="playback-finish">立即看完</button>`}</div>`;
}

function memoryQuoteDetails(line, memories, language, esc) {
  return (line.memory_ids || []).map(id => {
    const m = memories.get(id);
    if (!m) return '';
    const pieces = [];
    if (m.text && (language === 'zh' ? !HAN.test(m.text) : HAN.test(m.text))) pieces.push(esc(m.text));
    if (m.status === 'confirmed' && m.response && (language === 'zh' ? !HAN.test(m.response) : HAN.test(m.response))) pieces.push(esc(m.response));
    if (!pieces.length) return '';
    return ui`<details class="memory-original"><summary>${t('记忆原文')}</summary>${pieces.map(piece => ui`<p>${piece}</p>`).join('')}</details>`;
  }).join('');
}

export function sceneMarkup(scene, state, art, icon, esc, playback = null, languageState = null) {
  if (!isSceneCurrent(scene, state)) return '';
  const language = getLanguage();
  const view = displayScene(scene, state, language);
  const memories = new Map(state.memories.map(memory => [memory.id, memory]));
  const sourceLabel = id => t('翻开这段记忆 · ') + ({ pending: t('待对方确认'), confirmed: t('双方已确认'), recorded: t('本人记录') }[memories.get(id)?.status] || t('查看记录'));
  const presentation = scenePresentation(scene);
  const { status, visibleCount } = playbackView(view, playback);
  const actors = [...new Map(view.lines.map(line => [line.object_id, line.name])).values()];
  const languageNotice = !view.language_available
    ? (languageState?.error
      ? ui`<div class="theater-language-state" role="status"><p>${esc(languageState.error)}</p><button type="button" class="secondary" data-action="scene-language-retry">${t('重试语言同步')}</button></div>`
      : ui`<div class="theater-language-state" role="status"><p>${t('正在同步剧场语言…')}</p></div>`)
    : '';
  return ui`<section class="theater" id="theater" tabindex="-1" aria-labelledby="theater-title"><div class="theater-head"><div class="theater-heading"><h2 id="theater-title">小剧场 · ${esc(view.topic)}</h2>${view.original_topic ? ui`<p class="theater-original-topic">话题原文：${esc(view.original_topic)}</p>` : ''}<p class="theater-cast">出演：${actors.map(name => ui`<span>${esc(name)}</span>`).join('、')}</p></div><span class="mode-label mode-${presentation.mode}">${presentation.label}</span></div>${presentation.note ? ui`<p class="theater-generation-note" role="status">${presentation.note}</p>` : ''}<div class="theater-controls" id="theater-controls" tabindex="-1" aria-label="小剧场播放控制">${playbackMarkup(view, playback, esc)}</div><div id="theater-announcement" class="theater-announcement" role="status" aria-live="polite" aria-atomic="true"></div>${view.language_available ? ui`<div class="dialogue-list">${view.lines.map((line, index) => { const actorObj = state.objects?.find(object => object.id === line.object_id); return ui`<article class="dialogue" data-line-index="${index}" data-current="${status !== 'complete' && index === visibleCount - 1}"${index >= visibleCount ? ' hidden' : ''}>${art(actorObj || 'other', 'dialogue-art')}<div><div class="dialogue-name">${esc(line.name)}<span>${esc(line.mood)}</span></div><p>${esc(line.text)}</p>${line.source_note ? ui`<p class="dialogue-source-note">${esc(line.source_note)}</p>` : ''}${memoryQuoteDetails(line, memories, language, esc)}${(line.memory_ids || []).map(id => ui`<button class="source-link" data-action="source" data-id="${esc(id)}">${icon('memory')}${esc(sourceLabel(id))} ↗</button>`).join('')}</div></article>`; }).join('')}</div>` : languageNotice}</section>`;
}
