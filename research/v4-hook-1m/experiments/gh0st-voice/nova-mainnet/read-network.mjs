// Read-only network and wallet snapshot. No signer, secret key, or send method.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Interface,keccak256,formatEther} from 'ethers';
import {HERE,ROOT,CHAIN,SENDER,FACTORY,MANAGER,save} from './common.mjs';

const raw=fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').match(/^ROBINHOOD_MAINNET_RPC_URL\s*=\s*(.+)$/m)?.[1]?.trim();
const endpoint=process.env.ROBINHOOD_MAINNET_RPC_URL||raw?.replace(/^(['"])(.*)\1$/,'$2')||'https://rpc.mainnet.chain.robinhood.com';
const methods=new Set(['eth_chainId','eth_getBlockByNumber','eth_gasPrice','eth_call','eth_getCode','eth_getTransactionCount','eth_getBalance']);
let id=0;
async function rpc(method,params){assert(methods.has(method));const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});assert(res.ok,'Read-only RPC HTTP '+res.status);const b=await res.json();if(b.error)throw Error('Read-only RPC returned code '+b.error.code);return b.result;}
async function main(){
 assert.equal(Number(BigInt(await rpc('eth_chainId',[]))),CHAIN);
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 const [gasPrice,balance,latest,pending,managerCode,factoryCode]=await Promise.all([rpc('eth_gasPrice',[]),rpc('eth_getBalance',[SENDER,block.number]),rpc('eth_getTransactionCount',[SENDER,'latest']),rpc('eth_getTransactionCount',[SENDER,'pending']),rpc('eth_getCode',[MANAGER,block.number]),rpc('eth_getCode',[FACTORY,block.number])]);
 const expected=JSON.parse(fs.readFileSync(path.join(ROOT,'deployment/robinhood-mainnet-plan.json'),'utf8')).dependencies;
 assert.equal(keccak256(managerCode),expected.pool_manager_code_hash,'PoolManager identity changed');assert.equal(keccak256(factoryCode),expected.create2_deployer_code_hash,'Factory identity changed');
 const abi=new Interface(['function getGasAccountingParams() view returns(uint256,uint256,uint256)','function getPricesInWei() view returns(uint256,uint256,uint256,uint256,uint256,uint256)','function getL1BaseFeeEstimate() view returns(uint256)']);
 const arb={};for(const name of ['getGasAccountingParams','getPricesInWei','getL1BaseFeeEstimate']){const result=await rpc('eth_call',[{to:'0x000000000000000000000000000000000000006c',data:abi.encodeFunctionData(name)},block.number]);arb[name]=Array.from(abi.decodeFunctionResult(name,result),String);}
 const priceUrl='https://api.coinbase.com/v2/prices/ETH-USD/spot';const response=await fetch(priceUrl,{signal:AbortSignal.timeout(30000)});assert(response.ok,'Price endpoint HTTP '+response.status);const price=(await response.json()).data;assert(price.base==='ETH'&&price.currency==='USD'&&/^\d+(\.\d+)?$/.test(price.amount));
 const snapshot={collected_at:new Date().toISOString(),chain_id:CHAIN,rpc_host:new URL(endpoint).host,block:{number:Number(BigInt(block.number)),hash:block.hash,timestamp:Number(BigInt(block.timestamp)),gas_limit:BigInt(block.gasLimit).toString()},gas_price_wei:BigInt(gasPrice).toString(),wallet:{address:SENDER,balance_wei:BigInt(balance).toString(),balance_eth:formatEther(balance),latest_nonce:Number(BigInt(latest)),pending_nonce:Number(BigInt(pending))},dependencies:{manager:{address:MANAGER,code_hash:keccak256(managerCode)},factory:{address:FACTORY,code_hash:keccak256(factoryCode)}},arb_gas_info:arb,eth_usd:{amount:price.amount,source:priceUrl,retrieved_at:new Date().toISOString()},public_transactions_submitted:0};
 save('network-snapshot.json',snapshot);save('build/dependency-runtime.json',{manager:managerCode,factory:factoryCode});console.log(JSON.stringify(snapshot,null,2));
}
main().catch(e=>{console.error(e.name==='TypeError'?'Read-only network request unavailable':e.message);process.exitCode=1;});
