import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { digest } from './engine.mjs';
const req = createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const { formatUnits } = req('ethers');
const dir = path.dirname(new URL(import.meta.url).pathname);
const sha = name => digest(fs.readFileSync(path.join(dir,name)));
const c = {schema:'gh0st.gl3.automated-demo.config.v1',activationApproved:false,
 label:'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME',chainId:4663001,
 genesis:'0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483',rpc:'http://127.0.0.1:8547',
 signer:'0xe03f5f1392072f93795f95f778161ba989e7c32c',keyFile:'/workspace/gl3/mainnet/private/demo/wallet.json',stateDir:'/workspace/gl3/mainnet/private/demo/state-v1',
 intervalMs:1000,maxPending:4,tokenEveryTicks:10,nftEveryTicks:30,maxRunSeconds:21600,maxTransactions:100000,
 budgetWei:(100000n*10n**18n).toString(),reserveWei:(100n*10n**18n).toString(),gasMarginBps:12500,feeMultiplierBps:20000,mode:'counter',
 tokenRecipient:'0x000000000000000000000000000000000000dEaD',artifactsSHA256:sha('artifacts.json'),engineSHA256:sha('engine.mjs'),workerSHA256:sha('worker.mjs')};
fs.writeFileSync(path.join(dir,'config.proposed.json'),JSON.stringify(c,null,2)+'\n');
const estimates = JSON.parse(fs.readFileSync(path.join(dir,'evidence/estimates.json')));
if (estimates.results.some(x=>x.error)) throw Error('estimate errors');
const find = label => BigInt(estimates.results.find(x=>x.label===label).estimateGas);
const price = BigInt(estimates.gasPrice);
const deployments = ['Pulse','Token','NFT'].reduce((n,x)=>n+find('GL3AutomatedDemo'+x+':deployment'),0n)*price;
const counterHourly = (find('GL3AutomatedDemoPulse:steady')*3600n+find('GL3AutomatedDemoToken:steady')*360n+find('GL3AutomatedDemoNFT:steady')*120n)*price;
const selfHourly = (find('zero-value-self-transfer')*3600n+find('GL3AutomatedDemoToken:steady')*360n+find('GL3AutomatedDemoNFT:steady')*120n)*price;
const funding = [10000n,50000n,100000n].map(v=>({fundingGH0ST:String(v),retainedReserveGH0ST:'100',
 nominalCounterHoursAtCurrentTotalEstimate:Number(v*10n**18n-deployments-100n*10n**18n)/Number(counterHourly),
 conservativeHoursIfEntire125PercentGasLimitCharged:Number(v*10n**18n-deployments*125n/100n-100n*10n**18n)/Number(counterHourly*125n/100n)}));
const costs = {schema:'gh0st.gl3.automated-demo.cost-model.v1',observedUTC:estimates.observedUTC,estimateSHA256:sha('evidence/estimates.json'),
 avgPlannedTxPerSecond:34/30,plannedPulsePerHour:3600,plannedTestTokenPerHour:360,plannedDemoNFTPerHour:120,
 oneTimeDeploymentEstimateGH0ST:formatUnits(deployments,18),counterMixHourlyTotalEstimateGH0ST:formatUnits(counterHourly,18),
 zeroSelfMixHourlyTotalEstimateGH0ST:formatUnits(selfHourly,18),funding,
 maximumPending:4,quotePolicy:'Fresh live gas quote, maxFee=2x quote, gasLimit=ceil(1.25x live estimate). Max fees reserve balance but are not all necessarily paid.',
 scope:'Projection from current total eth_estimateGas including posting fees, not mined fees or throughput. Gas quote and compression/price-model updates can change it. Fees mostly go to configured treasury; no automatic topup/recycling is implemented. Parent poster ETH is separate.'};
fs.writeFileSync(path.join(dir,'evidence/cost-model.json'),JSON.stringify(costs,null,2)+'\n');
const names=['AutomatedDemo.sol','compile-estimate.mjs','engine.mjs','worker.mjs','test.mjs','run-guarded.py','preflight.mjs','freeze.mjs','artifacts.json','config.proposed.json',
 'evidence/tests.json','evidence/tests-exit.json','evidence/estimates.json','evidence/estimate-exit.json','evidence/cost-model.json'];
const manifest={schema:'gh0st.gl3.automated-demo.freeze.v1',activationApproved:false,liveSigned:0,liveSent:0,files:Object.fromEntries(names.map(name=>[name,{sha256:sha(name),bytes:fs.statSync(path.join(dir,name)).size}]))};
fs.writeFileSync(path.join(dir,'evidence/freeze.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({freezeSHA256:sha('evidence/freeze.json'),costs}));
