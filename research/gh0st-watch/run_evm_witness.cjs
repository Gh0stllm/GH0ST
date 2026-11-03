// Run only the bundled authored fixtures, on an Anvil instance this process starts.
// Usage: node run_evm_witness.cjs [output.json]; see AUDIT-IMPROVEMENTS.md.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawn,execFileSync} = require('node:child_process'), assert = require('node:assert/strict');
const {IpcSocketProvider,Interface,AbiCoder,Wallet,keccak256,toBeHex} = require('ethers');
const solc = require('solc'), sleep = ms => new Promise(r=>setTimeout(r,ms));
const fixtures = require('./audit-improvement-results.json').cases;
const binary = process.env.ANVIL || 'anvil';
const helpers = `pragma solidity 0.8.24;
contract Forwarder {function forward(address target,address payable recipient,uint n) external { (bool ok,)=target.call(abi.encodeWithSignature("pay(address,uint256)",recipient,n)); require(ok); }}
contract TestToken {bool public fail=true; mapping(address=>uint)public balance; constructor(address who){balance[who]=100;} function enable() external {fail=false;} function transferFrom(address from,address to,uint n) external returns(bool){if(fail)return false;balance[from]-=n;balance[to]+=n;return true;}}
contract Reenter {address target; bytes data; bool tried; function attack(address t,bytes calldata d) external payable {target=t;data=d;(bool depositOK,)=t.call{value:msg.value}(abi.encodeWithSignature("deposit()"));require(depositOK);(bool ok,)=t.call(d);require(ok);} receive() external payable {if(!tried){tried=true; (bool ok,)=target.call(data); if(!ok)return;}}}`;
function compile(name,source){
 const spec={language:'Solidity',sources:{[name]:{content:source}},settings:{evmVersion:'shanghai',optimizer:{enabled:false},outputSelection:{'*':{'*':['abi','evm.bytecode.object','storageLayout']}}}};
 const out=JSON.parse(solc.compile(JSON.stringify(spec)));assert(!(out.errors||[]).some(e=>e.severity==='error'),JSON.stringify(out.errors));return out.contracts[name];
}
async function main(){
 assert(solc.version().startsWith('0.8.24+'));const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'watch-'));
 const ipc=path.join(tmp,'evm.sock'); const anvil=spawn(binary,['--quiet','--host','127.0.0.1','--port','0','--ipc',ipc,'--chain-id','31337','--hardfork','shanghai','--mnemonic-random','12'],{stdio:'ignore'});let p;
 try{
 for(let i=0;!fs.existsSync(ipc)&&i<100;i++)await sleep(50);
 assert(fs.existsSync(ipc),'fresh local Anvil did not start');p=new IpcSocketProvider(ipc);
 const rpc=(m,args=[])=>p.send(m,args);const chain=await rpc('eth_chainId');assert.equal(BigInt(chain),31337n);
 const [owner,user,dest]=await rpc('eth_accounts');const helper=compile('Helper.sol',helpers);
 const result={scope:'Family and ABI supplied. Fresh fixture deployments, one scripted path per case. Not general discovery or proof of safety.',solc:solc.version(),anvil:execFileSync(binary,['--version'],{encoding:'utf8'}).split('\n')[0],evm:'shanghai',llm_calls:0,runs:[]};
 async function tx(fields){
  const hash=await rpc('eth_sendTransaction',[{gas:'0x7a1200',...fields}]);let r;
  for(let i=0;i<100&&!r;i++){r=await rpc('eth_getTransactionReceipt',[hash]);if(!r)await sleep(15);}
  assert(r,'No transaction receipt');return {hash,status:Number(BigInt(r.status)),contract:r.contractAddress};
 }
 async function deploy(a,args=[],value=0n){const iface=new Interface(a.abi);const r=await tx({from:owner,data:'0x'+a.evm.bytecode.object+iface.encodeDeploy(args).slice(2),value:toBeHex(value)});assert.equal(r.status,1);return {addr:r.contract,iface,layout:a.storageLayout};}
 const send=(c,m,args=[],from=user,value=0n)=>tx({to:c.addr,from,data:c.iface.encodeFunctionData(m,args),value:toBeHex(value)});
 const read=async(c,m,args)=>c.iface.decodeFunctionResult(m,await rpc('eth_call',[{to:c.addr,data:c.iface.encodeFunctionData(m,args)},'latest']))[0];
 // Some fixtures keep credit private. Use the compiler's declared mapping slot.
 const credit=async(c,who)=>{
  if(c.iface.hasFunction('credit(address)'))return read(c,'credit',[who]);
  const field=c.layout.storage.find(s=>s.label==='credit');assert.equal(c.layout.types[field.type].label,'mapping(address => uint256)');
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[who,field.slot]));
  return BigInt(await rpc('eth_getStorageAt',[c.addr,key,'latest']));
 };
 const eth=async(a)=>BigInt(await rpc('eth_getBalance',[a,'latest']));
 const ok=async r=>assert.equal((await r).status,1);
 for(const {id,source,family,expected,split} of fixtures){
  const contracts=Object.values(compile('Fixture.sol',source)).filter(a=>a.evm.bytecode.object);assert.equal(contracts.length,1);const a=contracts[0];let obs,witness;
  if(family==='mint'){
   const c=await deploy(a);const b=await read(c,'balance',[user]);const r=await send(c,'mint',[user,7]);const delta=await read(c,'balance',[user])-b;
   await ok(send(c,'mint',[dest,7],owner));assert.equal(await read(c,'balance',[dest]),7n);
   obs={ordinaryCallerReceipt:r.status,balanceIncrease:String(delta),privilegedControlIncrease:'7'};witness=r.status===1&&delta===7n;
  }else if(family==='underflow'){
   const c=await deploy(a);const b=await read(c,'balance',[user]);assert.equal(b,0n);
   const zero=await send(c,'burn',[0]);const r=await send(c,'burn',[1]);const after=await read(c,'balance',[user]);obs={initial:'0',burnOneReceipt:r.status,after:String(after),zeroBurnReceipt:zero.status};witness=r.status===1&&after===(1n<<256n)-1n;
  }else if(family==='authorization'){
   const c=await deploy(a,[],100n),f=await deploy(helper.Forwarder);await ok(send(c,'pay',[dest,1],owner));const b=await eth(dest);
   const r=await send(f,'forward',[c.addr,dest,7],owner);const delta=await eth(dest)-b;obs={ownerDirectControl:'passed',ownerViaIntermediaryReceipt:r.status,recipientIncrease:String(delta)};witness=r.status===1&&delta===7n;
  }else if(family==='token_return'){
   const t=await deploy(helper.TestToken,[user]);const c=await deploy(a,[t.addr]);const r=await send(c,'deposit',[7]);const claimed=await credit(c,user),moved=await read(t,'balance',[c.addr]);
   await ok(send(t,'enable'));await ok(send(c,'deposit',[7]));assert.equal(await read(t,'balance',[c.addr]),7n);assert.equal(await credit(c,user),claimed+7n);
   obs={falseReturnDepositReceipt:r.status,creditIncrease:String(claimed),tokensMoved:String(moved),trueReturnControl:'7 tokens moved and credited'};witness=r.status===1&&claimed===7n&&moved===0n;
  }else if(family==='withdraw'){
   const c=await deploy(a),atk=await deploy(helper.Reenter);await ok(send(c,'deposit',[],owner,20n));const fn=c.iface.getFunction('withdraw');const data=c.iface.encodeFunctionData(fn,fn.inputs.length?[7]:[]);const r=await send(atk,'attack',[c.addr,data],user,7n);assert.equal(r.status,1);
   const got=await eth(atk.addr);assert([7n,14n].includes(got));obs={victimLiquidity:'20',attackerDeposit:'7',receivedAfterReentry:String(got),outerReceipt:r.status};witness=got===14n;
  }else if(family==='replay'){
   const signer=Wallet.createRandom();const c=await deploy(a,[signer.address]);const h=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256','address','uint256'],[c.addr,31337,user,1]));
   const sig=signer.signingKey.sign(h);const args=[1,sig.v,sig.r,sig.s];await ok(send(c,'redeem',args));const first=await read(c,'points',[user]);assert.equal(first,100n);const r=await send(c,'redeem',args);const again=await read(c,'points',[user]);
   obs={firstCredit:String(first),secondIdenticalSignatureReceipt:r.status,pointsAfterSecond:String(again)};witness=r.status===1&&again===200n;
  }else throw Error('No witness recipe for '+family);
  result.runs.push({id,family,split,expected,witness,outcome:witness?'reproduced':'not reproduced in this execution',observations:obs});
 }
 fs.writeFileSync(process.argv[2]||'audit-evm-witnesses.json',JSON.stringify(result,null,2)+'\n');console.log(result.runs.length+' scripted executions completed');
 }finally{if(p)await p.destroy();anvil.kill();fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
