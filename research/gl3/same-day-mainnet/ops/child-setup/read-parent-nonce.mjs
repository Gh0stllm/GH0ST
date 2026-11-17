// Read-only public RPC evidence. No wallet, signing, private environment or send method.
import {writeFileSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {OWNER,check} from './policy.mjs';
const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});
async function rpc(method,params){check(['eth_chainId','eth_getTransactionCount','eth_getBlockByNumber'].includes(method),'Read-only method required.');return provider.send(method,params);}
try{
check(BigInt(await rpc('eth_chainId',[]))===4663n,'Wrong parent chain.');
const [latest,pending,block]=await Promise.all([rpc('eth_getTransactionCount',[OWNER,'latest']),rpc('eth_getTransactionCount',[OWNER,'pending']),rpc('eth_getBlockByNumber',['latest',false])]);
check(BigInt(latest)===BigInt(pending),'Cold wallet has a pending or changed nonce.');
const report={owner:OWNER,parentChainId:4663,latest:Number(BigInt(latest)),pending:Number(BigInt(pending)),equal:true,parentBlockNumber:block.number,parentBlockHash:block.hash,UTC:new Date().toISOString(),source:'Node ethers JsonRpcProvider to public RH RPC, static4663/cacheTimeout:-1/batchMaxCount1; chain verified first',nonceInferred:false,signatures:0,broadcasts:0,mustRecheckBeforeActualPlanAndEverySignature:true};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}finally{provider.destroy();}
