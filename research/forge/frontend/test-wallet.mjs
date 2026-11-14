// Actual production wallet integration against an isolated EVM. No public requests or funds.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import * as ethers from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import { ForgeWallet,matchRuntime } from './wallet.mjs';
import { TOKEN_ADDRESS,constructorArgs,assertTrace } from './core.mjs';
import { generateNpcDataset,trainModel,predictQuantized } from '../training/core.mjs';
const artifacts=JSON.parse(readFileSync(new URL('../runtime/artifacts.json',import.meta.url)));
const code=`pragma solidity 0.8.30;contract T{uint8 public constant decimals=18;mapping(address=>uint256)public balanceOf;mapping(address=>mapping(address=>uint256))public allowance;event Approval(address indexed owner,address indexed spender,uint256 value);function mint(address a,uint256 v)external{balanceOf[a]+=v;}function approve(address a,uint256 v)external returns(bool){allowance[msg.sender][a]=v;emit Approval(msg.sender,a,v);return true;}function transfer(address a,uint256 v)external returns(bool){balanceOf[msg.sender]-=v;balanceOf[a]+=v;return true;}function transferFrom(address a,address b,uint256 v)external returns(bool){allowance[a][msg.sender]-=v;balanceOf[a]-=v;balanceOf[b]+=v;return true;}}`;
const built=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'T.sol':{content:code}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}))).contracts['T.sol'].T;
const eip1193=ganache.provider({logging:{quiet:true},chain:{chainId:4663,hardfork:'shanghai'},wallet:{mnemonic:'test test test test test test test test test test test junk',defaultBalance:1000},miner:{blockGasLimit:30000000}});const provider=new ethers.BrowserProvider(eip1193,undefined,{cacheTimeout:-1});provider.pollingInterval=20;const signers=await Promise.all([provider.getSigner(0),provider.getSigner(1)]);const addresses=await Promise.all(signers.map(s=>s.getAddress()));
const local=new Map();globalThis.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
let sends=0,reject=false,wrongAccount=false;
globalThis.ethereum={on:()=>{},request:async r=>{
  if(['eth_requestAccounts','eth_accounts'].includes(r.method))return [wrongAccount?addresses[1]:addresses[0]];
  if(r.method==='eth_sendTransaction'){if(reject)throw Object.assign(new Error('declined'),{code:4001});sends++;}
  return eip1193.request(r);
}};
class LocalWallet extends ForgeWallet {
  constructor(options){super(artifacts.contracts.ForgeModel,options);this.provider.destroy();this.provider=provider;}
  // Only this test replaces the mainnet token code anchor. Production code cannot accept a fixture token.
  async verifyNetwork(){assert.equal(Number((await provider.getNetwork()).chainId),4663);assert.equal(Number(await this.token().decimals()),18);}
}
try{
  const template=await new ethers.ContractFactory(built.abi,'0x'+built.evm.bytecode.object,signers[0]).deploy();await template.waitForDeployment();
  await eip1193.request({method:'evm_setAccountCode',params:[TOKEN_ADDRESS,await provider.getCode(template.target)]});
  const token=new ethers.Contract(TOKEN_ADDRESS,built.abi,signers[0]);await(await token.mint(addresses[0],ethers.parseEther('100'))).wait();
  const prod=new ForgeWallet(artifacts.contracts.ForgeModel);prod.provider.destroy();prod.provider=provider;
  await assert.rejects(()=>prod.verifyNetwork(),/canonical GH0ST/);
  const result=await trainModel(generateNpcDataset({rows:120}),{epochs:20,seed:42});const model=result.model;
  const w=new LocalWallet();await w.connect();w.walletProvider.pollingInterval=20;
  assert.equal(sends,0,'connecting/training must not send');
  await w.estimateDeploy(model,ethers.parseEther('1'));assert.equal(sends,0,'gas estimates must not send');
  await w.deploy(model,ethers.parseEther('1'),{model});assert.equal(sends,1);assert.equal(w.live.creationVerified,true);assert.equal(w.pending,null);
  const l=w.live;assert.equal(matchRuntime(await provider.getCode(l.address),artifacts.contracts.ForgeModel),true);
  assertTrace(await w.preview(model.normalization.center),predictQuantized(model,model.normalization.center));assert.equal(sends,1,'read calls must not send');
  await assert.rejects(()=>w.infer(model.normalization.center),/Approve exactly/);assert.equal(sends,1);
  reject=true;await assert.rejects(()=>w.approve());reject=false;assert.equal(sends,1,'wallet rejection sends nothing');
  await(await token.approve(l.address,ethers.parseEther('9'))).wait();await w.refresh();
  await w.approve();assert.equal(w.allowance,0n);assert.equal(sends,2,'old allowance reset is one separate action');
  await assert.rejects(()=>w.infer(model.normalization.center),/Approve exactly/);assert.equal(sends,2);
  await w.approve();assert.equal(sends,3);assert.equal(w.allowance,ethers.parseEther('1'));
  await w.infer(model.normalization.center);assert.equal(sends,4);assert.equal(w.allowance,0n);assert.equal(w.credits,ethers.parseEther('1'));
  await w.withdraw();assert.equal(sends,5);assert.equal(w.credits,0n);assert.equal(await token.balanceOf(addresses[0]),ethers.parseEther('100'));
  await w.load(l.address,model);assert.equal(w.live.creationVerified,false);await assert.rejects(()=>w.approve(),/original deployment/);assert.equal(sends,5);
  const originalGetTransaction=provider.getTransaction.bind(provider);
  provider.getTransaction=async hash=>{const tx=await originalGetTransaction(hash);return {...tx,data:tx.data+'00'};};
  await assert.rejects(()=>w.load(l.address,model,l.transactionHash),/official ForgeModel constructor/);assert.equal(w.live,null);assert.equal(sends,5,'patched creation bytes cannot authorize payment');
  provider.getTransaction=originalGetTransaction;
  await w.load(l.address,model,l.transactionHash);
  wrongAccount=true;await assert.rejects(()=>w.approve(),/changed/);assert.equal(sends,5);wrongAccount=false;
  await w.connect();w.walletProvider.pollingInterval=20;
  const tx=await token.approve(l.address,ethers.parseEther('1'));await tx.wait();
  await assert.rejects(()=>w.wait({hash:tx.hash,wait:async()=>{throw new Error('simulated receipt timeout')}},'Approval exact fee',{address:l.address,amount:String(ethers.parseEther('1'))}),/timeout/);
  assert.ok(local.get('gh0st-forge-pending-v1'));
  const resumed=new LocalWallet();assert.equal(resumed.pending.hash,tx.hash);await resumed.resolve();assert.equal(resumed.pending,null);assert.equal(sends,5,'pending recovery never resends');
  const report={simulation:true,publicTransactions:0,localUITransactions:sends,checks:['production canonical-token anchor rejects local fixture','connect/train/estimate/read send no transactions','one direct model deployment with creation bytecode and runtime verification','exact Q8 on-chain trace parity','wallet rejection','nonexact allowance resets separately','approval and recorded prediction require separate actions','inference event and consumed allowance verified','beneficiary credit withdrawal verified','missing creation provenance disables paid actions','patched creation transaction bytes rejected','changed wallet blocks action','pending receipt recovers without resend']};
  writeFileSync(new URL('./wallet-test-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{provider.destroy();await eip1193.disconnect();}
