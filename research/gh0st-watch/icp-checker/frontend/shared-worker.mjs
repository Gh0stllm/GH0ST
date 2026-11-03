import {getAddress} from 'ethers';
import {scan,networks,rpc,qwenSummary} from './scan.js';
import {enrich} from './intelligence.js';
import {fetchMarket} from './market.js';
import {isPlatformToken} from './platform-token.js';

// Finish before the synchronous function deadline so its caller can publish
// the completed snapshot. Optional providers may finish later than the checks.
const maxCoreMs=34_000, maxTotalMs=48_000;
function within(promise,ms) {
  let timeout;
  const expired=new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('The shared scan timed out.')),Math.max(0,ms));
  });
  return Promise.race([promise,expired]).finally(()=>clearTimeout(timeout));
}

export async function generateReport(network,rawAddress) {
  if (!Object.hasOwn(networks,network) || typeof rawAddress!=='string' || !/^0x[\da-f]{40}$/i.test(rawAddress))
    throw new Error('Enter a Robinhood mainnet or testnet contract address.');
  const address=getAddress(rawAddress), started=Date.now(), trace=[];
  if (isPlatformToken(network,address))
    return {network,address,name:'GH0ST',trace,report:null,scannedAt:started,openedAt:started,details:{}};

  const step=message=>trace.push(((Date.now()-started)/1000).toFixed(1)+'s · '+message);
  const report=await within(scan(network,address,step),maxCoreMs);
  const scannedAt=Date.now();
  step('RH block hash rechecked. Behavior results ready.');
  const fields=new Map(report.overview.fields);
  const name=String(fields.get('Symbol') || fields.get('Name') || report.name || 'RH contract').slice(0,90);

  const remaining=maxTotalMs-(scannedAt-started);
  const [intel,market,note]=await Promise.all([
    within(enrich(networks[network],report,rpc),remaining).catch(()=>null),
    within(fetchMarket(network,address),remaining).catch(()=>({available:false,reason:'Market data unavailable.'})),
    within(qwenSummary(report),remaining).catch(()=>null),
  ]);
  return {network,address,name,report,trace,scannedAt,openedAt:scannedAt,details:{intel,market,note}};
}
