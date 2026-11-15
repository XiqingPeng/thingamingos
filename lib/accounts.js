import {betterAuth} from 'better-auth';
import {admin} from 'better-auth/plugins';
import {APIError} from 'better-auth/api';
import {getMigrations} from 'better-auth/db/migration';
import {fromNodeHeaders,toNodeHandler} from 'better-auth/node';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {seed,Problem} from './domain.js';

// Preview: persistent SQLite. Deployment: explicitly configured PostgreSQL.
export async function createAccounts({dataDir='data/accounts-preview',baseURL='http://127.0.0.1:18767',databaseURL,secret,migrate=true,basePath="/api/auth",cookiePath="/",cookiePrefix="better-auth"}={}){
 let database,query,close;
 if(databaseURL){const {Pool}=await import('pg');database=new Pool({connectionString:databaseURL});query=async(sql,args=[]) => (await database.query(sql,args)).rows;close=()=>database.end();}
 else {mkdirSync(dataDir,{recursive:true,mode:0o700});const {DatabaseSync}=await import('node:sqlite');database=new DatabaseSync(join(dataDir,'accounts.sqlite'));database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');query=async(sql,args=[])=>database.prepare(sql.replace(/\$\d+/g,'?')).all(...args);close=()=>database.close();
  if(!secret){const path=join(dataDir,'.auth-secret');if(!existsSync(path))writeFileSync(path,randomBytes(48).toString('hex'),{mode:0o600});secret=readFileSync(path,'utf8');}}
 if(!secret||secret.length<32)throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
 const validateName=data=>{if(data.name!==undefined&&(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>30))throw new APIError('BAD_REQUEST',{code:'INVALID_NAME',message:'Display name must contain 1–30 characters'});return {data:{...data,...(data.name!==undefined?{name:data.name.trim()}: {})}};};
 const auth=betterAuth({appName:'thingamingos',baseURL,basePath,secret,database,
  emailAndPassword:{enabled:true,minPasswordLength:8,maxPasswordLength:128},
  user:{changeEmail:{enabled:false}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
  rateLimit:{enabled:true,storage:'database',window:60,max:60,customRules:{'/sign-in/email':{window:60,max:8},'/sign-up/email':{window:60,max:5}}},
  databaseHooks:{user:{create:{before:validateName},update:{before:validateName}}},
  plugins:[admin()],advanced:{cookiePrefix,defaultCookieAttributes:{path:cookiePath,httpOnly:true,sameSite:'lax',secure:baseURL.startsWith('https:')}},
 });
 if(migrate){const migration=await getMigrations(auth.options);await migration.runMigrations();}
 await query('CREATE TABLE IF NOT EXISTS story_rooms (room TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)');
 await query('CREATE TABLE IF NOT EXISTS story_members (room TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(room,user_id))');
 const members=async room=>(await query('SELECT u.id,u.name,u.banned FROM "user" u JOIN story_members m ON m.user_id=u.id WHERE m.room=$1',[room])).filter(u=>!u.banned).map((u,i)=>({id:u.id,name:u.name,color:['#e6a64d','#9c9ee5','#8ebaa3'][i%3]}));
 const repository={
  async read(room){const rows=await query('SELECT state,version FROM story_rooms WHERE room=$1',[room]);if(!rows.length)throw new Problem('请先加入这个小屋',403);return {state:{...JSON.parse(rows[0].state),users:await members(room)},etag:rows[0].version};},
  async update(room,fn){for(let i=0;i<5;i++){const {state,etag}=await this.read(room);const result=fn(state);const {users,...stored}=state;const rows=await query('UPDATE story_rooms SET state=$1,version=version+1 WHERE room=$2 AND version=$3 RETURNING version',[JSON.stringify(stored),room,etag]);if(rows.length)return result;}throw new Problem('小屋正好有朋友在记故事，请再试一次',409);}
 };
 return {auth,query,repository,close,authPath:basePath,nodeHandler:toNodeHandler(auth),
  async session(req){return auth.api.getSession({headers:fromNodeHeaders(req.headers)});},
  async join(room,user){const initial=seed();initial.objects.forEach(o=>o.owner_id=user.id);initial.memories=[];await query('INSERT INTO story_rooms(room,state) VALUES($1,$2) ON CONFLICT(room) DO NOTHING',[room,JSON.stringify(initial)]);await query('INSERT INTO story_members(room,user_id) VALUES($1,$2) ON CONFLICT(room,user_id) DO NOTHING',[room,user.id]);},
  async isMember(room,id){return (await query('SELECT user_id FROM story_members WHERE room=$1 AND user_id=$2',[room,id])).length>0;},
 };
}
