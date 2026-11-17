// Runpod only. Generates a bounded temporary deployment identity; no funds/signing.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const {Wallet}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
try {
 assert.equal(process.platform,'linux');process.umask(0o077);
 const root='/workspace/gl3/mainnet';
 const secretFile=root+'/private/deployment-signer.json',backupFile=root+'/private/deployment-signer.age',publicFile=root+'/identities/deployment-signer.public.json';
 assert(![secretFile,backupFile,publicFile].some(fs.existsSync),'An existing deployment identity must be reconciled.');
 const recipient=fs.readFileSync(root+'/recovery-recipient.pub','utf8').trim();assert(recipient.startsWith('ssh-ed25519 '));
 const wallet=new Wallet('0x'+randomBytes(32).toString('hex'));
 const bytes=Buffer.from(JSON.stringify({schema:'gh0st.gl3.temporary-deployment-signer.v1',address:wallet.address,privateKey:wallet.privateKey},null,2)+'\n');
 fs.writeFileSync(secretFile,bytes,{flag:'wx',mode:0o600});
 execFileSync('/usr/bin/age',['-r',recipient,'-o',backupFile],{input:bytes,stdio:['pipe','pipe','pipe']});bytes.fill(0);
 const report={schema:'gh0st.gl3.temporary-deployer-public.v1',createdUTC:new Date().toISOString(),address:wallet.address,coldOwner:'0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',parentChainId:4663,fundingProposalWei:'5000000000000000',tokenFunding:false,adminAuthority:false,privatePath:secretFile,encryptedBackupPath:backupFile,encryptedBackupSHA256:createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex'),sourceSHA256:createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),fundsMoved:false,transactionsSigned:0,transactionsSubmitted:0};
 fs.writeFileSync(publicFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
} catch {console.error('Deployment identity preparation stopped; reconcile private state before retrying.');process.exitCode=1;}
