// Read-only policy primitives. These never start a node, sign or send transactions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const E=createRequire('/root/dispute/package.json')('ethers');
export const ZERO=E.ZeroAddress;
const ownerPublic='0x000000000000000000000000000000000000006b';
const arbSys='0x0000000000000000000000000000000000000064';
const ownerABI=new E.Interface(['function getAllChainOwners()view returns(address[])','function isChainOwner(address)view returns(bool)','function getAllNativeTokenOwners()view returns(address[])','function getNativeTokenManagementFrom()view returns(uint64)','function getScheduledUpgrade()view returns(uint64,uint64)','function getNetworkFeeAccount()view returns(address)']);
const sysABI=new E.Interface(['function arbOSVersion()view returns(uint256)']);
export function requireZeroOwnerGenesisConfig(genesis,importObservation){
 assert.equal(typeof genesis.serializedChainConfig,'string');const c=JSON.parse(genesis.serializedChainConfig);
 assert.equal(c.arbitrum.InitialChainOwner.toLowerCase(),ZERO);assert.equal(c.arbitrum.InitialArbOSVersion,61);assert.equal(c.arbitrum.AllowDebugPrecompiles,false);assert.equal(c.arbitrum.EnableArbOS,true);assert.equal(genesis.arbOSInit.nativeTokenSupplyManagementEnabled,false);assert.equal(genesis.arbOSInit.transactionFilteringEnabled,false);assert.deepEqual(genesis.alloc,{});
 // This observation must be emitted by the actual init reader, not inferred from config.
 const readerPins={JsonInitDataReader:'6d967359b4efb78ebf742e3ecdebd6870ecc9e6dada36d519bac46ec0fd86e00',MemoryInitDataReader:'58dc9155de4f6dee7268a3d844c037cd550618a994a4aa64cd331815c231dd1d'};assert(Object.hasOwn(readerPins,importObservation.readerClass));assert.equal(importObservation.readerSourceSHA256,readerPins[importObservation.readerClass]);assert.equal(importObservation.returnedChainOwner.toLowerCase(),ZERO);assert.equal(importObservation.importedAccountCount,0);assert.equal(importObservation.importedArbOSState,false);
 return{checked:true,chainId:BigInt(c.chainId).toString(),ArbOSVersion:61,chainOwner:ZERO,zeroAllocation:true,importObservationRequired:true,scope:'Configuration/actual-reader observation predicate only; genesis reproduction and chain state are separate gates'};
}
export async function requireZeroOwnerState(request,{blockNumber,expectedBlockHash}){
 assert(/^0x[0-9a-fA-F]{64}$/.test(expectedBlockHash));assert(/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(blockNumber));const before=await request('eth_getBlockByNumber',[blockNumber,false]);assert(before);assert.equal(before.hash.toLowerCase(),expectedBlockHash.toLowerCase());assert.equal(BigInt(before.number),BigInt(blockNumber));
 async function call(to,abi,name,args=[]){const raw=await request('eth_call',[{to,data:abi.encodeFunctionData(name,args)},blockNumber]);return abi.decodeFunctionResult(name,raw);}
 const owners=(await call(ownerPublic,ownerABI,'getAllChainOwners'))[0];assert.deepEqual(Array.from(owners,a=>a.toLowerCase()),[ZERO]);assert.equal((await call(ownerPublic,ownerABI,'isChainOwner',[ZERO]))[0],true);const nativeOwners=(await call(ownerPublic,ownerABI,'getAllNativeTokenOwners'))[0];assert.equal(nativeOwners.length,0);assert.equal((await call(ownerPublic,ownerABI,'getNativeTokenManagementFrom'))[0],0n);const upgrade=await call(ownerPublic,ownerABI,'getScheduledUpgrade');assert.equal(upgrade[0],0n);assert.equal(upgrade[1],0n);assert.equal((await call(ownerPublic,ownerABI,'getNetworkFeeAccount'))[0].toLowerCase(),ZERO);const reported=(await call(arbSys,sysABI,'arbOSVersion'))[0];assert.equal(reported,116n); // Canonical ArbSys reports55+ArbOSVersion.
 const after=await request('eth_getBlockByNumber',[blockNumber,false]);assert(after);assert.equal(after.hash.toLowerCase(),expectedBlockHash.toLowerCase());
 return{passed:true,blockNumber:BigInt(blockNumber).toString(),blockHash:expectedBlockHash.toLowerCase(),owners:[ZERO],zeroOwnerIsMember:true,nativeOwners:[],nativeManagementFrom:'0',scheduledUpgrade:['0','0'],networkFeeAccount:ZERO,ArbSysReportedVersion:'116',ArbOSVersion:61,scope:'Read-only pinned-block RPC observations. Request source authentication/finalized coordinator binding must be supplied by caller; no STF proof or public activation accepted here.'};
}
