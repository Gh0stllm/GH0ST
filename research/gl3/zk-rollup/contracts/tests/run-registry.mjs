import fs from 'node:fs';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const E = createRequire('/root/dispute/package.json')('ethers');
assert.equal(process.platform,'linux');
const R=process.env.GL3_COORDINATOR_TEST_ROOT||'/workspace/gl3/zk-rollup/coordinator', O=R+'/evidence';
const GETH='/workspace/gl3/durable/bin/geth';
const save=(n,x)=>fs.writeFileSync(O+'/'+n,JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const coder=E.AbiCoder.defaultAbiCoder();
const checks=[],receipts=[];
let geth,rpc,log;
const report={passed:false,scope:'Synthetic accumulator/registry and ABI units. No canonical guest proof, bridge payout or mainnet execution.',publicWrites:0};
function check(name){checks.push({name,passed:true});console.log(JSON.stringify({name,passed:true}));}
async function freePort(){const s=net.createServer();return new Promise(r=>s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));}));}
async function mined(tx,label){const receipt=await(await tx).wait();assert.equal(receipt.status,1);const raw=await rpc.send('eth_getTransactionReceipt',[receipt.hash]);save('receipts/'+receipt.hash+'.json',raw);save('transactions/'+receipt.hash+'.json',await rpc.send('eth_getTransactionByHash',[receipt.hash]));receipts.push({label,hash:receipt.hash,status:1,gas:String(receipt.gasUsed)});return receipt;}
async function reject(name,contract,method,args,expected){
    try {await contract[method].staticCall(...args);assert.fail('unexpected success');}
    catch(e){assert.equal(e.code,'CALL_EXCEPTION');assert(e.data&&e.data!=='0x');if(expected)assert.equal(contract.interface.parseError(e.data).name,expected);}
    try{await(await contract[method](...args,{gasLimit:1000000})).wait();assert.fail('unexpected mined success');}
    catch(e){assert.equal(e.code,'CALL_EXCEPTION');assert(e.receipt&&e.receipt.status===0);assert(e.receipt.gasUsed<1000000n);save('receipts/'+e.receipt.hash+'.json',await rpc.send('eth_getTransactionReceipt',[e.receipt.hash]));save('transactions/'+e.receipt.hash+'.json',await rpc.send('eth_getTransactionByHash',[e.receipt.hash]));receipts.push({label:name,hash:e.receipt.hash,status:0,gas:String(e.receipt.gasUsed)});}
    check(name);
}
try{
    fs.mkdirSync(O+'/receipts',{recursive:true});fs.mkdirSync(O+'/transactions',{recursive:true});
    const compiled=spawnSync('node',['--max-old-space-size=640',R+'/source/tests/compile.cjs'],{stdio:'inherit'});
    assert.equal(compiled.status,0,'coordinator compilation');
    const artifacts=JSON.parse(fs.readFileSync(O+'/unit-artifacts.json'));
    assert.equal(createHash('sha256').update(fs.readFileSync(GETH)).digest('hex'),'daec86c874d2f31d70784f4c8e15faf786e8eebd3cd23e77be744c2c42273119');
    const hp=await freePort(),ap=await freePort();log=fs.openSync(O+'/geth.log','w');
    geth=spawn(GETH,['--cache','16','--dev','--dev.period','1','--datadir',R+'/runtime/geth','--http','--http.addr','127.0.0.1','--http.port',String(hp),'--http.api','eth,net,web3','--authrpc.addr','127.0.0.1','--authrpc.port',String(ap),'--port','0','--nodiscover','--maxpeers','0','--ipcdisable','--nat','none'],{stdio:['ignore',log,log]});
    save('owned-geth.json',{pid:geth.pid,RPCBind:'127.0.0.1',chainId:1337});
    rpc=new E.JsonRpcProvider('http://127.0.0.1:'+hp,1337,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});rpc.pollingInterval=25;
    const send=rpc.send.bind(rpc);
    const allowed=new Set(['eth_chainId','eth_accounts','eth_blockNumber','eth_getBlockByNumber','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getCode','eth_call','eth_estimateGas','eth_sendTransaction','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory']);
    rpc.send=async(method,params)=>{assert(allowed.has(method),method);const at=Date.now();for(;;){try{return await send(method,params);}catch(e){if(method!=='eth_getTransactionReceipt'||e?.error?.code!==-32000||e?.error?.message!=='transaction indexing is in progress'||Date.now()-at>=5000)throw e;await sleep(25);}}};
    const started=Date.now();for(;;){try{if(BigInt(await rpc.send('eth_chainId',[]))===1337n)break;}catch{}assert(Date.now()-started<15000);await sleep(25);}
    const [account]=await rpc.send('eth_accounts',[]),signer=await rpc.getSigner(account);
    async function deploy(name,args=[]){const a=artifacts[name],c=await new E.ContractFactory(a.abi,a.bytecode,signer).deploy(...args);await mined(Promise.resolve(c.deploymentTransaction()),'deploy '+name);return c;}
    const bridge=await deploy('UnitAccumulatorBridge'),domain=E.id('synthetic registry unit domain');
    const registry=await deploy('UnitDataRegistry',[bridge.target,domain]);
    const codec=await deploy('UnitStatementCodec');
    const sender='0x1234567890123456789012345678901234567890';
    const body='0x0102030405';
    const delayedWire=E.solidityPacked(['uint8','uint256','uint64','uint64','uint256','uint256','bytes'],[12,BigInt(sender),101,202,0,303,body]);
    const messageHash=E.keccak256(E.solidityPacked(['uint8','address','uint64','uint64','uint256','uint256','bytes32'],[12,sender,101,202,0,303,E.keccak256(body)]));
    assert.equal(E.dataLength(delayedWire),118);
    const delayedAcc=E.keccak256(E.concat([E.ZeroHash,messageHash]));
    await mined(bridge.appendDelayed(delayedAcc),'synthetic authenticated delayed accumulator');
    await mined(registry.registerDelayedData(0,delayedWire),'register canonical delayed wire');
    const delayed=await registry.delayedRecords(0);assert.equal(delayed.wireHash,E.keccak256(delayedWire));assert.equal(delayed.messageHash,messageHash);assert.equal(delayed.afterAccumulator,delayedAcc);check('113-byte delayed header and 20-byte packed sender produce the authenticated accumulator');
    await mined(registry.registerDelayedData(0,delayedWire),'idempotent delayed registration');
    const mutate=(wire,index,value)=>{const b=E.getBytes(wire);b[index]^=value;return E.hexlify(b);};
    await reject('changed delayed body rejected',registry,'registerDelayedData',[0,mutate(delayedWire,117,1)],'AccumulatorMismatch');
    await reject('noncanonical sender high padding rejected',registry,'registerDelayedData',[0,mutate(delayedWire,1,1)],'InvalidWire');
    await reject('wrong encoded delayed index rejected',registry,'registerDelayedData',[0,mutate(delayedWire,80,1)],'InvalidWire');
    await reject('missing delayed index rejected',registry,'registerDelayedData',[1,delayedWire],'UnknownInboxIndex');
    await reject('short delayed wire rejected',registry,'registerDelayedData',[0,'0x00'],'InvalidWire');
    const header=E.solidityPacked(['uint64','uint64','uint64','uint64','uint64'],[100,200,1,10,1]);
    const firstWire=header,secondWire=E.concat([header,'0x003b']);
    const firstAcc=E.keccak256(E.concat([E.ZeroHash,E.keccak256(firstWire),delayedAcc]));
    const secondAcc=E.keccak256(E.concat([firstAcc,E.keccak256(secondWire),delayedAcc]));
    await mined(bridge.appendSequencer(firstAcc),'synthetic force-inclusion accumulator');
    await mined(bridge.appendSequencer(secondAcc),'synthetic calldata accumulator');
    await reject('out-of-order data registration rejected',registry,'registerSequencerData',[1,secondWire],'NoncontiguousRegistration');
    await mined(registry.registerSequencerData(0,firstWire),'register force-inclusion wire');
    await mined(registry.registerSequencerData(1,secondWire),'register calldata wire');
    assert.equal((await registry.sequencerRecords(1)).afterAccumulator,secondAcc);check('header-only force inclusion and calldata wires authenticate consecutive canonical accumulator equations');
    await mined(registry.registerSequencerData(1,secondWire),'idempotent sequencer registration');
    await reject('changed sequencer header rejected',registry,'registerSequencerData',[1,mutate(secondWire,7,1)],'AccumulatorMismatch');
    await reject('changed sequencer payload rejected',registry,'registerSequencerData',[1,mutate(secondWire,41,1)],'AccumulatorMismatch');
    await reject('changed delayed count rejected',registry,'registerSequencerData',[1,mutate(secondWire,39,2)],'UnknownInboxIndex');
    for(const flag of ['80','88','50','01','20']) await reject('unsupported DA flag '+flag+' rejected',registry,'registerSequencerData',[1,E.concat([header,'0x'+flag])],'UnsupportedDataAvailability');
    await reject('short sequencer wire rejected',registry,'registerSequencerData',[0,'0x00'],'InvalidWire');
    await reject('missing sequencer index rejected',registry,'registerSequencerData',[2,firstWire],'UnknownInboxIndex');
    const seqSeed=E.keccak256(coder.encode(['bytes32','bytes32'],[E.id('GH0ST_GL3_SEQ_RANGE_V1'),domain]));
    let seqPrefix=seqSeed;
    for(const [i,wire,before,after] of [[0,firstWire,E.ZeroHash,firstAcc],[1,secondWire,firstAcc,secondAcc]]) seqPrefix=E.keccak256(coder.encode(['bytes32','uint64','bytes32','bytes32','bytes32','uint64','bytes32'],[seqPrefix,i,E.keccak256(wire),before,after,1,delayedAcc]));
    const seqCommit=E.keccak256(coder.encode(['bytes32','bytes32','uint64','uint64','bytes32','bytes32'],[E.id('GH0ST_GL3_SEQ_RANGE_V1'),domain,0,2,seqSeed,seqPrefix]));
    assert.equal(await registry.sequencerRangeCommitment(0,2),seqCommit);
    const delayedSeed=E.keccak256(coder.encode(['bytes32','bytes32'],[E.id('GH0ST_GL3_DELAY_RANGE_V1'),domain]));
    const delayedPrefix=E.keccak256(coder.encode(['bytes32','uint64','bytes32','bytes32','bytes32','bytes32'],[delayedSeed,0,E.keccak256(delayedWire),messageHash,E.ZeroHash,delayedAcc]));
    const delayCommit=E.keccak256(coder.encode(['bytes32','bytes32','uint64','uint64','bytes32','bytes32'],[E.id('GH0ST_GL3_DELAY_RANGE_V1'),domain,0,1,delayedSeed,delayedPrefix]));
    assert.equal(await registry.delayedRangeCommitment(0,1),delayCommit);check('Solidity and independent ABI range commitments agree for actual registered bytes');
    const foreign=await deploy('UnitDataRegistry',[bridge.target,E.id('foreign domain')]);
    await mined(foreign.registerSequencerData(0,firstWire),'foreign-domain unit registration');
    assert.notEqual(await foreign.sequencerRangeCommitment(0,1),await registry.sequencerRangeCommitment(0,1));check('range commitments separate deployment domains');
    await assert.rejects(registry.sequencerRangeCommitment(0,3),e=>registry.interface.parseError(e.data).name==='MissingData');
    await assert.rejects(registry.sequencerRangeCommitment(2,1),e=>registry.interface.parseError(e.data).name==='InvalidRange');
    await assert.rejects(registry.sequencerRangeCommitment(0,257),e=>registry.interface.parseError(e.data).name==='MissingData');check('missing and reversed ranges rejected');
    const shortGas=await registry.sequencerRangeCommitment.estimateGas(0,2);
    await mined(bridge.appendSyntheticSequencers(260,E.keccak256(firstWire),delayedAcc),'append long synthetic input history');
    for(let start=2;start<262;start+=20) await mined(registry.unitRegisterMany(start,Array(Math.min(20,262-start)).fill(firstWire),{gasLimit:6000000}),'register long history '+start);
    const longCommit=await registry.sequencerRangeCommitment(0,262),longGas=await registry.sequencerRangeCommitment.estimateGas(0,262);
    assert.notEqual(longCommit,seqCommit);assert(longGas<=shortGas+100n);assert.equal(await registry.registeredSequencerCount(),262n);
    report.rangeGas={twoRecords:String(shortGas),records262:String(longGas)};check('262-record range exceeds the old cap with constant-cost parent commitment checking');
    await mined(registry.setLive(false),'unsealed unit profile');
    await reject('unsealed data registration rejected',registry,'registerSequencerData',[0,firstWire],'Unsealed');
    await mined(registry.setLive(true),'restore unit profile');
    const globalType='tuple(bytes32,bytes32,bytes32,bytes32,uint64,uint64)';
    const statementType=`tuple(uint256,bytes32,uint64,bytes32,bytes32,${globalType},${globalType},uint64,uint64,bytes32,uint64,uint64,bytes32)`;
    const before=[E.id('before'),E.ZeroHash,E.ZeroHash,E.ZeroHash,0,0],after=[E.id('after'),E.id('send root'),E.ZeroHash,E.ZeroHash,1,0];
    const values=coder.encode([statementType],[[1,domain,1,E.id('machine'),E.id('profile'),before,after,0,2,seqCommit,0,1,delayCommit]]);
    assert.equal(E.dataLength(values),736);const decoded=await codec.decode(values);assert.equal(decoded.afterState.sendRoot,after[1]);assert.equal(decoded.afterState.inboxPosition,1n);
    assert.equal(await codec.hashState(before),E.keccak256(coder.encode([globalType],[before])));check('736-byte statement roundtrip binds all four state hashes and both cursors');
    await assert.rejects(codec.decode('0x'+'00'.repeat(160)),e=>e.code==='CALL_EXCEPTION');
    await assert.rejects(codec.decode(values+'00'),e=>e.code==='CALL_EXCEPTION');
    const badU64=E.getBytes(values);badU64[64]=1;await assert.rejects(codec.decode(badU64),e=>e.code==='CALL_EXCEPTION');check('old 160-byte guest output, trailing bytes and noncanonical uint64 padding rejected');
    save('vectors.json',{delayedWire,messageHash,delayedAcc,firstWire,secondWire,firstAcc,secondAcc,seqCommit,delayCommit,values});
    report.contracts={bridge:bridge.target,registry:registry.target,codec:codec.target};report.passed=true;
}catch(e){report.error={message:e.shortMessage||e.message,stack:String(e.stack||e)};process.exitCode=1;}
finally{
    if(geth&&geth.exitCode===null&&geth.signalCode===null){geth.kill('SIGINT');await Promise.race([new Promise(r=>geth.once('exit',r)),sleep(5000)]);if(geth.exitCode===null&&geth.signalCode===null){geth.kill('SIGKILL');await new Promise(r=>geth.once('exit',r));}}
    if(log!==undefined)fs.closeSync(log);if(rpc)rpc.destroy();report.ownedGeth=geth?{pid:geth.pid,exitCode:geth.exitCode,signal:geth.signalCode}:null;report.checks=checks;report.checkCount=checks.length;report.asOfUTC=new Date().toISOString();save('receipt-index.json',receipts);save('result.json',report);console.log(JSON.stringify(report,null,2));
}
