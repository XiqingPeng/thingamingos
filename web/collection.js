export const PAGE_SIZE=6;
export function collectionPage(objects,query='',page=0){
 const q=query.trim().toLocaleLowerCase();
 const matches=objects.filter(o=>!q||[o.name,o.object_type,o.personality].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
 const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));const index=Math.min(Math.max(0,Math.trunc(page)||0),pages-1);
 return {items:matches.slice(index*PAGE_SIZE,(index+1)*PAGE_SIZE),page:index,pages,total:matches.length};
}
export function roomCast(objects,page=0){const pages=Math.max(1,Math.ceil(objects.length/3));const index=((page%pages)+pages)%pages;return {items:objects.slice(index*3,index*3+3),page:index,pages};}

// Resolve built-in artwork from the user-authored type and name; photos take priority in art().
export function objectIcon(object){
 if(!object||typeof object!=='object')return object;
 const label=[object.object_type,object.name].filter(Boolean).join(' ');
 for(const [pattern,kind] of [[/相机|拍立得|camera|polaroid/i,'camera'],[/随身听|播放器|收音机|耳机|walkman|music|radio|headphone/i,'music'],[/毛绒|玩偶|玩具|小云朵|plush|teddy|toy/i,'plush'],[/书|笔记本|日记|手帐|手账|book|diary|journal/i,'book'],[/闹钟|时钟|clock|alarm/i,'clock'],[/手机|电话|phone/i,'phone'],[/灯|lamp|light/i,'lamp'],[/画笔|水彩|铅笔|pencil|brush|pen/i,'brush'],[/鼠标|mouse/i,'mouse']])if(pattern.test(label))return kind;
 return object.kind||'other';
}
