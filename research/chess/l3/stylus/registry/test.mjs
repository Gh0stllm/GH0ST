import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,keccak256,solidityPacked,AbiCoder,hexlify,toUtf8Bytes} from 'ethers';
const source=readFileSync(new URL('./Gh0stModelRegistry.sol',import.meta.url),'utf8');
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Registry.sol':{content:source}},settings:{viaIR:true,optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
if(out.errors?.some(e=>e.severity==='error'))throw Error(JSON.stringify(out.errors));
const artifact=out.contracts['Registry.sol'].Gh0stModelRegistry;
const raw=ganache.provider({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'},wallet:{deterministic:true,totalAccounts:2},miner:{blockGasLimit:30000000}});
const provider=new BrowserProvider(raw);provider.pollingInterval=10;
const owner=await provider.getSigner(0),other=await provider.getSigner(1);
const factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,owner);
const contract=await factory.deploy();const deployment=await contract.deploymentTransaction().wait();
const tests=[],receipts=[];
async function test(name,fn){await fn();tests.push({name,passed:true});}
async function rejects(p){await assert.rejects(p);}
async function tx(p,label){const r=await (await p).wait();receipts.push({label,gasUsed:r.gasUsed.toString()});return r;}
const empty=keccak256('0x02');
const node=(a,b)=>keccak256(solidityPacked(['bytes1','bytes32','bytes32'],['0x01',a,b]));
const leaf=(i,b)=>keccak256(solidityPacked(['bytes1','uint32','uint32','bytes'],['0x00',i,b.length,b]));
function tree(bytes,pageBytes=256,evilPadding=false){
 const pages=[];for(let i=0;i<bytes.length;i+=pageBytes)pages.push(bytes.slice(i,i+pageBytes));
 let width=1;while(width<pages.length)width*=2;
 const leaves=Array.from({length:width},(_,i)=>i<pages.length?leaf(i,pages[i]):(evilPadding?keccak256(toUtf8Bytes('evil-padding')):empty));
 const levels=[leaves];while(levels.at(-1).length>1){const a=levels.at(-1),b=[];for(let i=0;i<a.length;i+=2)b.push(node(a[i],a[i+1]));levels.push(b);}
 const proofs=pages.map((_,i)=>{const p=[];for(let l=0;l<levels.length-1;l++)p.push(levels[l][(i>>l)^1]);return p;});
 const sha='0x'+createHash('sha256').update(bytes).digest('hex');
 return {bytes,pages,pageBytes,root:levels.at(-1)[0],proofs,sha};
}
const fixture=tree(Uint8Array.from({length:1025},(_,i)=>(i*73+11)&255));
const modelId=await contract.modelId(await owner.getAddress(),fixture.root,fixture.bytes.length,256,fixture.sha);
await test('declared geometry and file commitment bind model ID',async()=>{
 const expected=keccak256(AbiCoder.defaultAbiCoder().encode(['string','address','bytes32','uint64','uint32','bytes32'],['GH0ST_MODEL_V1',await owner.getAddress(),fixture.root,1025,256,fixture.sha]));assert.equal(modelId,expected);
 await tx(contract.registerModel(1025,256,fixture.root,fixture.sha),'register1025');
 const m=await contract.models(modelId);assert.equal(m.pageCount,5n);assert.equal(m.treeHeight,3n);assert.equal(m.isSealed,false);
});
await test('duplicate registration is idempotent',async()=>{assert.equal(await contract.registerModel.staticCall(1025,256,fixture.root,fixture.sha),modelId);const r=await tx(contract.registerModel(1025,256,fixture.root,fixture.sha),'registerDuplicate');assert.equal(r.logs.length,0);});
await test('zero or oversized model rejected',async()=>{await rejects(contract.registerModel.staticCall(0,256,fixture.root,fixture.sha));await rejects(contract.registerModel.staticCall(64n*1024n**3n+1n,256,fixture.root,fixture.sha));});
await test('invalid page geometry and excessive page count rejected',async()=>{await rejects(contract.registerModel.staticCall(1025,255,fixture.root,fixture.sha));await rejects(contract.registerModel.staticCall(1025,768,fixture.root,fixture.sha));await rejects(contract.registerModel.staticCall(64n*1024n**3n,256,fixture.root,fixture.sha));});
await test('unsealed data cannot be loaded',async()=>await rejects(contract.getPage(modelId,0)));
await test('unauthorized upload and seal rejected',async()=>{await rejects(contract.connect(other).uploadPage.staticCall(modelId,0,fixture.pages[0],fixture.proofs[0]));await rejects(contract.connect(other).sealModel.staticCall(modelId));});
await test('unknown model cannot upload, seal or load',async()=>{const unknown=keccak256(toUtf8Bytes('unknown'));await rejects(contract.uploadPage.staticCall(unknown,0,fixture.pages[0],fixture.proofs[0]));await rejects(contract.sealModel.staticCall(unknown));await rejects(contract.getPage(unknown,0));});
await test('premature seal rejected',async()=>await rejects(contract.sealModel.staticCall(modelId)));
await test('index and final page length enforced',async()=>{await rejects(contract.uploadPage.staticCall(modelId,5,fixture.pages[0],fixture.proofs[0]));await rejects(contract.uploadPage.staticCall(modelId,4,fixture.pages[0],fixture.proofs[4]));});
await test('wrong content and reordered page proof rejected',async()=>{const wrong=fixture.pages[0].slice();wrong[0]^=1;await rejects(contract.uploadPage.staticCall(modelId,0,wrong,fixture.proofs[0]));await rejects(contract.uploadPage.staticCall(modelId,0,fixture.pages[1],fixture.proofs[1]));});
await test('wrong proof height rejected',async()=>await rejects(contract.uploadPage.staticCall(modelId,0,fixture.pages[0],[])));
await test('valid pages may arrive out of order',async()=>{for(const i of [2,0,4,1,3])await tx(contract.uploadPage(modelId,i,fixture.pages[i],fixture.proofs[i]),'page1025-'+i);assert.equal((await contract.models(modelId)).uploadedPages,5n);});
await test('same page does not increment count',async()=>{assert.equal(await contract.uploadPage.staticCall(modelId,0,fixture.pages[0],fixture.proofs[0]),false);await tx(contract.uploadPage(modelId,0,fixture.pages[0],fixture.proofs[0]),'duplicatePage');assert.equal((await contract.models(modelId)).uploadedPages,5n);});
await test('conflicting duplicate rejected',async()=>{const b=fixture.pages[0].slice();b[9]^=1;await rejects(contract.uploadPage.staticCall(modelId,0,b,fixture.proofs[0]));});
await test('complete model seals and all bytes load unchanged',async()=>{await tx(contract.sealModel(modelId),'seal1025');for(let i=0;i<fixture.pages.length;i++)assert.equal(await contract.getPage(modelId,i),hexlify(fixture.pages[i]));});
await test('sealed model is immutable and identical actions idempotent',async()=>{assert.equal(await contract.sealModel.staticCall(modelId),false);assert.equal(await contract.uploadPage.staticCall(modelId,0,fixture.pages[0],fixture.proofs[0]),false);const b=fixture.pages[0].slice();b[0]^=1;await rejects(contract.uploadPage.staticCall(modelId,0,b,fixture.proofs[0]));await rejects(contract.getPage(modelId,5));});
await test('noncanonical padding root can never seal',async()=>{const f=tree(Uint8Array.from({length:513},(_,i)=>i&255),256,true);const id=await contract.modelId(await owner.getAddress(),f.root,513,256,f.sha);await tx(contract.registerModel(513,256,f.root,f.sha),'registerBadPadding');for(const i of [0,1])await tx(contract.uploadPage(id,i,f.pages[i],f.proofs[i]),'badPaddingReal-'+i);await rejects(contract.uploadPage.staticCall(id,2,f.pages[2],f.proofs[2]));await rejects(contract.sealModel.staticCall(id));});
await test('single-page height zero is supported',async()=>{const f=tree(Uint8Array.from([1,2,3]));const id=await contract.modelId(await owner.getAddress(),f.root,3,256,f.sha);await tx(contract.registerModel(3,256,f.root,f.sha),'registerSingle');await tx(contract.uploadPage(id,0,f.pages[0],[]),'singlePage');await tx(contract.sealModel(id),'sealSingle');assert.equal(await contract.getPage(id,0),'0x010203');});
const report={scope:'In-memory Ganache deployment and real EVM registry transactions; local fixture bytes only, no public chain or LLM inference',passed:tests.length,tests,solc:solc.version(),evmVersion:'shanghai',chainId:31337,fixtureBytes:1025,fixturePages:5,contractBytecodeBytes:artifact.evm.bytecode.object.length/2,contractBytecodeSHA256:createHash('sha256').update(Buffer.from(artifact.evm.bytecode.object,'hex')).digest('hex'),localDeploymentGas:deployment.gasUsed.toString(),receipts,fullLargeModelUploaded:false,nativeWasmLoaderIntegrated:false,publicTransactions:0,financialActions:false};
writeFileSync(new URL('./evidence/registry-tests.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('./evidence/registry-abi.json',import.meta.url),JSON.stringify(artifact.abi,null,2)+'\n');
writeFileSync(new URL('./evidence/fixture.json',import.meta.url),JSON.stringify({pageBytes:256,totalBytes:1025,root:fixture.root,fileSHA256:fixture.sha,modelId,pages:fixture.pages.map(hexlify),proofs:fixture.proofs,paddingLeaf:empty},null,2)+'\n');
console.log(JSON.stringify({...report,tests:tests.map(t=>t.name),receipts:undefined},null,2));
await raw.disconnect();
