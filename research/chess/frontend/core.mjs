import { getAddress, keccak256 } from 'ethers';
export const CHAIN_ID = 4663;
export const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const TOKEN_ADDRESS = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const TOKEN_RUNTIME_HASH = '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
export const ENTRY_FEE = 25_000n * 10n ** 18n;
export const TOTAL_PRIZE = 1_000_000n * 10n ** 18n;
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const hex = bytes => '0x' + Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
export function bytes(value,length=32) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${length*2}}$`).test(value)) throw new Error(`Expected an exact ${length}-byte hexadecimal value.`);
  return Uint8Array.from(value.slice(2).match(/../g), h => parseInt(h,16));
}
export function randomBytes() { return crypto.getRandomValues(new Uint8Array(32)); }
export const variant = value => value ? Object.keys(value)[0] : null;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const shorten = (value, n=7) => value ? `${String(value).slice(0,n)}…${String(value).slice(-5)}` : 'Not configured';
export function fenBoard(fen) {
  const rows = String(fen).split(' ')[0].split('/');
  if(rows.length!==8) throw new Error('The authority returned an invalid board.');
  return rows.flatMap((row,r) => {
    const cells=[];
    for(const c of row) {
      if(/[1-8]/.test(c)) cells.push(...Array(Number(c)).fill(null));
      else if(/[prnbqkPRNBQK]/.test(c)) cells.push(c);
      else throw new Error('The authority returned an invalid piece.');
    }
    if(cells.length!==8)throw new Error('The authority returned an invalid rank.');
    return cells.map((piece,f) => ({square:'abcdefgh'[f]+(8-r),piece,row:r,file:f}));
  });
}
export function validateConfig(c) {
  if(c.schemaVersion!==2||c.chainId!==CHAIN_ID||c.publicRpc!==PUBLIC_RPC||!same(c.tokenAddress,TOKEN_ADDRESS)||c.icHost!=='https://icp-api.io') throw new Error('The release configuration does not use the canonical chain, token, or ICP endpoint.');
  if(c.status!=='live') throw new Error('Paid entries are closed. This release has no verified deployment.');
  for(const key of ['authorityModuleHash','engineModuleHash','relayModuleHash','nnueSha256']) if(!/^[0-9a-f]{64}$/i.test(c[key]||''))throw new Error(`Release ${key} is missing.`);
  for(const key of ['engineConfigHash','vaultRuntimeHash','vaultDeploymentTransaction'])bytes(c[key]);
  for(const key of ['vaultAddress','poolOwner','attestorAddress','relayAddress'])getAddress(c[key]);
  for(const key of ['authorityCanisterId','engineCanisterId','relayCanisterId','engineCommit'])if(!c[key])throw new Error(`Release ${key} is missing.`);
  for(const key of ['authorityControllers','engineControllers','relayControllers'])if(!Array.isArray(c[key])||c[key].some(x=>typeof x!=='string'))throw new Error('The reviewed canister controller sets are missing.');
  if(c.nodes!==24_000_000||c.hashMb!==128||c.cachePolicy!=='retained-per-game')throw new Error('The improved retained 24m-node policy is required.');
  if(!Number.isSafeInteger(c.nodes)||c.nodes<=0||!Number.isSafeInteger(c.hashMb)||c.hashMb<=0||!/^\d+$/.test(String(c.cyclesPerSearch))||BigInt(c.cyclesPerSearch)<=0n||!c.releaseEvidence)throw new Error('The pinned search budget and reviewed release evidence are missing.');
  return true;
}
export function matchRuntime(actual, artifact) {
  let a=actual.replace(/^0x/,''), b=artifact.deployedBytecode.replace(/^0x/,'');
  if(a.length!==b.length||!artifact.immutableReferences)throw new Error('Vault runtime does not match the reviewed compiler artifact.');
  for(const refs of Object.values(artifact.immutableReferences)){
    let first;
    for(const {start,length} of refs){
      if(length!==32||start<0||(start+length)*2>a.length)throw new Error('Invalid compiler immutable reference.');
      const value=a.slice(start*2,(start+length)*2);if(first!==undefined&&first!==value)throw new Error('Vault immutable values are inconsistent.');first=value;
    }
    for(const {start,length} of refs){const from=start*2,to=(start+length)*2;a=a.slice(0,from)+'0'.repeat(length*2)+a.slice(to);b=b.slice(0,from)+'0'.repeat(length*2)+b.slice(to);}
  }
  if(!same(a,b))throw new Error('Vault runtime differs from the reviewed source.');
  return keccak256(actual);
}
export function readableError(e) {
  if(e?.code===4001||e?.code==='ACTION_REJECTED')return 'Request declined. No further action was sent.';
  if(e?.code==='TRANSACTION_REPLACED')return 'Transaction replaced. Reconcile the saved transaction before continuing.';
  return String(e?.shortMessage||e?.reason||e?.message||e).slice(0,280);
}

const pieceByNibble={1:'P',2:'N',3:'B',4:'R',5:'Q',6:'K',9:'p',10:'n',11:'b',12:'r',13:'q',14:'k'};
export function boardFen(game){
  const packed=BigInt(game.board);const ranks=[];
  for(let rank=7;rank>=0;rank--){let out='',empty=0;for(let file=0;file<8;file++){const n=Number((packed>>BigInt((rank*8+file)*4))&15n);if(!n){empty++;continue;}if(!pieceByNibble[n])throw new Error('Invalid canonical board piece.');if(empty){out+=empty;empty=0;}out+=pieceByNibble[n];}if(empty)out+=empty;ranks.push(out);}
  const flags=Number(game.castling);const rights=[flags&1?'K':'',flags&2?'Q':'',flags&4?'k':'',flags&8?'q':''].join('')||'-';
  const ep=Number(game.enPassant);const square=ep<64?'abcdefgh'[ep%8]+(Math.floor(ep/8)+1):'-';
  return `${ranks.join('/')} ${game.blackToMove?'b':'w'} ${rights} ${square} ${game.halfmoveClock} ${Math.floor(Number(game.ply)/2)+1}`;
}
export function encodeMove(uci){
  if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error('Choose a valid UCI move.');
  const sq=s=>s.charCodeAt(0)-97+(Number(s[1])-1)*8;const promo={n:2,b:3,r:4,q:5};
  return (sq(uci.slice(0,2))<<6)|sq(uci.slice(2,4))|((promo[uci[4]]||0)<<12);
}
export function decodeMove(value){
  const n=Number(value);if(!Number.isInteger(n)||n<0||n>65535)throw new Error('Invalid canonical encoded move.');
  const sq=i=>'abcdefgh'[i%8]+(Math.floor(i/8)+1);const p=n>>12;if(p&&!{2:'n',3:'b',4:'r',5:'q'}[p])throw new Error('Invalid canonical promotion.');
  return sq((n>>6)&63)+sq(n&63)+({2:'n',3:'b',4:'r',5:'q'}[p]||'');
}
export const BOT_MOVE_TYPES={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
export function botMoveDomain(config){return{name:'GH0ST Hybrid Chess',version:'1',chainId:CHAIN_ID,verifyingContract:config.vaultAddress};}
