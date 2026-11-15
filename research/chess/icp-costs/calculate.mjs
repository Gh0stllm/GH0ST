import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url);
const load=p=>JSON.parse(readFileSync(new URL(p,here)));
const cmc=load('cmc-rate.json'),p=load('pricing.json');
assert.ok(cmc.blsCertificateVerified&&cmc.witnessRootVerified&&cmc.returnedRateLeafVerified);
const cyclesPerIcp=BigInt(cmc.cyclesPerIcp),sig=BigInt(p.cyclesPerProductionEcdsaSignature);
const scale=(cycles,nodes)=>(cycles*BigInt(nodes)+12n)/13n;
const money=cycles=>({cycles:cycles.toString(),trillionCycles:Number(cycles)/1e12,icp:Number(cycles)/Number(cyclesPerIcp),minimumIcpE8sRoundedUp:((cycles*100000000n+cyclesPerIcp-1n)/cyclesPerIcp).toString(),usdAtMarketQuote:Number(cycles)/Number(cyclesPerIcp)*p.marketUsdPerIcp,usdAtDocsIllustrativeXdr:Number(cycles)/1e12*p.illustrativeUsdPerXdrInDocs});
const measured=[];
for(const name of ['pocketic-1m-evidence.json','pocketic-3m-evidence.json']){
 const evidence=load('../engine/continuation/experiment/evidence/'+name);
 for(const row of evidence.tests){
  assert.ok(row.exact_native_match);
  const instructions=row.calls.reduce((s,c)=>s+BigInt(c.instructions),0n);
  const cycles=instructions*BigInt(p.cyclesPerInstruction)+BigInt(row.calls.length)*BigInt(p.cyclesPerUpdate);
  measured.push({source:'../engine/continuation/experiment/evidence/'+name,positionId:row.position,targetNodes:row.target_nodes,sampledInstructions:instructions.toString(),updates:row.calls.length,costBasis:'Sampled instructions plus update base fees only; excludes ingress, encoding tail, authority, RPC, signing and storage',subnets:[13,34].map(nodes=>({nodes,cost:money(scale(cycles,nodes))}))});
 }
}
const localPath=new URL('pocketic-costs.json',here);
const local=existsSync(localPath)?load('pocketic-costs.json'):null;
const localCases=(local?.cases||[]).filter(r=>r.nativeExact).map(r=>({...r,calls:undefined,cost13Nodes:money(BigInt(r.localCyclesDebitedTotal)),cost34NodeScaledScenario:money(scale(BigInt(r.localCyclesDebitedTotal),34)),note:'13-node local cycle debits are artificial observed PocketIC charges, not a mainnet receipt. 34-node value is scaled arithmetic, not execution on that subnet.'}));
const base=measured.find(r=>r.targetNodes===3000000);
const baseCycles=BigInt(base.subnets[0].cost.cycles);
const empirical3m=localCases.find(r=>r.targetNodes===3000000);
const preferredCycles=empirical3m?BigInt(empirical3m.localCyclesDebitedTotal):baseCycles;
const budgetCases=[{targetNodes:3000000,cycles:preferredCycles},...localCases.filter(r=>r.targetNodes!==3000000).map(r=>({targetNodes:r.targetNodes,cycles:BigInt(r.localCyclesDebitedTotal)}))];
const projections=[];
// These are bot decisions, not plies, both-side moves, or measured whole-game bills.
for(const budget of budgetCases)for(const nodes of [13,34]){
 const perMove=scale(budget.cycles,nodes);
 const cases=[40,60,80].map(botMoves=>({botMoves,searchOnly:money(perMove*BigInt(botMoves)),searchPlusOneTerminalSignature:money(perMove*BigInt(botMoves)+sig),architectureBOneSignaturePerBotMove:money((perMove+sig)*BigInt(botMoves))}));
 projections.push({targetNodes:budget.targetNodes,nodes,perMove:money(perMove),architectureBPerMoveIncludingSignature:money(perMove+sig),games:cases,volumes:[100,1000].map(games=>({games,botMovesPerGame:60,cost:money((perMove*60n+sig)*BigInt(games)),architectureBCost:money((perMove+sig)*60n*BigInt(games)),note:'60-bot-move scenario, not an observed mean or forecast'}))});
}
const nativeDir=new URL('../benchmarks/results/baseline-3m/',here);
const nativeGames=readdirSync(nativeDir).filter(f=>f.endsWith('.json')&&!['summary.json','config.json','validation.json'].includes(f)).map(f=>({file:f,...JSON.parse(readFileSync(new URL(f,nativeDir)))})).filter(r=>r.completed&&Array.isArray(r.moves));
assert.ok(nativeGames.length>0,'No completed native games for turn-count scenarios');
const observedTurns=nativeGames.map(g=>g.moves.filter(m=>m.side==='Black').length);
const count=observedTurns.length,sum=observedTurns.reduce((a,b)=>a+b,0);
const observed=budgetCases.flatMap(budget=>[13,34].map(nodes=>{
 const perMove=scale(budget.cycles,nodes),mean=(perMove*BigInt(sum)+sig*BigInt(count))/BigInt(count);
 const bMean=(perMove+sig)*BigInt(sum)/BigInt(count);
 return{targetNodes:budget.targetNodes,nodes,sourceNativeGames:nativeGames.map(g=>({file:'../benchmarks/results/baseline-3m/'+g.file,id:g.id,plies:g.plies,botMoves:g.moves.filter(m=>m.side==='Black').length,termination:g.termination})),botMoveCounts:observedTurns,meanBotMoves:sum/count,rangeBotMoves:[Math.min(...observedTurns),Math.max(...observedTurns)],rangeSearchPlusSignature:observedTurns.map(botMoves=>({botMoves,cost:money(perMove*BigInt(botMoves)+sig),architectureBCost:money((perMove+sig)*BigInt(botMoves))})),meanSearchPlusSignature:money(mean),architectureBMeanOneSignaturePerBotMove:money(bMean),volumeAtMean:[100,1000].map(games=>({games,cost:money(mean*BigInt(games)),architectureBCost:money(bMean*BigInt(games))})),note:'Actual completed 3m-native-game bot-turn counts multiplied by one measured opening-search cost. Not the games executed/measured on ICP; position-dependent costs differ. Applying 10m per-move costs to these3m game lengths is a scenario, not an observed10m game length.'};
}));
const seconds=BigInt(p.storageMonthDays*86400),storagePerGiB=BigInt(p.cyclesPerGiBSecond)*seconds;
const storage=[13,34].map(nodes=>({nodes,scenarios:[0.5,1].map(gib=>({gib,cost:money(scale(storagePerGiB*BigInt(gib*2)/2n,nodes))})),observedWarm:(empirical3m?{bytes:empirical3m.warmStatus.memory_size,gib:empirical3m.warmStatus.memory_size/2**30,monthlyCost:money(scale(storagePerGiB*BigInt(empirical3m.warmStatus.memory_size)/1073741824n,nodes))}:null)}));
const upfront=[13,34].map(nodes=>({nodes,twoCanistersCreation:money(scale(2n*BigInt(p.cyclesPerCanisterCreation),nodes)),onePercentReservedComputePerMonth:money(scale(BigInt(p.cyclesPerComputeAllocationPercentSecond)*seconds,nodes)),note:'Creation burn only; installation/upload/reserved storage/freezing buffer and operational balance are additional. Reserved compute is optional and not assumed.'}));
const report={scope:'Optional ICP cost comparison, not architecture approval or replacement of the user-requested native Solidity design, funded deployment or full-game mainnet bill.',generatedAt:new Date().toISOString(),architectures:{A:{gameRules:'ICP',engine:'ICP',feeAndPrizeEscrow:'Robinhood',signing:'One production threshold-ECDSA signature per terminal game'},B:{gameRules:'Robinhood Solidity',engine:'ICP',feeAndPrizeEscrow:'Robinhood',signing:'Assumed one production threshold-ECDSA signature per bot move to authenticate the Solidity update; another proof system would have different cost',notMeasured:'Per-move RH state/RPC verification and native move gas are additional; this architecture is not implemented by the current ICP game-authority prototype'}},conversion:cmc,pricing:p,measuredSearchFormula:measured,localCycleObservations:localCases,preferredProjectionBasis:{kind:empirical3m?'Observed local PocketIC 3m search cycle debit, including ingress/tails':'Sampled 3m instructions plus update bases only',cyclesPerBotDecision13Nodes:preferredCycles.toString(),position:'Black after 1.e4, fresh full network and cleared128MiBTT; other positions or cache policies can cost differently'},gameProjections:projections,observedNativeTurnCountScenarios:observed,monthlyStorage:storage,upfront,productionSignature:money(sig),exclusions:['production game-authority work and storage','RH receipt/RPC outcalls and event indexing, including per-bot-move state verification for architectureB','job queue, retries, callback and continuation orchestration costs','installation/chunk upload and storage-reservation/freezing balances','Robinhood gas and GH0ST prizes','failed/aborted searches','future price/rate/subnet changes'],caveats:['Game tables are scenarios, not full games measured on ICP.','Do not linearly scale three million nodes to a different node budget without labeling it.','ArchitectureA adds one terminal signature per game; architectureB separately assumes one signature per bot move.','A 34-node computation scenario scales compute/storage by34/13; the already34-node production signing fee is not multiplied a second time.','512MiB storage is illustrative and is below this prototype warm footprint when measured;1GiB gives headroom but is not a concurrency guarantee.','Default0percent compute allocation has no reserved-compute charge and no latency guarantee.']};
writeFileSync(new URL('cost-report.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cyclesPerIcp:cmc.cyclesPerIcp,localCases:localCases.map(r=>({nodes:r.targetNodes,cycles:r.localCyclesDebitedTotal,icp:r.cost13Nodes.icp,usd:r.cost13Nodes.usdAtMarketQuote})),gameProjections:projections,observed,storage,upfront},null,2));
