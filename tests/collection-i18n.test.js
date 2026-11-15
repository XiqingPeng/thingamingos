import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionPage,roomCast} from '../web/collection.js';
import {ui,t,setLanguage,getLanguage,translateError} from '../web/i18n.js';

test('collection can page and search 200 items without putting more than three on the table',()=>{
 const objects=Array.from({length:200},(_,i)=>({id:String(i),name:`Companion ${i}`,object_type:i%2?'cup':'camera',personality:'curious'}));
 const found=[];for(let page=0;page<34;page++)found.push(...collectionPage(objects,'',page).items.map(o=>o.id));assert.equal(new Set(found).size,200);assert.equal(found.length,200);
 assert.equal(collectionPage(objects,'CAMERA').total,100);assert.equal(collectionPage(objects,'missing',30).page,0);assert.equal(collectionPage(objects,'missing').items.length,0);
 const cast=[];for(let page=0;page<67;page++){const group=roomCast(objects,page);assert.ok(group.items.length<=3);cast.push(...group.items.map(o=>o.id));}assert.equal(new Set(cast).size,200);assert.equal(roomCast(objects,67).page,0);
});
test('language switch translates authored fragments without rewriting user names, memories, or HTML values',()=>{
 try{setLanguage('en');const name='小屋里的杯子',memory='我在小屋里记下：等我回应';assert.equal(getLanguage(),'en');assert.equal(t('等我回应'),'Awaiting my reply');assert.equal(ui`<p>当前物品：${name}</p>`, `<p>Selected: ${name}</p>`);assert.equal(ui`<p>${memory}</p>`,`<p>${memory}</p>`);assert.match(translateError('unknown backend error'),/could not/);setLanguage('zh');assert.equal(t('等我回应'),'等我回应');}finally{setLanguage('zh');}
});
