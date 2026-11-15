import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createAccounts} from './lib/accounts.js';
import {accountHandler} from './lib/account-api.js';
const host=process.env.HOST||'127.0.0.1',basePath=process.env.APP_BASE_PATH||'';
if(basePath&&!/^\/apps\/[a-z][a-z0-9-]{0,48}$/.test(basePath))throw new Error('Invalid APP_BASE_PATH');
const port=Number(process.env.PORT||18767),dataDir=resolve(process.env.OBJECT_STORIES_DATA||'data/accounts-preview');
const accounts=await createAccounts({dataDir,baseURL:process.env.BETTER_AUTH_URL||`http://127.0.0.1:${port}`,databaseURL:process.env.DATABASE_URL,secret:process.env.BETTER_AUTH_SECRET,basePath:basePath+'/api/auth',cookiePath:basePath+'/',cookiePrefix:basePath?'thingamingos-'+basePath.split('/').pop():'better-auth'});
const mediaStore={async read(room,id){return readFile(join(dataDir,'media',room,id));},async write(room,id,bytes){const dir=join(dataDir,'media',room);await mkdir(dir,{recursive:true});await writeFile(join(dir,id),bytes);}};
const handler=accountHandler(accounts,mediaStore,{basePath}),root=resolve('web');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
http.createServer(async(req,res)=>{
 req.headers['x-forwarded-for']=req.socket.remoteAddress;

 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(basePath){
  if(url.pathname===basePath){res.writeHead(308,{Location:basePath+'/'+url.search});return res.end();}
  if(!url.pathname.startsWith(basePath+'/')){res.writeHead(404);return res.end('Not found');}
  url.pathname=url.pathname.slice(basePath.length);req.url=url.pathname+url.search;
 }
 // Local-only device frame compensates for host browser zoom during UI QA.
 // Production Vercel keeps frame-ancestors 'none'; only this loopback QA URL can frame itself.
 if(!basePath&&host==='127.0.0.1'&&!process.env.DATABASE_URL&&url.pathname==='/__preview/iphone'){
  const width=[375,390,430].includes(Number(url.searchParams.get('width')))?Number(url.searchParams.get('width')):390;
  const room=/^[a-f0-9]{32}$/.test(url.searchParams.get('room')||'')?url.searchParams.get('room'):'';
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  return res.end(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>thingamingos · iPhone 预览</title><style>*{box-sizing:border-box}body{margin:0;background:#e7dfc6;color:#344c37;font:14px system-ui;padding:18px 12px}header{max-width:450px;margin:0 auto 16px;text-align:center}nav{margin-top:10px;display:flex;justify-content:center;gap:16px}a{color:inherit}iframe{display:block;width:${width}px;height:844px;margin:auto;border:5px solid #304c3a;border-radius:22px;background:#fff2cd;box-sizing:content-box;max-width:none}small{display:block;margin-top:8px;color:#75795b}</style><header><strong>thingamingos · iPhone 预览</strong><small>${width} × 844 CSS px · 浏览器尺寸预览</small><nav>${[375,390,430].map(w=>`<a href="?width=${w}${room?'&room='+room:''}">${w} px</a>`).join('')}</nav></header><iframe title="iPhone 小屋预览" src="/?devicePreview=iphone${room?'&room='+room:''}"></iframe></html>`);
 }
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return handler(req,res);
 let file;try{file=resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));}catch{res.writeHead(400);return res.end('Invalid URL');}
 if(!file.startsWith(root+'/')){res.writeHead(403);return res.end();}
 try{const bytes=await readFile(file);const allowPreviewFrame=!basePath&&host==='127.0.0.1'&&!process.env.DATABASE_URL&&url.searchParams.get('devicePreview')==='iphone';if(url.pathname==='/sw.js'){res.setHeader('Cache-Control','no-cache');res.setHeader('Service-Worker-Allowed',basePath+'/');}if(url.pathname==='/'||url.pathname==='/index.html'||url.pathname==='/manifest.webmanifest')res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',`default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors ${allowPreviewFrame?"'self'":"'none'"}`);res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,host,()=>console.log(`thingamingos: http://${host}:${port}${basePath}/`));
