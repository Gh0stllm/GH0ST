// Observed private-fork state, never a claim of a complete canonical ledger.
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.env.GL3_NODE_PACKAGE),ganache=require('ganache'),E=require('ethers');
export const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const TOKEN_HASH='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const HOLDER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',RPC='https://rpc.mainnet.chain.robinhood.com';
export const word=x=>'0x'+BigInt(x==='0x'?'0x0':x.startsWith('0x')?x:'0x'+x).toString(16).padStart(64,'0');
export function storageAccesses(trace,rootAddress){
 const contexts=new Map(),rows=[];let prev;
 for(const log of trace.structLogs||[]){
  if(!prev)contexts.set(log.depth,{storage:rootAddress?.toLowerCase(),code:rootAddress?.toLowerCase()});
  if(prev&&log.depth>prev.depth){
   const parent=contexts.get(prev.depth)||{};let storage,code;
   if(['CALL','STATICCALL','DELEGATECALL','CALLCODE'].includes(prev.op)){
    code=E.getAddress('0x'+prev.stack.at(-2).replace(/^0x/,'').slice(-40).padStart(40,'0')).toLowerCase();
    storage=['DELEGATECALL','CALLCODE'].includes(prev.op)?parent.storage:code;
   }
   contexts.set(log.depth,{storage,code});
  }
  if(prev&&log.depth<prev.depth)for(const n of contexts.keys())if(n>log.depth)contexts.delete(n);
  const context=contexts.get(log.depth)||{};
  if(context.storage===TOKEN.toLowerCase()&&['SLOAD','SSTORE'].includes(log.op))rows.push({op:log.op,key:word(log.stack.at(-1)),pc:log.pc,depth:log.depth});
  prev=log;
 }
 return rows;
}
export async function createSource(out){
 const allowed=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_getProof','eth_call','eth_gasPrice']);const used=new Set();let id=0;
 async function forward(q){assert(allowed.has(q.method),'PUBLIC MUTATION BLOCKED '+q.method);used.add(q.method);const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q),signal:AbortSignal.timeout(30000)});assert(r.ok);return r.json();}
 async function rpc(method,params=[]){const r=await forward({jsonrpc:'2.0',id:++id,method,params});assert(!r.error,JSON.stringify(r.error));return r.result;}
 assert.equal(BigInt(await rpc('eth_chainId')),4663n);const block=await rpc('eth_getBlockByNumber',['latest',false]),code=await rpc('eth_getCode',[TOKEN,block.number]);assert.equal(E.keccak256(code),TOKEN_HASH);
 const gateway=http.createServer(async(req,res)=>{try{let body='';for await(const b of req)body+=b;assert(body.length<1000000);const q=JSON.parse(body),r=Array.isArray(q)?await Promise.all(q.map(forward)):await forward(q);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(r));}catch(e){res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32601,message:String(e)}}));}});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const server=ganache.server({logging:{quiet:true},fork:{url:'http://127.0.0.1:'+gateway.address().port,blockNumber:Number(BigInt(block.number))},chain:{chainId:94663007,hardfork:'shanghai'},wallet:{deterministic:true,unlockedAccounts:[HOLDER]}});await new Promise((r,j)=>server.listen(0,'127.0.0.1',e=>e?j(e):r()));
 const provider=new E.JsonRpcProvider('http://127.0.0.1:'+server.address().port,94663007,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=25;
 try{
 const wallets={owner:E.Wallet.createRandom(),player:E.Wallet.createRandom(),poster:E.Wallet.createRandom()};
 await provider.send('evm_setAccountBalance',[HOLDER,'0x'+E.parseEther('100').toString(16)]);
 const abi=['function transfer(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)','function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function totalSupply() view returns(uint256)'];
 const token=new E.Contract(TOKEN,abi,await provider.getSigner(HOLDER));const sent=await token.transfer(wallets.owner.address,E.parseEther('32'),{gasLimit:1500000}),receipt=await sent.wait();assert.equal(receipt.status,1);
 const tag=E.toQuantity(receipt.blockNumber),fundingTrace=await provider.send('debug_traceTransaction',[receipt.hash,{disableMemory:true,disableStorage:true}]);
 const touched=storageAccesses(fundingTrace,TOKEN),keys=new Set(touched.map(x=>x.key));for(let i=0;i<32;i++)keys.add(word('0x'+i.toString(16)));
 const storage={};for(const key of keys)storage[key]=word(await provider.send('eth_getStorageAt',[TOKEN,key,tag]));
 // The live token's dynamic-string getters use newer EVM instructions that
 // Ganache Shanghai does not implement. Read metadata on actual Robinhood;
 // persistent account values still come from the observed post-transfer fork.
 const metadataInterface=new E.Interface(abi),meta=async name=>metadataInterface.decodeFunctionResult(name,await rpc('eth_call',[{to:TOKEN,data:metadataInterface.encodeFunctionData(name)},block.number]))[0];
 const metadata={name:await meta('name'),symbol:await meta('symbol'),decimals:Number(await meta('decimals')),totalSupply:String(await meta('totalSupply')),source:'Read-only actual Robinhood calls at the pinned public block; native clone getters must match'};assert.equal(metadata.decimals,18);assert.equal(await token.balanceOf(wallets.owner.address,{blockTag:tag}),E.parseEther('32'));assert.equal((await rpc('eth_getBlockByNumber',[block.number,false])).hash,block.hash,'Public snapshot reorged during collection');
 const tokenAccount={balance:await provider.send('eth_getBalance',[TOKEN,tag]),nonce:await provider.send('eth_getTransactionCount',[TOKEN,tag]),code,storage};
 const snapshot={scope:'Observed token account and touched storage after a PRIVATE fork transfer; incomplete canonical ledger',publicChainId:4663,publicBlockNumber:Number(BigInt(block.number)),publicBlockHash:block.hash,publicStateRoot:block.stateRoot,privateForkChainId:94663007,privateSnapshotBlock:receipt.blockNumber,privateFundingTransaction:receipt.hash,privateFundingAmount:'32000000000000000000',holder:wallets.owner.address,originalPublicHolder:HOLDER,token:TOKEN,runtimeCodeHash:TOKEN_HASH,metadata,account:tokenAccount,initialStorageKeyCount:keys.size,tokenOwnerRolesFabricated:false,fullCanonicalStateCloned:false,canonicalMerkleProofVerificationPerformed:false,publicWrites:0};
 fs.writeFileSync(out+'/source-snapshot.json',JSON.stringify(snapshot,null,2)+'\n');
 const privateWallets=Object.fromEntries(Object.entries(wallets).map(([n,w])=>[n,{address:w.address,privateKey:w.privateKey}]));
 fs.writeFileSync(out+'/source-wallets.private.json',JSON.stringify(privateWallets,null,2)+'\n',{mode:0o600});
 return {snapshot,wallets,provider,tag,read:async key=>word(await provider.send('eth_getStorageAt',[TOKEN,key,tag])),methods:used,close:async()=>{provider.destroy();await server.close();gateway.closeAllConnections?.();await new Promise(r=>gateway.close(r));}};
 }catch(e){provider.destroy();await server.close();gateway.closeAllConnections?.();await new Promise(r=>gateway.close(r));throw e;}
}
