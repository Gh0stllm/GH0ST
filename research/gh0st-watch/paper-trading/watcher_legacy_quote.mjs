// Read-only, single-hop Uniswap V3 exact-input paper quotes for reviewed Watcher pools.
// Usage: node watcher_legacy_quote.mjs signals.json > legacy-quotes.json
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ARCHIVE, RH, historicalMarket, normalizedBlock, rpc} from './quote.mjs';

const require = createRequire(new URL('../icp-checker/frontend/package.json', import.meta.url));
const {Interface, keccak256} = require('ethers');
const FACTORY='0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const QUOTER='0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7';
const WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const INFRA = {
  [FACTORY]:'0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739',
  [QUOTER]:'0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28',
  [WETH]:'0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353',
};
// Token code hashes match the onchainBytecode returned by Sourcify. Reviewed
// NoxaFunTokenExact.yul fun_transfer and PonsLauncherToken.sol _update both
// credit the full amount and only gate transfers during their launch window.
// Reject all other tokens, any runtime change, and any still-restricted block.
const REVIEWED = {
  '0xa70fc67c9f69da90b63a0e4c05d229954574e313': {
    token:'0x020bfc650a365f8bb26819deaabf3e21291018b4', tokenCode:'0x725781ccca82a0bf9b1f8920b2fe58ea1e4facf46d0db9f50226d6409de890fe', poolCode:'0xf54b18fdd4021731542b67112c0f0e745ca7ed610df17dae69a13b06dddf92f8'},
  '0x10cc6bd38112cac182db90b6a71d8bb5939526ba': {
    token:'0x39dbed3a2bd333467115de45665cc57f813c4571', tokenCode:'0x16c3d3ede897688ddff79262606f13bead398332e65001f192460fbac4e1fb85', poolCode:'0x6b805cc147fb0d1392158bffce6dbdc926d32a88063ef74b9142efce5320d774'},
  '0x237609918f330add285b8bc5f8f2922283d1c4c5': {
    token:'0x45242320dbb855eea8fd36804c6487e10e97fcf9', tokenCode:'0xf680430391b4ba785aa712118ba59d26166adc3fe06cce93e374bcf059438994', poolCode:'0x9b98726382f028f694ba15f1cc769f840133290d438b34551f3f568219ab2948'},
};
const abi=new Interface([
  'function factory() view returns(address)', 'function WETH9() view returns(address)',
  'function token0() view returns(address)', 'function token1() view returns(address)',
  'function fee() view returns(uint24)', 'function getPool(address,address,uint24) view returns(address)',
  'function restrictionEndBlock() view returns(uint256)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)',
]);
const stake=5_000_000_000_000_000n;
const gasPerLeg=200_000n;
const providers=new Map();
async function authenticateChain(url) {
  if (!providers.has(url)) providers.set(url,Number(await rpc(url,'eth_chainId',[])));
  if (providers.get(url)!==4663) throw Error('Wrong chain ID');
}
async function quoteAt(url,b,pool,pin,buy,amount) {
  await authenticateChain(url);
  const height='0x'+b.number.toString(16);
  async function call(to,name,args=[]) {
    const data=abi.encodeFunctionData(name,args);
    const raw=await rpc(url,'eth_call',[{to,data,gas:'0x1c9c380'},height]);
    return abi.decodeFunctionResult(name,raw);
  }
  const hashes={...INFRA,[pool]:pin.poolCode,[pin.token]:pin.tokenCode};
  await Promise.all(Object.entries(hashes).map(async ([to,expected])=>{
    if (keccak256(await rpc(url,'eth_getCode',[to,height]))!==expected) throw Error('Runtime code changed at '+to);
  }));
  const [[factory],[quoterFactory],[wrapped],[token0],[token1],[fee],[lastRestricted]] = await Promise.all([
    call(pool,'factory'),call(QUOTER,'factory'),call(QUOTER,'WETH9'),call(pool,'token0'),call(pool,'token1'),
    call(pool,'fee'),call(pin.token,'restrictionEndBlock'),
  ]);
  if ([factory,quoterFactory].some(x=>x.toLowerCase()!==FACTORY)||wrapped.toLowerCase()!==WETH ||
      [token0,token1].map(x=>x.toLowerCase()).sort().join()!==[WETH,pin.token].sort().join())
    throw Error('Unrecognized factory, pair or wrapper');
  const [registered]=await call(FACTORY,'getPool',[WETH,pin.token,fee]);
  if(registered.toLowerCase()!==pool||fee!==10000n)throw Error('Pool or fee tier differs from authenticated factory');
  if(BigInt(b.number)<=lastRestricted)throw Error('Token launch transfer restrictions are still active');
  const [output,,crossed,quotedGas]=await call(QUOTER,'quoteExactInputSingle',[
    [buy?WETH:pin.token,buy?pin.token:WETH,amount,fee,0],
  ]);
  if(output<=0n)throw Error('Zero output');
  const hdr=normalizedBlock(await rpc(url,'eth_getBlockByNumber',[height,false]));
  if(hdr.hash!==b.hash||hdr.time!==b.time||hdr.baseFeeWei!==b.baseFeeWei)throw Error('Archive reference block mismatch');
  return {block:b.number,blockHash:b.hash,blockTime:b.time,stateRpc:url,input:String(amount),output:String(output),
    quoterGasUnits:String(quotedGas),initializedTicksCrossed:Number(crossed),feePips:Number(fee),lastRestrictedBlock:Number(lastRestricted),
    baseFeePerGasWei:b.baseFeeWei,assumedExecutionGasUnits:String(gasPerLeg),estimatedGasWei:b.baseFeeWei===null?null:String(gasPerLeg*BigInt(b.baseFeeWei))};
}
async function leg(market,time,pool,pin,buy,amount) {
  const block=await market.firstAt(time);
  const failures=[];
  for(const url of [ARCHIVE,RH]){
    try{return await quoteAt(url,block,pool,pin,buy,amount);}
    catch(error){failures.push(new URL(url).hostname+': '+error.message);}
  }
  throw Error(failures.join(' / '));
}
export async function quoteLegacy(market,row,trade) {
  const pool=row.pool?.toLowerCase(), pin=REVIEWED[pool];
  const record={name:row.name,address:row.address,pool,poolId:pool,...trade,paperStakeWei:String(stake),protocol:'Uniswap V3'};
  if(!pin||row.network!=='mainnet'||row.address?.toLowerCase()!==pin.token||row.side!=='base'||
      row.quoteAddress?.toLowerCase()!==WETH||!Number.isSafeInteger(row.observed)||!Number.isSafeInteger(trade.entry)||
      !Number.isSafeInteger(trade.exit)||trade.entry<row.observed||trade.exit<=trade.entry)
    return {...record,status:'unsupported',reason:'Unsupported report, pre-observation trade, token side, pool or WETH identity'};
  try{record.buy=await leg(market,trade.entry,pool,pin,true,stake);}
  catch(error){return {...record,status:'entry-unavailable',reason:error.message};}
  try{record.sell=await leg(market,trade.exit,pool,pin,false,BigInt(record.buy.output));}
  catch(error){return {...record,status:'exit-unavailable',reason:error.message};}
  const gross=BigInt(record.sell.output)-stake;
  const gas=[record.buy,record.sell].every(x=>x.estimatedGasWei!==null)?BigInt(record.buy.estimatedGasWei)+BigInt(record.sell.estimatedGasWei):null;
  return {...record,status:'quoted',pnlBeforeGasWei:String(gross),estimatedGasWei:gas===null?null:String(gas),
    pnlAfterEstimatedGasWei:gas===null?null:String(gross-gas)};
}
async function main(){
  const [file]=process.argv.slice(2);
  const signals=JSON.parse(await readFile(file,'utf8'));
  if(signals.complete!==true)throw Error('Provide a complete frozen signal report');
  const market=await historicalMarket(), rows=[];
  for(const row of signals.entries.filter(r=>r.pool?.length===42)){
    for(const window of row.windows)rows.push(await quoteLegacy(market,row,{kind:'signal',...window}));
    if(row.windows.length && row.end>row.start)
      rows.push(await quoteLegacy(market,row,{kind:'buy-and-hold',entry:row.start,exit:row.end}));
  }
  console.log(JSON.stringify({rows,model:'Historical exact-input V3 pool quotes for a 0.005 ETH stake normalized 1:1 into canonical WETH. Existing token allowance. Gas assumed 200,000 units per leg total, including wrap/unwrap, at block base fee; no priority fee or trader-specific routing charge. Independent block-end quotes; order is not submitted.',
    factory:FACTORY,quoter:QUOTER,wrapped:WETH,
    documentation:'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments',
    routes:Object.entries(REVIEWED).map(([pool,pin])=>({pool,...pin,source:'https://sourcify.dev/server/v2/contract/4663/'+pin.token+'?fields=all'}))},null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
