// Read-only historical nonce search. Does not sign, send or modify any journal.
import {JsonRpcProvider,Interface} from 'ethers';
import {writeFileSync} from 'node:fs';
import {OWNER,TOKEN,check,same,inbox} from './policy.mjs';
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1}),counts=new Map();let requests=0;
const get=async(m,p)=>{check(['eth_chainId','eth_getTransactionCount','eth_getBlockByNumber','eth_getTransactionReceipt'].includes(m));requests++;return rpc.send(m,p);};
const count=async b=>{const key=String(b);if(!counts.has(key))counts.set(key,BigInt(await get('eth_getTransactionCount',[OWNER,'0x'+b.toString(16)])));return counts.get(key);};
const tokenABI=new Interface(['function approve(address,uint256)','function transfer(address,uint256)']);
try{
 check(BigInt(await get('eth_chainId',[]))===4663n);const lower=116784951n,head=await get('eth_getBlockByNumber',['latest',false]),upper=BigInt(head.number);check(await count(lower)===6476n,'Known nonce checkpoint differs.');const found=[];
 for(const nonce of [6476n,6477n]){
  let lo=lower,hi=upper;check(await count(hi)>nonce,'Target nonce is not canonically consumed.');
  while(lo+1n<hi){const mid=(lo+hi)/2n;if(await count(mid)>nonce)hi=mid;else lo=mid;}
  const block=await get('eth_getBlockByNumber',['0x'+hi.toString(16),true]),matches=block.transactions.filter(t=>same(t.from,OWNER)&&BigInt(t.nonce)===nonce);check(matches.length===1,'Exactly one matching sender/nonce transaction required.');const tx=matches[0],receipt=await get('eth_getTransactionReceipt',[tx.hash]);check(receipt&&same(receipt.blockHash,block.hash)&&same(receipt.transactionHash,tx.hash),'Receipt is not bound to found canonical block.');
  let decoded=null;try{if(same(tx.to,TOKEN)){const d=tokenABI.parseTransaction({data:tx.input,value:tx.value});decoded={contract:'GH0ST',method:d.name,args:Array.from(d.args,x=>typeof x==='bigint'?String(x):x)};}else if(same(tx.to,'0xE4ce38967ED19B0177Ea52f2aA38cF817C1E2f89')){const d=inbox.parseTransaction({data:tx.input,value:tx.value});decoded={contract:'Actual GH0ST GL3 Inbox',method:d.name,args:Array.from(d.args,x=>typeof x==='bigint'?String(x):x),nativeRecipient:OWNER};}}catch{}
  found.push({nonce:String(nonce),beforeBlock:String(lo),beforeNonce:String(await count(lo)),includedBlock:String(hi),afterNonce:String(await count(hi)),blockTimestamp:BigInt(block.timestamp).toString(),transaction:tx,receipt,decoded});
 }
 const result={scope:'Read-only binary search of historical account nonce, full canonical blocks and matching receipts',owner:OWNER,chainId:4663,knownCheckpoint:{blockNumber:String(lower),nonce:'6476'},observedHead:{number:head.number,hash:head.hash,nonce:String(await count(upper))},found,requests,signatures:0,broadcasts:0,journalModified:false,UTC:new Date().toISOString()};if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}finally{rpc.destroy();}
