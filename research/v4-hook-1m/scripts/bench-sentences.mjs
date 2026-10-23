import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, concat, keccak256, toBeHex, zeroPadValue } from 'ethers';
import { base, compilationSettings, compileResearch, params } from '../tests/evm/helpers.mjs';

const track='swap-speaker-535k';
const read=file=>readFileSync(path.join(base,track,file));
const json=file=>JSON.parse(read(file));
const sha=data=>createHash('sha256').update(data).digest('hex');
const manifest=json('model/manifest.json'),vocabulary=json('model/vocabulary.json');
assert.equal(manifest.parameters,534751);assert.ok(manifest.parameters>=500000);
// The original floating-point checkpoint is not part of this recovered export.
// Verify every artifact used by EVM deployment, and leave the historical manifest intact.
for(const file of ['core.bin','embeddings.bin','nodes.bin','vocabulary.bin','vocabulary.json'])
 assert.equal(sha(read('model/'+file)),manifest.artifacts[file].sha256);
const vectors=json('reports/integer-fixtures.json'),generated=json('reports/generated-sentences.json');
const sourceFiles=[track+'/contracts/SentenceSpeakerModel.sol',track+'/contracts/SentenceSpeakerHook.sol','tests/evm/ResearchHarness.sol'];
const compiled=compileResearch(sourceFiles);
const rpc=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{deterministic:true},miner:{blockGasLimit:30_000_000,timestampIncrement:0}});
const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const signer=await provider.getSigner(0),abi=AbiCoder.defaultAbiCoder();
const receipts=[];
async function deploy(file,name,args=[],gasLimit=8_000_000){
 const artifact=compiled.contracts[file][name];
 const instance=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(...args,{gasLimit});
 const receipt=await instance.deploymentTransaction().wait();
 receipts.push({name,gas:receipt.gasUsed.toString()});return instance;
}
function int16(buffer){return Array.from({length:buffer.length/2},(_,i)=>BigInt(buffer.readInt16BE(i*2)));}
const embeddings=int16(read('model/embeddings.bin')),core=int16(read('model/core.bin')),nodes=int16(read('model/nodes.bin'));
function step(previous,state,features){
 const hidden=[];
 for(let row=0;row<32;row++){
  let sum=core[2240+row]*1024n;
  for(let j=0;j<32;j++){sum+=core[row*32+j]*embeddings[previous*32+j];sum+=core[1024+row*32+j]*BigInt(state[j]);}
  for(let j=0;j<6;j++)sum+=core[2048+row*6+j]*BigInt(features[j]);
  sum/=1024n;hidden.push(Number(sum<0n?0n:sum>8192n?8192n:sum));
 }
 let node=0;const scores=[];
 for(let depth=0;depth<13;depth++){
  let score=nodes[node*33+32]*1024n;
  for(let j=0;j<32;j++)score+=nodes[node*33+j]*BigInt(hidden[j]);
  score/=1024n;scores.push(score);node=node*2+1+(score>0n?1:0);
 }
 return {token:node-8191,state:hidden,scores};
}
function generate(previous,state,features,limit=12){
 const tokens=[];let ended=false;
 for(let i=0;i<limit;i++){
  const output=step(previous,state,features);previous=output.token;state=output.state;tokens.push(previous);
  if(/[.!?]$/.test(vocabulary[previous])){ended=true;break;}
 }
 return {previous,state,tokens,ended,text:tokens.map(t=>vocabulary[t]).join(' ')+(ended?'':'.')};
}

try{
 const dataFile=track+'/contracts/SentenceSpeakerModel.sol';
 const dataFactory=new ContractFactory(compiled.contracts[dataFile].SentenceModelData.abi,compiled.contracts[dataFile].SentenceModelData.evm.bytecode.object,signer);
 const commitments={};const groups={};let shardCount=0;
 for(const [name,file,chunk] of [['core','core.bin',4544],['embeddings','embeddings.bin',24000],['nodes','nodes.bin',23760],['vocabulary','vocabulary.bin',24000]]){
  const payload=read('model/'+file),addresses=[];let commitment=zeroPadValue('0x00',32);
  for(let start=0;start<payload.length;start+=chunk){
   const part=payload.subarray(start,start+chunk);
   const shard=await dataFactory.deploy('0x'+part.toString('hex'),{gasLimit:6_000_000});
   const receipt=await shard.deploymentTransaction().wait(),address=await shard.getAddress();
   const code=await provider.getCode(address);assert.equal(code,'0x00'+part.toString('hex'));
   addresses.push(address);receipts.push({name:name+'_shard',gas:receipt.gasUsed.toString()});shardCount++;
   commitment=keccak256(abi.encode(['bytes32','bytes32'],[commitment,keccak256(code)]));
  }
  groups[name]=addresses;commitments[name]=commitment;
  console.log(`Deployed and byte-checked ${name}: ${addresses.length} local shards.`);
 }
 assert.equal(shardCount,57);
 const model=await deploy(dataFile,'SentenceSpeakerModel',[groups.core[0],groups.embeddings,groups.nodes,groups.vocabulary]);
 assert.equal(Number(await model.PARAMETERS()),534751);
 const expectedModelHash=keccak256(abi.encode(['string','bytes32','bytes32','bytes32','bytes32'],
  ['GH0ST_SENTENCE_SPEAKER_535K_SAMPLED_T256_V2',keccak256(await provider.getCode(groups.core[0])),commitments.embeddings,commitments.nodes,commitments.vocabulary]));
 assert.equal(await model.modelHash(),expectedModelHash);
 let scoresMatched=0;
 for(const vector of vectors){
  const actual=await model.inspect(vector.previous_token,vector.state,vector.features);
  const independent=step(vector.previous_token,vector.state,vector.features);
  assert.equal(Number(actual.token),vector.token);assert.equal(independent.token,vector.token);
  assert.deepEqual(Array.from(actual.next,Number),vector.next_state);assert.deepEqual(independent.state,vector.next_state);
  assert.deepEqual(Array.from(actual.scores,String),vector.scores.map(String));assert.deepEqual(independent.scores.map(String),vector.scores.map(String));
  scoresMatched+=vector.scores.length;
 }
 for(const i of [0,6,12]){
  const g=generated[i],actual=await model.generate(g.previous_token,g.state,g.features,12);
  assert.equal(actual.text,g.text);assert.deepEqual(Array.from(actual.tokens,Number),g.tokens);
  assert.deepEqual(Array.from(actual.nextState,Number),g.next_state);assert.equal(actual.endedNaturally,g.ended_naturally);
 }
 const invalid=[['previous',8193,Array(32).fill(0),Array(6).fill(0)],['state_negative',0,[-1,...Array(31).fill(0)],Array(6).fill(0)],
  ['state_above_clamp',0,[8193,...Array(31).fill(0)],Array(6).fill(0)],['feature_bound',0,Array(32).fill(0),[4097,0,0,0,0,0]]];
 for(const [,previous,state,features] of invalid)await assert.rejects(model.inspect(previous,state,features));
 for(const limit of [0,17])await assert.rejects(model.generate(8192,Array(32).fill(0),Array(6).fill(0),limit));
 const manager=await deploy('tests/evm/ResearchHarness.sol','V4CallbackHarness');
 const factory=await deploy('tests/evm/ResearchHarness.sol','ResearchCreate2Factory');
 const hookFile=track+'/contracts/SentenceSpeakerHook.sol',artifact=compiled.contracts[hookFile].SentenceSpeakerHook;
 const config=[await manager.getAddress(),await model.getAddress(),'0x0000000000000000000000000000000000000100','0x0000000000000000000000000000000000000200',60,3000,12];
 const request=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).getDeployTransaction(...config);
 const initHash=keccak256(request.data),factoryAddress=await factory.getAddress();let salt,address,attempts;
 for(attempts=0;attempts<2_000_000;attempts++){
  salt=zeroPadValue(toBeHex(attempts),32);address='0x'+keccak256(concat(['0xff',factoryAddress,salt,initHash])).slice(-40);
  if((BigInt(address)&0x3fffn)===0x1040n)break;
 }
 assert.ok(attempts<2_000_000);
 const deployment=await(await factory.deploy(salt,request.data,{gasLimit:8_000_000})).wait();
 receipts.push({name:'SentenceSpeakerHook with test factory',gas:deployment.gasUsed.toString()});
 const hook=new Contract(address,artifact.abi,signer);
 const key={currency0:config[2],currency1:config[3],tickSpacing:60,fee:3000,hooks:address};
 const initial=await(await manager.initialize(key,0)).wait();
 const timestamp=(await provider.getBlock(initial.blockNumber)).timestamp,poolId=await hook.poolId(),modelHash=await model.modelHash();
 await assert.rejects(hook.afterSwap.staticCall(await signer.getAddress(),key,params,0,'0x'));
 await assert.rejects(manager.driveAfterSwap.staticCall({...key,fee:500},params,1,'0x'));
 let reference={tick:0,move:0,ewma:0,timestamp,sequence:0,previous:8192,state:Array(32).fill(0)};
 const sentences=[],measurements=[];
 async function checkReceipt(receipt,ticks){
  const events=receipt.logs.filter(log=>log.address.toLowerCase()===address.toLowerCase()).map(log=>hook.interface.parseLog(log)).filter(event=>event.name==='SentenceSpoken');
  assert.equal(events.length,ticks.length);const now=(await provider.getBlock(receipt.blockNumber)).timestamp;
  for(let i=0;i<ticks.length;i++){
   const c=reference,tick=ticks[i],move=Math.min(Math.abs(tick-c.tick),1024);
   const features=[move*4,c.ewma*4,Math.abs(move-c.move)*4,Math.floor(Math.min(Math.max(now-c.timestamp,0),300)*1024/300),1024,1024];
   const expected=generate(c.previous,c.state,features),event=events[i].args;
   assert.equal(event.text,expected.text);assert.equal(event.sequence,BigInt(c.sequence+1));assert.equal(Number(event.words),expected.tokens.length);assert.equal(event.endedNaturally,expected.ended);
   const inputHash=keccak256(abi.encode(['bytes32','bytes32','uint64','uint16','int16[32]','int32[6]'],[poolId,modelHash,c.sequence+1,c.previous,c.state,features]));
   assert.equal(event.inputHash,inputHash);
   reference={tick,move,ewma:Math.floor((7*c.ewma+move)/8),timestamp:now,sequence:c.sequence+1,
    previous:expected.ended?expected.previous:8192,state:expected.ended?expected.state:Array(32).fill(0)};
   assert.equal(event.stateHash,keccak256(abi.encode(['uint16','int16[32]'],[reference.previous,reference.state])));
   sentences.push({sequence:reference.sequence,text:event.text,words:expected.tokens.length,ended_naturally:expected.ended,features,input_hash:inputHash,block:receipt.blockNumber});
  }
  const c=await hook.context();assert.equal(Number(c.sequence),reference.sequence);assert.equal(Number(c.previousToken),reference.previous);
  assert.deepEqual(Array.from(await hook.hiddenState(),Number),reference.state);
  measurements.push({callbacks:ticks.length,gas_used:receipt.gasUsed.toString(),scope:'Local callback-harness transaction, including complete sentence inference, state writes and event; no AMM math or token settlement'});
 }
 for(let i=0;i<6;i++){
  if(i===3)await rpc.request({method:'evm_increaseTime',params:[600]});
  const tick=reference.tick-(i<2?5:i<4?90:320);
  const receipt=await(await manager.driveCallbackCycle(key,params,tick,'0x',{gasLimit:29_000_000})).wait();
  await checkReceipt(receipt,[tick]);assert.equal(await manager.lastAppliedFee(),3000n);
 }
 const first=reference.tick-100,second=reference.tick-200;
 const receipt=await(await manager.driveTwoAfterCallbacks(key,params,first,second,'0x',{gasLimit:29_000_000})).wait();
 await checkReceipt(receipt,[first,second]);assert.equal(sentences.at(-1).block,sentences.at(-2).block);
 const gas=measurements.filter(m=>m.callbacks===1).map(m=>Number(m.gas_used));
 const report={schema_version:1,status:'PASSED_LOCAL_EVM',parameters:534751,vocabulary_tokens:8192,
  training_location:'Local CPU only; no GitHub training jobs',network:'In-process Ganache Shanghai, 30 million block gas limit; no public transactions',
  architecture:'32-dimensional embedding, 32-dimensional recurrent state, 6 features, learned depth-13 binary word decoder',
  data_shards:shardCount,model_hash:modelHash,compiler:compilationSettings,
  parity:{vectors:vectors.length,branch_scores_matched:scoresMatched,all_hidden_states_exact:true,full_sentence_reference_cases:3},
  sentence_events:sentences.length,natural_completions:sentences.filter(s=>s.ended_naturally).length,
  exactly_one_sentence_per_callback:true,multiple_callbacks_same_block_verified:true,caller_and_pool_checks_passed:true,
  invalid_inputs_rejected:[...invalid.map(v=>v[0]),'zero_word_limit','oversized_word_limit'],
  gas_range_single_callback_transactions:[Math.min(...gas),Math.max(...gas)],measurements,
  total_local_deployment_gas:receipts.reduce((sum,r)=>sum+BigInt(r.gas),0n).toString(),deployment_receipts:receipts,
  source_sha256:Object.fromEntries([...sourceFiles,'scripts/bench-sentences.mjs'].map(file=>[file,sha(readFileSync(path.join(base,file)))])),
  limitations:['This is a callback harness with upstream hook handling, not a full real PoolManager swap.',
   'Sentence length is capped at 12 words; capped output receives a formatting period and an explicit endedNaturally=false flag.',
   'All parameters are part of the trained model, but conditional decoding activates only one vocabulary path per word.',
   'A half-million-parameter research model does not match a large general-purpose language model.',
   'Greedy output can repeat, become incoherent or make inaccurate statements; no economic utility is established.']};
 writeFileSync(path.join(base,track,'reports/evm-benchmark.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(path.join(base,track,'reports/swap-sentence-stream.json'),JSON.stringify(sentences,null,2)+'\n');
 console.log(JSON.stringify({parameters:534751,sentences,gas_range:report.gas_range_single_callback_transactions,parity:report.parity},null,2));
}finally{await provider.destroy();await rpc.disconnect();}
