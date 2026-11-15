import {sendManifest} from '../lib/web-app.js';
import {createAccounts} from '../lib/accounts.js';
import {accountHandler} from '../lib/account-api.js';
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { repo } from '../lib/store.js';
import { USERS,uid,Problem,mutate,publicState,sniff } from '../lib/domain.js';
import { createScene, translateSavedScene } from '../lib/scene-service.js';
import { createSceneGenerator, createSceneTranslator } from '../lib/llm-provider.js';
let accountRuntime;
async function authenticatedHandler(req,res){
 if(!process.env.BETTER_AUTH_URL||!process.env.BETTER_AUTH_SECRET)throw new Error('Account deployment configuration is incomplete');
 accountRuntime??=createAccounts({databaseURL:process.env.DATABASE_URL,baseURL:process.env.BETTER_AUTH_URL,secret:process.env.BETTER_AUTH_SECRET,migrate:false}).then(accounts=>accountHandler(accounts,{async read(room,id){const result=await get(`account-media/${room}/${id}`,{access:'private',useCache:false});if(!result)throw new Problem('这份素材不存在',404);return Buffer.from(await new Response(result.stream).arrayBuffer());},async write(room,id,bytes,mime){await put(`account-media/${room}/${id}`,bytes,{access:'private',contentType:mime,addRandomSuffix:false});}})).catch(error=>{accountRuntime=null;throw error;});
 return (await accountRuntime)(req,res);
}
const MAX=4*1024*1024;
const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
async function rawBody(req,max){let size=0,chunks=[];for await(const part of req){size+=part.length;if(size>max)throw new Problem('请求太大',413);chunks.push(part);}return Buffer.concat(chunks);}
export async function persistUpload({room,actor,upload_id,filename,bytes,mime},repository=repo,writeBlob=put){
 if(upload_id!==undefined&&upload_id!==null&&(typeof upload_id!=='string'||!/^[a-f0-9]{32}$/.test(upload_id)))throw new Problem('上传标识无效，请重新选择文件');
 const uploadId=upload_id||uid(),sha256=createHash('sha256').update(bytes).digest('hex');
 const id=createHash('sha256').update(`${actor}:${uploadId}:${sha256}`).digest('hex').slice(0,32);
 const previous=s=>s.media.find(m=>m.author_id===actor&&m.upload_id===uploadId);
 const check=m=>{if(m.sha256!==sha256)throw new Problem('这个上传标识已经用于另一份文件，请重新选择文件',409);return m;};
 const result=m=>({id:m.id,mime:m.mime,url:`/media/${m.id}?room=${room}`});
 const current=(await repository.read(room)).state,existing=previous(current);
 if(existing)return result(check(existing));
 if(current.media.length>=30)throw new Problem('演示小屋最多保存 30 份素材');
 try{await writeBlob(`rooms/${room}/media/${id}`,bytes,{access:'private',contentType:mime,addRandomSuffix:false,allowOverwrite:false});}
 catch(error){if(!/AlreadyExists|PreconditionFailed/.test(error.constructor.name))throw error;}
 // The deterministic path includes the content hash: a timed-out or concurrent retry
 // can reuse the same bytes without overwriting another participant's upload.
 const media=await repository.update(room,s=>{
  const existing=previous(s);if(existing)return check(existing);
  if(s.media.length>=30)throw new Problem('演示小屋最多保存 30 份素材');
  const m={id,mime,filename:filename.slice(0,160),size:bytes.length,author_id:actor,upload_id:uploadId,sha256};s.media.push(m);return m;
 });
 return result(media);
}
export default async function handler(req,res){
 try{
  const incoming=new URL(req.url,'https://'+req.headers.host);if(req.method==='GET'&&(incoming.searchParams.get('route')==='manifest'||incoming.pathname==='/api/manifest'))return sendManifest(res,incoming.searchParams.get('room'));
  if(process.env.DATABASE_URL)return await authenticatedHandler(req,res);
  res.setHeader('X-Content-Type-Options','nosniff');
  const url=new URL(req.url,'https://'+req.headers.host),route=url.searchParams.get('route')||url.pathname.replace(/^\/api\//,'');
  const generate=createSceneGenerator({bilingual:true});
  if(route==='health')return send(res,200,{ok:true,storage:!!process.env.BLOB_READ_WRITE_TOKEN,mode:generate?'hybrid':'rules',llm_configured:!!generate});
  const room=req.headers['x-room-key']||url.searchParams.get('room');
  if(typeof room!=='string'||!/^[a-f0-9]{32}$/.test(room))throw new Problem('请从小屋链接进入',400);
  const actor=req.headers['x-demo-user']||'a';if(!USERS.some(u=>u.id===actor))throw new Problem('请选择有效的演示身份',403);
  if(req.method==='GET'){
   const {state}=await repo.read(room);
   if(route==='state')return send(res,200,{...publicState(state,actor,room),mode:generate?'hybrid':'rules',llm_configured:!!generate});
   const match=/^media\/([a-f0-9]{32})$/.exec(route);
   if(match){
    const media=state.media.find(m=>m.id===match[1]);if(!media)throw new Problem('这份素材不存在',404);
    const blob=await get(`rooms/${room}/media/${media.id}`,{access:'private',useCache:false});
    if(!blob)throw new Problem('这份素材不存在',404);
    const bytes=Buffer.from(await new Response(blob.stream).arrayBuffer());let start=0,end=bytes.length-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||Number(m[1])>=bytes.length)throw new Problem('不支持这个视频区间',416);start=Number(m[1]);end=Math.min(m[2]?Number(m[2]):end,end);if(end<start)throw new Problem('不支持这个视频区间',416);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);}
    res.statusCode=status;res.setHeader('Content-Type',media.mime);res.setHeader('Content-Length',String(end-start+1));res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, no-store');return res.end(bytes.subarray(start,end+1));
   }
   throw new Problem('找不到这个入口',404);
  }
  if(req.method!=='POST')throw new Problem('不支持这个请求',405);
  const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)throw new Problem('请从小屋页面提交',403);
  if(route==='uploads'){
   if(Number(req.headers['content-length']||0)>MAX+65536)throw new Problem('预览版照片或短视频最大 4 MB',413);
   const raw=await rawBody(req,MAX+65536);
   const request=new Request('https://'+req.headers.host+req.url,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:raw});
   const form=await request.formData(),file=form.get('file');
   if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>MAX)throw new Problem('请选择 4 MB 以内的照片或短视频');
    const bytes=Buffer.from(await file.arrayBuffer()),mime=sniff(bytes);
    return send(res,200,await persistUpload({room,actor,upload_id:form.get('upload_id'),filename:file.name,bytes,mime}));
  }
  let data;
  if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))data=req.body;
  else if(typeof req.body==='string')data=JSON.parse(req.body);
  else data=JSON.parse((await rawBody(req,8192)).toString());
  if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>8192)throw new Problem('请求格式不正确');
  if(route==='session'){if(!USERS.some(u=>u.id===data.user_id))throw new Problem('无效演示身份');return send(res,200,{ok:true});}
  const translationRoute=/^scenes\/([a-f0-9]{32})\/language$/.exec(route);if(translationRoute)return send(res,200,await translateSavedScene({repository:repo,room,actor,sceneId:translationRoute[1],language:data.language,translate:createSceneTranslator()}));
  if(route==='scenes')return send(res,200,await createScene({repository:repo,room,actor,data,generate}));
  const result=await repo.update(room,s=>mutate(s,route,data,actor));return send(res,200,result);
 }catch(error){
  if(error instanceof Problem)return send(res,error.status,{error:error.message});
  if(error instanceof SyntaxError)return send(res,400,{error:'这段内容没有读懂，请检查后重试'});
  console.error('Object Stories request failed:',error.constructor.name,error.message?.replace(/vercel_blob_[^\s]+/g,'[redacted]'));
  return send(res,503,{error:'记忆小屋暂时没接上，请稍后重试；当前输入会保留'});
 }
}
