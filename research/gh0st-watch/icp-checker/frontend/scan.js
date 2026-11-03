import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {AbiCoder,Interface,getAddress,getBytes,id,keccak256,MaxUint256,toQuantity,formatUnits} from 'ethers';

export const CANISTER='ggcey-baaaa-aaaao-bbsgq-cai';
export const networks={
  mainnet:{label:'Mainnet',chain:4663,rpc:'https://rpc.mainnet.chain.robinhood.com',explorer:'https://robinhoodchain.blockscout.com',example:'0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559'},
  testnet:{label:'Testnet',chain:46630,rpc:'https://rpc.testnet.chain.robinhood.com',explorer:'https://explorer.testnet.chain.robinhood.com',example:'0x6bB3A22C36168d57aCEeD12Ff40a75035D4EaDD2'}
};
const abi=AbiCoder.defaultAbiCoder(), hexAddress=/^0x[0-9a-fA-F]{40}$/;
const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const beaconSlot='0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const sig=x=>id(x).slice(0,10), getterOf='balanceOf(address)',getterSimple='balance(address)';
const opc={delegatecall:'DELEGATECALL',origin:'ORIGIN',external_call:'External call',selfdestruct:'SELFDESTRUCT'};
function makeIdl({IDL:I}) {
  const P=I.Record({bytes:I.Nat32,hash:I.Text,selectors:I.Vec(I.Text),...Object.fromEntries(Object.keys(opc).map(k=>[k,I.Nat32]))});
  const rule=I.Variant({Mint:I.Record({balance_of:I.Bool}),Authorization:I.Null,Withdraw:I.Record({takes_amount:I.Bool}),Replay:I.Null,TokenReturn:I.Record({credit_slot:I.Opt(I.Nat64)}),Underflow:I.Null});
  const result=I.Record({reproduced:I.Bool,observed:I.Vec(I.Tuple(I.Text,I.Text))});
  return I.Service({inspect_runtime:I.Func([I.Vec(I.Nat8)],[I.Variant({Ok:P,Err:I.Text})],['query']),check_contract:I.Func([rule,I.Text],[I.Variant({Ok:result,Err:I.Text})],['query'])});
}
let actor;
async function checker(){if(!actor)actor=Actor.createActor(makeIdl,{agent:await HttpAgent.create({host:'https://icp-api.io'}),canisterId:CANISTER});return actor;}
const limit=(ms)=>AbortSignal.timeout(ms);
async function rpc(net,method,params){
  const r=await fetch(net.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:limit(12000)});
  if(!r.ok)throw Error('Robinhood RPC returned HTTP '+r.status);
  const b=await r.json();if(b.error||b.result==null)throw Error(b.error?.message||'Missing RPC result');return b.result;
}
async function metadata(net,address){
  const r=await fetch(net.explorer+'/api/v2/smart-contracts/'+address,{signal:limit(5000)});
  if(!r.ok)return null;return r.json();
}
function asAddress(word){if(!/^0x0{24}[a-f0-9]{40}$/i.test(word)||BigInt(word)===0n)return null;return getAddress('0x'+word.slice(-40));}
async function resolve(net,address,code,block){
  const clone=code.match(/^0x363d3d373d3d3d363d73([a-f0-9]{40})5af43d82803e903d91602b57fd5bf3/i);
  if(clone)return {address:getAddress('0x'+clone[1]),kind:'Minimal proxy'};
  const [impl,beacon]=await Promise.all([slot,beaconSlot].map(s=>rpc(net,'eth_getStorageAt',[address,s,block])));
  if(asAddress(impl))return {address:asAddress(impl),kind:'EIP-1967 implementation slot'};
  if(asAddress(beacon)){
    const target=asAddress(await rpc(net,'eth_call',[{to:asAddress(beacon),data:sig('implementation()')},block]));
    if(!target)throw Error('Beacon implementation could not be resolved');return {address:target,kind:'EIP-1967 beacon'};
  }
  return null;
}
async function inspect(net,address,codePromise,block){
  const code=await codePromise; if(code==='0x')throw Error('No deployed contract code at this address on Robinhood '+net.label+'.');
  const reply=await (await checker()).inspect_runtime(getBytes(code));
  if(!reply.Ok)throw Error(reply.Err||'ICP inspection unavailable');
  if(reply.Ok.hash!==keccak256(code))throw Error('Runtime fingerprint mismatch. Please run the scan again.');
  return {address,code,profile:reply.Ok,block};
}
async function probe(net,address,block,getter,mint){
  const args=abi.encode(['address','bytes4','bool'],[address,sig(getter),mint]);
  const raw=await rpc(net,'eth_call',[{from:'0x000000000000000000000000000000000000dEaD',data:__PROBE__+args.slice(2),gas:toQuantity(1500000)},block]);
  if(!/^0x[0-9a-f]{384}$/i.test(raw))throw Error('RPC did not return the six expected observation fields');
  const [beforeOk,afterOk,success,before,after,caller]=abi.decode(['bool','bool','bool','uint256','uint256','address'],raw);
  if(!beforeOk||!afterOk)throw Error('Balance getter did not return a uint256');
  if(!mint&&before!==0n)throw Error('Probe account already had a balance');
  const hit=success&&(mint?after===before+7n:after===MaxUint256);
  return {status:hit?'Reproduced':'Not reproduced',scope:'RH state simulation',detail:(mint?'Mint of 7':'Burn of 1')+' '+(success?'succeeded':'reverted')+'. Balance '+before+' → '+after+'.',evidence:[['Simulated caller',caller],['Balance getter',getter],['Amount in base units',mint?'7':'1']]};
}
async function describe(net,address,block,has,iface) {
  async function read(signature,type){
    if(!has(signature))return null;
    try{
      const raw=await rpc(net,'eth_call',[{to:address,data:sig(signature)},block]);
      if(raw.length>8194)return null;
      const value=abi.decode([type],raw)[0];
      return type==='string'?value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,90):value;
    }catch{return null}
  }
  const [name,symbol,decimals,supply,owner,paused]=await Promise.all([
    read('name()','string'),read('symbol()','string'),read('decimals()','uint8'),
    read('totalSupply()','uint256'),read('owner()','address'),read('paused()','bool')]);
  const fields=[];
  if(name)fields.push(['Name',name]);if(symbol)fields.push(['Symbol',symbol]);
  if(supply!==null)fields.push(['Total supply',decimals!==null&&decimals<=80n?formatUnits(supply,decimals)+' '+(symbol||'units'):supply+' base units']);
  if(owner!==null)fields.push(['Owner getter',owner]);
  if(paused!==null)fields.push(['Paused getter',paused?'True':'False']);
  const controls=(iface?.fragments||[]).filter(f=>f.type==='function'&&['payable','nonpayable'].includes(f.stateMutability)&&/^(upgrade|set|pause|unpause|mint|burn|grantRole|revokeRole|renounce|transferOwnership|blacklist|whitelist|freeze)/i.test(f.name)).map(f=>f.format('sighash')).sort();
  return {fields,controls};
}
const recipes=[
 ['mint','Ordinary-account mint','mint(address,uint256)'],['underflow','Balance underflow','burn(uint256)'],
 ['withdraw','Withdrawal reentry','deposit()'],['authorization','Origin-based payment','pay(address,uint256)'],
 ['replay','Signed coupon replay','redeem(uint256,uint8,bytes32,bytes32)'],['token','Credit on failed transfer','deposit(uint256)']
];
function creationInput(m){
  if(!m?.creation_bytecode?.match(/^0x(?:[a-f0-9]{2})+$/i))return null;
  return m.creation_bytecode.toLowerCase();
}
async function replay(net,target,block,meta,key,iface,has){
  if(!meta||!iface||!creationInput(meta))throw Error('Verified deployment input and ABI required for this recipe.');
  const ctors=iface.deploy.inputs.map(x=>x.type).join(',');
  const pre={withdraw:ctors===''&&has('deposit()')&&(has('withdraw()')||has('withdraw(uint256)')),authorization:ctors===''&&iface.deploy.payable&&has('pay(address,uint256)'),replay:ctors==='address'&&has('points(address)')&&has('redeem(uint256,uint8,bytes32,bytes32)'),token:ctors==='address'&&has('credit(address)')&&has('deposit(uint256)')};
  if(!pre[key])throw Error('Contract interface or constructor differs from the supported recipe.');
  let creation=creationInput(meta);
  if(ctors==='address'){
    const tail=meta.constructor_args?.replace(/^0x/,'').toLowerCase();
    if(!tail?.match(/^[a-f0-9]{64}$/)||!creation.endsWith(tail))throw Error('Cannot separate verified constructor arguments.');
    creation=creation.slice(0,-tail.length);
  }
  if((creation.length-2)/2>12288)throw Error('Creation code exceeds the 12 KiB replay limit.');
  const r={withdraw:{Withdraw:{takes_amount:!has('withdraw()')}},authorization:{Authorization:null},replay:{Replay:null},token:{TokenReturn:{credit_slot:[]}}}[key];
  const out=await (await checker()).check_contract(r,creation);
  if(!out.Ok)throw Error(out.Err||'Replay unavailable');
  return {status:out.Ok.reproduced?'Reproduced':'Not reproduced',scope:'Fresh ICP deployment',detail:'Executed the recipe on a fresh deployment with controlled balances and roles.',evidence:out.Ok.observed};
}
export async function scan(network,raw,progress=()=>{}){
  const net=networks[network];if(!net||!hexAddress.test(raw.trim()))throw Error('Enter a 42-character contract address beginning with 0x.');
  let address;try{address=getAddress(raw.trim())}catch{throw Error('The address checksum is invalid. Copy the address again.')}
  progress('Reading Robinhood Chain…');
  const [chain,block]=await Promise.all([rpc(net,'eth_chainId',[]),rpc(net,'eth_getBlockByNumber',['latest',false])]);
  if(Number(chain)!==net.chain||!block.hash)throw Error('The RPC network could not be verified.');
  const height=block.number;const lookup=metadata(net,address).catch(()=>null);
  progress('Inspecting deployed code on ICP…');
  const target=await inspect(net,address,rpc(net,'eth_getCode',[address,height]),height);
  let proxy=null,proxyError='',logic=target;
  try{proxy=await resolve(net,address,target.code,height);if(proxy)logic=await inspect(net,proxy.address,rpc(net,'eth_getCode',[proxy.address,height]),height)}catch(e){proxyError=e.message}
  let m=proxy?await metadata(net,logic.address).catch(()=>null):await lookup;
  // Only attach ABI and constructor details when explorer runtime bytes match the pinned RPC result.
  const verified=Boolean(m?.is_verified && m.deployed_bytecode?.toLowerCase()===logic.code.toLowerCase());
  if(!verified)m=null;
  let iface=null;try{if(m?.abi)iface=new Interface(m.abi)}catch{}
  const constants=new Set(logic.profile.selectors),has=s=>iface?iface.hasFunction(s):constants.has(sig(s).slice(2));
  const getter=has(getterOf)?getterOf:has(getterSimple)?getterSimple:null;
  progress('Testing supported contract behavior…');
  const overviewTask=describe(net,address,height,has,iface);
  const rows=await Promise.all(recipes.map(async([key,title,signature])=>{
    try{
      if(proxyError)throw Error('Proxy resolution unavailable. Runtime code inspection completed.');
      if(!has(signature))throw Error(iface?'Required method absent from verified ABI.':'Required method was not identified in runtime code.');
      let finding;
      if(key==='mint'||key==='underflow'){
        if(!getter)throw Error('A supported balance getter was not identified.');
        finding=await probe(net,address,height,getter,key==='mint');
      }else{
        if(proxy||target.profile.delegatecall)throw Error('A fresh deployment cannot reproduce proxy or delegated storage.');
        finding=await replay(net,target,height,m,key,iface,has);
      }
      return {key,title,...finding};
    }catch(e){return {key,title,status:'Untested',detail:e.message,scope:'Coverage',evidence:[]}}
  }));
  const overview=await overviewTask;
  const confirm=await rpc(net,'eth_getBlockByNumber',[height,false]);
  if(confirm.hash!==block.hash)throw Error('Robinhood Chain reorganized during this scan. Run it again.');
  return {address,network,overview,block:Number(height),blockHash:block.hash,hash:target.profile.hash,size:target.profile.bytes,verified,name:m?.name||'',proxy,proxyError,logicHash:logic.profile.hash,
    indicators:Object.entries(opc).map(([key,label])=>({label,count:logic.profile[key]})),rules:rows,explorer:net.explorer};
}
