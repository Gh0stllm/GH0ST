// Runpod only. Creates encrypted operator keystores and private effective configs.
// Does not sign a transaction, fund a wallet, broadcast or start a service.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const {Wallet}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const regularPrivate=p=>{const s=fs.lstatSync(p);assert(path.isAbsolute(p)&&fs.realpathSync(p)===p&&s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.uid===process.getuid());};
const write=(p,b)=>{const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
let lockFd,lockPath;
try {
 assert.equal(os.platform(),'linux');process.umask(0o077);
 const specPath=path.resolve(process.argv[2]);const spec=JSON.parse(fs.readFileSync(specPath));
 assert(['prepare','render'].includes(spec.mode));
 const root=path.resolve(spec.root);assert(root.startsWith('/workspace/gl3/'));
 if(spec.testOnly===true){assert(root.startsWith('/workspace/gl3/same-day-network/operator-runtime-tests/'));assert.notEqual(root,'/workspace/gl3/mainnet');}
 else assert.equal(root,'/workspace/gl3/mainnet');
 assert.equal(fs.realpathSync(root),root);
 const pub=JSON.parse(fs.readFileSync(path.join(root,'identities/operators.public.json')));
 assert(pub.schema==='gh0st.gl3.operator-identities.v1'&&pub.parentChainId===4663&&pub.childChainId===4663001);
 if(spec.testOnly!==true){assert.equal(pub.coldOwner,'0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6');assert.equal(pub.addresses.batchPoster,'0x52cc715ef517CE1933142d2168B43F8fdc54b7c5');assert.equal(pub.addresses.validator,'0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad');}
 lockPath=path.join(root,'private/runtime-prepare.lock');lockFd=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lockFd,String(process.pid));
 const secrets=path.join(root,'secrets');
 if(spec.mode==='prepare'){
  assert(!fs.existsSync(secrets),'Existing operator runtime needs reconciliation.');
  const input=path.join(root,'private/operators.json');regularPrivate(input);
  const encrypted=path.join(root,'private/operators.age');regularPrivate(encrypted);
  assert.equal(hash(fs.readFileSync(encrypted)),pub.encryptedBackupSHA256);
  const offPod=JSON.parse(fs.readFileSync(spec.offPodBackupReceipt));
  assert(offPod.verified===true&&offPod.encryptedBackupSHA256===pub.encryptedBackupSHA256,'Off-pod encrypted recovery must be verified.');
  const raw=fs.readFileSync(input),operators=JSON.parse(raw);assert.equal(operators.schema,'gh0st.gl3.operator-secrets.v1');
  const staging=path.join(root,'private/runtime-stage-'+randomBytes(12).toString('hex'));fs.mkdirSync(staging,{mode:0o700});
  const passwords={},keystoreHashes={};
  for(const [role,folder] of [['batchPoster','batch-poster-keystore'],['validator','validator-keystore']]){
   const record=operators.roles[role];const wallet=new Wallet(record.privateKey);
   assert.equal(wallet.address,record.address);assert.equal(wallet.address,pub.addresses[role]);assert.notEqual(wallet.address,pub.coldOwner);
   passwords[role]=randomBytes(32).toString('hex');
   const encryptedWallet=await wallet.encrypt(passwords[role]);
   const dir=path.join(staging,folder);fs.mkdirSync(dir,{mode:0o700});write(path.join(dir,'operator.json'),encryptedWallet+'\n');
   const test=await Wallet.fromEncryptedJson(encryptedWallet,passwords[role]);assert.equal(test.address,wallet.address);
   keystoreHashes[role]=hash(Buffer.from(encryptedWallet+'\n'));record.privateKey=undefined;
  }
  raw.fill(0);operators.roles=undefined;
  write(path.join(staging,'passwords.json'),json(passwords));
  write(path.join(staging,'validator.jwt'),randomBytes(32).toString('hex')+'\n');
  fs.renameSync(staging,secrets);
  const report={schema:'gh0st.gl3.operator-runtime-prepared.v1',createdUTC:new Date().toISOString(),addresses:pub.addresses,encryptedBackupSHA256:pub.encryptedBackupSHA256,keystoreHashes,keysEncrypted:true,recoveryVerifiedOffPod:true,transactionsSigned:0,transactionsSubmitted:0,serviceStarted:false,testOnly:spec.testOnly===true};
  write(path.join(root,'identities/runtime-prepared.json'),json(report));console.log(json(report));
 } else {
  assert(spec.receiptBindingsVerified===true,'Actual reviewed receipt bindings are required.');
  const bytes=fs.readFileSync(spec.genesisFile);assert.equal(hash(bytes),spec.genesisSHA256);
  const info=fs.readFileSync(spec.chainInfoFile);assert.equal(hash(info),spec.chainInfoSHA256);
  const inputs=JSON.parse(fs.readFileSync(spec.nodeTemplate)),backend=JSON.parse(fs.readFileSync(spec.validatorTemplate));
  assert.equal(inputs.chain.id,4663001);assert.equal(inputs['parent-chain'].id,4663);
  assert.equal(inputs.http.addr,'127.0.0.1');assert.equal(inputs.node['batch-poster']['parent-chain-wallet'].account,pub.addresses.batchPoster);
  assert.equal(inputs.node.staker['parent-chain-wallet'].account,pub.addresses.validator);
  assert.equal(inputs.node.bold['minimum-gap-to-parent-assertion'],'0s');assert.equal(inputs.node.bold['assertion-posting-interval'],'5s');
  assert.equal(inputs.execution.rpc['tx-fee-cap'],1000);
  regularPrivate(path.join(secrets,'passwords.json'));const passwords=JSON.parse(fs.readFileSync(path.join(secrets,'passwords.json')));
  regularPrivate(spec.parentRpcUrlFile);const url=fs.readFileSync(spec.parentRpcUrlFile,'utf8').trim();const parsed=new URL(url);assert.equal(parsed.protocol,'https:');
  const values={'$GL3_PARENT_RPC':url,'$GL3_BATCH_POSTER_PASSWORD':passwords.batchPoster,'$GL3_VALIDATOR_PASSWORD':passwords.validator};
  function render(x){if(typeof x==='string'){if(x.startsWith('$GL3_')){assert(Object.hasOwn(values,x));return values[x];}return x;}if(Array.isArray(x))return x.map(render);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,render(v)]));return x;}
  const node=render(inputs);const config=path.join(root,'config');fs.mkdirSync(config,{recursive:true,mode:0o700});
  const cs=fs.lstatSync(config);assert(cs.isDirectory()&&!cs.isSymbolicLink()&&fs.realpathSync(config)===config&&cs.uid===process.getuid()&&(cs.mode&0o777)===0o700,'Private canonical config directory required.');
  assert.equal(backend.auth.addr,'127.0.0.1');assert.equal(backend.validation['api-auth'],true);assert.equal(backend.validation['api-public'],false);
  assert.equal(backend.auth.jwtsecret,path.join(secrets,'validator.jwt'));assert.equal(node.node['block-validator']['validation-server'].jwtsecret,backend.auth.jwtsecret);
  for(const [name,contents] of [['genesis.json',bytes],['chain-info.json',info],['node.effective.json',json(node)],['validator.effective.json',json(backend)]])write(path.join(config,name),contents);
  const report={schema:'gh0st.gl3.operator-config-rendered.v1',createdUTC:new Date().toISOString(),genesisSHA256:hash(bytes),chainInfoSHA256:hash(info),nodeEffectiveSHA256:hash(Buffer.from(json(node))),backendEffectiveSHA256:hash(Buffer.from(json(backend))),privateConfigs:true,transactionsSigned:0,transactionsSubmitted:0,serviceStarted:false};
  write(path.join(root,'identities/config-rendered.json'),json(report));console.log(json(report));
 }
} catch {
 // Never print crypto inputs, effective config or untrusted provider errors.
 console.error('Operator runtime preparation stopped. Preserve private files and reconcile before retrying.');process.exitCode=1;
} finally {
 if(lockFd!==undefined){fs.closeSync(lockFd);if(lockPath)fs.unlinkSync(lockPath);}
}
