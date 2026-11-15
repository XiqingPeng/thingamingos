import { get, put } from '@vercel/blob';
import { seed, Problem } from './domain.js';
export const normalizeEtag=value=>String(value).replace(/^W\//,'').replace(/^"|"$/g,'');
export function repository(driver={get,put}){
 async function read(room){
  let result;
  try{result=await driver.get(`rooms/${room}/state.json`,{access:'private',useCache:false});}
  catch(e){if(e.constructor.name==='BlobNotFoundError')return {state:seed(),etag:null};throw e;}
  if(!result)return {state:seed(),etag:null};
  if(result.statusCode!==200||!result.blob?.etag)throw new Error('State read did not return a version');
  return {state:await new Response(result.stream).json(),etag:normalizeEtag(result.blob.etag)};
 }
 async function update(room,fn){
  for(let attempt=0;attempt<5;attempt++){
   const {state,etag}=await read(room);const result=fn(state);
   try{
    await driver.put(`rooms/${room}/state.json`,JSON.stringify(state),{access:'private',contentType:'application/json',addRandomSuffix:false,...(etag?{allowOverwrite:true,ifMatch:etag}:{allowOverwrite:false})});
    return result;
   }catch(e){if(!/PreconditionFailed|AlreadyExists/.test(e.constructor.name)||attempt===4)throw e;}
  }
  throw new Problem('小屋正好有朋友在记故事，请再试一次',409);
 }
 return {read,update};
}
export const repo=repository();
