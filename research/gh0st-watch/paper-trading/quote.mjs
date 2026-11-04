/**
 * Historical, read-only Pons GH0ST/ETH quotes. Requires the Watch frontend's
 * locked ethers installation (npm ci in ../icp-checker/frontend).
 * node quote.mjs ENTRY_UNIX_SECONDS EXIT_UNIX_SECONDS ...
 * node quote.mjs --file pairs.json                  # JSON array in and out
 * cat pairs.jsonl | node quote.mjs                  # JSON lines in and out
 */
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';

const require=createRequire(new URL('../icp-checker/frontend/package.json',import.meta.url));
const {Interface,AbiCoder,keccak256}=require('ethers');
const RH='https://rpc.mainnet.chain.robinhood.com';
const ARCHIVE='https://robinhood.api.pocket.network';
const BLOCKSCOUT='https://robinhoodchain.blockscout.com/api';
const POOL='0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01';
const KEY=['0x0000000000000000000000000000000000000000','0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',0,200,'0xe5e702641ea86f4ae6cc3cdaed2b886f976be044'];
const MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951';
const MANAGER_HASH='0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626';
const QUOTER='0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const QUOTER_HASH='0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6';
const HOOK_HASH='0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db';
const keyType='(address,address,uint24,int24,address)';
if(keccak256(AbiCoder.defaultAbiCoder().encode([keyType],[KEY]))!==POOL)throw Error('Pool key pin mismatch.');
const iface=new Interface([
  'function quoteExactInputSingle(('+keyType+',bool,uint128,bytes)) returns (uint256,uint256)',
  'function poolManager() view returns (address)',
  'function poolKeys(bytes25) view returns (address,address,uint24,int24,address)',
  'function launches(bytes32) view returns (bool registered,bool memecoinIsCurrency0,address memecoin,address quoteToken,address creator,address buybackCreatorRecipient,address protocolFeeRecipient,uint16 creatorTaxBps,uint16 protocolFeeShareBps,uint16 buybackBurnBps,uint16 hookFeeBps,uint16 maxInternalPriceImpactBps,bool buybackEnabled)',
]);
const inputWei=5_000_000_000_000_000n, gasUnits=200_000n;
const hex=v=>'0x'+Number(v).toString(16);
const serial=(_,v)=>typeof v==='bigint'?v.toString():v;
let messageId=0;
async function rpc(url,method,params) {
  for(let n=0;n<3;n++){
    const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++messageId,method,params}),signal:AbortSignal.timeout(13000)});
    if(res.status===429 || res.status>=500){if(n<2){await new Promise(ok=>setTimeout(ok,500*(n+1)));continue;}}
    if(!res.ok)throw Error(method+' HTTP '+res.status);
    const reply=await res.json();
    if(reply.error || reply.result==null)throw Error(method+': '+(reply.error?.message??'missing result'));
    return reply.result;
  }
}
function normalizedBlock(b){
  const h=Number(b.number),ts=Number(b.timestamp);
  if(!Number.isSafeInteger(h)||!Number.isSafeInteger(ts)||!/^0x[\da-f]{64}$/i.test(b.hash))throw Error('Invalid RH block header');
  return {number:h,time:ts,hash:b.hash,baseFeeWei:b.baseFeePerGas==null?null:BigInt(b.baseFeePerGas).toString()};
}
async function historicalMarket(){
  if(Number(await rpc(RH,'eth_chainId',[]))!==4663)throw Error('Unexpected RH header chain');
  const providers=[];
  for(const url of [ARCHIVE,RH]){
    try{if(Number(await rpc(url,'eth_chainId',[]))===4663)providers.push(url);}catch{}
  }
  if(!providers.length)throw Error('No verified RH historical state provider available');
  const blocks=new Map(), metadata=new Map();
  let explorerUsable=true;
  async function header(height){
    if(!blocks.has(height)){
      const b=normalizedBlock(await rpc(RH,'eth_getBlockByNumber',[typeof height==='number'?hex(height):height,false]));
      blocks.set(height,b);blocks.set(b.number,b);
    }
    return blocks.get(height);
  }
  const [genesis,tip]=await Promise.all([header(0),header('latest')]);
  async function firstAt(time){
    if(!Number.isSafeInteger(time)||time<genesis.time||time>tip.time)throw Error('Timestamp outside recorded RH chain history.');
    if(time===genesis.time)return genesis;
    let lo=genesis,hi=tip;
    if(explorerUsable){
      try{
        const url=BLOCKSCOUT+'?'+new URLSearchParams({module:'block',action:'getblocknobytime',timestamp:time,closest:'after'});
        const res=await fetch(url,{signal:AbortSignal.timeout(3000)});
        if(!res.ok)throw Error();
        const data=await res.json(),candidate=Number(data.result?.blockNumber??data.result);
        if(data.status!=='1'||!Number.isSafeInteger(candidate)||candidate<0||candidate>tip.number)throw Error();
        await header(candidate);
      }catch{explorerUsable=false;}
    }
    for(const b of blocks.values()){
      if(b.time<time&&b.number>lo.number)lo=b;
      if(b.time>=time&&b.number<hi.number)hi=b;
    }
    // Interpolate over near-uniform block times first; finish with a bounded
    // binary search for the *first* of potentially many same-second blocks.
    for(let step=0;hi.number-lo.number>1;step++){
      const delta=hi.number-lo.number;
      const position=step<4&&delta>32 ? Math.round((time-lo.time)*delta/(hi.time-lo.time)) : Math.floor(delta/2);
      const mid=await header(lo.number+Math.max(1,Math.min(delta-1,position)));
      if(mid.time<time)lo=mid;else hi=mid;
    }
    if(hi.time<time||lo.time>=time||hi.number!==lo.number+1)throw Error('Timestamp boundary was not verified.');
    return hi;
  }
  async function call(url,b,to,fn,args){
    const raw=await rpc(url,'eth_call',[{to,data:iface.encodeFunctionData(fn,args),gas:'0x1c9c380'},hex(b.number)]);
    return iface.decodeFunctionResult(fn,raw);
  }
  async function pinned(url,b,route){
    const pin=url+'/'+b.hash;
    if(!metadata.has(pin)){
      const [code,managerCode,manager]=await Promise.all([
        rpc(url,'eth_getCode',[QUOTER,hex(b.number)]),rpc(url,'eth_getCode',[MANAGER,hex(b.number)]),call(url,b,QUOTER,'poolManager',[])]);
      if(keccak256(code)!==QUOTER_HASH||keccak256(managerCode)!==MANAGER_HASH||manager[0].toLowerCase()!==MANAGER)
        throw Error('Historical manager or quoter does not match pinned RH Uniswap v4 deployment.');
      metadata.set(pin,true);
    }
    if(route.poolId!==POOL)return {};
    const [hook,launch]=await Promise.all([
      rpc(url,'eth_getCode',[KEY[4],hex(b.number)]),call(url,b,KEY[4],'launches',[POOL])]);
    if(keccak256(hook)!==HOOK_HASH||!launch.registered||launch.memecoinIsCurrency0||launch.memecoin.toLowerCase()!==KEY[1]||launch.quoteToken.toLowerCase()!==KEY[0])
      throw Error('Historical Pons contract or pool registration does not match pinned route.');
    return {hookFeeBps:Number(launch.hookFeeBps),creatorTaxBps:Number(launch.creatorTaxBps)};
  }
  async function quote(b,buy,amount,route){
    if(amount<=0n||amount>=1n<<128n)throw Error('Quoted input is outside uint128 range.');
    let reasons=[];
    for(const url of providers){
      try{
        const rates=await pinned(url,b,route);
        const [output,quotedGas]=await call(url,b,QUOTER,'quoteExactInputSingle',[[route.key,buy,amount,'0x']]);
        if(output<=0n)throw Error('The v4 quoter returned no output.');
        const end=normalizedBlock(await rpc(url,'eth_getBlockByNumber',[hex(b.number),false]));
        if(end.hash!==b.hash||end.time!==b.time||end.baseFeeWei!==b.baseFeeWei)throw Error('Historical block mismatch between providers.');
        return {block:b.number,blockHash:b.hash,blockTime:b.time,stateRpc:url,input:amount.toString(),output:output.toString(),quoterGasUnits:quotedGas.toString(),
          ...rates,baseFeePerGasWei:b.baseFeeWei,assumedExecutionGasUnits:gasUnits.toString(),estimatedGasWei:b.baseFeeWei===null?null:(gasUnits*BigInt(b.baseFeeWei)).toString()};
      }catch(e){reasons.push(new URL(url).hostname+': '+e.message);}
    }
    throw Error('Historical quote unavailable. '+reasons.join(' / '));
  }
  async function roundTrip(route,{entry,exit,kind}){
    if(route.key[0]!==KEY[0]||keccak256(AbiCoder.defaultAbiCoder().encode([keyType],[route.key]))!==route.poolId)throw Error('Expected a native ETH / token pool with matching ID.');
    if(!Number.isSafeInteger(entry)||!Number.isSafeInteger(exit)||exit<=entry)throw Error('Use increasing UNIX seconds for entry and exit.');
    const common={entry,exit,kind,poolId:route.poolId,paperStakeWei:inputWei.toString()};
    let buy,sell;
    try{buy=await quote(await firstAt(entry),true,inputWei,route);}
    catch(e){return {...common,status:'entry-unavailable',reason:e.message};}
    try{sell=await quote(await firstAt(exit),false,BigInt(buy.output),route);}
    catch(e){return {...common,status:'exit-unavailable',buy,reason:e.message};}
    const beforeGas=BigInt(sell.output)-inputWei;
    const gasWei=buy.estimatedGasWei===null||sell.estimatedGasWei===null?null:BigInt(buy.estimatedGasWei)+BigInt(sell.estimatedGasWei);
    return {...common,status:'quoted',buy,sell,pnlBeforeGasWei:beforeGas.toString(),estimatedGasWei:gasWei?.toString()??null,
      pnlAfterEstimatedGasWei:gasWei===null?null:(beforeGas-gasWei).toString(),model:'Independent block-end exact-input quotes, inclusive of hook effects. Estimated gas assumes 200000 units per leg at block base fee, zero priority fee and existing allowance. No fill, submission or persistent market impact from the paper order.'};
  }
  return {firstAt,header,tip,call,roundTrip};
}
async function historicReader(){
  const market=await historicalMarket();
  return trade=>market.roundTrip({poolId:POOL,key:KEY},trade);
}
export {historicReader,historicalMarket,rpc,normalizedBlock,RH,ARCHIVE,MANAGER,QUOTER,keyType};
async function main(){
  const argv=process.argv.slice(2),arrayMode=argv[0]==='--file';
  let pairs=[];
  if(arrayMode){
    if(argv.length!==2)throw Error('Usage: node quote.mjs --file pairs.json');
    pairs=JSON.parse(await readFile(argv[1],'utf8'));if(!Array.isArray(pairs))throw Error('Expected a JSON array of {entry,exit}.');
  }else if(argv.length){
    if(argv.length%2)throw Error('Usage: node quote.mjs entryUnix exitUnix [...]');
    for(let i=0;i<argv.length;i+=2)pairs.push({entry:Number(argv[i]),exit:Number(argv[i+1])});
  }else{
    for await(const line of createInterface({input:process.stdin}))if(line.trim())pairs.push(JSON.parse(line));
  }
  if(!pairs.length)throw Error('Supply at least one timestamp pair.');
  const session=await historicReader().then(reader=>({reader}),error=>({error}));
  const results=[];
  for(const {entry,exit,kind} of pairs){
    let record;
    try{if(session.error)throw session.error;record=await session.reader({entry,exit,kind});}
    catch(e){record={status:'unavailable',entry,exit,kind,reason:e.message};process.exitCode=2;}
    if(record.status!=='quoted')process.exitCode=2;
    if(arrayMode)results.push(record);else console.log(JSON.stringify(record,serial));
  }
  if(arrayMode)console.log(JSON.stringify(results,serial,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
