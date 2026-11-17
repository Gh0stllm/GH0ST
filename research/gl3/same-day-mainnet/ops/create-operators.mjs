// Runpod-only operator identities. Does not fund, sign transactions or broadcast.
import fs from 'node:fs';
import os from 'node:os';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const {Wallet}=createRequire('/root/dispute/package.json')('ethers');
try {
assert.equal(process.platform,'linux');
assert.equal(os.hostname(),'cc91695a75f7');
process.umask(0o077);
const root='/workspace/gl3/mainnet';
fs.mkdirSync(root,{recursive:true,mode:0o700});
const privateDir=root+'/private',publicDir=root+'/identities';
fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
fs.mkdirSync(publicDir,{recursive:true,mode:0o700});
const privatePath=privateDir+'/operators.json',backupPath=privateDir+'/operators.age';
assert(!fs.existsSync(privatePath)&&!fs.existsSync(backupPath),'Existing keys require reconciliation, never replacement');
const recipient=fs.readFileSync(root+'/recovery-recipient.pub','utf8').trim();
assert(recipient.startsWith('ssh-ed25519 '));
const ageVersion=execFileSync('/usr/bin/age',['--version'],{encoding:'utf8'}).trim();
const roles={},addresses={};
for(const role of ['batchPoster','validator']){
    const secret=randomBytes(32),wallet=new Wallet('0x'+secret.toString('hex'));
    roles[role]={address:wallet.address,privateKey:wallet.privateKey};
    addresses[role]=wallet.address;secret.fill(0);
}
const data=Buffer.from(JSON.stringify({schema:'gh0st.gl3.operator-secrets.v1',roles},null,2)+'\n');
fs.writeFileSync(privatePath,data,{mode:0o600,flag:'wx'});
execFileSync('/usr/bin/age',['-r',recipient,'-o',backupPath],{input:data,stdio:['pipe','pipe','pipe']});
assert.equal(fs.statSync(privatePath).mode&0o777,0o600);
assert.equal(fs.statSync(backupPath).mode&0o777,0o600);
assert(fs.statSync(backupPath).size>256);
const digest=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const report={schema:'gh0st.gl3.operator-identities.v1',createdUTC:new Date().toISOString(),
    parentChainId:4663,childChainId:4663001,addresses,
    coldOwner:'0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',
    coldOwnerKeyPresentOnWorker:false,privatePath,encryptedBackupPath:backupPath,
    encryptedBackupSHA256:digest(backupPath),ageVersion,backupRecipient:recipient,
    sourceSHA256:digest(new URL(import.meta.url)),fundsMoved:false,transactionsSigned:false,publicEndpointStarted:false};
fs.writeFileSync(publicDir+'/operators.public.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
data.fill(0);
console.log(JSON.stringify(report));
} catch {
    // Crypto library errors may include their input: never log the raw error.
    console.error('Operator identity setup failed; reconcile private state before retrying.');
    process.exitCode=1;
}
