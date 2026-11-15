// Prepares a reviewable unsigned transaction after ICP bindings exist. Never signs/broadcasts.
import fs from 'node:fs';
import { ContractFactory, getAddress, getCreateAddress, keccak256, formatEther } from 'ethers';
const filename=process.argv[2];
if(!filename){console.error('Provide the verified ICP binding JSON path. No transaction prepared.');process.exit(2);}
const b=JSON.parse(fs.readFileSync(filename));
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const owner='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const endpoint=process.env.ROBINHOOD_MAINNET_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const artifact=JSON.parse(fs.readFileSync(new URL('../../evm/hybrid-artifacts/hybridchessgame.json',import.meta.url)));
const fail=m=>{throw Error(m)};
const must=(v,m)=>v||fail(m);
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(25_000)});if(!r.ok)fail('RPC unavailable');const v=await r.json();if(v.error||v.result===undefined)fail('Read-only chain request failed');return v.result;}
try{
 must(b.scope==='verified ICP chess bootstrap'&&b.nodes===24_000_000&&b.hashMb===128&&b.cachePolicy==='retained-per-game','Missing verified fixed-policy bootstrap');
 must(b.stockfishCommit==='edb0d9db6731067ec50ce619ff372b463bc4dd5d'&&b.nnueSha256==='1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2','Model pins differ');
 must(b.engineCanisterId&&b.coordinatorCanisterId&&/^[a-f0-9]{64}$/.test(b.engineModuleHash)&&/^[a-f0-9]{64}$/.test(b.coordinatorModuleHash),'Missing actual canister hashes');
 const attestor=getAddress(b.attestorAddress);must(attestor!=='0x0000000000000000000000000000000000000000'&&/^0x[a-fA-F0-9]{64}$/.test(b.engineConfigHash),'Invalid signer/policy hash');
 must(BigInt(await rpc('eth_chainId'))===4663n,'Wrong chain');
 const code=await rpc('eth_getCode',[token,'latest']);must(keccak256(code)==='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164','Wrong token runtime');
 const outcomes=await Promise.allSettled([rpc('eth_getTransactionCount',[owner,'latest']),rpc('eth_getTransactionCount',[owner,'pending']),rpc('eth_gasPrice')]);for(const o of outcomes)if(o.status!=='fulfilled')throw o.reason;
 const[latest,pending,price]=outcomes.map(x=>x.value);must(latest===pending,'Resolve the wallet pending nonce before preparing deployment');
 const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(token,owner,attestor,b.engineConfigHash);
 const estimate=BigInt(await rpc('eth_estimateGas',[{from:owner,data:tx.data,value:'0x0'}]));
 const gas=(estimate*125n+99n)/100n;const maxFee=BigInt(price)*2n;const maxCost=gas*maxFee;
 must(maxCost<=500_000_000_000_000n,'Deployment fee would exceed the 0.0005 ETH deployment component cap');
 const out={scope:'Unsigned creation transaction for human review; no signing, broadcasting or approval implied',chainId:4663,from:owner,to:null,nonce:Number(BigInt(pending)),predictedContract:getCreateAddress({from:owner,nonce:BigInt(pending)}),constructor:{token,poolOwner:owner,attestor,engineConfigHash:b.engineConfigHash},entryGH0ST:'25000',fixedPrizeGH0ST:'1000000',automaticPauseAfterHumanCheckmate:true,startsPaused:true,creationCodeHash:keccak256(tx.data),estimateGas:estimate.toString(),maxGasCostETH:formatEther(maxCost),transaction:{type:2,chainId:4663,nonce:Number(BigInt(pending)),gasLimit:gas.toString(),maxFeePerGas:maxFee.toString(),maxPriorityFeePerGas:'0',value:'0',data:tx.data},sourceArtifact:'evm/hybrid-artifacts/hybridchessgame.json',transactionsBroadcast:0};
 console.log(JSON.stringify(out,null,2));
}catch(e){console.error(/RPC|chain|runtime|policy|pins|nonce|fee|hash|bootstrap|signer|canister/.test(e.message)?e.message:'Unsigned preparation failed; no funds moved');process.exitCode=1;}
