import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const slug=process.argv[2]||'thingamingos';
if(!/^[a-z][a-z0-9-]{0,48}$/.test(slug))throw new Error('Invalid app slug');
const base='/apps/'+slug,root=resolve('.'),destination=resolve(process.argv[3]||'data/campus-release/'+Date.now());
if(!destination.startsWith(root+'/data/campus-release/'))throw new Error('Use a fresh data/campus-release/<release> directory');
await mkdir(resolve('data/campus-release'),{recursive:true});
await mkdir(destination,{recursive:false});
// Explicit allowlist: never package credentials, local databases, logs, uploads or dependencies.
for(const entry of ['web','lib','api','server.js','package.json','package-lock.json','Dockerfile','.dockerignore'])await cp(entry,join(destination,entry),{recursive:true,errorOnExist:true,force:false});
async function walk(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Symlink refused: '+path);if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}
const paths=/(["'`])\/(?=api\/|media\/|assets\/|fonts\/|icons\/|sw\.js|manifest\.webmanifest|offline\.(?:html|css|js)|favicon\.svg|room\.svg|(?:app|style|mobile|audio)\.(?:js|css)|\?)/g;
for(const file of await walk(join(destination,'web'))){if(!/\.(?:html|css|js)$/.test(file))continue;let source=await readFile(file,'utf8');source=source.replace(paths,(_,quote)=>quote+base+'/');if(file.endsWith('/sw.js'))source=source.replaceAll('thingamingos-offline-',slug+'-campus-offline-');await writeFile(file,source);}
// Static and dynamic manifests share the same path contract. Dynamic uses original source manifest.
const staticPath=join(destination,'web/manifest.webmanifest'),manifest=JSON.parse(await readFile(staticPath,'utf8'));
manifest.id=manifest.scope=base+'/';manifest.start_url=base+manifest.start_url;manifest.icons.forEach(icon=>icon.src=base+icon.src);await writeFile(staticPath,JSON.stringify(manifest,null,2)+'\n');
const docker=join(destination,'Dockerfile');await writeFile(docker,(await readFile(docker,'utf8')).replaceAll('/apps/thingamingos',base).replaceAll('/mydata/data/thingamingos','/mydata/data/'+slug));
const entries=[];for(const file of (await walk(destination)).sort()){entries.push(createHash('sha256').update(await readFile(file)).digest('hex')+'  '+relative(destination,file));}
await writeFile(join(destination,'SHA256SUMS'),entries.join('\n')+'\n');console.log(destination);
