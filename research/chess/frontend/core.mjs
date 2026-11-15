import { getAddress, keccak256 } from 'ethers';
export const CHAIN_ID = 4663;
export const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const TOKEN_ADDRESS = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const TOKEN_RUNTIME_HASH = '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
export const ENTRY_FEE = 25_000n * 10n ** 18n;
export const TOTAL_PRIZE = 100_000n * 10n ** 18n;
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const hex = bytes => '0x' + Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
export function bytes(value,length=32) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${length*2}}$`).test(value)) throw new Error(`Expected an exact ${length}-byte hexadecimal value.`);
  return Uint8Array.from(value.slice(2).match(/../g), h => parseInt(h,16));
}
export function randomBytes() { return crypto.getRandomValues(new Uint8Array(32)); }
export async function principalHash(principal) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', principal.toUint8Array()))); }
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
  if(c.schemaVersion!==1||c.chainId!==CHAIN_ID||c.publicRpc!==PUBLIC_RPC||!same(c.tokenAddress,TOKEN_ADDRESS)||c.icHost!=='https://icp-api.io') throw new Error('The release configuration does not use the canonical chain, token, or ICP endpoint.');
  if(c.status!=='live') throw new Error('Paid entries are closed. This release has no verified deployment.');
  for(const key of ['authorityModuleHash','engineModuleHash','nnueSha256']) if(!/^[0-9a-f]{64}$/i.test(c[key]||''))throw new Error(`Release ${key} is missing.`);
  for(const key of ['engineConfigHash','vaultRuntimeHash','vaultDeploymentTransaction'])bytes(c[key]);
  for(const key of ['vaultAddress','poolOwner','attestorAddress'])getAddress(c[key]);
  for(const key of ['authorityCanisterId','engineCanisterId','engineCommit'])if(!c[key])throw new Error(`Release ${key} is missing.`);
  for(const key of ['authorityControllers','engineControllers'])if(!Array.isArray(c[key])||c[key].some(x=>typeof x!=='string'))throw new Error('The reviewed canister controller sets are missing.');
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
