// Historical quotes for saved Watcher Uniswap v4 pool IDs only.
// node watcher_quote.mjs universe.json signals.json v4-quotes.json
import {createRequire} from 'node:module';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {historicalMarket,rpc,normalizedBlock,RH,ARCHIVE,MANAGER,QUOTER,keyType} from './quote.mjs';
const require=createRequire(new URL('../icp-checker/frontend/package.json',import.meta.url));
const {AbiCoder,Interface,keccak256}=require('ethers');
const ZERO='0x'+'0'.repeat(40), POSITION='0x58daec3116aae6d93017baaea7749052e8a04fa7';
const POSITION_HASH='0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2';
const events=new Interface(['event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)']);
const topics0=events.getEvent('Initialize').topicHash;
const hex=n=>'0x'+n.toString(16);
const match=(a,b)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
function asKey(value){return [value[0].toLowerCase(),value[1].toLowerCase(),Number(value[2]),Number(value[3]),value[4].toLowerCase()];}
const hash=key=>keccak256(AbiCoder.defaultAbiCoder().encode([keyType],[key]));
async function creationHint(pool){
  const res=await fetch('https://api.dexscreener.com/latest/dex/pairs/robinhood/'+pool,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Pool creation locator HTTP '+res.status);
  const j=await res.json(),pair=j.pairs?.find(p=>p.chainId==='robinhood'&&match(p.pairAddress,pool));
  if(!Number.isSafeInteger(pair?.pairCreatedAt))throw Error('No indexed creation time for this exact pool.');
  return Math.floor(pair.pairCreatedAt/1000);
}
export async function resolveRoute(market,asset,position){
  const pool=asset.pool.toLowerCase(),token=asset.address.toLowerCase();
  if(!/^0x[0-9a-f]{64}$/.test(pool))throw Error('Saved pool is not a v4 ID.');
  let evidence,key;
  if(position){
    const mapped=asKey(await market.call(RH,market.tip,POSITION,'poolKeys',[pool.slice(0,52)]));
    if(hash(mapped)===pool){key=mapped;evidence={source:'PositionManager.poolKeys(bytes25)',contract:POSITION,codeHash:POSITION_HASH,block:market.tip.number,blockHash:market.tip.hash};}
  }
  if(!key){
    // Locator only. AMM parameters come exclusively from an authenticated log,
    // with a canonical receipt and exact full-length key hash.
    const timestamp=await creationHint(pool),around=await market.firstAt(timestamp);
    let log;
    for(const distance of [48,512,4096]){
      const filter={address:MANAGER,topics:[topics0,pool],fromBlock:hex(Math.max(0,around.number-distance)),toBlock:hex(Math.min(market.tip.number,around.number+distance))};
      for(const provider of [RH,ARCHIVE]){
        try{
          const logs=await rpc(provider,'eth_getLogs',[filter]);
          log=logs?.find(x=>!x.removed&&match(x.address,MANAGER)&&match(x.topics?.[0],topics0)&&match(x.topics?.[1],pool));
          if(log)break;
        }catch{}
      }
      if(log)break;
    }
    if(!log)throw Error('No matching PoolManager Initialize log near indexed creation; key unresolved.');
    const block=await market.header(Number(log.blockNumber));
    const receipt=await rpc(RH,'eth_getTransactionReceipt',[log.transactionHash]);
    const confirmed=receipt.logs?.find(x=>x.logIndex===log.logIndex&&match(x.address,MANAGER)&&x.data===log.data&&JSON.stringify(x.topics)===JSON.stringify(log.topics));
    if(receipt.status!=='0x1'||receipt.transactionHash!==log.transactionHash||receipt.blockHash!==block.hash||log.blockHash!==block.hash||!confirmed)
      throw Error('Initialize receipt could not be verified against its canonical block.');
    const parsed=events.parseLog(log).args;
    key=asKey([parsed.currency0,parsed.currency1,parsed.fee,parsed.tickSpacing,parsed.hooks]);
    if(hash(key)!==pool)throw Error('Initialize key hash did not match the saved pool ID.');
    evidence={source:'PoolManager.Initialize',manager:MANAGER,tx:log.transactionHash,logIndex:Number(log.logIndex),block:block.number,blockHash:block.hash};
  }
  if(!key.slice(0,2).includes(token))return {status:'unsupported',key,evidence,reason:'On-chain currencies do not contain the saved contract.'};
  if(key[0]!==ZERO||key[1]!==token)return {status:'unsupported',key,evidence,reason:'On-chain key is not native ETH / watched contract.'};
  return {status:'verified',poolId:pool,key,evidence};
}
export async function positionActive(market){
  const b=market.tip;
  try{
    const [code,[manager],header]=await Promise.all([rpc(RH,'eth_getCode',[POSITION,hex(b.number)]),market.call(RH,b,POSITION,'poolManager',[]),rpc(RH,'eth_getBlockByNumber',[hex(b.number),false])]);
    return keccak256(code)===POSITION_HASH&&match(manager,MANAGER)&&normalizedBlock(header).hash===b.hash;
  }catch{return false;}
}
async function universeQuotes(universe,signals,outfile){
  const market=await historicalMarket(),position=await positionActive(market);
  const results={schema:'watcher-historical-v4-v1',manager:MANAGER,quoter:QUOTER,routes:[],rows:[]};
  const identities=new Map(universe.entries.map(e=>[e.address.toLowerCase(),e]));
  for(const e of signals.entries){
    if(e.status!=='evaluated'||!/^0x[\da-f]{64}$/i.test(e.pool??''))continue;
    const asset=identities.get(e.address.toLowerCase());
    if(!asset||asset.reason!==null||!match(asset.pool,e.pool))throw Error('Signal pool does not match saved Watcher universe.');
    const base={name:asset.name,address:asset.address,pool:asset.pool};
    let route;
    try{route=await resolveRoute(market,asset,position);}
    catch(error){route={status:'unresolved',reason:error.message};}
    results.routes.push({...base,...route});
    const requested=e.windows.map(({entry,exit})=>({entry,exit,kind:'signal'}));
    if(requested.length&&e.end>e.start)requested.push({entry:e.start,exit:e.end,kind:'buy-and-hold'});
    for(const w of requested){
      let record;
      if(route.status!=='verified')record={status:route.status==='unsupported'?'unsupported':'entry-unavailable',reason:route.reason};
      else try{record=await market.roundTrip(route,w);}catch(error){record={status:'entry-unavailable',reason:error.message};}
      results.rows.push({...base,...w,paperStakeWei:'5000000000000000',...record});
    }
    // Publish complete rows incrementally for reproducibility and long runs.
    await writeFile(outfile+'.tmp',JSON.stringify(results,null,2)+'\n');await rename(outfile+'.tmp',outfile);
  }
  await writeFile(outfile,JSON.stringify(results,null,2)+'\n');
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [u,s,out]=process.argv.slice(2);if(!u||!s||!out)throw Error('Usage: node watcher_quote.mjs universe.json signals.json v4-quotes.json');
  const inputs=await Promise.all([u,s].map(async file=>JSON.parse(await readFile(file,'utf8'))));
  const results=await universeQuotes(...inputs,out);
  console.log(results.routes.length+' pools, '+results.rows.length+' trade or benchmark records.');
}
