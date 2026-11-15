import {t,ui,getLanguage,setLanguage,locale,translateError} from './i18n.js';
// Small state boundaries shared by the browser and its race-condition tests.
export function createRequestGate(initialActor) {
  let actor = initialActor, epoch = 0, sequence = 0;
  return {
    get actor() { return actor; },
    switchActor(next) { actor = next; epoch++; sequence++; return this.capture(); },
    capture() { return { actor, epoch }; },
    isCurrent(ticket) { return ticket.actor === actor && ticket.epoch === epoch; },
    beginRead() { return { ...this.capture(), sequence: ++sequence }; },
    accepts(ticket) { return this.isCurrent(ticket) && ticket.sequence === sequence; },
    invalidateReads() { sequence++; },
  };
}

export function defaultSceneIds(objects, selected) {
  return [...new Set([selected, ...objects.map(object => object.id)])]
    .filter(id => objects.some(object => object.id === id)).slice(0, 3);
}

export function prepareObjectData(input, actor, users) {
  const data = { ...input };
  delete data.media;
  delete data.pixel_style;
  for (const field of ['name', 'object_type', 'personality', 'text']) data[field] = String(data[field] || '').trim();
  if (!data.name || !data.object_type) throw new Error(t('请填写物品名字和类型，不能只填空格'));
  if (data.name.length > 30 || data.object_type.length > 40 || data.personality.length > 100 || data.text.length > 600) throw new Error(t('填写的内容太长，请缩短后再保存'));
  data.tagged_user_id = String(data.tagged_user_id || '').trim();
  if (data.tagged_user_id && (data.tagged_user_id === actor || !users.some(user => user.id === data.tagged_user_id))) throw new Error(t('请选择小屋里的另一位朋友'));
  if (data.tagged_user_id && !data.text) throw new Error(t('标注朋友时，请写下你们的故事'));
  if (data.is_gift && !data.tagged_user_id) throw new Error(t('赠送故事需要选择赠送者'));
  return data;
}

export function createUploadCache(makeId) {
  const files = new WeakMap();
  return async function upload(file, actor, send) {
    let actors = files.get(file);
    if (!actors) files.set(file, actors = new Map());
    let entry = actors.get(actor);
    if (!entry) actors.set(actor, entry = { uploadId: makeId(), mediaId: null, pending: null });
    if (entry.mediaId) return entry.mediaId;
    if (!entry.pending) {
      entry.pending = Promise.resolve().then(() => send(file, entry.uploadId, actor))
        .then(result => { entry.mediaId = result.id; return result.id; })
        .finally(() => { entry.pending = null; });
    }
    return entry.pending;
  };
}
