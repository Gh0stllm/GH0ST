// Read Robinhood mainnet; mutate only an in-process Ganache fork on Runpod.
// The loopback gateway rejects every public-RPC method outside this read list.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.resolve(here,'../../chess/package.json'));
const ganache=require('ganache');
const {BrowserProvider,Contract,ContractFactory,Interface,keccak256}=require('ethers');
const endpoint='https://rpc.mainnet.chain.robinhood.com';
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const owner='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const output=process.argv[2];assert(output,'supply an output JSON path');
const reads=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_getProof','eth_call','eth_gasPrice']);
const used=new Set();let id=0;
async function forward(request){
 if(!reads.has(request.method))throw Error('public mutation blocked: '+request.method);
 used.add(request.method);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
 assert(response.ok,'public RPC HTTP '+response.status);return response.json();
}
async function rpc(method,params=[]){const r=await forward({jsonrpc:'2.0',id:++id,method,params});if(r.error)throw Error(JSON.stringify(r.error));return r.result;}
const report={scope:'read-only Robinhood snapshot and private cloud-fork ERC20 tests; no public transactions',publicEndpoint:endpoint,token,owner,publicDeployment:false,realChainSpend:0,gasTokenReadyForProduction:false,checks:[]};
let gateway,server;
try{
 assert.equal(BigInt(await rpc('eth_chainId')),4663n);
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 report.parent={chainId:4663,blockNumber:Number(BigInt(block.number)),blockHash:block.hash,gasLimit:String(BigInt(block.gasLimit)),baseFeeWei:block.baseFeePerGas?String(BigInt(block.baseFeePerGas)):null};
 const abi=['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function transferFrom(address,address,uint256) returns(bool)'];
 const iface=new Interface(abi),tag=block.number;
 const read=async(name,args=[])=>iface.decodeFunctionResult(name,await rpc('eth_call',[{to:token,data:iface.encodeFunctionData(name,args)},tag]))[0];
 const code=await rpc('eth_getCode',[token,tag]);assert.notEqual(code,'0x');
 report.runtimeCodeHash=keccak256(code);report.runtimeCodeBytes=(code.length-2)/2;
 report.standardMinimalProxyImplementation=code.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i)?.[1]||null;
 const decimals=Number(await read('decimals'));
 report.metadata={name:await read('name'),symbol:await read('symbol'),decimals,totalSupply:String(await read('totalSupply')),ownerBalance:String(await read('balanceOf',[owner]))};
 const selfResult=await rpc('eth_call',[{from:owner,to:token,data:iface.encodeFunctionData('transfer',[owner,1n])},tag]);
 assert.equal(iface.decodeFunctionResult('transfer',selfResult)[0],true);report.publicSelfTransferSimulationPassed=true;
 gateway=http.createServer(async(req,res)=>{
  try{let body='';for await(const c of req)body+=c;assert(body.length<1000000);const input=JSON.parse(body);const result=Array.isArray(input)?await Promise.all(input.map(forward)):await forward(input);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}
  catch(e){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32601,message:String(e)}}));}
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const forkURL='http://127.0.0.1:'+gateway.address().port;
 const forkId=94663007;
 server=ganache.provider({logging:{quiet:true},fork:{url:forkURL,blockNumber:report.parent.blockNumber},chain:{chainId:forkId,hardfork:'shanghai'},wallet:{deterministic:true,unlockedAccounts:[owner]}});
 assert.equal(BigInt(await server.request({method:'eth_chainId',params:[]})),BigInt(forkId));report.privateForkChainId=forkId;
 const provider=new BrowserProvider(server);provider.pollingInterval=50;
 await server.request({method:'evm_setAccountBalance',params:[owner,'0x8ac7230489e80000']});
 const accounts=(await provider.listAccounts()).filter(x=>x.address.toLowerCase()!==owner.toLowerCase());
 const holder=accounts[1],receiver=accounts[2],spender=accounts[3],funder=await provider.getSigner(owner);
 const c=new Contract(token,abi,provider),unit=10n**BigInt(decimals),half=unit/2n;assert(half>0n);
 assert(BigInt(report.metadata.ownerBalance)>=4n*unit,'public owner lacks four tokens for the private simulation');
 async function transferCheck(signer,to,amount,label){
  const from=signer.address;const beforeFrom=await c.balanceOf(from),beforeTo=await c.balanceOf(to),supply=await c.totalSupply();
  const tx=await c.connect(signer).transfer(to,amount,{gasLimit:1500000});const receipt=await tx.wait();assert.equal(receipt.status,1);
  const afterFrom=await c.balanceOf(from),afterTo=await c.balanceOf(to);assert.equal(await c.totalSupply(),supply);
  if(from.toLowerCase()===to.toLowerCase()){assert.equal(afterFrom,beforeFrom);}else{assert.equal(beforeFrom-afterFrom,amount);assert.equal(afterTo-beforeTo,amount);}
  report.checks.push({name:label,passed:true,amount:String(amount),privateForkGasUsed:String(receipt.gasUsed)});
 }
 await transferCheck(funder,holder.address,4n*unit,'fund unprivileged fork holder');
 await transferCheck(holder,holder.address,unit,'nonzero self transfer preserves balance');
 await transferCheck(holder,receiver.address,unit,'unprivileged transfer exact balance deltas');
 const approval=await c.connect(holder).approve(spender.address,unit,{gasLimit:1500000});assert.equal((await approval.wait()).status,1);assert.equal(await c.allowance(holder.address,spender.address),unit);
 const beforeFrom=await c.balanceOf(holder.address),beforeTo=await c.balanceOf(receiver.address),supply=await c.totalSupply();
 const tx=await c.connect(spender).transferFrom(holder.address,receiver.address,half,{gasLimit:1500000});const receipt=await tx.wait();assert.equal(receipt.status,1);
 assert.equal(beforeFrom-await c.balanceOf(holder.address),half);assert.equal(await c.balanceOf(receiver.address)-beforeTo,half);assert.equal(await c.allowance(holder.address,spender.address),unit-half);assert.equal(await c.totalSupply(),supply);
 report.checks.push({name:'approval and transferFrom exact deltas and allowance',passed:true,privateForkGasUsed:String(receipt.gasUsed)});
 report.sampledERC20ForkChecksPassed=true;
 if(process.env.GL3_BRIDGE_UNIT==='1'){
  const solc=require('solc');
  const fixture=`pragma solidity ^0.8.20;
  interface IOut { function updateSendRoot(bytes32,bytes32) external; }
  contract ProbeRollup { address public owner; constructor(){owner=msg.sender;} function setRoot(address o,bytes32 r,bytes32 b) external {require(msg.sender==owner); IOut(o).updateSendRoot(r,b);} }
  contract ProbeProxy { constructor(address impl,bytes memory data){ bytes32 slot=bytes32(uint256(keccak256("eip1967.proxy.implementation"))-1); assembly {sstore(slot,impl)} (bool ok,bytes memory r)=impl.delegatecall(data); if(!ok) assembly {revert(add(r,32),mload(r))} } fallback() external payable {bytes32 slot=bytes32(uint256(keccak256("eip1967.proxy.implementation"))-1); assembly {let a:=sload(slot) calldatacopy(0,0,calldatasize()) let ok:=delegatecall(gas(),a,0,calldatasize(),0,0) returndatacopy(0,0,returndatasize()) switch ok case 0 {revert(0,returndatasize())} default {return(0,returndatasize())}}} }`;
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Probe.sol':{content:fixture}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  assert(!(compiled.errors||[]).some(e=>e.severity==='error'),JSON.stringify(compiled.errors));
  const operator=accounts[0];
  const deploy=async(a,args=[])=>{const d=await new ContractFactory(a.abi,a.bytecode||('0x'+a.evm.bytecode.object),operator).deploy(...args,{gasLimit:15000000});await d.waitForDeployment();return d;};
  const artifacts={};
  const expected={ERC20Bridge:'22a828d77e1ea812f1085825aa55873f6da3f58c382f3b9239f8591d4518d0b9',ERC20Outbox:'998874c44a74dba0cd1d2d870d71b89342d932a831c0daab0401e197afd31768'};
  const {createHash}=await import('node:crypto');
  for(const n of Object.keys(expected)){const b=fs.readFileSync('/root/gl3-contracts/artifacts/'+n+'.json');assert.equal(createHash('sha256').update(b).digest('hex'),expected[n]);artifacts[n]=JSON.parse(b);}
  const rollup=await deploy(compiled.contracts['Probe.sol'].ProbeRollup),bridgeImpl=await deploy(artifacts.ERC20Bridge),outboxImpl=await deploy(artifacts.ERC20Outbox);
  const proxyABI=compiled.contracts['Probe.sol'].ProbeProxy;
  const bridgeProxy=await deploy(proxyABI,[await bridgeImpl.getAddress(),new Interface(artifacts.ERC20Bridge.abi).encodeFunctionData('initialize',[await rollup.getAddress(),token])]);
  const bridge=new Contract(await bridgeProxy.getAddress(),artifacts.ERC20Bridge.abi,operator);
  const outboxProxy=await deploy(proxyABI,[await outboxImpl.getAddress(),new Interface(artifacts.ERC20Outbox.abi).encodeFunctionData('initialize',[await bridge.getAddress()])]);
  const outbox=new Contract(await outboxProxy.getAddress(),artifacts.ERC20Outbox.abi,operator),inbox=accounts[4];
  await (await bridge.setOutbox(await outbox.getAddress(),true)).wait();await (await bridge.setDelayedInbox(inbox.address,true)).wait();
  const amount=4n*unit;await (await c.connect(funder).transfer(inbox.address,amount,{gasLimit:1500000})).wait();await (await c.connect(inbox).approve(await bridge.getAddress(),amount)).wait();
  const beforeBridge=await c.balanceOf(await bridge.getAddress());
  await (await bridge.connect(inbox).enqueueDelayedMessage(9,inbox.address,keccak256('0x1234'),amount,{gasLimit:1500000})).wait();
  assert.equal(await c.balanceOf(await bridge.getAddress())-beforeBridge,amount);
  const args=[[],0n,holder.address,receiver.address,123n,456n,789n,amount,'0x'];
  async function reject(fn,label){let denied=false;try{await fn();}catch{denied=true;}assert(denied,label);report.checks.push({name:label,passed:true});}
  await reject(()=>outbox.executeTransaction.staticCall(...args),'unknown withdrawal root rejects');
  const item=await outbox.calculateItemHash(...args.slice(2));const root=await outbox.calculateMerkleRoot([],0n,item),blockHash=keccak256('0x9876');
  await reject(()=>outbox.updateSendRoot.staticCall(root,blockHash),'non-rollup root registration rejects');
  await (await rollup.setRoot(await outbox.getAddress(),root,blockHash)).wait();
  const before=await c.balanceOf(receiver.address);const withdrawal=await outbox.executeTransaction(...args,{gasLimit:1500000});await withdrawal.wait();
  assert.equal(await c.balanceOf(receiver.address)-before,amount);assert.equal(await c.balanceOf(await bridge.getAddress()),beforeBridge);assert.equal(await outbox.isSpent(0n),true);
  await reject(()=>outbox.executeTransaction.staticCall(...args),'withdrawal replay rejects');
  assert.equal(await outbox.l2ToL1Sender(),'0x0000000000000000000000000000000000000000');
  report.bridgeContractUnitChecksPassed=true;report.bridgeUnit={realGH0STFork:true,pinnedImplementations:expected,exactEscrowAndReturnAmount:String(amount),mockConfirmedSendRoot:true,actualChildBurnAndConfirmedAssertionTested:false,productionProxyAndGovernanceTested:false};
 }
 report.limitations=['Representative transfers do not prove all privileged, rebasing or future upgrade behavior.','Shanghai Ganache does not reproduce every Robinhood/ArbOS feature.','Parent deployment, bridge custody, fee pricing and full withdrawals remain untested here.','Private-fork gas is not a Robinhood deployment fee quote.'];
}catch(e){report.sampledERC20ForkChecksPassed=false;report.error=String(e.stack||e);process.exitCode=1;}
finally{
 if(server)await server.disconnect();if(gateway)await new Promise(r=>gateway.close(r));
 report.publicRPCMethods=[...used].sort();report.asOfUTC=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
