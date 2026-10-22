import test from 'node:test';
import assert from 'node:assert/strict';
import * as Ethers from '../website/mint/vendor/ethers.js';
import { mountS0ULIntel, INTEL_ABIS, INTEL_WATCH_ABI, INTEL_UNIVERSAL_ABI, formatIntelETH } from '../website/s0ul-intel.mjs';

const OWNER='0x1111111111111111111111111111111111111111', OTHER='0x2222222222222222222222222222222222222222';
const OBS='0x3333333333333333333333333333333333333333', REPORTS='0x4444444444444444444444444444444444444444';
const MODEL='0x5555555555555555555555555555555555555555', TARGET='0x6666666666666666666666666666666666666666';
const POOL='0x7777777777777777777777777777777777777777', WATCH='0x8888888888888888888888888888888888888888';
const WATCH_REPORTS='0x9999999999999999999999999999999999999999', UNIVERSAL='0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const ZERO=Ethers.ZeroHash, BLOCK='0x'+'aa'.repeat(32), EMPTY_HASH=Ethers.keccak256('0x');
const MODEL_ID=Ethers.keccak256(Ethers.toUtf8Bytes('test numeric model')), MANIFEST=Ethers.keccak256(Ethers.toUtf8Bytes('test training manifest'));
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const interfaces={observations:new Ethers.Interface(INTEL_ABIS.observations), reports:new Ethers.Interface(INTEL_ABIS.reports), watch:new Ethers.Interface(INTEL_WATCH_ABI), universal:new Ethers.Interface(INTEL_UNIVERSAL_ABI)};
const key=(kind,target,account,codeHash)=>Ethers.keccak256(Ethers.AbiCoder.defaultAbiCoder().encode(['uint8','address','address','bytes32'],[kind,target,account,codeHash]));
const result=(iface,method,values)=>iface.decodeFunctionResult(method,iface.encodeFunctionResult(method,values));

function dom(){
  class Element {
    constructor(tag='DIV'){this.tagName=tag;this.dataset={};this.style={};this.listeners=new Map();this.children=[];this.textContent='';this.value='';this.checked=false;this.attributes={};}
    addEventListener(type,fn){this.listeners.set(type,fn);} removeEventListener(type){this.listeners.delete(type);}
    async fire(type,event={}){await this.listeners.get(type)?.(event);} append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
    removeAttribute(name){delete this[name];} setAttribute(name,value){this.attributes[name]=String(value);} getAttribute(name){return this.attributes[name]??null;} focus(){} querySelectorAll(){return [];}
  }
  const nodes=new Map(),root=new Element();root.ownerDocument={defaultView:{},createElement:tag=>new Element(tag.toUpperCase())};
  Object.defineProperty(root,'innerHTML',{set(html){for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Element());
    for(const[id,value]of Object.entries({'subject-id':'1',lookback:'1',action:'snapshot',kind:'3'}))nodes.get('intel-'+id).value=value;
    for(const[,id,body]of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const option=body.match(/<option\b[^>]*\bselected[^>]*value="([^"]+)"/)??body.match(/<option\b[^>]*value="([^"]+)"/);if(option)nodes.get(id).value=option[1];}
  }});root.querySelector=selector=>nodes.get(selector.slice(1));root.querySelectorAll=()=>[];
  return{root,get:id=>nodes.get('intel-'+id)};
}

function fixture(options={}){
  const env={now:1_800_000_000_000,rpcChain:4663,walletChain:4663,account:OWNER,balance:10n**21n,gasPrice:1_000_000_003n,gasEstimate:500_000n,blockLimit:32_000_000n,nonce:7,
    calls:[],sends:[],transactions:new Map(),receipts:new Map(),saved:new Map(),watchSubjects:new Map(),watchKeys:new Map(),joined:new Set(),legacySubjects:[],
    codes:new Map([[OBS,'0x6001'],[REPORTS,'0x6002'],[MODEL,'0x6003'],[TARGET,'0x6004'],[POOL,'0x6005'],[WATCH,'0x6006'],[WATCH_REPORTS,'0x6007'],[UNIVERSAL,'0x6008']]),...options};
  const pin=address=>({address,codeHash:Ethers.keccak256(env.codes.get(address))});
  const classifier={...pin(MODEL),modelId:MODEL_ID,trainingManifestHash:MANIFEST};
  const deployment={chainId:4663,subjects:[],observations:pin(OBS),reports:pin(REPORTS),classifier};
  const watchDeployment={chainId:4663,observations:pin(WATCH),reports:pin(WATCH_REPORTS),universalReader:pin(UNIVERSAL),classifier:{...classifier}};
  const events=new Map();
  const storage={getItem(k){if(env.storageReadFails)throw Error('Storage read failed');return env.saved.get(k)??null;},setItem(k,v){if(env.storageFails)throw Error('Storage disabled');if(!env.storageDropsWrites)env.saved.set(k,v);},removeItem(k){if(env.storageFails)throw Error('Storage disabled');env.saved.delete(k);}};
  const codeHash=target=>{const c=env.codes.get(target)??'0x';return Ethers.keccak256(c);};
  function inspection(target,account){
    if(env.inspectError)throw env.inspectError;
    const code=env.codes.get(target)??'0x',kind=target===TARGET?1:target===POOL?3:0;
    const mask=kind?(kind===3?5:1)+(account===Ethers.ZeroAddress?0:2):0,preferred=kind===3?3:kind&&account!==Ethers.ZeroAddress?2:kind;
    const values=[1_000_000n,0n,0n,0n],balance=[100_000n,1_000_000n,0n,0n],pool=[1000n,2000n,10000n,1799999940n];
    const fields=[target,account,env.nativeBalance??12345678901234567890n,BigInt((code.length-2)/2),codeHash(target),BigInt(env.blockTimestamp??1800000000),BigInt(env.blockNumber??100),mask,preferred,kind?0:1,mask&2?0:5,kind===3?0:2,kind===3?TARGET:Ethers.ZeroAddress,kind===3?MODEL:Ethers.ZeroAddress,kind?values:[0,0,0,0],mask&2?balance:[0,0,0,0],kind===3?pool:[0,0,0,0]];
    if(env.inspectOverride)env.inspectOverride(fields);return result(interfaces.watch,'inspect',[fields])[0];
  }
  function universal(target){
    if(env.universalError)throw env.universalError;
    const code=env.codes.get(target)??'0x',bytes=BigInt((code.length-2)/2),selectors=Array(32).fill('0x00000000'),signals=Array(10).fill(0);
    const fields=[target,env.nativeBalance??12345678901234567890n,codeHash(target),bytes,bytes,true,1,0,0,selectors,signals,0,false,Ethers.ZeroAddress,false,false,false,Ethers.ZeroAddress,false,Ethers.ZeroAddress,BigInt(env.blockTimestamp??1800000000),BigInt(env.blockNumber??100)];
    if(env.profileOverride)env.profileOverride(fields);
    return result(interfaces.universal,'analyze',[fields,env.universalText??`On-chain structural facts for ${target}. No safety verdict.`]);
  }
  function subject(id,registry='watch'){
    const s=registry==='watch'?env.watchSubjects.get(BigInt(id)):env.legacySubjects[Number(id)-1];if(!s)throw Error('Unknown subject');return s;
  }
  function frame(id,registry='watch'){
    const s=subject(id,registry),seq=s.sequence??1n,observed=s.timestamp??1799999940n,previousAt=seq>1n?observed-300n:0n;
    const values=s.kind===3?[1000n,2000n,10000n,observed]:s.kind===2?[100000n,1000000n,0n,0n]:[1000000n,0n,0n,0n];
    const current=[seq,observed,100n,BLOCK,values],previous=[seq>1n?seq-1n:0n,previousAt,99n,seq>1n?BLOCK:ZERO,[0,0,0,0]],flags=(seq>1n?1:0)+6;
    return result(interfaces.observations,'features',[[id,s.kind,current,previous,hash(seq+100n),seq>1n?hash(seq+99n):ZERO,[0,0,0,0,0,seq>1n?300:0,s.kind,flags],seq>1n?300:0,flags,seq>1n,true,seq>1n?0:9]])[0];
  }
  const provider={async getNetwork(){return{chainId:4663n};},async send(method){env.calls.push('rpc:'+method);if(method==='eth_chainId')return Ethers.toQuantity(env.rpcChain);throw Error('Unexpected RPC method');},async getCode(a){env.calls.push('code:'+a);return env.codes.get(a)??'0x';},async getBlock(n){if(env.blockError)throw env.blockError;return{number:n==='latest'?(env.blockNumber??100):n,timestamp:env.blockTimestamp??1800000000,gasLimit:env.blockLimit,hash:env.noncanonical?ZERO:BLOCK};},async getFeeData(){if(env.feeError)throw env.feeError;return{gasPrice:env.gasPrice};},async getTransaction(h){return env.transactions.get(h)??null;},async getTransactionReceipt(h){return env.hideReceipts?null:env.receipts.get(h)??null;}};
  const estimateFunction=(contract,method)=>({estimateGas:async(...args)=>{env.calls.push('estimate:'+contract+':'+method);env.estimates??=[];env.estimates.push({contract,method,args});await env.onEstimate?.();if(env.estimateError)throw env.estimateError;return env.gasEstimate;}});
  const obs=(registry,address,iface)=>({interface:iface,getFunction:method=>estimateFunction(address,method),async owner(){return registry==='legacy'?OWNER:Ethers.ZeroAddress;},async minSpacing(){return 60n;},async subjectCount(){env.calls.push(registry+':subjectCount');if(registry==='watch')throw Error('V2 global enumeration is forbidden');if(env.legacyCountError)throw env.legacyCountError;return env.legacyCount??BigInt(env.legacySubjects.length);},async subject(id){env.calls.push(registry+':subject:'+id);if(env.legacyReadError&&registry==='legacy')throw env.legacyReadError;const s=subject(id,registry);return result(interfaces.observations,'subject',[[s.kind,true,s.target,s.account??Ethers.ZeroAddress,s.codeHash??codeHash(s.target),s.asset0??s.target,s.asset1??Ethers.ZeroAddress,s.sequence??1n,0]])[0];},async features(id){return frame(id,registry);},snapshot:{staticCall:async()=>[env.snapshotStatus??0,2n]}});
  const reports=(address,observations,config)=>({interface:interfaces.reports,getFunction:method=>estimateFunction(address,method),async observations(){return env[address+':observations']??observations;},async classifier(){return env[address+':classifier']??MODEL;},async observationsCodeHash(){return env[address+':obsHash']??config.observations.codeHash;},async classifierCodeHash(){return env[address+':modelHash']??classifier.codeHash;},async modelId(){return env[address+':modelId']??MODEL_ID;},async trainingManifestHash(){return env[address+':manifest']??MANIFEST;},async chainId(){return env[address+':chain']??4663n;},async latestReport(){return 0n;}});
  const contracts={observations:obs('legacy',OBS,interfaces.observations),reports:reports(REPORTS,OBS,deployment),classifier:{async modelId(){return env.modelId??MODEL_ID;},async trainingManifestHash(){return env.manifest??MANIFEST;}},watchObservations:obs('watch',WATCH,interfaces.watch),watchReports:reports(WATCH_REPORTS,WATCH,watchDeployment),universalReader:{interface:interfaces.universal,async analyze(target,at){env.calls.push('universal:analyze:'+target);await env.onUniversal?.();return universal(target);},async read(target,data,at){env.calls.push('universal:read');env.rawReads??=[];env.rawReads.push({target,data,at});await env.onRawRead?.();if(env.rawError)throw env.rawError;return env.rawResult??result(interfaces.universal,'read',[0n,32n,hash(123)]);}}};
  Object.assign(contracts.watchObservations,{async inspect(target,account,at){env.calls.push('watch:inspect:'+target);env.inspections??=[];env.inspections.push({target,account,at});await env.onInspect?.();return inspection(target,account);},async inspectText(target,account,at){return env.inspectionText??`Current compatible getter facts for ${target}; account ${account}.`;},async subjectKey(...args){env.calls.push('watch:subjectKey');return key(...args);},async keyToSubject(k){env.calls.push('watch:keyToSubject');if(env.keyError)throw env.keyError;return env.watchKeys.get(k)??0n;},async isWatching(who,id){return env.joined.has(who.toLowerCase()+':'+id);},async watchlist(){throw Error('Watchlist enumeration is not needed for O(1) lookup');}});
  function addWatch(kind=1,target=TARGET,account=Ethers.ZeroAddress,id=1n){const s={kind,target,account,codeHash:codeHash(target),sequence:1n,timestamp:1799999940n};env.watchSubjects.set(id,s);env.watchKeys.set(key(kind,target,account,s.codeHash),id);return id;}
  async function broadcast(request){
    const journalKey=`gh0st:intel:4663:${OWNER.toLowerCase()}`,journal=JSON.parse(env.saved.get(journalKey)??'null');assert.ok(journal,'durable intent precedes wallet request');assert.equal(journal.hash,null);assert.equal(journal.to,request.to);assert.equal(journal.contract,request.to===WATCH?'watchObservations':'watchReports');assert.equal(journal.dataHash,Ethers.keccak256(request.data));assert.equal(journal.nonce,env.nonce);
    const h=hash(env.sends.length+1);env.sends.push(request);env.transactions.set(h,{...request,hash:h,from:OWNER,nonce:Number(request.nonce),chainId:4663,value:BigInt(request.value),gasLimit:BigInt(request.gasLimit),gasPrice:BigInt(request.gasPrice)});
    let log;if(request.to===WATCH){const decoded=interfaces.watch.parseTransaction({data:request.data});if(decoded.name==='watch'){const[k,t,a,ch]=decoded.args,id=env.watchKeys.get(key(k,t,a,ch))??addWatch(Number(k),t,a);env.joined.add(OWNER.toLowerCase()+':'+id);log={address:WATCH,...interfaces.watch.encodeEventLog(interfaces.watch.getEvent('WatchAdded'),[OWNER,id,key(k,t,a,ch)])};}}
    env.receipts.set(h,{hash:h,status:1,blockNumber:101,blockHash:BLOCK,gasPrice:BigInt(request.gasPrice),gasUsed:100000n,logs:log?[log]:[]});if(env.sendError)throw Object.assign(Error('Ambiguous wallet transport'),{code:env.sendError});return{hash:h,async wait(){assert.equal(JSON.parse(env.saved.get(journalKey)).hash,h);if(env.waitError)throw Error('Receipt RPC interrupted');return env.receipts.get(h);}};
  }
  const ethereum={on(n,fn){if(!events.has(n))events.set(n,new Set());events.get(n).add(fn);},removeListener(n,fn){events.get(n)?.delete(fn);},emit(n){for(const fn of events.get(n)??[])fn();},async request({method}){env.calls.push('wallet:'+method);if(method==='eth_accounts'||method==='eth_requestAccounts')return[env.account];if(method==='eth_chainId')return Ethers.toQuantity(env.walletChain);if(method==='wallet_switchEthereumChain'){env.walletChain=4663;return null;}if(method==='eth_getTransactionCount'){await env.onNonce?.();return Ethers.toQuantity(env.nonce);}throw Error('Unexpected wallet request '+method);}};
  const eth={...Ethers,BrowserProvider:class{async getBalance(){return env.balance;}async getSigner(){return{sendTransaction:broadcast};}destroy(){}}};
  function surface(){const d=dom(),mounted=mountS0ULIntel(d.root,{deployment,watchDeployment,ethers:eth,provider,contracts,ethereum:options.noWallet?null:ethereum,storage,now:()=>env.now,setInterval:()=>1,clearInterval(){}});return{...d,mounted};}
  const primary=surface();async function watchQuote(){await primary.mounted.ready;await primary.mounted.analyze(TARGET);await primary.get('watch').fire('click');await primary.mounted.estimate();assert.equal(primary.mounted.state.quote?.kind,'preview',primary.get('notice').textContent);await primary.mounted.connect();assert.equal(primary.mounted.state.quote?.kind,'wallet',primary.get('notice').textContent);return primary.mounted.state.quote;}
  async function consent(){primary.get('consent').checked=true;await primary.get('consent').fire('change');}
  return{...primary,env,deployment,watchDeployment,provider,contracts,ethereum,storage,surface,addWatch,watchQuote,consent};
}

test('every valid address including zero and no-code accounts gets contract-produced live facts without a wallet',async t=>{
  const f=fixture({noWallet:true,nativeBalance:(1n<<200n)+17n});t.after(()=>f.mounted.destroy());await f.mounted.ready;
  for(const address of [Ethers.ZeroAddress,OTHER,TARGET,POOL]){
    await f.mounted.analyze(address);assert.ok(f.mounted.state.inspection,f.get('notice').textContent);
    assert.equal(f.mounted.state.inspection.target,address);assert.equal(f.mounted.state.inspection.nativeBalance,(1n<<200n)+17n);
    assert.match(f.get('live-report').textContent,/On-chain structural facts/);assert.equal(f.get('live-result').hidden,false);
  }
  assert.equal(f.env.calls.some(c=>c.startsWith('wallet:')),false);assert.equal(f.env.sends.length,0);
});

test('optional watched-account balance and pool priority use actual ABI tuples, not caller-supplied metrics',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;
  f.get('inspect-account').value=OTHER;await f.get('inspect-account').fire('input');await f.mounted.analyze(TARGET);
  assert.equal(f.mounted.state.inspection.preferredKind,2n);assert.equal(f.mounted.state.inspection.balanceValues[0],100000n);assert.equal(f.env.inspections.at(-1).account,OTHER);
  await f.mounted.analyze(POOL);assert.equal(f.mounted.state.inspection.preferredKind,3n);assert.equal(f.get('live-type').textContent,'V2-compatible pool');
  assert.equal(f.env.sends.length,0);assert.equal(f.env.calls.some(c=>c.startsWith('estimate:')),false);
});

test('generic contracts still get structural analysis while numeric Watch stays unavailable',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;f.env.codes.set(OTHER,'0x6009');
  f.env.universalText='<img src=x onerror=alert(1)> This is literal contract text.';await f.mounted.analyze(OTHER);
  assert.equal(f.get('live-type').textContent,'Contract');assert.equal(f.get('live-report').textContent,f.env.universalText);
  assert.equal(f.get('watch').hidden,true);assert.equal(f.get('update').hidden,true);assert.equal(f.get('raw-read').disabled,false);assert.equal(f.env.sends.length,0);
});

test('V2 lookup is O(1) and a large permissionless registry is never enumerated',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;const id=f.addWatch(1,TARGET,Ethers.ZeroAddress,987654321n);
  await f.mounted.analyze(TARGET);assert.equal(f.mounted.state.current.id,id);assert.equal(f.mounted.state.current.registry,'watch');
  assert.ok(f.env.calls.includes('watch:subjectKey'));assert.ok(f.env.calls.includes('watch:keyToSubject'));
  assert.equal(f.env.calls.includes('watch:subjectCount'),false);assert.ok(f.env.calls.filter(c=>c.startsWith('watch:subject:')).length<=3);assert.equal(f.env.calls.filter(c=>c.startsWith('watch:subject:')).every(c=>c==='watch:subject:'+id),true);
  assert.match(f.get('result-summary').textContent,/baseline observation.*No comparison report/i);
});

test('legacy history failure or oversized count does not block otherwise valid universal live analysis',async()=>{
  for(const change of [f=>{f.env.legacyCount=999n;},f=>{f.env.legacyCountError=Error('Legacy history unavailable');},f=>{f.env.legacySubjects=[{kind:1,target:TARGET}];f.env.legacyReadError=Error('Legacy history unavailable');}]){
    const f=fixture();await f.mounted.ready;change(f);await f.mounted.analyze(TARGET);
    assert.ok(f.mounted.state.inspection,f.get('notice').textContent);assert.equal(f.get('live-result').hidden,false);assert.match(f.get('live-report').textContent,/On-chain structural facts/);assert.equal(f.env.sends.length,0);f.mounted.destroy();
  }
});

test('actual chain and all V2 runtime, model and immutable report dependencies fail closed',async()=>{
  const wrongChain=fixture({rpcChain:1});await wrongChain.mounted.ready;assert.equal(wrongChain.mounted.state.verified,false);assert.equal(wrongChain.env.sends.length,0);wrongChain.mounted.destroy();
  const corruptions=[f=>f.env.codes.set(WATCH,'0x00'),f=>f.env.codes.set(WATCH_REPORTS,'0x00'),f=>f.env.codes.set(UNIVERSAL,'0x00'),
    f=>{f.env[WATCH_REPORTS+':observations']=OBS;},f=>{f.env[WATCH_REPORTS+':classifier']=OTHER;},f=>{f.env[WATCH_REPORTS+':obsHash']=ZERO;},f=>{f.env[WATCH_REPORTS+':modelHash']=ZERO;},
    f=>{f.env[WATCH_REPORTS+':modelId']=ZERO;},f=>{f.env[WATCH_REPORTS+':manifest']=ZERO;},f=>{f.env[WATCH_REPORTS+':chain']=1;},f=>{f.watchDeployment.classifier.modelId=ZERO;},f=>{f.watchDeployment.chainId=1;}];
  for(const corrupt of corruptions){const f=fixture();corrupt(f);await f.mounted.ready;assert.equal(f.mounted.state.verified,false);assert.equal(f.get('send').disabled,true);assert.equal(f.env.sends.length,0);f.mounted.destroy();}
});

test('inconsistent inspector identities or universal profiles clear old evidence and never select a paid action',async()=>{
  const changes=[f=>{f.env.inspectOverride=a=>{a[0]=OTHER;};},f=>{f.env.profileOverride=a=>{a[0]=OTHER;};},f=>{f.env.profileOverride=a=>{a[1]+=1n;};},f=>{f.env.profileOverride=a=>{a[2]=ZERO;};},f=>{f.env.profileOverride=a=>{a[8]=33;};},f=>{f.env.profileOverride=a=>{a[4]=24577n;};},f=>{f.env.inspectError=Error('Inspector RPC interrupted');},f=>{f.env.universalError=Error('Universal RPC interrupted');}];
  for(const change of changes){const f=fixture();await f.mounted.ready;await f.mounted.analyze(TARGET);await f.get('watch').fire('click');await f.mounted.estimate();assert.ok(f.mounted.state.quote);change(f);await f.mounted.analyze(TARGET);assert.equal(f.mounted.state.inspection,null);assert.equal(f.mounted.state.quote,null);assert.equal(f.get('live-result').hidden,true);assert.equal(f.get('send').disabled,true);assert.equal(f.env.sends.length,0);f.mounted.destroy();}
});

test('Watch preview grants no authority; connecting requotes exact code-pinned V2 arguments for the actual wallet',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;await f.mounted.analyze(TARGET);await f.get('watch').fire('click');await f.mounted.estimate();
  const preview=f.mounted.state.quote;assert.equal(preview.kind,'preview');assert.equal(preview.owner,null);assert.equal(preview.to,WATCH);assert.equal(preview.contract,'watchObservations');assert.equal(f.get('send').disabled,true);assert.equal(f.get('fee-approval').hidden,true);
  f.get('consent').checked=true;await f.mounted.send();assert.equal(f.env.sends.length,0);
  await f.mounted.connect();const q=f.mounted.state.quote;assert.equal(q.kind,'wallet');assert.equal(q.owner,OWNER);assert.equal(f.get('consent').checked,false);
  const parsed=interfaces.watch.parseTransaction({data:q.data});assert.equal(parsed.name,'watch');assert.deepEqual([...parsed.args],[1n,TARGET,Ethers.ZeroAddress,Ethers.keccak256('0x6004')]);
  assert.equal(f.env.estimates.at(-1).args.at(-1).from,OWNER);assert.equal(q.estimatedWei,q.gasEstimate*q.submissionGasPriceWei);assert.equal(f.get('limit').value,formatIntelETH(q.reserveWei));assert.equal(f.env.sends.length,0);
});

test('approved Watch sends only one zero-value V2 call with a durable destination-bound journal and reads its baseline',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());const q=await f.watchQuote();await f.consent();await f.mounted.send();
  assert.equal(f.env.sends.length,1);const request=f.env.sends[0];assert.equal(request.to,WATCH);assert.equal(request.value,0n);assert.equal(request.data,q.data);assert.equal(request.chainId,4663);
  assert.equal(f.mounted.state.pending,null);assert.equal(f.mounted.state.current.registry,'watch');assert.equal(f.mounted.state.watchJoined,true);assert.match(f.get('result-summary').textContent,/baseline observation.*No comparison report/i);
});

test('ordinary advancing head time does not invalidate Watch intent, while source identity or permission changes do',async()=>{
  const good=fixture();await good.watchQuote();await good.consent();good.env.blockTimestamp=1800000005;good.env.blockNumber=101;
  await good.mounted.send();assert.equal(good.env.sends.length,1,good.get('notice').textContent);good.mounted.destroy();
  for(const change of [f=>f.env.codes.set(TARGET,'0x600a'),async f=>{f.get('inspect-account').value=OTHER;await f.get('inspect-account').fire('input');},f=>{f.env.joined.add(OWNER.toLowerCase()+':'+f.addWatch());},f=>{f.env.account=OTHER;},f=>{f.env.walletChain=1;},f=>{f.env.gasPrice*=3n;},f=>{f.env.balance=0n;},f=>{f.env.now+=45000;}]){
    const f=fixture();await f.watchQuote();await f.consent();await change(f);await f.mounted.send();assert.equal(f.env.sends.length,0,f.get('notice').textContent);f.mounted.destroy();
  }
});

test('ambiguous Watch is never resent and recovery cannot accept a legacy destination for the saved V2 action',async t=>{
  const f=fixture({sendError:-32603});t.after(()=>f.mounted.destroy());await f.watchQuote();await f.consent();await f.mounted.send();assert.equal(f.env.sends.length,1);assert.equal(f.mounted.state.pending.hash,null);assert.equal(f.mounted.state.pending.contract,'watchObservations');
  const reloaded=f.surface();t.after(()=>reloaded.mounted.destroy());await reloaded.mounted.ready;await reloaded.mounted.connect();assert.equal(reloaded.mounted.state.pending.contract,'watchObservations');
  const h=hash(1),tx=f.env.transactions.get(h);f.env.transactions.set(h,{...tx,to:OBS});await reloaded.mounted.reconcile(h);assert.ok(reloaded.mounted.state.pending);assert.match(reloaded.get('notice').textContent,/does not match/);
  f.env.transactions.set(h,tx);await reloaded.mounted.reconcile(h);assert.equal(reloaded.mounted.state.pending,null);assert.equal(f.env.sends.length,1);
});

test('raw getter reads use only the pinned STATICCALL reader with bounded canonical input and no wallet',async t=>{
  const f=fixture({noWallet:true});t.after(()=>f.mounted.destroy());await f.mounted.ready;await f.mounted.analyze(OTHER);
  await f.mounted.read('0x8da5cb5b');assert.equal(f.env.rawReads.length,1);assert.equal(f.env.rawReads[0].target,OTHER);assert.equal(f.env.rawReads[0].data,'0x8da5cb5b');assert.deepEqual(f.env.rawReads[0].at,{blockTag:100});assert.match(f.get('raw-result').textContent,/Call returned/);
  for(const bad of ['0x0','0xz0','8da5cb5b','0x'+'aa'.repeat(4097)]){await f.mounted.read(bad);assert.equal(f.env.rawReads.length,1);assert.match(f.get('raw-result').textContent,/complete hex|4,096/);}
  await f.mounted.read('0x');assert.equal(f.env.rawReads.length,2);assert.equal(f.env.calls.some(c=>c.startsWith('wallet:')),false);assert.equal(f.env.sends.length,0);
});

test('raw read statuses preserve failure/truncation truth and reject inconsistent RPC sizes or output bytes',async()=>{
  const f=fixture({noWallet:true});await f.mounted.ready;await f.mounted.analyze(TARGET);
  for(const [status,size,data,text]of [[1n,4n,'0xdeadbeef',/failed or reverted/],[2n,64000n,'0x'+'ab'.repeat(2048),/prefix shown/]]){f.env.rawResult=result(interfaces.universal,'read',[status,size,data]);await f.mounted.read('0x8da5cb5b');assert.match(f.get('raw-result').textContent,text);}
  for(const [status,size,data]of [[0n,99n,'0xdeadbeef'],[2n,4n,'0xdeadbeef'],[1n,9n,'0xdeadbeef'],[3n,4n,'0xdeadbeef'],[0n,2049n,'0x'+'ab'.repeat(2049)]]){f.env.rawResult=[status,size,data];await f.mounted.read('0x8da5cb5b');assert.match(f.get('raw-result').textContent,/inconsistent bounded response/);}
  assert.equal(f.env.sends.length,0);f.mounted.destroy();
});

test('address edits during an in-flight estimate or raw read cannot restore a stale quote or getter result',async()=>{
  const f=fixture();await f.mounted.ready;await f.mounted.analyze(TARGET);await f.get('watch').fire('click');f.env.onEstimate=async()=>{f.get('address').value=OTHER;await f.get('address').fire('input');};await f.mounted.estimate();assert.equal(f.mounted.state.quote,null);assert.equal(f.mounted.state.inspection,null);assert.equal(f.get('send').disabled,true);
  f.env.onEstimate=null;await f.mounted.analyze(TARGET);f.env.onRawRead=async()=>{f.get('address').value=OTHER;await f.get('address').fire('input');};await f.mounted.read('0x8da5cb5b');assert.match(f.get('raw-result').textContent,/address changed/);assert.equal(f.mounted.state.inspection,null);assert.equal(f.env.sends.length,0);f.mounted.destroy();
});

test('shared Watch creation or sequence changes after quote require another reviewed estimate',async()=>{
  for(const existing of [false,true]){
    const f=fixture();if(existing)f.addWatch();await f.watchQuote();await f.consent();
    if(existing)f.env.watchSubjects.get(1n).sequence=2n;else f.addWatch();
    await f.mounted.send();assert.equal(f.env.sends.length,0);assert.match(f.get('notice').textContent,/state changed.*estimate/i);f.mounted.destroy();
  }
});

test('recovered membership lookup loads the exact shared history before enabling Refresh, while stale inspector reads stay cleared',async()=>{
  const f=fixture();await f.mounted.ready;const id=f.addWatch();f.env.joined.add(OWNER.toLowerCase()+':'+id);f.env.keyError=Error('Lookup RPC interrupted');await f.mounted.analyze(TARGET);
  assert.ok(f.mounted.state.inspection);assert.equal(f.mounted.state.current,null);assert.match(f.get('notice').textContent,/Saved watch history.*unavailable/);
  f.env.keyError=null;await f.mounted.connect();await f.get('watch').fire('click');await f.mounted.estimate();assert.equal(f.mounted.state.quote,null);assert.equal(f.mounted.state.watchJoined,true);assert.equal(f.mounted.state.current.id,id);assert.equal(f.mounted.state.current.registry,'watch');assert.equal(f.get('watch').textContent,'Refresh saved report');
  await f.get('watch').fire('click');await f.mounted.estimate();assert.equal(f.mounted.state.quote?.to,WATCH_REPORTS);assert.equal(f.mounted.state.quote?.contract,'watchReports');assert.equal(f.mounted.state.quote?.method,'captureAndAnalyze');f.mounted.destroy();
  const stale=fixture();await stale.mounted.ready;await stale.mounted.analyze(TARGET);await stale.get('watch').fire('click');stale.env.onInspect=async()=>{stale.get('address').value=OTHER;await stale.get('address').fire('input');};await stale.mounted.estimate();assert.equal(stale.mounted.state.quote,null);assert.equal(stale.mounted.state.inspection,null);assert.equal(stale.mounted.state.current,null);assert.equal(stale.get('send').disabled,true);stale.mounted.destroy();
});
