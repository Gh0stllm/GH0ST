import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Principal} from '@icp-sdk/core/principal';
import {Ed25519KeyIdentity} from '@icp-sdk/core/identity';
import {CANISTERS,privateFile,loadWorkerIdentity,normalizeStatus,parseArchiveRequest,managementIdl} from '../server/read-only-icp.mjs';
import {readServerCredential,validateServerActivation} from '../scripts/run-server-worker.mjs';
import {createHash} from 'node:crypto';
import {IDL} from '@icp-sdk/core/candid';

test('Server identity loader rejects administrator or replacement identities without exposing key material',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh0st-server-identity-'));
 try{const p=path.join(dir,'worker.json');fs.writeFileSync(p,JSON.stringify(Ed25519KeyIdentity.generate().toJSON()),{mode:0o600});assert.throws(()=>loadWorkerIdentity(p),/existing limited worker/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Private server inputs reject world-readable files, symlinks and oversized input',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh0st-server-private-'));
 try{const p=path.join(dir,'file');fs.writeFileSync(p,'test',{mode:0o644});assert.throws(()=>privateFile(p),/private|Private/);fs.chmodSync(p,0o600);assert.equal(privateFile(p).toString(),'test');assert.throws(()=>privateFile(p,{maxBytes:3}),/bounded/);fs.symlinkSync(p,path.join(dir,'link'));assert.throws(()=>privateFile(path.join(dir,'link')),/regular file/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Management status normalization preserves exact large cycle counts and controller identity',()=>{
 const owner=Principal.fromText('uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe');
 const r=normalizeStatus(CANISTERS.model,{status:{running:null},settings:{controllers:[owner]},module_hash:[Uint8Array.from({length:32},()=>171)],cycles:99999999999999999n,reserved_cycles:0n,memory_size:5n,idle_cycles_burned_per_day:6n});
 assert.equal(r.cycles,'99999999999999999');assert.equal(r.module_hash,'0x'+'ab'.repeat(32));assert.equal(r.settings.controllers[0],owner.toText());assert.equal(r.status,'Running');
 assert.throws(()=>normalizeStatus(CANISTERS.model,{module_hash:[]}),/Missing complete/);
});
test('Archive requests reject update methods and traversal while preserving exact fixed query arguments',()=>{
 assert.deepEqual(parseArchiveRequest('get_chats','()'),[]);
 const dir='.canister_cache/'+CANISTERS.coordinator+'/db_chats';
 assert.deepEqual(parseArchiveRequest('recursive_dir_content_query',`(record {dir="${dir}";max_entries=12:nat64})`),[{dir,max_entries:12n}]);
 const filename=dir+'/2026-10-27_01-02-03';
 assert.equal(parseArchiveRequest('file_download_chunk',`(record {filename="${filename}";chunksize=65536:nat64;offset=0:nat64})`)[0].filename,filename);
 for(const [method,arg]of [['chats_resume','()'],['file_download_chunk',`(record {filename="${dir}/../../keys";chunksize=65536:nat64;offset=0:nat64})`],['recursive_dir_content_query','(record {dir="/";max_entries=12:nat64})']])assert.throws(()=>parseArchiveRequest(method,arg),/read-only/);
});
test('Management reader exposes only queries and no topup, settings, upgrade or signing methods',()=>{
 const service=managementIdl({IDL});assert.deepEqual(service._fields.map(([n])=>n).sort(),['canister_status','fetch_canister_logs']);for(const[,method]of service._fields)assert.deepEqual(method.annotations,['query']);
});
test('Headless credential is bounded, private, read from the service credential directory and never from a password environment variable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gh0st-server-credential-'));
 try{fs.writeFileSync(path.join(dir,'rh-relayer-password'),'test credential\n',{mode:0o600});const env={GH0ST_SERVER_RUNTIME:'1',GH0ST_SERVER_LEGACY_ONLY:'1',CREDENTIALS_DIRECTORY:dir};assert.equal(readServerCredential(env),'test credential');assert.throws(()=>readServerCredential({...env,RH_RELAYER_PASSWORD:'secret'}),/Raw secrets/);assert.throws(()=>readServerCredential({...env,GH0ST_SERVER_LEGACY_ONLY:'0'}),/preserve/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Server activation binds actual machine, immutable frozen snapshot and final source-writer fence',()=>{
 const hostId='a'.repeat(64),handoffId='verified-handoff-20261027',at='2026-10-27T00:00:00.000Z';
 const snapshot={schema:'gh0st-server-handoff-snapshot-v1',kind:'final_frozen',writerFence:{handoffId,destinationHostId:hostId,sourceWritersStopped:true,destinationWritersDisabled:true,checkedAt:at}};
 const snapshotBytes=Buffer.from(JSON.stringify(snapshot));
 const permit={schema:'gh0st-server-activation-v1',accepted:true,hostname:'verified-server',hostId,handoffId,finalSnapshotSha256:createHash('sha256').update(snapshotBytes).digest('hex'),oldSendersFencedAt:at};
 const args={hostname:'verified-server',hostId,snapshotBytes};
 assert.equal(validateServerActivation(permit,args),true);
 assert.throws(()=>validateServerActivation(permit,{...args,hostname:'copied-host'}),/host/);
 assert.throws(()=>validateServerActivation({...permit,finalSnapshotSha256:'not-a-hash'},args),/snapshot/);
 assert.throws(()=>validateServerActivation(permit,{...args,snapshotBytes:Buffer.from(JSON.stringify({...snapshot,kind:'warm_copy'}))}),/snapshot/);
 const unsafe=Buffer.from(JSON.stringify({...snapshot,writerFence:{...snapshot.writerFence,sourceWritersStopped:false}}));
 assert.throws(()=>validateServerActivation({...permit,finalSnapshotSha256:createHash('sha256').update(unsafe).digest('hex')},{...args,snapshotBytes:unsafe}),/source-writer/);
});
