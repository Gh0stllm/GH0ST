import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {Principal} from '@icp-sdk/core/principal';
import {IDL} from '@icp-sdk/core/candid';
import {Interface,keccak256} from 'ethers';
import {validateConfig,fenBoard,INITIAL_FEN,principalHash,bytes,hex,matchRuntime,ENTRY_FEE,TOTAL_PRIZE,TOKEN_ADDRESS} from './core.mjs';
import {ChessService,idlFactory} from './service.mjs';
import {ChessWallet} from './wallet.mjs';
const config=JSON.parse(readFileSync(new URL('./public-config.json',import.meta.url)));
const artifact=JSON.parse(readFileSync(new URL('../evm/artifacts.json',import.meta.url))).contracts.RHChessChallengeVault;
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
globalThis.localStorage={map:new Map(),getItem(k){return this.map.get(k)||null;},setItem(k,v){this.map.set(k,String(v));},removeItem(k){this.map.delete(k);}};
const player='0x1111111111111111111111111111111111111111',vault='0x2222222222222222222222222222222222222222';
const hash='0x'+'ab'.repeat(32),principal='0x'+'cd'.repeat(32),gameId='0x'+'ef'.repeat(32);
function wallet(options={}){return new ChessWallet({...config,vaultAddress:vault},artifact,options);}
test('staged configuration rejects paid readiness before any external read',async()=>{
  assert.throws(()=>validateConfig(config),/Paid entries are closed/);
  const s=new ChessService(config);await assert.rejects(()=>s.verify(),/Paid entries are closed/);assert.equal(s.verified,false);
});
test('canonical chain, token and endpoint cannot be replaced by public configuration',()=>{
  for(const change of [{chainId:1},{publicRpc:'https://example.com'},{tokenAddress:vault},{icHost:'http://localhost:4943'}])assert.throws(()=>validateConfig({...config,...change}),/canonical/);
});
test('principal binding hashes the raw principal bytes, not displayed text',async()=>{
  const p=Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');const expected='0x'+createHash('sha256').update(p.toUint8Array()).digest('hex');assert.equal(await principalHash(p),expected);assert.notEqual(expected,'0x'+createHash('sha256').update(p.toText()).digest('hex'));
});
test('board FEN parser yields exactly 64 squares and rejects malformed positions',()=>{
  const board=fenBoard(INITIAL_FEN);assert.equal(board.length,64);assert.equal(board[0].square,'a8');assert.equal(board[60].piece,'K');assert.equal(board[63].square,'h1');assert.throws(()=>fenBoard('8/8/8/8/8/8/8/9 w - - 0 1'));assert.throws(()=>bytes('0x1234'));
});
test('Candid service carries current position hash, instruction receipt, bounded move request',()=>{
  const service=idlFactory({IDL});const methods=Object.fromEntries(service._fields);assert.ok(methods.submit_move);assert.ok(methods.run_bot);assert.ok(methods.get_game);assert.ok(!methods.search);assert.ok(!methods.accept_entry);
  const text=methods.get_game.retTypes[0].display();assert.match(text,/position_hash/);assert.match(text,/instructions/);assert.match(text,/requested_nodes/);assert.match(text,/stop_reason/);
  const input=methods.submit_move.argTypes[0].display();assert.match(input,/expected_position_hash/);assert.match(input,/request_id/);assert.doesNotMatch(input,/fen/);
});
test('reviewed runtime accepts immutables only and rejects instruction corruption',()=>{
  const expected=artifact.deployedBytecode;assert.equal(matchRuntime(expected,artifact),keccak256(expected));
  const corrupted='0x'+(expected[2]==='0'?'1':'0')+expected.slice(3);assert.throws(()=>matchRuntime(corrupted,artifact),/runtime differs/);
  assert.throws(()=>matchRuntime(expected+'00',artifact),/runtime does not match/);
});
test('direct approval and entry require a fresh authority verification gate',async()=>{
  const w=wallet();await assert.rejects(()=>w.approveExact(),/verification gate/);await assert.rejects(()=>w.enter(principal),/verification gate/);assert.equal(w.pending,null);
  let checks=0;const guarded=wallet({verifyAuthority:async()=>{checks++;throw new Error('canonical entry verifier unavailable');}});
  await assert.rejects(()=>guarded.approveExact(),/canonical entry verifier/);await assert.rejects(()=>guarded.enter(principal),/canonical entry verifier/);assert.equal(checks,2);assert.equal(guarded.pending,null);
});
test('full prize must be free before approval; entry fee cannot fund its own prize',async()=>{
  const w=wallet({verifyAuthority:async()=>{}});w.assertWallet=async()=>{};w.balance=ENTRY_FEE;w.solvent=true;w.paused=false;w.freePool=TOTAL_PRIZE-1n;
  await assert.rejects(()=>w.assertEntry(),/100,000 unreserved/);w.freePool=TOTAL_PRIZE;await w.assertEntry();w.paused=true;await assert.rejects(()=>w.assertEntry(),/Entry is closed/);
});
test('ambiguous wallet send persists intent before broadcast and blocks new sends',async()=>{
  const w=wallet();w.wallet=player;w.provider={estimateGas:async()=>50000n};w.walletProvider={getTransactionCount:async()=>7};let sawPersisted=false;
  w.signer={sendTransaction:async()=>{sawPersisted=!!JSON.parse(localStorage.getItem('gh0st-chess-unresolved-transaction-v1'));throw new Error('transport lost after wallet submission');}};
  const method={populateTransaction:async()=>({to:vault,data:'0x1234'})};
  await assert.rejects(()=>w.send('Enter challenge',{enterGame:method},'enterGame',[],{}),/transport lost/);assert.equal(sawPersisted,true);assert.equal(w.pending.nonce,7);assert.equal(w.pending.hash,null);
  await assert.rejects(()=>w.assertWallet(),/Connect your Robinhood wallet|Resolve the saved transaction/);w.persist(null);
});
test('explicit wallet rejection clears unsent intent; network ambiguity does not',async()=>{
  const w=wallet();w.wallet=player;w.provider={estimateGas:async()=>50000n};w.walletProvider={getTransactionCount:async()=>7};w.signer={sendTransaction:async()=>{throw Object.assign(new Error('rejected'),{code:'ACTION_REJECTED'});}};
  await assert.rejects(()=>w.send('Approve 25,000 GH0ST',{approve:{populateTransaction:async()=>({to:TOKEN_ADDRESS,data:'0x1234'})}},'approve',[],{}));assert.equal(w.pending,null);
});
test('receipt reconciliation rejects mismatched original calldata before accepting events',async()=>{
  const w=wallet();w.pending={kind:'Enter challenge',wallet:player,target:vault,data:'0x1234',nonce:7,hash,expected:{gameId,principalHash:principal,nonce:'9',engineConfigHash:hash}};
  w.provider={getTransaction:async()=>({from:player,to:vault,data:'0x5678',nonce:7})};
  await assert.rejects(()=>w.accept({hash,from:player,to:vault,status:1,confirmations:async()=>1,logs:[]}),/original transaction/);assert.ok(w.pending);w.persist(null);
});
test('forged entry principal cannot be reconciled as the players paid entry',async()=>{
  const w=wallet();w.pending={kind:'Enter challenge',wallet:player,target:vault,data:'0x1234',nonce:7,hash,expected:{gameId,principalHash:principal,nonce:'9',engineConfigHash:hash}};
  w.provider={getTransaction:async()=>({from:player,to:vault,data:'0x1234',nonce:7})};
  const iface=new Interface(artifact.abi);const encoded=iface.encodeEventLog('EntryAccepted',[gameId,player,'0x'+'11'.repeat(32),9n,hash,1n,2n,3n]);
  await assert.rejects(()=>w.accept({hash,from:player,to:vault,status:1,confirmations:async()=>1,logs:[{address:vault,...encoded}]}),/Entry event differs/);assert.ok(w.pending);w.persist(null);
});
test('unresolved authority move is persisted and reconciled without automatic retry',async()=>{
  const s=new ChessService(config);s.principal=Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');let updates=0;
  s.authenticatedActor=async()=>({submit_move:async()=>{updates++;throw new Error('response lost');}});s.legalMoves=async()=>['e2e4'];
  const game={position_hash:bytes(hash),moves:[]};await assert.rejects(()=>s.submit(gameId,game,'e2e4'),/response lost/);assert.equal(updates,1);assert.ok(s.pendingMove);
  await assert.rejects(()=>s.submit(gameId,game,'e2e4'),/Reconcile/);assert.equal(updates,1);
  s.game=async()=>({requests:[]});await assert.rejects(()=>s.reconcileMove(),/unresolved/);assert.equal(updates,1);
  const request=bytes(s.pendingMove.requestId);s.game=async()=>({requests:[[request,bytes(hash)]]});await s.reconcileMove();assert.equal(s.pendingMove,null);assert.equal(updates,1);
});
test('definitive authority rejection clears only the rejected move intent',async()=>{
  const s=new ChessService(config);s.principal=Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');s.authenticatedActor=async()=>({submit_move:async()=>({Err:{StalePosition:null}})});s.legalMoves=async()=>['e2e4'];
  await assert.rejects(()=>s.submit(gameId,{position_hash:bytes(hash),moves:[]},'e2e4'),/StalePosition/);assert.equal(s.pendingMove,null);
});
test('settlement reconciliation requires exact amount and canonical token payout transfer',async()=>{
  const w=wallet();w.pending={kind:'Settle result',wallet:player,target:vault,data:'0x1234',nonce:7,hash,expected:{gameId,result:1,paid:String(TOTAL_PRIZE),finalPositionHash:principal,transcriptHash:hash}};
  w.provider={getTransaction:async()=>({from:player,to:vault,data:'0x1234',nonce:7})};const iface=new Interface(artifact.abi);
  const wrong=iface.encodeEventLog('GameSettled',[gameId,player,1,ENTRY_FEE,principal,hash,hash]);
  await assert.rejects(()=>w.accept({hash,from:player,to:vault,status:1,confirmations:async()=>1,logs:[{address:vault,...wrong}]}),/outcome, amount/);
  const exact=iface.encodeEventLog('GameSettled',[gameId,player,1,TOTAL_PRIZE,principal,hash,hash]);
  await assert.rejects(()=>w.accept({hash,from:player,to:vault,status:1,confirmations:async()=>1,logs:[{address:vault,...exact}]}),/canonical token payout/);assert.ok(w.pending);w.persist(null);
});
