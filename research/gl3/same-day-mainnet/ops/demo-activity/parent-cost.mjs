import fs from 'node:fs';
import path from 'node:path';
const url='https://rpc.mainnet.chain.robinhood.com';
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('PARENT_RPC_HTTP_'+r.status);const v=await r.json();if(v.error)throw Error('PARENT_RPC_ERROR');return v.result;}
if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error('WRONG_PARENT');
const hash='0x3f1a08133bdc5bfd7783e365b5d331ecec90cb825fcfcb90775abd045688afa8';
const [receipt,tx,price]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_gasPrice',[])]);
const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
if(block.hash!==receipt.blockHash||receipt.status!=='0x1'||tx.from.toLowerCase()!=='0x52cc715ef517ce1933142d2168b43f8fdc54b7c5')throw Error('NONCANONICAL_POSTER_REFERENCE');
const gas=BigInt(receipt.gasUsed),quote=BigInt(price);
const report={schema:'gh0st.gl3.automated-demo.parent-cost-reference.v1',observedUTC:new Date().toISOString(),parentChainId:4663,
 referenceBatch:{hash,block:receipt.blockNumber,blockHash:block.hash,gasUsed:String(gas),gasUsedForL1:receipt.gasUsedForL1??null,effectiveGasPrice:String(BigInt(receipt.effectiveGasPrice)),paidWei:String(gas*BigInt(receipt.effectiveGasPrice)),calldataBytes:(tx.input.length-2)/2},
 currentParentGasPriceWei:String(quote),hypotheticalBatchesPerHourAt10SecondInterval:360,
 historicGasShapeAtCurrentPricePerHourWei:String(gas*quote*360n),
 scope:'Historical canonical batch reference only. 360 times this gas shape is not a quote for the new demo workload. Actual data compression, batch size/frequency, parent posting component and fee quote require a measured pilot. Parent ETH is separate from child GH0ST. No topups or transactions sent.'};
const dir=path.dirname(new URL(import.meta.url).pathname);fs.writeFileSync(path.join(dir,'evidence/parent-cost-reference.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
