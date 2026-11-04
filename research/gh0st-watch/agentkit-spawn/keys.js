import {Ed25519KeyIdentity} from '@icp-sdk/core/identity';
const cryptoAPI=globalThis.crypto;
const random=n=>cryptoAPI.getRandomValues(new Uint8Array(n));
const encode=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
function decode(value,bytes) {
  if(typeof value!=='string' || value.length!==2*bytes || !/^[0-9a-f]+$/i.test(value))throw new Error('This backup is malformed.');
  return Uint8Array.from(value.match(/../g),b=>parseInt(b,16));
}
const aes=(op,key,iv,data)=>cryptoAPI.subtle[op]({name:'AES-GCM',iv},key,data);
let ready;
function db(){
  if(!ready)ready=new Promise((resolve,reject)=>{
    const req=indexedDB.open('gh0st-agentkit-spawn',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('owners',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(new Error('Owner key storage is unavailable. Enable site storage to create or manage an agent.'));
  });
  return ready;
}
async function access(mode,work){
  const data=await db();
  return new Promise((resolve,reject)=>{
    const tx=data.transaction('owners',mode), req=work(tx.objectStore('owners'));
    tx.oncomplete=()=>resolve(req.result);
    tx.onabort=()=>reject(new Error('This browser could not save or read the owner key.'));
  });
}
const row=id=>access('readonly',store=>store.get(id));
export async function listKeys(){return (await access('readonly',store=>store.getAll())).map(({id,label})=>({id,label}));}
async function persist(seed,label){
  const identity=Ed25519KeyIdentity.generate(seed),id=identity.getPrincipal().toText();
  if(!await row(id)){
    const key=await cryptoAPI.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=random(12), wrapped=await aes('encrypt',key,iv,seed);
    await access('readwrite',s=>s.put({id,label,key,iv,wrapped}));
  }
  return {id,identity};
}
export function newKey(label){return persist(random(32),label);}
async function unlock(id){
  const entry=await row(id);
  if(!entry)throw new Error('Import this agent’s owner backup to manage it.');
  const seed=new Uint8Array(await aes('decrypt',entry.key,entry.iv,entry.wrapped));
  const identity=Ed25519KeyIdentity.generate(seed);
  if(identity.getPrincipal().toText()!==id)throw new Error('Owner key integrity check failed.');
  return {seed,identity,label:entry.label};
}
export async function identityFor(id){return (await unlock(id)).identity;}
export async function renameKey(id,label){
  const entry=await row(id);
  if(entry)await access('readwrite',s=>s.put({...entry,label}));
}
const tag='gh0st-spawn-owner-v1';
async function passKey(pass,salt){
  if(typeof pass!=='string'||pass.length<10||pass.length>160)throw new Error('Use a backup passphrase of 10 to 160 characters.');
  const password=await cryptoAPI.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return cryptoAPI.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},password,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function exportBackup(id,pass) {
  const {seed,label}=await unlock(id),salt=random(16),iv=random(12);
  const key=await passKey(pass,salt),cipher=await aes('encrypt',key,iv,seed);
  return {format:tag,id,label,salt:encode(salt),iv:encode(iv),cipher:encode(cipher)};
}
export async function importBackup(file,pass) {
  if(!file || file.size>4096)throw new Error('Choose a GH0ST Spawn backup under 4 KB.');
  let data;try{data=JSON.parse(await file.text());}catch{throw new Error('This file is not a GH0ST Spawn backup.');}
  if(data?.format!==tag)throw new Error('Unsupported owner backup format.');
  const key=await passKey(pass,decode(data.salt,16));
  let seed;
  try {seed=new Uint8Array(await aes('decrypt',key,decode(data.iv,12),decode(data.cipher,48)));}
  catch {throw new Error('The backup could not be unlocked. Check the file and passphrase.');}
  const id=Ed25519KeyIdentity.generate(seed).getPrincipal().toText();
  if(id!==data.id)throw new Error('The backup does not match the recorded owner.');
  return persist(seed,typeof data.label==='string'?data.label.slice(0,40):'Recovered agent');
}
