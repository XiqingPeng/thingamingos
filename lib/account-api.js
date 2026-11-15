import {sendManifest} from './web-app.js';
import {createHash} from 'node:crypto';
import {Problem,publicState,mutate,sniff,uid} from './domain.js';
import {createScene,translateSavedScene} from './scene-service.js';
import {createSceneGenerator,createSceneTranslator} from './llm-provider.js';
const mediaPaths=(state,basePath)=>({...state,objects:state.objects.map(o=>({...o,media_url:o.media_url?basePath+o.media_url:null,pixel_media_url:o.pixel_media_url?basePath+o.pixel_media_url:null}))});
const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
async function raw(req,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new Problem('请求太大',413);chunks.push(chunk);}return Buffer.concat(chunks);}
export function accountHandler(accounts,mediaStore,{basePath=''}={}){return async(req,res)=>{
 try{
  const url=new URL(req.url,'http://'+req.headers.host),route=url.searchParams.get('route')||url.pathname.replace(/^\/(?:api\/)?/,'');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(route.startsWith('auth/')){url.searchParams.delete('route');req.url=(accounts.authPath||'/api/auth')+'/'+route.slice(5)+(url.searchParams.size?'?'+url.searchParams.toString():'');return accounts.nodeHandler(req,res);}
  if(route==='manifest'&&req.method==='GET')return sendManifest(res,url.searchParams.get('room'),basePath);
  if(route==='health')return send(res,200,{ok:true,identity_mode:'account',mode:'rules'});
  const session=await accounts.session(req);if(!session||session.user.banned)throw new Problem('请先登录',401);
  const room=req.headers['x-room-key']||url.searchParams.get('room');
  if(typeof room!=='string'||!/^[a-f0-9]{32}$/.test(room))throw new Problem('请从小屋链接进入');
  if(req.method!=='GET'){
   const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)throw new Problem('请从小屋页面提交',403);
   if(req.headers['sec-fetch-site']==='cross-site')throw new Problem('请从小屋页面提交',403);
  }
  const actor=session.user.id;
  if(route==='room/join'&&req.method==='POST'){await accounts.join(room,session.user);return send(res,200,{ok:true});}
  if(!await accounts.isMember(room,actor))throw new Problem('你还不是这个小屋的成员',403);
  if(req.method==='GET'){
   if(route==='state'){const {state}=await accounts.repository.read(room);return send(res,200,{...mediaPaths(publicState(state,actor,room),basePath),identity_mode:'account',account:{id:actor,name:session.user.name,email:session.user.email,role:session.user.role||'user'},storage:'database'});}
   const match=/^media\/([a-f0-9]{32})$/.exec(route);
   if(match){const {state}=await accounts.repository.read(room),media=state.media.find(m=>m.id===match[1]);if(!media)throw new Problem('这份素材不存在',404);const bytes=await mediaStore.read(room,media.id);let start=0,end=bytes.length-1;
    if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range||Number(range[1])>=bytes.length)throw new Problem('不支持这个视频区间',416);start=Number(range[1]);end=Math.min(range[2]?Number(range[2]):end,end);if(end<start)throw new Problem('不支持这个视频区间',416);res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);}
    res.setHeader('Content-Type',media.mime);res.setHeader('Content-Length',String(end-start+1));res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, no-store');return res.end(bytes.subarray(start,end+1));}
   throw new Problem('找不到这个入口',404);
  }
  if(req.method!=='POST')throw new Problem('不支持这个请求',405);
  if(route==='uploads'){
   const buffer=await raw(req,4*1024*1024+65536),form=await new Request('http://'+req.headers.host,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:buffer}).formData(),file=form.get('file');
   if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>4*1024*1024)throw new Problem('请选择 4 MB 以内的照片或短视频');
   const bytes=Buffer.from(await file.arrayBuffer()),mime=sniff(bytes),uploadId=form.get('upload_id')||uid();
   if(!/^[a-f0-9]{32}$/.test(uploadId))throw new Problem('上传标识无效，请重新选择文件');
   const sha256=createHash('sha256').update(bytes).digest('hex'),id=createHash('sha256').update(`${actor}:${uploadId}:${sha256}`).digest('hex').slice(0,32);
   const previous=(await accounts.repository.read(room)).state.media.find(m=>m.author_id===actor&&m.upload_id===uploadId);
   if(previous){if(previous.sha256!==sha256)throw new Problem('这个上传标识已经用于另一份文件，请重新选择文件',409);return send(res,200,{id:previous.id});}
   if((await accounts.repository.read(room)).state.media.length>=30)throw new Problem('演示小屋最多保存 30 份素材');
   await mediaStore.write(room,id,bytes,mime);
   await accounts.repository.update(room,state=>{const existing=state.media.find(m=>m.author_id===actor&&m.upload_id===uploadId);if(existing){if(existing.sha256!==sha256)throw new Problem('这个上传标识已经用于另一份文件，请重新选择文件',409);return;}if(state.media.length>=30)throw new Problem('演示小屋最多保存 30 份素材');state.media.push({id,mime,filename:file.name.slice(0,160),size:bytes.length,author_id:actor,upload_id:uploadId,sha256});});return send(res,200,{id});
  }
  const data=req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)?req.body:JSON.parse(typeof req.body==='string'?req.body:(await raw(req,8192)).toString());
  if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>8192)throw new Problem('请求格式不正确');
  const translationRoute=/^scenes\/([a-f0-9]{32})\/language$/.exec(route);if(translationRoute)return send(res,200,await translateSavedScene({repository:accounts.repository,room,actor,sceneId:translationRoute[1],language:data.language,translate:createSceneTranslator()}));
  if(route==='scenes')return send(res,200,await createScene({repository:accounts.repository,room,actor,data,generate:createSceneGenerator({bilingual:true})}));
  return send(res,200,await accounts.repository.update(room,state=>mutate(state,route,data,actor)));
 }catch(error){if(error instanceof Problem)return send(res,error.status,{error:error.message});if(error instanceof SyntaxError)return send(res,400,{error:'请求格式不正确'});console.error('Account API failed:',error.constructor.name);return send(res,503,{error:'小屋暂时没接上，请稍后重试'});}
};}
