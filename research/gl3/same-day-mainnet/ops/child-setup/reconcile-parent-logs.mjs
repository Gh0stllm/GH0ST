// Read-only fallback when public RH nodes have pruned historical account state.
import {JsonRpcProvider,Interface} from 'ethers';
import {writeFileSync} from 'node:fs';
import {OWNER,TOKEN,check,same,inbox} from './policy.mjs';
const rpc=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});let requests=0;
const get=async(m,p)=>{check(['eth_chainId','eth_getLogs','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(m));requests++;return rpc.send(m,p);};
const abi=new Interface(['function approve(address,uint256)','function transfer(address,uint256)']);
try{
 check(BigInt(await get('eth_chainId',[]))===4663n);const from=0x6f612ecn,head=await get('eth_getBlockByNumber',['latest',false]),end=BigInt(head.number),topic='0x'+OWNER.slice(2).toLowerCase().padStart(64,'0'),logs=[];
 for(let start=from;start<=end;start+=1000n){const finish=start+999n<end?start+999n:end;logs.push(...await get('eth_getLogs',[{fromBlock:'0x'+start.toString(16),toBlock:'0x'+finish.toString(16),topics:[null,topic]}]));}
 const found=[];
 for(const hash of new Set(logs.map(x=>x.transactionHash))){const tx=await get('eth_getTransactionByHash',[hash]);if(!tx||!same(tx.from,OWNER)||![6476n,6477n].includes(BigInt(tx.nonce)))continue;const receipt=await get('eth_getTransactionReceipt',[hash]),block=await get('eth_getBlockByNumber',[tx.blockNumber,false]);check(receipt&&same(receipt.blockHash,block.hash)&&same(receipt.transactionHash,tx.hash),'Canonical receipt mismatch.');let decoded=null;
  try{const d=(same(tx.to,'0xE4ce38967ED19B0177Ea52f2aA38cF817C1E2f89')?inbox:abi).parseTransaction({data:tx.input,value:tx.value});decoded={contract:same(tx.to,TOKEN)?'GH0ST':same(tx.to,'0xE4ce38967ED19B0177Ea52f2aA38cF817C1E2f89')?'Actual GH0ST GL3 Inbox':tx.to,method:d.name,args:Array.from(d.args,x=>typeof x==='bigint'?String(x):x)};}catch{}
  found.push({nonce:String(BigInt(tx.nonce)),transaction:tx,receipt,decoded,blockTimestamp:String(BigInt(block.timestamp))});
 }
 const report={scope:'Read-only owner-topic event lookup followed by exact sender/nonce and canonical receipt verification',owner:OWNER,chainId:4663,fromBlock:String(from),toBlock:String(end),matchingLogs:logs.length,uniqueTransactions:new Set(logs.map(x=>x.transactionHash)).size,found,requests,signaturesCreated:0,broadcasts:0,journalModified:false,UTC:new Date().toISOString()};if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}finally{rpc.destroy();}
