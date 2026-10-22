import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, AbiCoder, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes, toBeHex, toUtf8String } from 'ethers';

const sourceFiles = [
  'contracts/analysis/S0ULAnalysisFacts.sol',
  'contracts/analysis/S0ULAnalysisCodec.sol',
  'contracts/intel/v2/S0ULUniversalReader.sol',
  'contracts/analysis/test/S0ULAnalysisFactsMocks.sol',
];
const PROFILE = 'tuple(address target,uint256 nativeBalance,bytes32 codeHash,uint256 codeBytes,uint256 scannedBytes,bool complete,uint32 opcodeCount,uint32 push4Count,uint8 selectorCount,bytes4[32] selectorCandidates,uint32[10] opcodeSignals,uint8 interfaceMask,bool ownerAvailable,address owner,bool pausedAvailable,bool paused,bool implementationAvailable,address implementation,bool assetAvailable,address asset,uint64 observedAt,uint64 blockCounter)';
const EVIDENCE = `tuple(${PROFILE} profile,uint8[14] features,bool supplyAvailable,uint256 totalSupply,bool poolAvailable,uint112 reserve0,uint112 reserve1,uint32 reserveTimestamp,address token0,address token1)`;
const BASES = [4,6,8,24,27,30,33,36,39,42,44,46,48,50];
const SCHEMA = 'S0UL-ANALYSIS-FACTS-v1|code:2|native:2|interfaces:16|owner:3|pause:3|implementation:3|asset:3|supply:3|pool:3|delegate:2|writes:2|origin:2|externalCall:2|scan:2|BOS:1|SEP:3|bases:4,6,8,24,27,30,33,36,39,42,44,46,48,50';
const coder = AbiCoder.defaultAbiCoder();
const records = [], measurements = {}, sourceSha256 = {};
let compiled, rpc, provider, signer, signerAddress, reader, facts, token0, token1, codec;
const codecOnly = process.env.S0UL_FACTS_CODEC_ONLY === '1';
const selector = signature => keccak256(toUtf8Bytes(signature)).slice(0,10);
const path = relative => fileURLToPath(new URL('../' + relative, import.meta.url));

function artifact(name) {
  const found = Object.values(compiled.contracts).flatMap(file=>Object.entries(file)).find(([key])=>key===name);
  assert.ok(found, 'Missing artifact '+name); return found[1];
}
async function mined(tx) {
  const sent=await tx;
  const receipt=await provider.getTransactionReceipt(sent.hash)??await sent.wait();
  assert.equal(Number(receipt.status),1,'Local transaction failed'); return receipt;
}
async function deploy(name,args=[]) {
  const a=artifact(name), c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args,{gasLimit:12_000_000});
  await c.waitForDeployment(); return c;
}
async function adapterFor(source) {
  const address=await source.getAddress(); return deploy('S0ULAnalysisFacts',[address,keccak256(await provider.getCode(address))]);
}
async function capture(target,options={}) {
  const [raw,prompt]=await facts.capture(target,{gasLimit:31_000_000,...options});
  const e=coder.decode([EVIDENCE],raw)[0];
  assert.equal(prompt.length,16); assert.equal(prompt[0],1n); assert.equal(prompt[15],3n);
  assert.deepEqual([...prompt].slice(1,15),[...e.features].map((f,i)=>BigInt(BASES[i])+f),'Every prompt token must be derived from its evidence feature');
  return {e,prompt:[...prompt],raw};
}
async function fixture() { return deploy('AnalysisFactsGetterMock'); }
async function getter(target,name,mode,value) { await mined(target.setGetter(selector(name),mode,value)); }
async function poolTokens(target,first=token0,second=token1) {
  const a=typeof first==='string'?first:await first.getAddress(), b=typeof second==='string'?second:await second.getAddress();
  await getter(target,'token0()',0,BigInt(a)); await getter(target,'token1()',0,BigInt(b));
}
function check(name,fn) {
  test(name,async()=>{
    const started=Date.now();
    try { await fn(); records.push({name,result:'PASS',durationMs:Date.now()-started}); }
    catch(error) { records.push({name,result:'FAIL',durationMs:Date.now()-started,error:String(error?.message??error)}); throw error; }
  });
}

before(async()=>{
  const sources={};
  for(const file of sourceFiles) {
    const content=readFileSync(path(file),'utf8'); sources[file]={content}; sourceSha256[file]=createHash('sha256').update(content).digest('hex');
  }
  for(const file of ['analysis-model/schema.json','analysis-model/vocabulary.json']) sourceSha256[file]=createHash('sha256').update(readFileSync(path(file))).digest('hex');
  compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
  assert.deepEqual((compiled.errors??[]).filter(item=>item.severity==='error'),[],(compiled.errors??[]).map(item=>item.formattedMessage).join('\n'));
  for(const name of ['S0ULUniversalReader','S0ULAnalysisFacts']) assert.ok(artifact(name).evm.deployedBytecode.object.length/2<=24_576);
  rpc=ganache.provider({logging:{quiet:true},chain:{chainId:31340,hardfork:'shanghai'},miner:{blockGasLimit:32_000_000},wallet:{deterministic:true}});
  provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1,batchStallTime:0}); provider.pollingInterval=10;
  signer=await provider.getSigner(0); signerAddress=await signer.getAddress();
  reader=await deploy('S0ULUniversalReader'); facts=await adapterFor(reader);
  codec=await deploy('S0ULAnalysisCodec');
  token0=await deploy('AnalysisFactsAssetMock'); token1=await deploy('AnalysisFactsAssetMock');
});
after(async()=>{
  if(compiled&&records.length) {
    let allRecords=records, allMeasurements=measurements, earlierRun;
    if(codecOnly) {
      earlierRun=JSON.parse(readFileSync(path('reports/analysis-facts-evm-validation.json'),'utf8'));
      assert.equal(earlierRun.result,'PASS','Codec-only aggregation requires an earlier successful facts suite');
      for(const [file,hash] of Object.entries(earlierRun.sourceSha256)) assert.equal(sourceSha256[file],hash,'Facts sources changed since the earlier run');
      allRecords=[...new Map([...earlierRun.cases.filter(item=>!item.name.startsWith('strict word codec:')), ...records].map(item=>[item.name,item])).values()];
      allMeasurements={...earlierRun.gas,...measurements};
    }
    const report={format:'s0ul-analysis-facts-local-evm-validation-v1',verifiedUtc:new Date().toISOString(),result:allRecords.every(r=>r.result==='PASS')?'PASS':'FAIL',scope:'In-process Ganache31340/shanghai only. Real S0ULUniversalReader, S0ULAnalysisFacts and S0ULAnalysisCodec; local adversarial target fixtures. No public RPC, transactions or model-quality claim.',compiler:solc.version(),sourceSha256,runtimeBytes:{reader:artifact('S0ULUniversalReader').evm.deployedBytecode.object.length/2,facts:artifact('S0ULAnalysisFacts').evm.deployedBytecode.object.length/2,codec:artifact('S0ULAnalysisCodec').evm.deployedBytecode.object.length/2},tests:{total:allRecords.length,passed:allRecords.filter(r=>r.result==='PASS').length,failed:allRecords.filter(r=>r.result==='FAIL').length},gas:allMeasurements,cases:allRecords};
    if(earlierRun) report.validationRuns=[...(earlierRun.validationRuns??[{verifiedUtc:earlierRun.verifiedUtc,passed:earlierRun.tests.passed,scope:'facts integration',sourceSha256:earlierRun.sourceSha256}]),{verifiedUtc:report.verifiedUtc,passed:records.filter(r=>r.result==='PASS').length,scope:'codec subset; prior facts cases retained only after exact unchanged-source hash checks',sourceSha256}];
    writeFileSync(path('reports/analysis-facts-evm-validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({result:report.result,tests:report.tests,gas:measurements}));
  }
  await provider?.destroy(); await rpc?.disconnect();
});

check('reader identity, schema identity and constructor pins fail closed',async()=>{
  assert.equal(await facts.reader(),await reader.getAddress());
  assert.equal(await facts.readerCodeHash(),keccak256(await provider.getCode(await reader.getAddress())));
  assert.equal(await facts.chainId(),31340n);
  assert.equal(await facts.schemaHash(),keccak256(toUtf8Bytes(SCHEMA)));
  await assert.rejects(deploy('S0ULAnalysisFacts',[ZeroAddress,ZeroHash]));
  await assert.rejects(deploy('S0ULAnalysisFacts',[await reader.getAddress(),ZeroHash]));
  await assert.rejects(deploy('S0ULAnalysisFacts',[await reader.getAddress(),'0x'+'ab'.repeat(32)]));
  const addr=await reader.getAddress(), original=await provider.getCode(addr);
  await rpc.request({method:'evm_setAccountCode',params:[addr,'0x00']});
  try { await assert.rejects(facts.capture(ZeroAddress)); }
  finally { await rpc.request({method:'evm_setAccountCode',params:[addr,original]}); }
});

check('zero, unfunded no-code and funded no-code addresses are accepted with exact full-width native balance',async()=>{
  for(const [address,balance] of [[ZeroAddress,0n],['0x0000000000000000000000000000000000009001',0n],['0x0000000000000000000000000000000000009002',(1n<<200n)+123n]]) {
    await rpc.request({method:'evm_setAccountBalance',params:[address,toBeHex(balance)]});
    const {e,prompt}=await capture(address); assert.equal(e.profile.target,address); assert.equal(e.profile.nativeBalance,balance);
    assert.equal(e.profile.codeBytes,0n); assert.equal(e.supplyAvailable,false); assert.equal(e.poolAvailable,false);
    assert.deepEqual([...e.features],[0n,balance===0n?0n:1n,0n,0n,0n,0n,0n,0n,0n,0n,0n,0n,0n,1n]);
    assert.equal(prompt[1],4n); assert.equal(prompt[2],balance===0n?6n:7n);
  }
});

check('contract evidence preserves exact code hash, balance, block counter and observation timestamp',async()=>{
  const target=await fixture(), address=await target.getAddress();
  await rpc.request({method:'evm_setAccountBalance',params:[address,toBeHex(111n)]});
  const {e}=await capture(address), block=await provider.getBlock('latest');
  assert.equal(e.profile.target,address); assert.equal(e.profile.nativeBalance,111n); assert.equal(e.profile.codeHash,keccak256(await provider.getCode(address)));
  assert.equal(e.profile.codeBytes,BigInt((await provider.getCode(address)).length/2-1));
  assert.equal(e.profile.observedAt,BigInt(block.timestamp)); assert.equal(e.profile.blockCounter,BigInt(block.number));
  assert.equal(e.features[0],1n); assert.equal(e.features[1],1n); assert.equal(e.features[13],1n);
});

check('reported interface masks require canonical ERC165 and map directly to the model input',async()=>{
  const target=await fixture(), address=await target.getAddress();
  for(const [flags,mask] of [[0,1],[1,3],[2,5],[4,9],[7,15]]) {
    await mined(target.setInterfaces(flags,0)); const {e,prompt}=await capture(address);
    assert.equal(e.features[2],BigInt(mask)); assert.equal(prompt[3],8n+BigInt(mask));
  }
  for(const mode of [1,2,3,4]) {
    await mined(target.setInterfaces(7,mode)); const {e}=await capture(address); assert.equal(e.features[2],0n,'Nonconforming interface mode '+mode);
  }
});

check('ownership, implementation and asset classify unavailable, zero and nonzero separately without truncating dirty addresses',async()=>{
  const target=await fixture(), address=await target.getAddress();
  for(const [name,index] of [['owner()',3],['implementation()',5],['asset()',6]]) {
    assert.equal((await capture(address)).e.features[index],0n);
    await getter(target,name,0,0n); assert.equal((await capture(address)).e.features[index],1n);
    await getter(target,name,0,BigInt(signerAddress)); assert.equal((await capture(address)).e.features[index],2n);
    await getter(target,name,0,(1n<<200n)|BigInt(signerAddress)); assert.equal((await capture(address)).e.features[index],0n);
    await mined(target.clearGetter(selector(name)));
  }
});

check('pause has unavailable, false and true states and rejects noncanonical boolean data',async()=>{
  const target=await fixture(), address=await target.getAddress();
  assert.equal((await capture(address)).e.features[4],0n);
  for(const [value,feature] of [[0n,1n],[1n,2n],[2n,0n]]) {
    await getter(target,'paused()',0,value); assert.equal((await capture(address)).e.features[4],feature);
  }
  await getter(target,'paused()',2,1n); assert.equal((await capture(address)).e.features[4],0n);
});

check('supply availability is independent of zero or positive value and preserves all uint256 bits',async()=>{
  const target=await fixture(), address=await target.getAddress();
  assert.equal((await capture(address)).e.features[7],0n);
  for(const [value,feature] of [[0n,1n],[1n,2n],[(1n<<256n)-1n,2n]]) {
    await getter(target,'totalSupply()',0,value); const {e,prompt}=await capture(address);
    assert.equal(e.supplyAvailable,true); assert.equal(e.totalSupply,value); assert.equal(e.features[7],feature); assert.equal(prompt[8],36n+feature);
  }
});

check('scalar return bombs, truncation, revert, gas exhaustion and attempted writes cannot poison feature classes',async()=>{
  const target=await fixture(), address=await target.getAddress();
  for(const mode of [1,2,3,4,5,6,7,8,9]) {
    await getter(target,'totalSupply()',mode,123n);
    const {e,prompt}=await capture(address); assert.equal(e.supplyAvailable,false,'Mode '+mode); assert.equal(e.features[7],0n); assert.equal(prompt[8],36n);
    assert.equal(e.features[0],1n); assert.equal(e.features[13],1n); assert.equal(await target.counter(),0n,'STATICCALL must prohibit getter writes');
  }
  await getter(target,'totalSupply()',0,1n); assert.equal((await capture(address)).e.totalSupply,1n);
});

check('pool compatibility requires canonical reserves and live distinct asset contract addresses',async()=>{
  const target=await fixture(), address=await target.getAddress();
  await mined(target.setReserves(10n,20n,1n,0));
  assert.equal((await capture(address)).e.poolAvailable,false,'No asset getters');
  await poolTokens(target); let {e,prompt}=await capture(address);
  assert.equal(e.poolAvailable,true); assert.equal(e.reserve0,10n); assert.equal(e.reserve1,20n); assert.equal(e.reserveTimestamp,1n);
  assert.equal(e.token0,await token0.getAddress()); assert.equal(e.token1,await token1.getAddress()); assert.equal(e.features[8],2n); assert.equal(prompt[9],41n);
  for(const [first,second] of [[ZeroAddress,await token1.getAddress()],[await token0.getAddress(),ZeroAddress],[await token0.getAddress(),await token0.getAddress()],[signerAddress,await token1.getAddress()]]) {
    await poolTokens(target,first,second); assert.equal((await capture(address)).e.poolAvailable,false);
  }
  await poolTokens(target);
  await getter(target,'token0()',0,(1n<<200n)|BigInt(await token0.getAddress())); assert.equal((await capture(address)).e.poolAvailable,false);
  await poolTokens(target); await getter(target,'token1()',3,BigInt(await token1.getAddress())); assert.equal((await capture(address)).e.poolAvailable,false);
});

check('pool zero reserves, uint112 and uint32 boundaries are distinguished and out-of-range words are rejected',async()=>{
  const target=await fixture(), address=await target.getAddress(); await poolTokens(target);
  for(const [r0,r1,time,available,feature] of [[0n,2n,0n,true,1n],[1n,0n,0n,true,1n],[0n,0n,0n,true,1n],[(1n<<112n)-1n,(1n<<112n)-1n,(1n<<32n)-1n,true,2n],[1n<<112n,1n,0n,false,0n],[1n,1n<<112n,0n,false,0n],[1n,1n,1n<<32n,false,0n]]) {
    await mined(target.setReserves(r0,r1,time,0)); const {e}=await capture(address);
    assert.equal(e.poolAvailable,available); assert.equal(e.features[8],feature);
    if(available) { assert.equal(e.reserve0,r0); assert.equal(e.reserve1,r1); assert.equal(e.reserveTimestamp,time); }
  }
});

check('pool malformed sizes, bombs, reverts, exhausted gas and write attempts are unavailable rather than fabricated',async()=>{
  const target=await fixture(), address=await target.getAddress(); await poolTokens(target);
  for(const mode of [1,2,3,4,5,6,7,8,9]) {
    await mined(target.setReserves(1n,2n,3n,mode)); const {e}=await capture(address);
    assert.equal(e.poolAvailable,false,'Reserve mode '+mode); assert.equal(e.features[8],0n); assert.equal(e.reserve0,0n); assert.equal(e.token0,ZeroAddress);
    assert.equal(await target.counter(),0n);
  }
});

check('opcode features are exact structural flags, skip PUSH data and retain incomplete-scan evidence',async()=>{
  const address='0x0000000000000000000000000000000000009020';
  await rpc.request({method:'evm_setAccountCode',params:[address,'0x00f15532f4']});
  let {e,prompt}=await capture(address); assert.deepEqual([...e.features].slice(9,13),[1n,1n,1n,1n]); assert.deepEqual(prompt.slice(10,14),[43n,45n,47n,49n]);
  await rpc.request({method:'evm_setAccountCode',params:[address,'0x637ff1553200']});
  ({e}=await capture(address)); assert.deepEqual([...e.features].slice(9,13),[0n,0n,0n,0n],'PUSH payloads are not opcode positions');
  const code='0x00'+'00'.repeat(24575)+'f4';
  await rpc.request({method:'evm_setAccountCode',params:[address,code]});
  ({e,prompt}=await capture(address)); assert.equal(e.profile.codeBytes,24577n); assert.equal(e.profile.scannedBytes,24576n); assert.equal(e.features[13],0n); assert.equal(prompt[14],50n); assert.equal(e.features[9],0n);
});

check('cross-checks reject reader target, native balance, code identity, mask, clock or block inconsistencies',async()=>{
  const badReader=await deploy('AnalysisFactsBadReaderMock'), badFacts=await adapterFor(badReader);
  await badFacts.capture(ZeroAddress);
  for(const mode of [1,2,3,4,5,6,7]) {
    await mined(badReader.setMode(mode)); await assert.rejects(badFacts.capture(ZeroAddress),'Inconsistent profile mode '+mode);
  }
});

check('capture derives prompt internally, ignores trailing ABI data, rejects insufficient gas and fits bounded adversarial scan',async()=>{
  const address='0x0000000000000000000000000000000000009030';
  const unique=Array.from({length:31},(_,i)=>'63'+i.toString(16).padStart(8,'0')).join('');
  const code='0x'+unique+('630000001e').repeat(Math.floor((24576-155)/5))+'00';
  assert.equal((code.length-2)/2,24576);
  await rpc.request({method:'evm_setAccountCode',params:[address,code]});
  const expected=await capture(address);
  const data=facts.interface.encodeFunctionData('capture',[address])+coder.encode(['uint16[]'],[Array(16).fill(511)]).slice(2);
  const raw=await provider.call({to:await facts.getAddress(),data,gasLimit:31_000_000});
  const decoded=facts.interface.decodeFunctionResult('capture',raw); assert.deepEqual([...decoded.prompt],expected.prompt);
  await assert.rejects(facts.capture(address,{gasLimit:70_000}));
  const receipt=await mined(signer.sendTransaction({...await facts.capture.populateTransaction(address),gasLimit:31_000_000}));
  measurements.adversarial24576ByteCapture=receipt.gasUsed.toString(); assert.ok(receipt.gasUsed<31_000_000n);
});

check('strict word codec: domain, schema and all output words match the frozen Python vocabulary',async()=>{
  const vocabulary=JSON.parse(readFileSync(path('analysis-model/vocabulary.json'),'utf8'));
  const schema=JSON.parse(readFileSync(path('analysis-model/schema.json'),'utf8'));
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  assert.equal(createHash('sha256').update(JSON.stringify(vocabulary.words)).digest('hex'),vocabulary.domain_sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(stable(schema))).digest('hex'),vocabulary.schema_sha256);
  assert.equal(await codec.domainSha256(),'0x'+vocabulary.domain_sha256); assert.equal(await codec.schemaSha256(),'0x'+vocabulary.schema_sha256);
  assert.equal(await codec.FIRST_WORD(),64n); assert.equal(await codec.LAST_WORD(),BigInt(vocabulary.last_output_id));
  for(let offset=0;offset<vocabulary.words.length;offset+=31) {
    const words=vocabulary.words.slice(offset,offset+31), ids=words.map((_,i)=>64+offset+i);
    assert.equal(toUtf8String(await codec.decode([...ids,2],true)),words.join(' '));
  }
});

check('strict word codec: exact generated words round trip without selecting or replacing content',async()=>{
  const vocabulary=JSON.parse(readFileSync(path('analysis-model/vocabulary.json'),'utf8'));
  const text='No runtime code observed. Native balance zero. This snapshot cannot establish identity, history, value, or safety.';
  const words=text.split(' '), inverse=new Map(Object.entries(vocabulary.id_to_word).map(([id,word])=>[word,Number(id)]));
  const ids=[...words.map(word=>inverse.get(word)),2]; assert.ok(ids.every(Number.isInteger));
  assert.equal(toUtf8String(await codec.decode(ids,true)),text); assert.equal(toUtf8String(await codec.decode(ids,false)),text);
  const reversed=[...ids.slice(0,-1)].reverse();
  assert.equal(toUtf8String(await codec.decode([...reversed,2],false)),[...words].reverse().join(' '),'Decoder must preserve emitted order rather than reconstruct a reference report');
});

check('strict word codec: missing EOS, repeated or middle specials, input IDs, padding and unassigned vocabulary IDs fail closed',async()=>{
  for(const ids of [[],[2],[64],[64,1],[0,2],[1,64,2],[64,0,2],[64,1,2],[64,3,2],[64,4,2],[64,51,2],[64,52,2],[64,63,2],[64,151,2],[64,511,2],[64,2,2]]) await assert.rejects(codec.decode(ids,true),'Invalid generated IDs '+ids);
  for(const id of [0,1,2,3,4,51,52,63,151,511]) await assert.rejects(codec.word(id));
});

check('strict word codec: output length counts EOS and enforces the thirty-two-token generation boundary',async()=>{
  const words=Array(31).fill(64), expected=Array(31).fill('Asset').join(' ');
  assert.equal(toUtf8String(await codec.decode([...words,2],true)),expected);
  await assert.rejects(codec.decode([...words,64,2],true));
});
