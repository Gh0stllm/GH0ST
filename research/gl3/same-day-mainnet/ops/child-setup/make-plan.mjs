// Static preparation only. A complete plan still requires live receipt verification by SetupEngine.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OWNER,GENESIS,FUNDING,actionTemplates,validatePlan,validatePolicy} from './policy.mjs';
const [configPath,policyPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: make-plan.mjs runtime-fields.json fee-policy.json output-plan.json');
const policy=readFileSync(policyPath);validatePolicy(JSON.parse(policy));const fields=JSON.parse(readFileSync(configPath));
const p={schema:'gh0st.gl3.child-setup.review.v1',owner:OWNER,parentChainId:4663,childChainId:4663001,genesisHash:GENESIS,depositUnits:String(FUNDING),feeMode:'fresh-market',aggregateFeeCeilings:null,parentNonceBase:null,factoryAddress:null,inboxAddress:null,bridgeAddress:null,rollupAddress:null,outboxAddress:null,creationTransactionHash:null,creationReceiptBlockHash:null,parentConfirmationBlocks:12,feePolicySHA256:createHash('sha256').update(policy).digest('hex'),priorUserConsentSHA256:null,...fields,automaticTopups:false,extraHeartbeatTransactions:false};
p.actions=actionTemplates(p);validatePlan(p);writeFileSync(out,JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600});
