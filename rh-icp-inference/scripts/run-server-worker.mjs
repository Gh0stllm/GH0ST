import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runBuyWorker} from './run-buy-worker.mjs';
import {unlockKeystore} from './execute-rh.mjs';
import {privateFile,loadWorkerIdentity} from '../server/read-only-icp.mjs';

export function readServerCredential(env=process.env){
 if(env.GH0ST_SERVER_RUNTIME!=='1'||env.GH0ST_SERVER_LEGACY_ONLY!=='1')throw Error('Server must explicitly preserve the current 30-180 character production behavior');
 if(env.RH_RELAYER_PRIVATE_KEY||env.RH_RELAYER_PASSWORD)throw Error('Raw secrets in environment variables are forbidden');
 const dir=env.CREDENTIALS_DIRECTORY;
 if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('A systemd credential directory is required');
 const data=privateFile(path.join(dir,'rh-relayer-password'),{maxBytes:4096}).toString('utf8').replace(/\r?\n$/,'');
 if(!data.length||/[\r\n\0]/.test(data))throw Error('Relayer credential is empty or invalid');
 return data;
}
export function validateServerActivation(permit,{hostname,hostId,snapshotBytes}={}){
 const hash=createHash('sha256').update(snapshotBytes??'').digest('hex');
 if(permit?.schema!=='gh0st-server-activation-v1'||permit.accepted!==true||permit.hostname!==hostname||permit.hostId!==hostId||!/^[0-9a-f]{64}$/.test(permit.finalSnapshotSha256??'')||permit.finalSnapshotSha256!==hash)throw Error('Activation host or immutable final snapshot differs');
 const s=JSON.parse(snapshotBytes);
 if(s.schema!=='gh0st-server-handoff-snapshot-v1'||s.kind!=='final_frozen'||s.writerFence?.handoffId!==permit.handoffId||String(permit.handoffId??'').length<16||s.writerFence.sourceWritersStopped!==true||s.writerFence.destinationWritersDisabled!==true||s.writerFence.destinationHostId!==hostId||permit.oldSendersFencedAt!==s.writerFence.checkedAt||!Number.isFinite(Date.parse(permit.oldSendersFencedAt)))throw Error('Activation lacks the accepted frozen handoff and source-writer fence');
 return true;
}
export async function main(){
 if(process.platform!=='linux')throw Error('The server launcher is Linux-only');
 loadWorkerIdentity();
 const activation=process.env.GH0ST_ACTIVATION_FILE;
 if(!activation)throw Error('Final verified single-writer handoff activation is missing');
 const permit=JSON.parse(privateFile(activation,{maxBytes:16384}).toString('utf8'));
 if(permit.hostname!==process.env.GH0ST_SERVER_HOSTNAME||!path.isAbsolute(permit.finalSnapshotFile??''))throw Error('Server activation must identify the real configured host and immutable snapshot path');
 const hostId=createHash('sha256').update(fs.readFileSync('/etc/machine-id')).digest('hex');
 validateServerActivation(permit,{hostname:os.hostname(),hostId,snapshotBytes:privateFile(permit.finalSnapshotFile,{maxBytes:64*1024*1024})});
 let password=readServerCredential();let signer;
 try{signer=await unlockKeystore(process.env.RH_RELAYER_KEYSTORE_FILE,process.env.RH_RELAYER_ADDRESS,async()=>password);}
 finally{password=undefined;}
 await runBuyWorker({signer});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error('GH0ST server launch failed closed. Check private activation, worker credentials and runtime preflight. No secret was logged.');process.exitCode=78;});
