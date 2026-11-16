// Self-contained isolated test chain; no parent, public RPC, or existing keys.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';
import {Wallet,NonceManager,JsonRpcProvider,Interface,ContractFactory,parseEther,id,ZeroHash} from 'ethers';
import solc from 'solc';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),cache=path.join(root,'.cache');
const binary=path.join(cache,'bin/gh0st-nitro'),source=path.join(cache,'nitro-build');
const wasm=path.resolve(root,'../stylus/.cache/normalized.wasm');
const fallback=path.join(root,'stylus-native/.cache/canonical.wasm');const fixture=fs.existsSync(wasm)?wasm:fallback;
const prepared=spawnSync(path.join(cache,'go/bin/go'),['run','-mod=mod',path.join(root,'dev-rpc/encode/main.go'),fixture],{cwd:source,env:{...process.env,GOTOOLCHAIN:'local'},encoding:'utf8'});
if(prepared.status!==0)throw new Error(prepared.stderr);const deployCode=prepared.stdout.trim();if(!/^0x[0-9a-f]+$/.test(deployCode))throw new Error('bad deployment code');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>resolve(n));});});
const account=Wallet.createRandom(); // ephemeral memory-only local test key
const data=fs.mkdtempSync(path.join(cache,'rpc-dev-')),logPath=path.join(data,'node.log'),log=fs.openSync(logPath,'w');
const args=['--dev','--init.dev-init-address',account.address,'--persistent.chain',path.join(data,'chain'),'--persistent.global-config',path.join(data,'config'),'--http.addr','127.0.0.1','--http.port',String(port),'--auth.addr=','--ipc.path=','--ws.addr=','--node.batch-poster.enable=false','--node.staker.enable=false','--execution.parent-chain-reader.enable=false','--version-alerter.enable=false','--file-logging.enable=false','--node.feed.output.enable=false'];
const child=spawn(binary,args,{cwd:source,stdio:['ignore',log,log]});
const provider=new JsonRpcProvider('http://127.0.0.1:'+port,412346,{staticNetwork:true,batchMaxCount:1});provider.pollingInterval=100;
const report={scope:'Actual signed local-only Nitro RPC transactions with ephemeral genesis-funded test account',nativeTarget:'darwin/arm64',parentConnectivity:false,publicChain:false,existingWalletUsed:false,modelSeeded:false,financialActions:false,transactions:[],checks:[]};
function recordReceipt(name,receipt){if(receipt.status!==1)throw new Error(name+' reverted');report.transactions.push({name,hash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),status:receipt.status,contractAddress:receipt.contractAddress});}
async function send(name,transaction){const input={...transaction,from:account.address,gasPrice:100000000n};delete input.gasLimit;const estimate=await provider.estimateGas(input);report.checks.push({name:name+' estimate',estimatedGas:String(estimate)});const tx=await writer.sendTransaction({...transaction,gasLimit:estimate+estimate/5n,gasPrice:100000000n});const receipt=await tx.wait();recordReceipt(name,receipt);return receipt;}
const writer=new NonceManager(account.connect(provider));
try{
 let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('node exited: '+fs.readFileSync(logPath,'utf8').slice(-2500));try{report.chainId=await provider.send('eth_chainId',[]);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
 if(!ready)throw new Error('loopback node startup timeout');if(report.chainId!=='0x64aba')throw new Error('wrong local chain');
 report.clientVersion=await provider.send('web3_clientVersion',[]);report.genesisBalance=String(await provider.getBalance(account.address));
 const llm=new Interface(['function inspect(bytes32) view returns(uint64,uint32,uint32,uint32,uint32,bytes32,bool)']);
 try{await provider.call({from:account.address,to:'0x0000000000000000000000000000000000000a12',data:llm.encodeFunctionData('inspect',[ZeroHash])});throw new Error('A12 unexpectedly accepted absent genesis model');}
 catch(e){if(String(e.message).includes('unexpectedly accepted'))throw e;report.llmAbsentGenesis={rejected:true,message:String(e.shortMessage||e.message),data:e.data??null};}
 const deployment=await send('deploy normalized Stylus runtime',{data:deployCode,gasLimit:5000000n});const address=deployment.contractAddress;
 const wasmABI=new Interface(['function activateProgram(address) payable returns(uint16,uint256)','function programVersion(address) view returns(uint16)']);
 await send('activate actual Stylus program',{to:'0x0000000000000000000000000000000000000071',data:wasmABI.encodeFunctionData('activateProgram',[address]),value:parseEther('1'),gasLimit:10000000n});
 report.stylusAddress=address;report.stylusVersion=Number(wasmABI.decodeFunctionResult('programVersion',await provider.call({to:'0x0000000000000000000000000000000000000071',data:wasmABI.encodeFunctionData('programVersion',[address])}))[0]);
 const cases=JSON.parse(fs.readFileSync(path.resolve(root,'../stylus/evidence/abi-cases.json'),'utf8'));
 for(const test of cases){let result,error;try{result=await provider.call({from:account.address,to:address,data:test.calldata,gasLimit:100000000n});}catch(e){error=e;}
 if(test.revert?!error:error||result.toLowerCase()!==test.expected.toLowerCase())throw new Error('Stylus ABI case failed: '+test.name+' '+(error?.message||result));report.checks.push({name:test.name,expectedRevert:test.revert,passed:true});}
 // A normal Solidity caller invokes the activated Stylus contract in a mined tx.
 const solidity='pragma solidity ^0.8.30; contract GhostCaller { int256 public answer; function run(address target, bytes calldata input) external { (bool ok,bytes memory out)=target.staticcall(input);require(ok,"stylus call");answer=abi.decode(out,(int256)); } }';
 const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'GhostCaller.sol':{content:solidity}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));const fatal=(compiled.errors||[]).filter(x=>x.severity==='error');if(fatal.length)throw new Error(fatal.map(x=>x.formattedMessage).join('\n'));
 const artifact=compiled.contracts['GhostCaller.sol'].GhostCaller,factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,writer);const callerReceipt=await send('deploy Solidity caller',await factory.getDeployTransaction());const contract=factory.attach(callerReceipt.contractAddress);
 const dot=cases.find(t=>t.name==='signed dot');await send('Solidity transaction calls Stylus signed dot',{to:await contract.getAddress(),data:contract.interface.encodeFunctionData('run',[address,dot.calldata])});report.solidityCaller=await contract.getAddress();report.solidityAnswer=String(await contract.answer());if(report.solidityAnswer!=='-31')throw new Error('Solidity→Stylus output mismatch');
 report.wasmSHA256=crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex');report.passed=true;
}catch(e){report.passed=false;report.error={message:String(e.shortMessage||e.message),rpcMessage:e.info?.error?.message||e.error?.message||null,reason:e.reason||null};process.exitCode=1;}
finally{provider.destroy();child.kill('SIGINT');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);if(child.exitCode===null)child.kill('SIGKILL');report.processStopped=child.exitCode!==null;fs.closeSync(log);report.nodeLogTail=fs.readFileSync(logPath,'utf8').slice(-2000).replaceAll(root,'$NITRO_EXPERIMENT');const output=path.join(cache,'dev-rpc-transactions.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
