import assert from 'node:assert/strict';
import test from 'node:test';
import {AbiCoder,ZeroHash,concat,dataSlice,keccak256,solidityPacked,zeroPadValue,getBytes} from 'ethers';
import {MODEL_ID,JOB_ROUTE_IDS,TRUSTED_JOB_TRANSPORT} from '../scripts/job-plan.mjs';
import {JOB_PACKET_TYPE,packJobTokens} from '../scripts/job-worker.mjs';
import {decodeRelayPacket,validateTwoDvnConfig,chooseRelayAction,sendRelayAction,FIXED_OPTIONS} from '../scripts/job-relay.mjs';
const coder=AbiCoder.defaultAbiCoder();
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
function fixture(result=false) {
 const home={key:'robinhood',role:'home',eid:30416,router:addr(1)},compute={key:'opbnb',role:'compute',eid:30202,router:addr(2)};
 const source=result?compute:home,destination=result?home:compute;
 const config={modelId:MODEL_ID,routeId:JOB_ROUTE_IDS.opbnb,sessionId:'0x'+'12'.repeat(32)};
 const tokens=packJobTokens(result?[5,6]:[1,2]),promptHash=keccak256(packJobTokens([1,2])),maxNewTokens=2;
 const jobId=keccak256(coder.encode(['bytes32','bytes32','bytes32','bytes32','uint32'],[config.routeId,MODEL_ID,config.sessionId,promptHash,maxNewTokens]));
 const trace=result?'0x'+'33'.repeat(32):keccak256(coder.encode(['string','bytes32'],['GH0ST_JOB_V2',jobId]));
 const message=coder.encode([JOB_PACKET_TYPE],[[2,result?2:1,config.routeId,MODEL_ID,config.sessionId,jobId,promptHash,maxNewTokens,trace,tokens]]);
 const header=solidityPacked(['uint8','uint64','uint32','bytes32','uint32','bytes32'],[1,7,source.eid,zeroPadValue(source.router,32),destination.eid,zeroPadValue(destination.router,32)]);
 const guid=keccak256(dataSlice(header,1)),encoded=concat([header,guid,message]);
 return {source,destination,config,header,guid,message,encoded,decoded:decodeRelayPacket(encoded,source,destination,config)};
}
function receiver(packet,{quorum=false,accepted=false,stored=ZeroHash,nonce=0n}={}) {
 const key=packet.destination.key,requiredDVNs=[...TRUSTED_JOB_TRANSPORT[key].requiredDVNs];
 const config={...packet.destination,chainId:key==='opbnb'?204:4663,dvnConfirmations:20,maxTransactionGas:'16777216',maxFeePerGasWei:'10',confirmations:1};
 const uln={confirmations:20n,requiredDVNCount:2n,optionalDVNCount:0n,optionalDVNThreshold:0n,requiredDVNs,optionalDVNs:[]};
 return {config,execute:true,deadline:100,router:{acceptedGuid:async()=>accepted},endpoint:{inboundPayloadHash:async()=>stored,lazyInboundNonce:async()=>nonce},
  receiveLibrary:{getUlnConfig:async()=>uln,verifiable:async()=>quorum},uln,
  provider:{getBlock:async()=>({timestamp:1,baseFeePerGas:0n}),getFeeData:async()=>({maxFeePerGas:null,maxPriorityFeePerGas:null,gasPrice:5n})}};
}
test('job packet parsing preserves exact LZ header, GUID, payload hash and origin',()=>{
 for(const isResult of [false,true]){const f=fixture(isResult);assert.equal(getBytes(f.header).length,81);assert.equal(f.decoded.header,f.header);assert.equal(f.decoded.guid,f.guid);assert.equal(f.decoded.message,f.message);assert.equal(f.decoded.payloadHash,keccak256(concat([f.guid,f.message])));assert.equal(f.decoded.origin.nonce,7n);}
 assert.equal(getBytes(FIXED_OPTIONS).length,22);
});
test('changed GUID, packet version, source OApp or job identity is rejected',()=>{
 const f=fixture();
 assert.throws(()=>decodeRelayPacket(concat([f.header,ZeroHash,f.message]),f.source,f.destination,f.config),/GUID/);
 assert.throws(()=>decodeRelayPacket('0x02'+f.encoded.slice(4),f.source,f.destination,f.config),/version/);
 assert.throws(()=>decodeRelayPacket(f.encoded,{...f.source,router:addr(3)},f.destination,f.config),/OApp/);
 assert.throws(()=>decodeRelayPacket(f.encoded,f.source,f.destination,{...f.config,sessionId:ZeroHash}),/identity/);
});
test('exactly the two pinned required DVNs and reviewed confirmations are mandatory',()=>{
 const f=fixture(),d=receiver(f);assert.equal(validateTwoDvnConfig(d.uln,d.config),d.uln);
 for(const change of [{requiredDVNCount:1n},{optionalDVNCount:1n},{confirmations:1n},{requiredDVNs:[addr(8),addr(9)]}])assert.throws(()=>validateTwoDvnConfig({...d.uln,...change},d.config));
});
test('failed quorum never constructs a payable commit or delivery action',async()=>{
 const f=fixture(),d=receiver(f);const action=await chooseRelayAction(d,f.decoded);assert.equal(action.kind,'waiting-dvns');
 await assert.rejects(sendRelayAction(d,action),/Unsupported relay action/);
});
test('successful quorum commits exact packet header and guid-plus-message hash',async()=>{
 const f=fixture(),d=receiver(f,{quorum:true});const action=await chooseRelayAction(d,f.decoded);
 assert.equal(action.method,'commitVerification');assert.deepEqual(action.args,[f.header,keccak256(concat([f.guid,f.message]))]);
});
test('delivery is selected only after endpoint stores the exact verified payload hash',async()=>{
 const f=fixture(),d=receiver(f,{stored:f.decoded.payloadHash});const action=await chooseRelayAction(d,f.decoded);
 assert.equal(action.kind,'deliver');assert.deepEqual(action.args,[f.decoded.origin,f.destination.router,f.guid,f.message,'0x']);
 const wrong=receiver(f,{stored:'0x'+'01'.repeat(32)});await assert.rejects(chooseRelayAction(wrong,f.decoded),/different or nil/);
});
test('accepted GUIDs skip replay and cleared nonces cannot be resubmitted',async()=>{
 const f=fixture();assert.equal((await chooseRelayAction(receiver(f,{accepted:true}),f.decoded)).kind,'delivered');
 await assert.rejects(chooseRelayAction(receiver(f,{nonce:7n}),f.decoded),/already cleared/);
});
function payableTarget(connection,method,fail=false) {
 const calls=[];const fn=async(...args)=>{calls.push(['send',args]);return {wait:async()=>({status:1,hash:'0xlocal-test',gasUsed:1n})};};
 fn.estimateGas=async(...args)=>{calls.push(['estimate',args]);return 100000n;};
 fn.staticCall=async(...args)=>{calls.push(['simulate',args]);if(fail)throw Error('failed');};
 connection.endpoint[method]=fn;return {calls,target:connection.endpoint};
}
test('failed relay preflight and read-only mode never execute destination calls',async()=>{
 const f=fixture(),d=receiver(f,{stored:f.decoded.payloadHash}),p=payableTarget(d,'lzReceive',true);
 const action=await chooseRelayAction(d,f.decoded);await assert.rejects(sendRelayAction(d,action));assert.equal(p.calls.filter(x=>x[0]==='send').length,0);
 d.execute=false;await assert.rejects(sendRelayAction(d,action),/disabled/);
});
test('signed delivery arguments match the verified packet bytes used in preflight',async()=>{
 const f=fixture(true),d=receiver(f,{stored:f.decoded.payloadHash}),p=payableTarget(d,'lzReceive');
 const action=await chooseRelayAction(d,f.decoded);await sendRelayAction(d,action);
 const simulated=p.calls.find(x=>x[0]==='simulate')[1],signed=p.calls.find(x=>x[0]==='send')[1];
 assert.deepEqual(signed.slice(0,-1),simulated.slice(0,-1));assert.deepEqual(signed.slice(0,-1),action.args);
 assert.equal(signed.at(-1).value,0n);assert.equal(signed.at(-1).gasLimit,120000n);
});
