import { JsonRpcProvider, BrowserProvider, Contract, ContractFactory, Interface, getAddress, getCreateAddress, keccak256, formatEther, formatUnits } from 'ethers';
import { CHAIN_ID, PUBLIC_RPC, TOKEN_ADDRESS, EXPLORER, same, coder, constructorArgs, modelIdentity, assertTrace, normalizeTrace, verifyActionReceipt } from './core.mjs';
import { predictQuantized, normalizeFeatures } from '../training/core.mjs';
const TOKEN_CODE_HASH='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const KEY='gh0st-forge-pending-v1';
const tokenABI=['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)'];
export function matchRuntime(actual, artifact) {
  if(!artifact.deployedBytecode||!artifact.immutableReferences) throw new Error('Compiler runtime verification data is missing.');
  let a=actual.slice(2).toLowerCase(),b=artifact.deployedBytecode.replace(/^0x/,'').toLowerCase();
  if(a.length!==b.length) throw new Error('The contract runtime size differs from ForgeModel.');
  for(const refs of Object.values(artifact.immutableReferences)) {
    let first=null;
    for(const {start,length} of refs) {
      if(length!==32||start<0||(start+length)*2>a.length)throw new Error('Invalid compiler immutable reference.');
      const current=a.slice(start*2,(start+length)*2);
      if(first!==null&&current!==first)throw new Error('The contract contains inconsistent copies of an immutable value.');
      first=current;
    }
    for(const {start,length} of refs) { const from=start*2,to=(start+length)*2;a=a.slice(0,from)+'0'.repeat(length*2)+a.slice(to);b=b.slice(0,from)+'0'.repeat(length*2)+b.slice(to); }
  }
  if(a!==b) throw new Error('The contract runtime differs from the published ForgeModel compiler output.');
  return true;
}
export class ForgeWallet {
  constructor(artifact,{notice,changed,onReceipt}={}) {
    this.artifact=artifact;this.notice=notice||(()=>{});this.changed=changed||(()=>{});this.onReceipt=onReceipt||(()=>{});
    this.provider=new JsonRpcProvider(PUBLIC_RPC,undefined,{cacheTimeout:-1});this.wallet=null;this.signer=null;this.live=null;this.pending=null;this.estimate=null;this.allowance=0n;this.balance=0n;this.credits=0n;
    try{const p=JSON.parse(localStorage.getItem(KEY));if(p?.hash&&p.wallet&&p.expected)this.pending=p;}catch{}
    if(globalThis.ethereum?.on){ethereum.on('accountsChanged',()=>this.invalidate('Wallet account changed. Reconnect before continuing.'));ethereum.on('chainChanged',()=>this.invalidate('Wallet network changed. Reconnect to Robinhood Chain.'));}
  }
  invalidate(message){this.signer=null;this.wallet=null;this.estimate=null;this.allowance=0n;this.balance=0n;this.credits=0n;this.notice(message);this.changed();}
  contract(address=this.live?.address,runner=this.provider){return new Contract(address,this.artifact.abi,runner)}
  token(runner=this.provider){return new Contract(TOKEN_ADDRESS,tokenABI,runner)}
  async verifyNetwork(){
    if(Number((await this.provider.getNetwork()).chainId)!==CHAIN_ID) throw new Error('The public RPC returned an unexpected network.');
    const [code,decimals]=await Promise.all([this.provider.getCode(TOKEN_ADDRESS),this.token().decimals()]);
    if(code==='0x'||keccak256(code)!==TOKEN_CODE_HASH||Number(decimals)!==18)throw new Error('The canonical GH0ST token code or decimals could not be verified.');
  }
  async connect(){
    if(!globalThis.ethereum)throw new Error('Open Forge in an Ethereum wallet browser, or install a compatible wallet.');
    const accounts=await ethereum.request({method:'eth_requestAccounts'});
    if(!accounts[0])throw new Error('No wallet account was selected.');
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){
      try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
      catch(error){if(Number(error.code)!==4902)throw error;await ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[PUBLIC_RPC],blockExplorerUrls:[EXPLORER]}]});}
    }
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID)throw new Error('Switch the wallet to Robinhood Chain before continuing.');
    await this.verifyNetwork();
    this.wallet=getAddress((await ethereum.request({method:'eth_accounts'}))[0]);
    this.walletProvider=new BrowserProvider(ethereum,undefined,{cacheTimeout:-1});this.signer=await this.walletProvider.getSigner(this.wallet);
    await this.refresh();this.changed();
  }
  async assertWallet(){
    if(!this.signer||!this.wallet)throw new Error('Connect your wallet on Robinhood Chain first.');
    if(this.pending)throw new Error('Check the saved pending transaction before sending another.');
    const accounts=await ethereum.request({method:'eth_accounts'});
    if(!same(accounts[0],this.wallet)||Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){this.invalidate('Wallet changed. Reconnect to continue.');throw new Error('The wallet account or network changed.');}
    await this.verifyNetwork();
  }
  async estimateDeploy(model,fee){
    await this.assertWallet();
    const tx=await new ContractFactory(this.artifact.abi,this.artifact.bytecode).getDeployTransaction(...constructorArgs(model,this.wallet,fee));
    const [gas,feeData]=await Promise.all([this.provider.estimateGas({...tx,from:this.wallet}),this.provider.getFeeData()]);
    const gasPrice=feeData.maxFeePerGas??feeData.gasPrice;
    if(!gasPrice)throw new Error('A live network gas price was unavailable.');
    const gasLimit=gas*120n/100n;
    this.estimate={modelHash:model.hashes.modelHash,fee:String(fee),wallet:this.wallet,gas,gasLimit,gasPrice,wei:gasLimit*gasPrice,created:Date.now(),tx};this.changed();return this.estimate;
  }
  async deploy(model,fee,modelPackage){
    await this.assertWallet();const e=this.estimate;
    if(!e||!same(e.modelHash,model.hashes.modelHash)||e.fee!==String(fee)||!same(e.wallet,this.wallet)||Date.now()-e.created>300000)throw new Error('Get a new live gas estimate for this model and fee before deploying.');
    const nonce=await this.walletProvider.getTransactionCount(this.wallet,'pending');
    const address=getCreateAddress({from:this.wallet,nonce});
    const tx=await this.signer.sendTransaction({...e.tx,gasLimit:e.gasLimit,nonce});
    return this.wait(tx,'Deploy model',{address,beneficiary:this.wallet,fee:String(fee),modelPackage});
  }
  async load(address,model,transactionHash=null){
    this.live=null;this.allowance=0n;this.balance=0n;this.credits=0n;this.changed();
    await this.verifyNetwork();address=getAddress(address);
    const c=this.contract(address),code=await this.provider.getCode(address);matchRuntime(code,this.artifact);
    const keys=['paymentToken','beneficiary','fee','inputCount','hiddenWidth','classCount','featureSchemaHash','labelsHash','datasetHash','weightsHash','modelHash','modelId','data','dataCodeHash'];
    const vals=await Promise.all(keys.map(k=>c[k]()));const v=Object.fromEntries(keys.map((k,i)=>[k,vals[i]]));
    if(!same(v.paymentToken,TOKEN_ADDRESS)||Number(v.inputCount)!==model.shape.input||Number(v.hiddenWidth)!==model.shape.hidden||Number(v.classCount)!==model.shape.output)throw new Error('The on-chain model dimensions or payment token differ from this package.');
    for(const key of ['featureSchemaHash','labelsHash','datasetHash','weightsHash','modelHash'])if(!same(v[key],model.hashes[key]))throw new Error(`The on-chain ${key} differs from this package.`);
    if(!same(v.modelId,modelIdentity(address,v.beneficiary,v.fee,model.hashes.modelHash)))throw new Error('The deployed model identity does not match its address, creator, fee, and package.');
    const dataCode=await this.provider.getCode(v.data);
    if(!same(keccak256(dataCode),v.dataCodeHash)||!same(dataCode,`0x00${model.packedWeightsHex.slice(2)}`))throw new Error('The on-chain packed weights differ from this package.');
    const raw=model.normalization.center;
    const expected=predictQuantized(model,raw);const actual=await c.predict(normalizeFeatures(model,raw));assertTrace(actual,expected);
    const quote=await c.quote();if(!same(quote[0],v.modelId)||BigInt(quote[1])!==v.fee)throw new Error('The model quote differs from its verified identity.');
    let creationVerified=false;
    if(transactionHash){
      if(!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))throw new Error('Enter a valid deployment transaction hash.');
      const [tx,receipt]=await Promise.all([this.provider.getTransaction(transactionHash),this.provider.getTransactionReceipt(transactionHash)]);
      if(!tx||!receipt||Number(receipt.status)!==1||tx.to!==null||!same(receipt.contractAddress,address)||!same(tx.from,v.beneficiary))throw new Error('The creation transaction does not match this model and beneficiary.');
      const expected=await new ContractFactory(this.artifact.abi,this.artifact.bytecode).getDeployTransaction(...constructorArgs(model,v.beneficiary,v.fee));
      if(!same(tx.data,expected.data))throw new Error('The creation transaction differs from the official ForgeModel constructor and model package.');
      creationVerified=true;
    }
    this.live={address,beneficiary:v.beneficiary,fee:v.fee,modelId:v.modelId,model,codeHash:keccak256(code),creationVerified,transactionHash:creationVerified?transactionHash:null};await this.refresh();this.changed();return this.live;
  }
  async assertLive(){
    if(!this.live)throw new Error('Load and verify a deployed model first.');
    const l=this.live;const [quote,code]=await Promise.all([this.contract().quote(),this.provider.getCode(l.address)]);
    if(!same(keccak256(code),l.codeHash)||!same(quote[0],l.modelId)||BigInt(quote[1])!==l.fee)throw new Error('The model code or quote changed. Reload and verify it.');
    return l;
  }
  async preview(raw){const l=await this.assertLive();const trace=await this.contract().predict(normalizeFeatures(l.model,raw));assertTrace(trace,predictQuantized(l.model,raw));return normalizeTrace(trace);}
  async refresh(){
    if(this.live){await this.assertLive();if(this.wallet){[this.allowance,this.balance,this.credits]=await Promise.all([this.token().allowance(this.wallet,this.live.address),this.token().balanceOf(this.wallet),this.contract().credits(this.wallet)]);}}
    this.changed();
  }
  async approve(){
    await this.assertWallet();const l=await this.assertLive();await this.refresh();
    if(!l.creationVerified)throw new Error('Verify the original deployment transaction before approving a model fee.');
    if(l.fee===0n||this.allowance===l.fee)return;
    const amount=this.allowance>0n?0n:l.fee;
    const tx=await this.token(this.signer).approve(l.address,amount);return this.wait(tx,amount===0n?'Approval reset':'Approval exact fee',{address:l.address,amount:String(amount)});
  }
  async infer(raw){
    await this.assertWallet();const l=await this.assertLive();await this.refresh();
    if(!l.creationVerified)throw new Error('Verify the original deployment transaction before recording a prediction.');
    if((l.fee>0n&&this.allowance!==l.fee)||this.balance<l.fee)throw new Error('Approve exactly the fixed fee and ensure your GH0ST balance covers it.');
    const features=normalizeFeatures(l.model,raw);const trace=await this.preview(raw);const block=await this.provider.getBlock('latest');
    const traceType=new Interface(this.artifact.abi).getFunction('predict').outputs[0];
    const expected={address:l.address,modelId:l.modelId,fee:String(l.fee),features,rawFeatures:raw,classId:trace.classId,trace,inputHash:keccak256(coder.encode(['int256[]'],[features])),traceHash:keccak256(coder.encode([traceType],[trace]))};
    const tx=await this.contract(l.address,this.signer).inferPaid(features,l.modelId,l.fee,Number(block.timestamp)+600);return this.wait(tx,'Record prediction',expected);
  }
  async withdraw(){
    await this.assertWallet();const l=await this.assertLive();if(!l.creationVerified)throw new Error('Verify the original deployment transaction before withdrawing model credits.');await this.refresh();if(this.credits===0n)throw new Error('Your wallet has no claimable credits on this model.');
    const expected={address:this.live.address,amount:String(this.credits)};
    const tx=await this.contract(this.live.address,this.signer).withdraw();return this.wait(tx,'Withdraw credits',expected);
  }
  persist(value){
    if(value){localStorage.setItem(KEY,JSON.stringify(value));this.pending=value;}else{localStorage.removeItem(KEY);this.pending=null;}
    this.changed();
  }
  async wait(tx,type,expected){
    this.pending={hash:tx.hash,type,expected,wallet:this.wallet};
    try{this.persist(this.pending)}catch{this.notice('A transaction was submitted. Keep this page open: browser storage is unavailable.');}
    this.notice(`${type} submitted. Waiting for a confirmed receipt. ${tx.hash}`);
    const receipt=await tx.wait(1,120000);return this.accept(receipt);
  }
  async accept(receipt){
    if(!this.pending)throw new Error('No saved transaction exists for this receipt.');
    const p=this.pending;
    if(Number(receipt.status)===0&&same(receipt.hash,p.hash)){this.persist(null);throw new Error('The transaction reverted. Network gas may have been spent.');}
    verifyActionReceipt(receipt,p,l=>new Interface(p.type.startsWith('Approval')?tokenABI:this.artifact.abi).parseLog(l));
    if(p.type==='Deploy model'){
      const live=await this.load(receipt.contractAddress,p.expected.modelPackage.model,receipt.hash);
      if(!same(live.beneficiary,p.expected.beneficiary)||String(live.fee)!==p.expected.fee)throw new Error('The deployed beneficiary or fee differs from the approved deployment.');
    }
    if(p.type.startsWith('Approval')){const amount=await this.token().allowance(p.wallet,p.expected.address);if(amount!==BigInt(p.expected.amount))throw new Error('The confirmed token allowance differs from the requested amount.');}
    await this.onReceipt(p,receipt);this.persist(null);await this.refresh();this.notice(`${p.type} confirmed and receipt verified.`);return receipt;
  }
  async resolve(){
    if(!this.pending)return;const receipt=await this.provider.getTransactionReceipt(this.pending.hash);
    if(!receipt)return this.notice('The saved transaction is pending or unavailable. No new transaction was sent. Check your wallet or explorer.');
    if(await receipt.confirmations()<1)return;return this.accept(receipt);
  }
  estimateText(){return this.estimate?`${formatEther(this.estimate.wei)} ETH · ${this.estimate.gas.toLocaleString()} gas (+20% limit)`:'Estimate after training';}
  feeText(value){return `${formatUnits(value,18).replace(/\.0$/,'')} GH0ST`}
}
