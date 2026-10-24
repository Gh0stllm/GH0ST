// Restores exact packed model bytes from the immutable unsigned deployment archive.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {getBytes,getAddress,hexlify} from 'ethers';
import {loadPackage} from './deploy.mjs';
import {HERE,VOICE,EXPORT,GROUPS,CHECKPOINT,sha,json,read,restoreArtifact} from './common.mjs';

const{plan,entries}=loadPackage();const manifest=JSON.parse(fs.readFileSync(path.join(HERE,'export-manifest.json'),'utf8'));
const runtimes=new Map(entries.filter(e=>['data','catalog-page','catalog-root'].includes(e.kind)).map(e=>[e.address.toLowerCase(),Buffer.from(getBytes('0x'+e.transaction.data.slice(86)))]));
function payload(address){const bytes=runtimes.get(address.toLowerCase());assert(bytes&&bytes[0]===0);return bytes.subarray(1);}
function addresses(bytes){assert.equal(bytes.length%20,0);return Array.from({length:bytes.length/20},(_,i)=>getAddress(hexlify(bytes.subarray(i*20,i*20+20))));}
fs.mkdirSync(EXPORT,{recursive:true});
for(const group of GROUPS){const pages=addresses(payload(plan.groups[group].catalog));const shards=pages.flatMap(p=>addresses(payload(p)));const bytes=Buffer.concat(shards.map(payload));assert.equal(bytes.length,manifest.artifacts[group+'.bin'].bytes);assert.equal(sha(bytes),manifest.artifacts[group+'.bin'].sha256);const dest=path.join(EXPORT,group+'.bin');if(fs.existsSync(dest))assert.equal(sha(fs.readFileSync(dest)),sha(bytes),'Refuse to overwrite differing model data');else fs.writeFileSync(dest,bytes);console.log(group+': verified '+bytes.length+' bytes');}
const dest=path.join(EXPORT,'manifest.json');if(fs.existsSync(dest))assert.equal(sha(fs.readFileSync(dest)),sha(Buffer.from(json(manifest))));else fs.writeFileSync(dest,json(manifest));
function put(file,bytes,expected){assert.equal(sha(bytes),expected);fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))assert.equal(sha(fs.readFileSync(file)),expected,'Refuse to overwrite differing data');else fs.writeFileSync(file,bytes);}
put(path.join(EXPORT,'vocabulary.json'),fs.readFileSync(path.join(HERE,'vocabulary.json')),manifest.artifacts['vocabulary.json'].sha256);
for(const name of ['sigmoid-delta.bin','exp-q32.bin'])put(path.join(EXPORT,name),fs.readFileSync(path.join(HERE,'tables',name)),manifest.artifacts[name].sha256);
const bundled=read('model-artifacts.json');
for(const[name,target,expected]of [['reference.npz.gz',path.join(EXPORT,'reference.npz'),manifest.reference_sha256],['checkpoint.safetensors.gz',path.join(VOICE,'voice-v10/runs/broad-language-2500/checkpoint-001000/model.safetensors'),CHECKPOINT]]){const file=restoreArtifact('bundle/'+name,bundled[name].sha256);put(target,gunzipSync(fs.readFileSync(file)),expected);}
console.log('Reference, lookup tables, vocabulary and selected checkpoint verified.');
