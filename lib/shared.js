import { randomUUID } from 'node:crypto';
export const USERS=[{id:'a',name:'小满',color:'#e6a64d'},{id:'b',name:'小北',color:'#9c9ee5'},{id:'c',name:'阿栗',color:'#8ebaa3'}];
export const uid=()=>randomUUID().replaceAll('-','');
export const now=()=>new Date().toISOString();
export const ids=new Set(USERS.map(u=>u.id));
export class Problem extends Error {constructor(message,status=400){super(message);this.status=status;}}
export function text(data,key,max=600,required=false){const v=data[key]??'';if(typeof v!=='string')throw new Problem('请输入文字');const s=v.trim();if(required&&!s)throw new Problem('请把故事和名字填写完整');if(s.length>max)throw new Problem(`请控制在 ${max} 字以内`);return s;}
export function tag(data,actor,users=USERS){const value=data.tagged_user_id||null;if(value!==null&&(!users.some(user=>user.id===value)||value===actor))throw new Problem('请标注小屋里的另一位朋友');return value;}

export const OBJECT_LABELS={mug:'杯子',keyboard:'键盘',plant:'植物',other:'其他物品'};
export function objectKind(type){
 if(/杯|保温壶|\b(cup|mug|thermos)\b/i.test(type))return 'mug';
 if(/键盘|\bkeyboard\b/i.test(type))return 'keyboard';
 if(/植物|盆栽|绿萝|多肉|花盆|\b(plant|succulent)\b/i.test(type))return 'plant';
 return 'other';
}
