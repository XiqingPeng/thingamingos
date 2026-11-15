import { USERS,uid,now,ids,Problem,text,tag,OBJECT_LABELS,objectKind } from './shared.js';
import { buildScene } from './theater.js';
export { USERS,uid,Problem,text } from './shared.js';
export function seed(){
 const timestamp='2026-11-13T12:00:00.000Z';
 return {objects:[{id:'cup',owner_id:'a',name:'老朋友',kind:'mug',personality:'嘴硬心软，重感情，偶尔吃醋',media_id:null,created_at:timestamp},{id:'keys',owner_id:'a',name:'打工搭子',kind:'keyboard',personality:'一本正经地吐槽，关心大家下班',media_id:null,created_at:timestamp},{id:'leaf',owner_id:'b',name:'慢半拍',kind:'plant',personality:'慢悠悠的乐天派，总能发现小确幸',media_id:null,created_at:timestamp}],memories:[
 {id:'00000000000000000000000000000001',object_id:'cup',author_id:'a',text:'这个杯子是小北在毕业那年送我的，我一直用到现在。',tagged_user_id:'b',status:'pending',kind:'gift',response:'',created_at:timestamp,responded_at:null},
 {id:'00000000000000000000000000000002',object_id:'cup',author_id:'a',text:'我答应这周带它一起去公园晒太阳。',tagged_user_id:null,status:'recorded',kind:'promise',response:'',created_at:timestamp,responded_at:null},
 {id:'00000000000000000000000000000003',object_id:'keys',author_id:'a',text:'昨天我说最后改一个字，结果又敲了两个小时。',tagged_user_id:null,status:'recorded',kind:'story',response:'',created_at:timestamp,responded_at:null},
 {id:'00000000000000000000000000000004',object_id:'leaf',author_id:'b',text:'上周终于长出了一片新叶子，小满给它拍了合照。',tagged_user_id:'a',status:'pending',kind:'story',response:'',created_at:timestamp,responded_at:null}],media:[],latest_scene:null};
}
export const memoryRevision=m=>Number.isSafeInteger(m.revision)&&m.revision>=1?m.revision:1;
export function publicState(s,actor,room){return {users:s.users||USERS,current_user_id:actor,objects:s.objects.map(o=>{const m=s.media.find(m=>m.id===o.media_id),pm=o.pixel_media_id?s.media.find(m=>m.id===o.pixel_media_id):null;return {...o,object_type:o.object_type||OBJECT_LABELS[o.kind]||'其他物品',media_url:m?`/media/${m.id}?room=${room}`:null,media_type:m?.mime||null,pixel_media_url:pm?`/media/${pm.id}?room=${room}`:null};}),memories:s.memories.map(m=>({...m,revision:memoryRevision(m)})).sort((a,b)=>b.created_at.localeCompare(a.created_at)),latest_scene:s.latest_scene,mode:'rules',shared_space:'我们的记忆小屋',max_upload_mb:4,storage:'private-blob',identity_mode:'demo'};}
export function mutate(s,route,data,actor){
 if(!(s.users||USERS).some(user=>user.id===actor))throw new Problem('请选择有效的演示身份',403);
 if(route==='objects'){
  if(s.objects.length>=20)throw new Problem('演示小屋最多收留 20 件物品');
  const object_type=text(data,'object_type',40,Object.hasOwn(data,'object_type'));
  const name=text(data,'name',30,true),kind=object_type?objectKind(object_type):(data.kind||'other'),personality=text(data,'personality',100)||'有点好奇，嘴硬心软';
  if(!['mug','keyboard','plant','other'].includes(kind))throw new Problem('不支持的物品类型');
  const story=text(data,'text'),who=tag(data,actor,s.users||USERS),media_id=data.media_id||null,pixel_media_id=data.pixel_media_id||null;
  if(who&&!story)throw new Problem('标注朋友时，请写下你们的故事');
  if(media_id&&!s.media.some(m=>m.id===media_id&&m.author_id===actor))throw new Problem('请重新上传自己的照片或视频');
  if(pixel_media_id&&!s.media.some(m=>m.id===pixel_media_id&&m.author_id===actor&&m.mime.startsWith('image/')))throw new Problem('像素形象文件无效，请重新选择图片');
  const id=uid();s.objects.push({id,owner_id:actor,name,kind,object_type:object_type||OBJECT_LABELS[kind],personality,media_id,pixel_media_id,created_at:now()});
  if(story)mutate(s,'memories',{object_id:id,text:story,tagged_user_id:who,kind:data.is_gift&&who?'gift':'story'},actor);
  return {id};
 }
 if(route==='memories'){
  if(s.memories.length>=160)throw new Problem('演示小屋的记忆抽屉已经满了');
  const oid=text(data,'object_id',40,true),story=text(data,'text',600,true),who=tag(data,actor,s.users||USERS),kind=data.kind||'story';
  if(!s.objects.some(o=>o.id===oid))throw new Problem('这件物品不存在');
  if(!['story','promise','gift'].includes(kind)||kind==='gift'&&!who)throw new Problem('赠送故事需要标注赠送者');
   const id=uid();s.memories.unshift({id,object_id:oid,author_id:actor,text:story,tagged_user_id:who,status:who?'pending':'recorded',kind,response:'',created_at:now(),responded_at:null,revision:1});return {id};
 }
 const match=/^memories\/([a-f0-9]{32})\/(respond|edit|forget)$/.exec(route);
 if(match){
  const m=s.memories.find(m=>m.id===match[1]);if(!m)throw new Problem('这段记忆不存在',404);
  if(match[2]==='respond'){
   if(m.tagged_user_id!==actor)throw new Problem('只有被标注的人可以回应',403);
   if(!Number.isSafeInteger(data.expected_revision)||data.expected_revision!==memoryRevision(m))throw new Problem('这段记忆已更新，请关闭弹窗，重新阅读最新内容后再回应',409);
   if(m.status!=='pending')throw new Problem('这段记忆已经回应过了');
   if(!['confirm','decline'].includes(data.action))throw new Problem('请选择回应方式');
    const response=text(data,'response');m.status=data.action==='confirm'?'confirmed':'declined';m.response=response;m.responded_at=now();
  }else{
   if(m.author_id!==actor)throw new Problem('只有记录者可以修改或忘记这段记忆',403);
   if(match[2]==='forget')s.memories=s.memories.filter(x=>x.id!==m.id);
    else {m.text=text(data,'text',600,true);m.revision=memoryRevision(m)+1;m.status=m.tagged_user_id?'pending':'recorded';m.response='';m.responded_at=null;}
  }
  s.latest_scene=null;return {ok:true};
 }
 if(route==='scenes')return buildScene(s,data);
 throw new Problem('找不到这个入口',404);
}
export function sniff(raw){
 if(raw.length>=3&&raw[0]===255&&raw[1]===216&&raw[2]===255)return'image/jpeg';
 if(raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';
 if(['GIF87a','GIF89a'].includes(raw.subarray(0,6).toString()))return'image/gif';
 if(raw.subarray(0,4).toString()==='RIFF'&&raw.subarray(8,12).toString()==='WEBP')return'image/webp';
 if(raw.subarray(0,4).equals(Buffer.from([26,69,223,163])))return'video/webm';
 if(raw.subarray(4,8).toString()==='ftyp'){
  if(/heic|heix|avif|mif1/.test(raw.subarray(8,32).toString()))throw new Problem('这张照片请先转成 JPG 或 PNG');
  return raw.subarray(8,12).toString()==='qt  '?'video/quicktime':'video/mp4';
 }
 throw new Problem('支持 JPG、PNG、GIF、WebP 图片，以及 MP4、WebM、MOV 视频');
}
