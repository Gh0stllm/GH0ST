// Public configuration/source freeze only. Never reads a wallet, production journal or private config.
import fs from 'node:fs';import path from 'node:path';import {digest,ensure} from './engine.mjs';
const dir=path.dirname(new URL(import.meta.url).pathname),sha=n=>digest(fs.readFileSync(path.join(dir,n)));
const fundingHash=process.argv[2]??null;ensure(fundingHash===null||/^0x[0-9a-f]{64}$/i.test(fundingHash),'INVALID_ADDITIONAL_FUNDING_HASH');
const old=JSON.parse(fs.readFileSync(path.join(dir,'../config.proposed.json')));
const c={...old,schema:'gh0st.gl3.automated-demo.config.v2',activationApproved:false,policyVersion:2,
 journalIdentityConfigSHA256:'1e203f27e8668824a20fcceb9db75eae9e78f5f800f553e2040cddfc1038ad59',maxPending:1,intervalMs:1000,
 maxRunSeconds:86400,maxTransactions:100000,budgetWei:String(350000n*10n**18n),stateDir:'/workspace/gl3/mainnet/private/demo/state-v2',
 artifactsSHA256:sha('artifacts.json'),engineSHA256:sha('engine.mjs'),workerSHA256:sha('worker.mjs'),
 fundingReceipts:[{hash:'0x039a2bda3b4e915e41d27b0d1669c5ba008e702ce38228ed1839969157600ed8',amountWei:String(100000n*10n**18n)},
 {hash:fundingHash,amountWei:String(250000n*10n**18n)}]};
fs.writeFileSync(path.join(dir,'config.proposed.json'),JSON.stringify(c,null,2)+'\n');
const spec={schema:'gh0st.gl3.demo-migration-approval.v2',approved:false,oldControllerPID:8221,oldWorkerPID:8231,
 oldStateDir:'/workspace/gl3/mainnet/private/demo/state-v1',oldExitReceiptPath:null,
 newConfigPath:'/workspace/gl3/mainnet/private/demo/config-v2.approved.json',newConfigSHA256:null,migratorSHA256:sha('migrate.mjs')};
fs.writeFileSync(path.join(dir,'migration-approval.example.json'),JSON.stringify(spec,null,2)+'\n');
const files=['engine.mjs','worker.mjs','run-guarded.py','migrate.mjs','prestop-check.mjs','test.mjs','prepare.mjs','artifacts.json','config.proposed.json','migration-approval.example.json','evidence/tests.json','evidence/tests-exit.json'];
const manifest={schema:'gh0st.gl3.automated-demo.v2-freeze.v1',activationApproved:false,actualMigrationPerformed:false,
 originalProductionJournalRead:false,actualWorkerChanged:false,additionalFundingHash:fundingHash,
 files:Object.fromEntries(files.map(n=>[n,{sha256:sha(n),bytes:fs.statSync(path.join(dir,n)).size}]))};
fs.writeFileSync(path.join(dir,'evidence/freeze.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceFreezeSHA256:sha('evidence/freeze.json'),configProposedSHA256:sha('config.proposed.json'),migratorSHA256:sha('migrate.mjs'),additionalFundingSelected:fundingHash!==null}));
