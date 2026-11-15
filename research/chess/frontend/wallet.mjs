import { JsonRpcProvider, BrowserProvider, Contract, ContractFactory, Interface, getAddress, keccak256, verifyTypedData, toBeHex } from 'ethers';
import { CHAIN_ID,PUBLIC_RPC,TOKEN_ADDRESS,TOKEN_RUNTIME_HASH,ENTRY_FEE,TOTAL_PRIZE,same,validateConfig,matchRuntime,randomBytes,hex } from './core.mjs';
const KEY='gh0st-chess-unresolved-transaction-v1';
const tokenABI=['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)'];
const resultTypes={GameResult:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'principalHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'finalPositionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'result',type:'uint8'},{name:'engineConfigHash',type:'bytes32'},{name:'completedAt',type:'uint64'},{name:'issuedAt',type:'uint64'},{name:'validUntil',type:'uint64'}]};
export class ChessWallet {
  constructor(config,artifact,{notice=()=>{},changed=()=>{},onEntry=()=>{},verifyAuthority}={}){
    Object.assign(this,{config,artifact,notice,changed,onEntry,verifyAuthority});this.provider=new JsonRpcProvider(PUBLIC_RPC,undefined,{cacheTimeout:-1});this.wallet=null;this.signer=null;this.verified=false;this.pending=null;this.balance=0n;this.allowance=0n;this.freePool=0n;this.totalReserved=0n;
    try{const p=JSON.parse(localStorage.getItem(KEY));if(p?.wallet&&p?.target&&p?.data)this.pending=p;}catch{}
    globalThis.ethereum?.on?.('accountsChanged',()=>this.invalidate());globalThis.ethereum?.on?.('chainChanged',()=>this.invalidate());
  }
  invalidate(){this.wallet=null;this.signer=null;this.verified=false;this.balance=0n;this.allowance=0n;this.notice('Wallet changed. Reconnect before continuing.');this.changed();}
  token(runner=this.provider){return new Contract(TOKEN_ADDRESS,tokenABI,runner);}
  vault(runner=this.provider){return new Contract(this.config.vaultAddress,this.artifact.abi,runner);}
  async verifyChain(){
    if(Number((await this.provider.getNetwork()).chainId)!==CHAIN_ID)throw new Error('The public RPC returned an unexpected chain.');
    const [code,decimals]=await Promise.all([this.provider.getCode(TOKEN_ADDRESS),this.token().decimals()]);
    if(keccak256(code)!==TOKEN_RUNTIME_HASH||Number(decimals)!==18)throw new Error('The canonical GH0ST runtime and 18 decimals could not be verified.');
  }
  async connect(){
    if(!globalThis.ethereum)throw new Error('Open this page in an Ethereum wallet browser or install a compatible wallet.');
    await ethereum.request({method:'eth_requestAccounts'});
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){
      try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
      catch(error){if(Number(error.code)!==4902)throw error;await ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[PUBLIC_RPC],blockExplorerUrls:['https://robinhoodchain.blockscout.com']}]});}
    }
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID)throw new Error('Switch to Robinhood Chain before continuing.');
    await this.verifyChain();const account=(await ethereum.request({method:'eth_accounts'}))[0];if(!account)throw new Error('Choose a wallet account.');
    this.wallet=getAddress(account);this.walletProvider=new BrowserProvider(ethereum,undefined,{cacheTimeout:-1});this.signer=await this.walletProvider.getSigner(this.wallet);this.balance=await this.token().balanceOf(this.wallet);this.changed();
  }
  async verify(){
    this.verified=false;validateConfig(this.config);await this.verifyChain();const c=this.config,v=this.vault();
    const [code,tx,receipt,token,owner,attestor,configHash,entry,prize,paused,solvent,free,reserved]=await Promise.all([
      this.provider.getCode(c.vaultAddress),this.provider.getTransaction(c.vaultDeploymentTransaction),this.provider.getTransactionReceipt(c.vaultDeploymentTransaction),v.paymentToken(),v.owner(),v.attestor(),v.engineConfigHash(),v.ENTRY_FEE(),v.TOTAL_PRIZE(),v.paused(),v.isSolvent(),v.freePool(),v.totalReserved()
    ]);
    const codeHash=matchRuntime(code,this.artifact);
    if(!same(codeHash,c.vaultRuntimeHash)||!same(token,TOKEN_ADDRESS)||!same(owner,c.poolOwner)||!same(attestor,c.attestorAddress)||!same(configHash,c.engineConfigHash)||entry!==ENTRY_FEE||prize!==TOTAL_PRIZE)throw new Error('Vault identity, terms, signer, owner, or search commitment differ from the release.');
    if(!tx||!receipt||Number(receipt.status)!==1||tx.to!==null||!same(receipt.contractAddress,c.vaultAddress))throw new Error('The original vault deployment receipt is unavailable or mismatched.');
    const expected=await new ContractFactory(this.artifact.abi,this.artifact.bytecode).getDeployTransaction(TOKEN_ADDRESS,c.poolOwner,c.attestorAddress,c.engineConfigHash);
    if(!same(tx.data,expected.data))throw new Error('The original vault constructor differs from the reviewed source and pinned release.');
    this.freePool=free;this.totalReserved=reserved;this.paused=paused;this.solvent=solvent;this.verified=true;
    if(this.wallet)[this.balance,this.allowance]=await Promise.all([this.token().balanceOf(this.wallet),this.token().allowance(this.wallet,c.vaultAddress)]);
    this.changed();return{paused,solvent,freePool:free,totalReserved:reserved};
  }
  async assertWallet(){
    if(!this.wallet||!this.signer)throw new Error('Connect your Robinhood wallet first.');
    if(this.pending)throw new Error('Resolve the saved transaction before sending another.');
    const accounts=await ethereum.request({method:'eth_accounts'});
    if(!same(accounts[0],this.wallet)||Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){this.invalidate();throw new Error('Wallet account or network changed.');}
    await this.verify();
  }
  async assertEntry(){if(typeof this.verifyAuthority!=='function')throw new Error('The canonical authority verification gate is unavailable.');await this.verifyAuthority();await this.assertWallet();if(this.paused||!this.solvent||this.freePool<TOTAL_PRIZE)throw new Error('Entry is closed: the vault must have 100,000 unreserved GH0ST before your fee is charged.');if(this.balance<ENTRY_FEE)throw new Error('Your wallet needs 25,000 GH0ST plus ETH for network gas.');}
  persist(value){if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY);this.pending=value;this.changed();}
  async send(kind,contract,method,args,expected){
    const populated=await contract[method].populateTransaction(...args);const gas=await this.provider.estimateGas({...populated,from:this.wallet});const nonce=await this.walletProvider.getTransactionCount(this.wallet,'pending');
    const intent={kind,wallet:this.wallet,target:getAddress(populated.to),data:populated.data,nonce,hash:null,expected,createdAt:Date.now()};
    // Intent is saved BEFORE the wallet can broadcast. Ambiguous sends remain blocked.
    this.persist(intent);
    try{
      const tx=await this.signer.sendTransaction({...populated,nonce,gasLimit:gas*120n/100n});this.persist({...intent,hash:tx.hash});this.notice(`${kind} sent. Waiting for its receipt.`);
      const receipt=await tx.wait(1,90000);return this.accept(receipt);
    }catch(error){if((error?.code===4001||error?.code==='ACTION_REJECTED')&&!this.pending?.hash)this.persist(null);throw error;}
  }
  async approveExact(){
    await this.assertEntry();if(this.allowance===ENTRY_FEE)throw new Error('Exactly 25,000 GH0ST is already approved. Entry is a separate action.');
    const amount=this.allowance===0n?ENTRY_FEE:0n;return this.send(amount===0n?'Reset allowance':'Approve 25,000 GH0ST',this.token(this.signer),'approve',[this.config.vaultAddress,amount],{amount:String(amount)});
  }
  async enter(principalHash){
    await this.assertEntry();if(this.allowance!==ENTRY_FEE)throw new Error('Approve exactly 25,000 GH0ST in a separate action first.');
    const nonce=BigInt(hex(randomBytes()));const gameId=await this.vault().gameIdFor(this.wallet,nonce);
    return this.send('Enter challenge',this.vault(this.signer),'enterGame',[principalHash,nonce],{gameId,principalHash,nonce:String(nonce),engineConfigHash:this.config.engineConfigHash});
  }
  async accept(receipt){
    const p=this.pending;if(!p||!receipt)throw new Error('No saved transaction can be reconciled.');
    if(p.hash&&!same(p.hash,receipt.hash))throw new Error('Receipt differs from the saved transaction.');
    const tx=await this.provider.getTransaction(receipt.hash);
    if(!tx||!same(tx.from,p.wallet)||!same(tx.to,p.target)||!same(tx.data,p.data)||tx.nonce!==p.nonce||!same(receipt.from,p.wallet)||!same(receipt.to,p.target))throw new Error('Receipt and original transaction do not match the saved action.');
    if(Number(receipt.status)===0){this.persist(null);throw new Error('The transaction reverted. Gas may have been spent.');}
    if(Number(receipt.status)!==1||await receipt.confirmations()<1)throw new Error('The transaction is not confirmed.');
    const iface=new Interface(p.kind.includes('allowance')||p.kind.startsWith('Approve')?tokenABI:this.artifact.abi);
    const logs=receipt.logs.filter(l=>same(l.address,p.target)).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).filter(Boolean);
    let admitted=null;
    if(p.kind==='Enter challenge'){
      const found=logs.filter(l=>l.name==='EntryAccepted');if(found.length!==1)throw new Error('Expected exactly one EntryAccepted event.');const a=found[0].args;
      if(!same(a.gameId,p.expected.gameId)||!same(a.player,p.wallet)||!same(a.principalHash,p.expected.principalHash)||a.nonce!==BigInt(p.expected.nonce)||!same(a.engineConfigHash,p.expected.engineConfigHash))throw new Error('Entry event differs from the bound wallet, identity, nonce, or engine configuration.');
      const g=await this.vault().games(a.gameId);if(!same(g.player,p.wallet)||!same(g.principalHash,a.principalHash)||g.nonce!==a.nonce||Number(g.result)!==0)throw new Error('Vault game state does not match the confirmed entry.');
      admitted={gameId:a.gameId,transactionHash:receipt.hash,wallet:p.wallet,principalHash:a.principalHash,nonce:String(a.nonce),openedAt:String(a.openedAt),gameDeadline:String(a.gameDeadline),reconciliationDeadline:String(a.reconciliationDeadline)};
      localStorage.setItem('gh0st-chess-entry-v1',JSON.stringify(admitted));
    }else if(p.kind==='Settle result'||p.kind==='Refund unattested entry'){
      const found=logs.filter(l=>l.name==='GameSettled');if(found.length!==1||!same(found[0].args.gameId,p.expected.gameId)||!same(found[0].args.player,p.wallet))throw new Error('Settlement event does not match this game and payout wallet.');
      const a=found[0].args;if(Number(a.result)!==p.expected.result||a.paid!==BigInt(p.expected.paid)||!same(a.finalPositionHash,p.expected.finalPositionHash)||!same(a.transcriptHash,p.expected.transcriptHash))throw new Error('Settlement outcome, amount, or terminal commitments differ from the approved result.');
      if(a.paid>0n){const tokenInterface=new Interface(tokenABI);const transfers=receipt.logs.filter(l=>same(l.address,TOKEN_ADDRESS)).map(l=>{try{return tokenInterface.parseLog(l);}catch{return null;}}).filter(l=>l?.name==='Transfer'&&same(l.args.from,this.config.vaultAddress)&&same(l.args.to,p.wallet));if(transfers.length!==1||transfers[0].args.value!==a.paid)throw new Error('The canonical token payout transfer does not match settlement.');}
      localStorage.setItem('gh0st-chess-last-settlement-v1',JSON.stringify({gameId:a.gameId,wallet:p.wallet,result:Number(a.result),paid:String(a.paid),transactionHash:receipt.hash}));
    }else{
      const found=logs.filter(l=>l.name==='Approval');if(found.length!==1||!same(found[0].args.owner,p.wallet)||!same(found[0].args.spender,this.config.vaultAddress)||found[0].args.value!==BigInt(p.expected.amount))throw new Error('Approval receipt differs from the exact requested allowance.');
      if(await this.token().allowance(p.wallet,this.config.vaultAddress)!==BigInt(p.expected.amount))throw new Error('Current allowance differs from the confirmed approval.');
    }
    this.persist(null);if(admitted)await this.onEntry(admitted);await this.verify();this.notice(`${p.kind} confirmed and receipt verified.`);return receipt;
  }
  async resolve(optionalHash){
    if(!this.pending)return;if(optionalHash&&!this.pending.hash){if(!/^0x[0-9a-f]{64}$/i.test(optionalHash))throw new Error('Enter the exact wallet transaction hash.');this.persist({...this.pending,hash:optionalHash});}
    if(!this.pending.hash)throw new Error('The wallet outcome is uncertain. Paste its transaction hash to reconcile it. Sending is blocked.');
    const receipt=await this.provider.getTransactionReceipt(this.pending.hash);if(!receipt)throw new Error('Receipt is unavailable or still pending. No transaction was re-sent.');return this.accept(receipt);
  }
  async settle(envelope,material){
    await this.assertWallet();const r=envelope.receipt;if(!r||!envelope.signature||!material)throw new Error('A signed result and authority result material are required.');
    const map={gameId:'game_id',player:'player',principalHash:'principal_hash',nonce:'nonce',finalPositionHash:'final_position_hash',transcriptHash:'transcript_hash',engineConfigHash:'engine_config_hash'};
    for(const [key,source]of Object.entries(map)){const expected=key==='nonce'?BigInt(hex(material[source])):hex(material[source]);if(key==='nonce'?BigInt(r[key])!==expected:!same(r[key],expected))throw new Error(`Signed ${key} differs from the authority result.`);}
    if(Number(r.result)!==material.result||BigInt(r.completedAt)!==material.completed_at||!same(r.player,this.wallet)||!same(r.engineConfigHash,this.config.engineConfigHash))throw new Error('Signed result differs from the terminal game, connected wallet, or engine.');
    const domain={name:'GH0ST RH Chess Challenge',version:'1',chainId:CHAIN_ID,verifyingContract:this.config.vaultAddress};
    if(!same(verifyTypedData(domain,resultTypes,r,envelope.signature),this.config.attestorAddress))throw new Error('The result is not signed by the pinned attestor.');
    const paid=Number(r.result)===1?TOTAL_PRIZE:[6,7].includes(Number(r.result))?ENTRY_FEE:0n;
    return this.send('Settle result',this.vault(this.signer),'settleGame',[r,envelope.signature],{gameId:r.gameId,result:Number(r.result),paid:String(paid),finalPositionHash:r.finalPositionHash,transcriptHash:r.transcriptHash});
  }
  async refund(gameId){await this.assertWallet();const game=await this.vault().games(gameId);if(!same(game.player,this.wallet)||Number(game.result)!==0)throw new Error('No unresolved entry for this wallet.');const block=await this.provider.getBlock('latest');if(BigInt(block.timestamp)<=game.reconciliationDeadline)throw new Error('The reconciliation window has not expired.');const zero='0x'+'00'.repeat(32);return this.send('Refund unattested entry',this.vault(this.signer),'refundUnattested',[gameId],{gameId,result:8,paid:String(ENTRY_FEE),finalPositionHash:zero,transcriptHash:zero});}
}
