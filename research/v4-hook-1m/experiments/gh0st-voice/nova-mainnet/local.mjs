// An unforked, in-process chain only. This module has no public RPC transport.
import assert from 'node:assert/strict';
import hre from 'hardhat';
import * as ethers from 'ethers';
import {CHAIN,GAS,SENDER,FACTORY,MANAGER,read} from './common.mjs';
export const rpc=(method,params=[])=>hre.network.provider.request({method,params});
export async function resetLocal(){
 assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);
 Object.assign(hre.config.networks.hardhat,{chainId:CHAIN,blockGasLimit:Number(GAS),allowUnlimitedContractSize:false,initialBaseFeePerGas:0,throwOnTransactionFailures:false});
 await rpc('hardhat_reset');assert.equal(Number(await rpc('eth_chainId')),CHAIN);assert.match(await rpc('web3_clientVersion'),/Hardhat/i);
 const code=read('build/dependency-runtime.json'),snapshot=read('network-snapshot.json');
 for(const [address,runtime,expected]of [[FACTORY,code.factory,snapshot.dependencies.factory.code_hash],[MANAGER,code.manager,snapshot.dependencies.manager.code_hash]]){assert.equal(ethers.keccak256(runtime),expected);await rpc('hardhat_setCode',[address,runtime]);}
 await rpc('hardhat_impersonateAccount',[SENDER]);await rpc('hardhat_setBalance',[SENDER,ethers.toBeHex(ethers.parseEther('10000'))]);await rpc('hardhat_setNonce',[SENDER,ethers.toBeHex(snapshot.wallet.latest_nonce)]);
 return{accounts:await rpc('eth_accounts'),snapshot};
}
export async function sendLocal(from,request,limit=GAS){
 assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);assert.equal(Number(await rpc('eth_chainId')),CHAIN);
 await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);
 const tx={from,gas:ethers.toBeHex(limit),gasPrice:'0x0',value:'0x0',...request};
 if(tx.chainId!==undefined)assert.equal(Number(tx.chainId),CHAIN);
 delete tx.chainId;
 tx.value=ethers.toBeHex(BigInt(tx.value));
 if(tx.to===null)delete tx.to;
 const hash=await rpc('eth_sendTransaction',[tx]);const receipt=await rpc('eth_getTransactionReceipt',[hash]);assert(receipt);return receipt;
}
export function contract(address,artifact){return{address,interface:new ethers.Interface(artifact.abi)};}
export async function view(c,name,args=[]){const bytes=await rpc('eth_call',[{to:c.address,data:c.interface.encodeFunctionData(name,args),gas:ethers.toBeHex(GAS)},'latest']);return c.interface.decodeFunctionResult(name,bytes);}
export async function value(c,name,args=[]){return(await view(c,name,args))[0];}
