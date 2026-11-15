import { JsonRpcProvider, BrowserProvider, Contract, ContractFactory, Interface, getAddress, keccak256, verifyTypedData, AbiCoder, id } from 'ethers';
import { Chess } from 'chess.js';
import { CHAIN_ID,PUBLIC_RPC,TOKEN_ADDRESS,TOKEN_RUNTIME_HASH,ENTRY_FEE,TOTAL_PRIZE,same,validateConfig,matchRuntime,randomBytes,hex,boardFen,decodeMove,encodeMove,BOT_MOVE_TYPES,botMoveDomain } from './core.mjs';
const KEY='gh0st-chess-hybrid-unresolved-transaction-v2';
export const tokenABI=['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)'];
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
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}catch(error){if(Number(error.code)!==4902)throw error;await ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[PUBLIC_RPC],blockExplorerUrls:['https://robinhoodchain.blockscout.com']}]});}}
    if(Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID)throw new Error('Switch to Robinhood Chain before continuing.');
    await this.verifyChain();const account=(await ethereum.request({method:'eth_accounts'}))[0];if(!account)throw new Error('Choose a wallet account.');
    this.wallet=getAddress(account);this.walletProvider=new BrowserProvider(ethereum,undefined,{cacheTimeout:-1});this.signer=await this.walletProvider.getSigner(this.wallet);this.balance=await this.token().balanceOf(this.wallet);this.changed();
  }
  async verify(){
    this.verified=false;validateConfig(this.config);await this.verifyChain();const c=this.config,v=this.vault();
    const [code,tx,receipt,token,owner,attestor,configHash,entry,prize,paused,solvent,free,reserved,activeGameId]=await Promise.all([
      this.provider.getCode(c.vaultAddress),this.provider.getTransaction(c.vaultDeploymentTransaction),this.provider.getTransactionReceipt(c.vaultDeploymentTransaction),v.paymentToken(),v.owner(),v.attestor(),v.engineConfigHash(),v.ENTRY_FEE(),v.TOTAL_PRIZE(),v.paused(),v.isSolvent(),v.freePool(),v.totalReserved(),v.activeGameId()
    ]);
    if(!same(matchRuntime(code,this.artifact),c.vaultRuntimeHash)||!same(token,TOKEN_ADDRESS)||!same(owner,c.poolOwner)||!same(attestor,c.attestorAddress)||!same(configHash,c.engineConfigHash)||entry!==ENTRY_FEE||prize!==TOTAL_PRIZE)throw new Error('Native game identity, rules, terms, signer, owner, or search commitment differ from the release.');
    if(!tx||!receipt||Number(receipt.status)!==1||tx.to!==null||!same(receipt.contractAddress,c.vaultAddress))throw new Error('The original game deployment receipt is unavailable or mismatched.');
    const expected=await new ContractFactory(this.artifact.abi,this.artifact.bytecode).getDeployTransaction(TOKEN_ADDRESS,c.poolOwner,c.attestorAddress,c.engineConfigHash);
    if(!same(tx.data,expected.data))throw new Error('The original game constructor differs from the reviewed source and pinned release.');
    this.activeGameId=activeGameId;this.deploymentBlock=receipt.blockNumber;this.freePool=free;this.totalReserved=reserved;this.paused=paused;this.solvent=solvent;this.verified=true;
    if(this.wallet)[this.balance,this.allowance]=await Promise.all([this.token().balanceOf(this.wallet),this.token().allowance(this.wallet,c.vaultAddress)]);
    this.changed();return{paused,solvent,freePool:free,totalReserved:reserved};
  }
  async assertWallet(){
    if(!this.wallet||!this.signer)throw new Error('Connect your Robinhood wallet first.');if(this.pending)throw new Error('Resolve the saved transaction before sending another.');
    const accounts=await ethereum.request({method:'eth_accounts'});if(!same(accounts[0],this.wallet)||Number(BigInt(await ethereum.request({method:'eth_chainId'})))!==CHAIN_ID){this.invalidate();throw new Error('Wallet account or network changed.');}await this.verify();
  }
  async assertEntry(){if(typeof this.verifyAuthority!=='function')throw new Error('The canonical brain verification gate is unavailable.');await this.verifyAuthority();await this.assertWallet();if(this.activeGameId&&BigInt(this.activeGameId)!==0n)throw new Error('The retained engine is serving another game. Entry reopens after it settles.');if(this.paused||!this.solvent||this.freePool<TOTAL_PRIZE)throw new Error('Entry is closed: the game must have 1,000,000 unreserved GH0ST before your fee is charged.');if(this.balance<ENTRY_FEE)throw new Error('Your wallet needs 25,000 GH0ST plus ETH for network gas.');}
  persist(value){if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY);this.pending=value;this.changed();}
  async send(kind,contract,method,args,expected){
    if(this.pending)throw new Error('Resolve the saved transaction before sending another.');
    const populated=await contract[method].populateTransaction(...args);const gas=await this.provider.estimateGas({...populated,from:this.wallet});const nonce=await this.walletProvider.getTransactionCount(this.wallet,'pending');
    const intent={kind,wallet:this.wallet,target:getAddress(populated.to),data:populated.data,nonce,hash:null,expected,createdAt:Date.now()};this.persist(intent);
    try{const tx=await this.signer.sendTransaction({...populated,nonce,gasLimit:gas*120n/100n});this.persist({...intent,hash:tx.hash});this.notice(`${kind} sent. Waiting for its receipt.`);const receipt=await tx.wait(1,90000);return this.accept(receipt);}catch(error){if((error?.code===4001||error?.code==='ACTION_REJECTED')&&!this.pending?.hash)this.persist(null);throw error;}
  }
  async approveExact(){await this.assertEntry();if(this.allowance===ENTRY_FEE)throw new Error('Exactly 25,000 GH0ST is already approved. Entry is a separate action.');const amount=this.allowance===0n?ENTRY_FEE:0n;return this.send(amount===0n?'Reset allowance':'Approve 25,000 GH0ST',this.token(this.signer),'approve',[this.config.vaultAddress,amount],{amount:String(amount)});}
  async enter(){await this.assertEntry();if(this.allowance!==ENTRY_FEE)throw new Error('Approve exactly 25,000 GH0ST in a separate action first.');const nonce=BigInt(hex(randomBytes()));const gameId=await this.vault().gameIdFor(this.wallet,nonce);return this.send('Enter challenge',this.vault(this.signer),'enterGame',[nonce],{gameId,nonce:String(nonce)});}
  async game(gameId){
    if(!this.verified)throw new Error('Verify the native game release before loading a game.');
    const block=await this.provider.getBlock('latest');const g=await this.vault().getGame(gameId,{blockTag:block.number});if(g.player==='0x0000000000000000000000000000000000000000')return null;
    const history=await this.vault().getMoves(gameId,{blockTag:block.number});
    const ref=new Chess(),moves=[];const abi=AbiCoder.defaultAbiCoder();let transcript=id('GH0ST_CHESS_INITIAL_V1');
    for(const encoded of history){const uci=decodeMove(encoded);let played;try{played=ref.move(uci);}catch{throw new Error('Canonical move history failed independent legal replay.');}moves.push({uci,san:played.san,ply:moves.length+1});transcript=keccak256(abi.encode(['bytes32','uint16'],[transcript,encoded]));}
    const canonicalFen=boardFen(g),fields=ref.fen().split(' '),native=canonicalFen.split(' ');
    const hash=keccak256(abi.encode(['uint256','uint8','uint8','bool'],[g.board,g.castling,g.enPassant,g.blackToMove]));
    const last=ref.history({verbose:true}).at(-1);const rawEP=last?.piece==='p'&&Math.abs(Number(last.from[1])-Number(last.to[1]))===2?(last.from.charCodeAt(0)-97)+(Number(last.from[1])+Number(last.to[1])-2)/2*8:64;
    if(rawEP!==Number(g.enPassant)||moves.length!==Number(g.ply)||fields[0]!==native[0]||fields[1]!==native[1]||fields[2]!==native[2]||fields[4]!==native[4]||!same(hash,g.positionHash)||!same(transcript,g.transcriptHash))throw new Error('Canonical history does not match the stored Robinhood board and commitments.');
    return{...Object.fromEntries(['player','nonce','openedAt','turnDeadline','result','ply','positionHash','transcriptHash','board','castling','enPassant','halfmoveClock','blackToMove'].map(k=>[k,g[k]])),gameId,fen:ref.fen(),moves,blockNumber:block.number,blockHash:block.hash};
  }
  async assertGame(gameId){await this.assertWallet();const g=await this.game(gameId);if(!g||!same(g.player,this.wallet)||Number(g.result)!==0)throw new Error('This is not an active game for your wallet.');return g;}
  async humanMove(gameId,uci){const g=await this.assertGame(gameId);if(g.blackToMove)throw new Error('The ICP engine plays Black.');const local=new Chess(g.fen);if(!local.moves({verbose:true}).some(m=>m.from+m.to+(m.promotion||'')===uci))throw new Error('This move is not legal in the current Robinhood position.');return this.send('Play White move',this.vault(this.signer),'playHumanMove',[gameId,encodeMove(uci)],{gameId,ply:Number(g.ply)+1,encodedMove:encodeMove(uci)});}
  async botMove(gameId,envelope){const g=await this.assertGame(gameId);const m=envelope?.move;if(!m||!envelope.signature||!g.blackToMove)throw new Error('No signed Black move is ready for this game.');for(const [key,value]of Object.entries({gameId,player:g.player,positionHash:g.positionHash,transcriptHash:g.transcriptHash,engineConfigHash:this.config.engineConfigHash}))if(!same(m[key],value))throw new Error(`Signed ${key} differs from the current canonical game.`);if(Number(m.ply)!==Number(g.ply)||BigInt(m.validUntil)<=BigInt(Math.floor(Date.now()/1000)))throw new Error('The signed move is stale or expired.');if(!same(verifyTypedData(botMoveDomain(this.config),BOT_MOVE_TYPES,m,envelope.signature),this.config.attestorAddress))throw new Error('Black move is not signed by the pinned ICP attestor.');return this.send('Apply ICP Black move',this.vault(this.signer),'playBotMove',[m,envelope.signature],{gameId,ply:Number(g.ply)+1,encodedMove:Number(m.encodedMove)});}
  async action(method,gameId){await this.assertGame(gameId);if(!['claimDraw','resign','claimTimeout'].includes(method))throw new Error('Unsupported game action.');return this.send({claimDraw:'Claim draw',resign:'Resign',claimTimeout:'Claim turn timeout'}[method],this.vault(this.signer),method,[gameId],{gameId});}
  async accept(receipt){
    const p=this.pending;if(!p||!receipt)throw new Error('No saved transaction can be reconciled.');if(p.hash&&!same(p.hash,receipt.hash))throw new Error('Receipt differs from the saved transaction.');const tx=await this.provider.getTransaction(receipt.hash);
    if(!tx||!same(tx.from,p.wallet)||!same(tx.to,p.target)||!same(tx.data,p.data)||tx.nonce!==p.nonce||!same(receipt.from,p.wallet)||!same(receipt.to,p.target))throw new Error('Receipt and original transaction do not match the saved action.');if(Number(receipt.status)===0){this.persist(null);throw new Error('The transaction reverted. Gas may have been spent.');}if(Number(receipt.status)!==1||await receipt.confirmations()<1)throw new Error('The transaction is not confirmed.');
    const approval=p.kind.includes('allowance')||p.kind.startsWith('Approve');const iface=new Interface(approval?tokenABI:this.artifact.abi);const logs=receipt.logs.filter(l=>same(l.address,p.target)).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).filter(Boolean);let admitted=null;
    if(approval){const found=logs.filter(l=>l.name==='Approval');if(found.length!==1||!same(found[0].args.owner,p.wallet)||!same(found[0].args.spender,this.config.vaultAddress)||found[0].args.value!==BigInt(p.expected.amount))throw new Error('Approval receipt differs from the exact requested allowance.');if(await this.token().allowance(p.wallet,this.config.vaultAddress)!==BigInt(p.expected.amount))throw new Error('Current allowance differs from the confirmed approval.');}
    else if(p.kind==='Enter challenge'){const g=await this.vault().getGame(p.expected.gameId);if(!same(g.player,p.wallet)||g.nonce!==BigInt(p.expected.nonce)||Number(g.result)!==0||Number(g.ply)!==0)throw new Error('Native game state does not match the confirmed entry.');admitted={gameId:p.expected.gameId,transactionHash:receipt.hash,wallet:p.wallet,nonce:p.expected.nonce};localStorage.setItem('gh0st-chess-hybrid-entry-v2',JSON.stringify(admitted));}
    else if(p.expected.encodedMove!==undefined){const found=logs.filter(l=>l.name==='MovePlayed'&&same(l.args.gameId,p.expected.gameId));if(found.length!==1||Number(found[0].args.ply)!==p.expected.ply||Number(found[0].args.encodedMove)!==p.expected.encodedMove)throw new Error('The confirmed move event differs from the saved action.');}
    else{const g=await this.vault().getGame(p.expected.gameId);if(!same(g.player,p.wallet)||Number(g.result)===0)throw new Error('The canonical game has not reached the requested terminal state.');}
    const settlements=logs.filter(l=>l.name==='GameSettled');for(const event of settlements){const a=event.args;if(!same(a.gameId,p.expected.gameId)||!same(a.player,p.wallet))throw new Error('Settlement does not belong to the original game wallet.');const expected=Number(a.result)===1?TOTAL_PRIZE:Number(a.result)===6?ENTRY_FEE:0n;if(a.paid!==expected)throw new Error('Native settlement amount differs from the fixed prize/refund.');if(a.paid>0n){const ti=new Interface(tokenABI);const transfers=receipt.logs.filter(l=>same(l.address,TOKEN_ADDRESS)).map(l=>{try{return ti.parseLog(l);}catch{return null;}}).filter(l=>l?.name==='Transfer'&&same(l.args.from,this.config.vaultAddress)&&same(l.args.to,p.wallet));if(transfers.length!==1||transfers[0].args.value!==expected)throw new Error('The canonical GH0ST payout transfer does not match settlement.');}localStorage.setItem('gh0st-chess-last-settlement-v2',JSON.stringify({gameId:a.gameId,wallet:p.wallet,result:Number(a.result),paid:String(a.paid),transactionHash:receipt.hash}));}
    this.persist(null);if(admitted)await this.onEntry(admitted);await this.verify();this.notice(`${p.kind} confirmed and receipt verified.`);return receipt;
  }
  async resolve(optionalHash){if(!this.pending)return;if(optionalHash&&!this.pending.hash){if(!/^0x[0-9a-f]{64}$/i.test(optionalHash))throw new Error('Enter the exact wallet transaction hash.');this.persist({...this.pending,hash:optionalHash});}if(!this.pending.hash)throw new Error('The wallet outcome is uncertain. Paste its transaction hash to reconcile it. Sending is blocked.');const receipt=await this.provider.getTransactionReceipt(this.pending.hash);if(!receipt)throw new Error('Receipt is unavailable or still pending. No transaction was re-sent.');return this.accept(receipt);}
}
