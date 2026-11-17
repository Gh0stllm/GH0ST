// Generates only a dedicated, unfunded demonstration identity on Runpod.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const {Wallet}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const root='/workspace/gl3/mainnet',priv=root+'/private/demo',report=root+'/identities/demo.public.json';
try{
 assert.equal(process.platform,'linux');process.umask(0o077);
 fs.mkdirSync(priv,{mode:0o700});assert(!fs.existsSync(report));
 const recipient=fs.readFileSync(root+'/recovery-recipient.pub','utf8').trim();assert(recipient.startsWith('ssh-ed25519 '));
 const secret=randomBytes(32),wallet=new Wallet('0x'+secret.toString('hex'));secret.fill(0);
 const bytes=Buffer.from(JSON.stringify({schema:'gh0st.gl3.demo-secret.v1',address:wallet.address,privateKey:wallet.privateKey})+'\n');
 fs.writeFileSync(priv+'/wallet.json',bytes,{mode:0o600,flag:'wx'});
 execFileSync('/workspace/gl3/durable/demo-tools/age',['-r',recipient,'-o',priv+'/wallet.age'],{input:bytes,stdio:['pipe','pipe','pipe']});bytes.fill(0);
 const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 const out={schema:'gh0st.gl3.demo-identity.v1',createdUTC:new Date().toISOString(),address:wallet.address,childChainId:4663001,scope:'Dedicated automated demonstration transactions only; no validator, poster, ownership or mint authority',encryptedBackupSHA256:digest(priv+'/wallet.age'),sourceSHA256:digest(new URL(import.meta.url)),funded:false,transactionsSigned:false};
 fs.writeFileSync(report,JSON.stringify(out,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(out));
}catch{console.error('Demo identity creation failed. Preserve and reconcile existing private files before any retry.');process.exitCode=1;}
