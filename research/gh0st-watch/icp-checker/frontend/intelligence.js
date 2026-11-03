import {getAddress,formatEther,formatUnits,id} from 'ethers';
const zero='0x'+'0'.repeat(40), transfer=id('Transfer(address,address,uint256)');
const addr=x=>typeof x==='string'&&/^0x[\da-f]{40}$/i.test(x)?getAddress(x.toLowerCase()):null;
const hash=x=>typeof x==='string'&&/^0x[\da-f]{64}$/i.test(x)?x:null;
const same=(a,b)=>Boolean(a&&b&&a.toLowerCase()===b.toLowerCase());
const optional=p=>p.catch(()=>null);
const hex=n=>'0x'+n.toString(16);
const longWord=v=>/^0x[0-9a-f]{64}$/i.test(v)?BigInt(v):null;
const percent=(part,total)=>total>0n?(part*10000n/total/100n).toString()+'.'+(part*10000n/total%100n).toString().padStart(2,'0')+'%':null;
async function api(net,path){
  const r=await fetch(net.explorer+path,{signal:AbortSignal.timeout(6500),headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('Explorer unavailable');return r.json();
}
async function recentActivity(net,account,end,action){
  const q=new URLSearchParams({module:'account',action,address:account,startblock:'0',endblock:String(end),page:'1',offset:'50',sort:'desc'});
  const r=await api(net,'/api?'+q);
  if(!Array.isArray(r.result)|| (r.status!=='1' && !(r.result.length===0&&/no transactions/i.test(r.message||''))))throw Error('History unavailable');
  return r.result;
}
function earlier(row,block,index){
  const b=Number(row.blockNumber);
  return b<block || (b===block&&row.transactionIndex!=null&&Number(row.transactionIndex)<index);
}
async function previous(net,wallet,creator,entry,block,index,subject){
  const [direct,internal]=await Promise.all([optional(recentActivity(net,wallet,block,'txlist')),optional(recentActivity(net,creator,block,'txlistinternal'))]);
  const found=new Map();
  function add(address,tx,height,kind){
    const a=addr(address);if(!a||same(a,subject)||!hash(tx))return;
    const k=a.toLowerCase();if(!found.has(k)||kind==='Same wallet via factory')found.set(k,{address:a,tx,block:Number(height),kind});
  }
  const outgoing=(direct||[]).filter(x=>same(x.from,wallet)&&x.isError==='0'&&earlier(x,block,index));
  for(const x of outgoing)if(!x.to||x.to==='0x')add(x.contractAddress,x.hash,x.blockNumber,'Wallet creation');
  for(const x of internal||[]){
    if(Number(x.blockNumber)>=block||x.isError!=='0'||!same(x.from,creator)||!/^create2?$/i.test(x.type||''))continue;
    add(x.contractAddress||x.to,x.transactionHash,x.blockNumber,same(wallet,creator)?'Wallet creation':'Factory creation · wallet unknown');
  }
  const candidates=creator!==wallet&&entry?outgoing.filter(x=>same(x.to,entry)).slice(0,5):[];
  const traces=await Promise.all(candidates.map(x=>optional(api(net,'/api/v2/transactions/'+x.hash+'/internal-transactions'))));
  traces.forEach((rows,i)=>{
    for(const x of rows?.items||[])if(x.success!==false&&!x.error&&/^create2?$/i.test(x.type||'')&&same(x.from?.hash,creator))
      add(x.created_contract?.hash||x.to?.hash,candidates[i].hash,candidates[i].blockNumber,'Same wallet via factory');
  });
  return {items:[...found.values()].sort((a,b)=>b.block-a.block).slice(0,10),direct:direct?.length??null,internal:internal?.length??null,traced:traces.filter(Boolean).length};
}
const swaps=new Set(['Swap(address,uint256,uint256,uint256,uint256,address)','Swap(address,address,int256,int256,uint160,uint128,int24)','Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'].map(id));
async function earlySwaps(target,origin,block,receipt,rpc){
  const end=Math.min(origin+9,block);
  const logs=await rpc('eth_getLogs',[{address:target,fromBlock:hex(origin),toBlock:hex(end),topics:[transfer]}]);
  const byTx=new Map();
  for(const l of logs){
    if(l.removed||!same(l.address,target)||l.topics?.length!==3||!hash(l.transactionHash)||!longWord(l.data))continue;
    const from=addr('0x'+l.topics[1].slice(-40)),to=addr('0x'+l.topics[2].slice(-40));if(!from||!to||same(from,zero)||same(to,zero))continue;
    if(!byTx.has(l.transactionHash))byTx.set(l.transactionHash,new Set());
    byTx.get(l.transactionHash).add(from.toLowerCase()).add(to.toLowerCase());
  }
  const sample=[...byTx].slice(0,12), heights=new Map(),senders=new Set();let checked=0,matches=0,example=null;
  for(let i=0;i<sample.length;i+=3){
    const batch=sample.slice(i,i+3);const records=await Promise.all(batch.map(([tx])=>tx===receipt.transactionHash?receipt:optional(rpc('eth_getTransactionReceipt',[tx]))));
    records.forEach((r,j)=>{
      if(!r?.logs||r.status!=='0x1')return;checked++;
      if(!r.logs.some(l=>swaps.has(l.topics?.[0])&&batch[j][1].has(l.address.toLowerCase())))return;
      matches++;senders.add(r.from.toLowerCase());example??=r.transactionHash;heights.set(r.blockNumber,1+(heights.get(r.blockNumber)||0));
    });
  }
  return {end,origin,eligible:byTx.size,checked,matches,wallets:senders.size,max:Math.max(0,...heights.values()),example};
}
async function launch(net,target,origin,receipt,rpc,block){
  const out={privateStatus:'Unknown · public chain data does not identify private trading bundles.'};
  const early=optional(earlySwaps(target,origin,block,receipt,rpc));
  const all=await optional(rpc('eth_getLogs',[{address:target,fromBlock:hex(origin),toBlock:hex(origin),topics:[transfer]}]));
  if(!Array.isArray(all))return {...out,early:await early};
  const grouped=new Map(),unique=new Set();
  for(const log of all){
    if(log.removed||!same(log.blockHash,receipt.blockHash)||!same(log.address,target)||log.topics?.length!==3||!/^0x0{24}[a-f\d]{40}$/i.test(log.topics[2])||longWord(log.data)===null||longWord(log.data)===0n)continue;
    const recipient=addr('0x'+log.topics[2].slice(-40));
    if(!recipient||same(recipient,zero))continue;
    unique.add(recipient);if(!grouped.has(log.transactionHash))grouped.set(log.transactionHash,new Set());grouped.get(log.transactionHash).add(recipient);
  }
  const largest=[...grouped].sort((a,b)=>b[1].size-a[1].size)[0];
  return {...out,early:await early,transactions:grouped.size,recipients:unique.size,maxRecipients:largest?.[1].size||0,tx:largest?.[0]};
}
async function provenance(net,target,block,erc,rpc){
  const lookup=await api(net,'/api/v2/addresses/'+target),txid=hash(lookup.creation_transaction_hash||lookup.creation_tx_hash);
  if(!txid)throw Error('No indexed creation transaction');
  const receipt=await rpc('eth_getTransactionReceipt',[txid]);const h=Number(receipt.blockNumber),wallet=addr(receipt.from);
  if(!wallet||receipt.status!=='0x1'||!same(receipt.transactionHash,txid)||h>block)throw Error('No confirmed deployment receipt');
  const canonical=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
  if(!same(canonical.hash,receipt.blockHash))throw Error('Deployment block changed');
  const direct=same(receipt.contractAddress,target);
  const creator=direct?wallet:addr(lookup.creator_address_hash);
  const entry=addr(receipt.to);
  if(!creator)throw Error('Explorer did not identify the creating account');
  const [history,native,nonce,bundle,creatorCode]=await Promise.all([previous(net,wallet,creator,entry,h,Number(receipt.transactionIndex),target),optional(rpc('eth_getBalance',[wallet,hex(block)])),optional(rpc('eth_getTransactionCount',[wallet,hex(block)])),erc?launch(net,target,h,receipt,rpc,block):null,optional(rpc('eth_getCode',[creator,hex(block)]))]);
  return {wallet,creator,tx:txid,block:h,direct,creatorKind:creatorCode==null?'Unknown':creatorCode==='0x'?'No deployed code':'Contract',balance:native==null?null:formatEther(native),nonce:nonce==null?null:BigInt(nonce).toString(),history,bundle};
}
async function coin(net,target,block,rpc,deployment){
  const tag=hex(block);
  const read=async(signature,who)=>longWord(await rpc('eth_call',[{to:target,data:id(signature).slice(0,10)+(who?who.slice(2).toLowerCase().padStart(64,'0'):'')},tag]));
  const [token,holders,supply,decimals]=await Promise.all([optional(api(net,'/api/v2/tokens/'+target)),optional(api(net,'/api/v2/tokens/'+target+'/holders')),optional(read('totalSupply()')),optional(read('decimals()'))]);
  const addresses=[...new Set((holders?.items||[]).map(x=>addr(x.address?.hash)).filter(Boolean))].slice(0,10);
  const balances=await Promise.all(addresses.map(x=>optional(read('balanceOf(address)',x))));
  const sum=addresses.length&&balances.every(x=>x!==null)?balances.reduce((a,b)=>a+b,0n):null;
  const origin=await deployment, walletBalance=origin?.wallet?await optional(read('balanceOf(address)',origin.wallet)):null;
  return {holders:token?.holders_count??null,top:sum!==null&&supply!==null?percent(sum,supply):null,count:addresses.length,
    walletShare:walletBalance!==null&&supply!==null?percent(walletBalance,supply):null,
    walletUnits:walletBalance!==null&&decimals!==null&&decimals<=80n?formatUnits(walletBalance,decimals):null};
}
export async function enrich(net,r,request){
  const call=(m,p)=>request(net,m,p);
  const deployment=optional(provenance(net,r.address,r.block,r.erc20,call));
  const [origin,token]=await Promise.all([deployment,r.erc20?optional(coin(net,r.address,r.block,call,deployment)):null]);
  const anchor=await call('eth_getBlockByNumber',[hex(r.block),false]);
  if(anchor.hash!==r.blockHash)throw Error('Block changed. Run the scan again.');
  return {origin,token};
}
