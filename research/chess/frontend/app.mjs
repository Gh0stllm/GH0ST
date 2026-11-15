import { Chess } from 'chess.js';
import { ChessService } from './service.mjs';
import { ChessWallet } from './wallet.mjs';
import { INITIAL_FEN,ENTRY_FEE,TOTAL_PRIZE,fenBoard,variant,hex,bytes,same,shorten,escapeHTML,readableError } from './core.mjs';

const $=id=>document.getElementById(id);
const state={config:null,service:null,wallet:null,game:null,gameId:null,legal:[],selected:null,flipped:false,demo:null,busy:false,signedResult:null,material:null,releaseError:null};
const pieceNames={p:'pawn',r:'rook',n:'knight',b:'bishop',q:'queen',k:'king'};
const piecePaths={
  p:'<circle cx="24" cy="12" r="6"/><path d="M20 19h8l2 12 5 6H13l5-6Z"/>',
  r:'<path d="M13 7h6v6h4V7h4v6h4V7h6v13l-5 4v10l4 4H12l4-4V24l-3-4Z"/><path d="M17 21h14" fill="none"/>',
  b:'<path d="M24 5C17 11 15 15 17 20l4 4-3 10-5 4h22l-5-4-3-10 4-4c2-5 0-9-7-15Z"/><path d="m27 11-6 8" fill="none"/>',
  n:'<path d="m17 7 4 4 8-3 5 7 1 13-5 8H13l4-9 10-6-7-2-4 6-7-4 5-8Z"/><path d="m20 11 1 6m7-4h1" fill="none"/>',
  q:'<path d="m11 14 7 7 6-12 6 12 7-7-5 20 4 4H12l4-4Z"/><circle cx="10" cy="11" r="2.5"/><circle cx="24" cy="6" r="2.5"/><circle cx="38" cy="11" r="2.5"/><path d="M17 29h14" fill="none"/>',
  k:'<path d="M24 4v10m-5-5h10" fill="none"/><path d="M24 14c-8-6-15 1-11 8l6 5-2 7-5 4h24l-5-4-2-7 6-5c4-7-3-14-11-8Z"/><path d="M19 28h10" fill="none"/>',
};
function pieceSVG(piece){return `<svg class="piece ${piece===piece.toUpperCase()?'white':'black'}" viewBox="0 0 48 48" aria-hidden="true"><g fill="var(--piece)" stroke="var(--edge)" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${piecePaths[piece.toLowerCase()]}<path d="M12 39h24v4H12z"/></g></svg>`;}
const notice=message=>{$('notice').textContent=message;};
const money=n=>Number(n/10n**18n).toLocaleString('en-US');
const gameFen=()=>state.demo?.fen()||state.game?.fen||INITIAL_FEN;
const myGame=()=>state.game&&state.service?.signedIn()&&state.game.entry.player_principal.toText()===state.service.principal.toText()&&same(hex(state.game.entry.player),state.wallet?.wallet);
const canMove=()=>!state.busy&&(state.demo?!state.demo.isGameOver():myGame()&&state.service.verified&&variant(state.game.phase)==='WaitingHuman'&&!state.service.pendingMove);
function legalMoves(){return state.demo?state.demo.moves({verbose:true}).map(m=>m.from+m.to+(m.promotion||'')):state.legal;}
function renderBoard(){
  let board=fenBoard(gameFen());if(state.flipped)board=board.reverse();const legal=legalMoves();const latest=state.demo?.history({verbose:true}).at(-1);const last=latest?latest.from+latest.to:state.game?.moves.at(-1)?.uci;
  const side=gameFen().split(' ')[1];
  $('board').innerHTML=board.map((cell,index)=>{
    const {square,piece,row,file}=cell;const movable=canMove()&&piece&&(side==='w'?piece===piece.toUpperCase():piece===piece.toLowerCase());
    const target=state.selected&&legal.some(m=>m.slice(0,2)===state.selected&&m.slice(2,4)===square);
    const classes=['square',(row+file)%2?'dark':'',square===state.selected?'selected':'',target?'legal':'',last&&(last.slice(0,2)===square||last.slice(2,4)===square)?'last-move':''].filter(Boolean).join(' ');
    const label=piece?`${piece===piece.toUpperCase()?'White':'Black'} ${pieceNames[piece.toLowerCase()]}`:'Empty';
    return `<button type="button" class="${classes}" role="gridcell" aria-label="${square}, ${label}${target?', legal destination':''}${square===state.selected?', selected':''}" aria-selected="${square===state.selected}" data-square="${square}" tabindex="${state.selected===square||(!state.selected&&index===56)?0:-1}">${piece?pieceSVG(piece):''}${index%8===0?`<span class="rank">${square[1]}</span>`:''}${index>=56?`<span class="file">${square[0]}</span>`:''}</button>`;
  }).join('');
}
function renderMoves(){
  let moves;
  if(state.demo)moves=state.demo.history();else if(state.game){const ref=new Chess();moves=state.game.moves.map(m=>{try{return ref.move(m.uci).san;}catch{return m.uci;}});}else moves=[];
  $('move-count').textContent=`${moves.length} PLY`;
  $('move-history').innerHTML=moves.length?Array.from({length:Math.ceil(moves.length/2)},(_,i)=>`<div class="move-row"><span>${i+1}.</span><span>${escapeHTML(moves[i*2])}</span><span>${escapeHTML(moves[i*2+1]||'')}</span></div>`).join(''):'<div class="empty-moves"><span>01.</span><p>The board is quiet.<br>Your first move starts the story.</p></div>';
  $('move-history').scrollTop=$('move-history').scrollHeight;
}
function renderReceipt(){
  const g=state.game;const receipt=[...(g?.moves||[])].reverse().find(m=>m.engine.length)?.engine[0];const c=state.config;
  $('receipt-engine').textContent=receipt?.engine_commit||c?.engineCommit||'Not configured';
  $('receipt-net').textContent=receipt?.nnue_sha256||c?.nnueSha256||'Not configured';
  $('receipt-nodes').textContent=receipt?`${receipt.actual_nodes.toLocaleString()} / ${receipt.requested_nodes.toLocaleString()}`:`— / ${c?.nodes?.toLocaleString()||'—'}`;
  $('receipt-depth').textContent=receipt?String(receipt.depth):'—';$('receipt-instructions').textContent=receipt?receipt.instructions.toLocaleString():'—';
  $('receipt-stop').textContent=receipt?.stop_reason||'—';
  $('receipt-transcript').textContent=g?hex(g.transcript_hash):'No game';$('receipt-tag').textContent=receipt?'ICP search receipt':'No search yet';
  $('download-proof').disabled=!g;
}
function render(){
  const s=state.service,w=state.wallet,g=state.game;if(!s||!w)return;
  const ready=s.verified&&w.verified&&s.status?.paid_entries_enabled&&!w.paused&&w.solvent&&w.freePool>=TOTAL_PRIZE;
  const authenticated=s.signedIn();const noPending=!w.pending&&!s.pendingMove;
  $('release-label').textContent=ready?'VERIFIED RELEASE':'RELEASE STAGING';$('stage-tag').textContent=state.demo?'Local rules board':ready?'Paid entries open':'Paid entries closed';
  $('sign-in').textContent=authenticated?'Sign out':'Sign in ↗';$('identity-status').textContent=authenticated?shorten(s.principal.toText(),11):'Internet Identity binds your game.';
  $('connect-wallet').innerHTML=w.wallet?`${escapeHTML(shorten(w.wallet))} <span>✓</span>`:'Connect wallet <span>↗</span>';
  $('wallet-status').textContent=w.wallet?`${shorten(w.wallet,9)} · 4663`:'Robinhood Chain · 4663';$('wallet-check').textContent=w.wallet?'✓':'○';
  $('available-pool').textContent=w.verified?`${money(w.freePool)} GH0ST`:'—';$('reserved-pool').textContent=w.verified?`${money(w.totalReserved)} GH0ST`:'—';
  $('pool-status').textContent=w.verified?(w.paused?'Entries paused':w.freePool>=TOTAL_PRIZE?'Full prize available before entry':'Insufficient free prize pool'):'Prize pool not configured';$('pool-signal').style.background=ready?'var(--amber)':'';
  $('approve-entry').textContent=w.allowance>0n&&w.allowance!==ENTRY_FEE?'Reset existing allowance to zero ↗':w.allowance===ENTRY_FEE?'Exactly 25,000 GH0ST approved ✓':'Approve exactly 25,000 GH0ST ↗';
  const activeEntry=!!g||!!state.gameId;
  $('approve-entry').disabled=state.busy||!ready||!authenticated||!w.wallet||!noPending||w.allowance===ENTRY_FEE||activeEntry||!!state.demo;
  $('enter-game').disabled=state.busy||!ready||!authenticated||!w.wallet||!noPending||w.allowance!==ENTRY_FEE||w.balance<ENTRY_FEE||activeEntry||!!state.demo;
  $('entry-help').textContent=ready?(activeEntry?'An entry is already loaded. Complete or reconcile this game before entering another.':'Approval and entry are separate actions. Exactly 25,000 GH0ST is charged on entry, plus network gas. The full 100,000 GH0ST prize is reserved first.'):'Paid entry is disabled. Approval and entry will require separate clicks after the deployment, engine, and full prize reserve are verified.';
  $('local-demo').classList.toggle('hidden',!!state.demo||!!g);$('exit-demo').classList.toggle('hidden',!state.demo);$('reset-demo').classList.toggle('hidden',!state.demo);$('demo-note').classList.toggle('hidden',!state.demo);
  const phase=g?variant(g.phase):null;const liveHuman=myGame()&&s.verified;
  $('resign').classList.toggle('hidden',!liveHuman||phase==='Terminal');$('claim-draw').classList.toggle('hidden',!liveHuman||phase!=='WaitingHuman');$('resume-engine').classList.toggle('hidden',!liveHuman||phase!=='WaitingBot');
  for(const id of ['resign','claim-draw','resume-engine','sign-in','connect-wallet','verify-release','load-game','local-demo','exit-demo','reset-demo'])$(id).disabled=state.busy;
  $('opponent-name').textContent=state.demo?'Local Black':'GH0ST';$('opponent-detail').textContent=state.demo?'You control both sides · no engine':'Stockfish 19 · calibration pending';
  $('human-name').textContent=state.demo?'Local White':'You';$('human-detail').textContent=state.demo?'Practice chess rules on this device':'White · the first move is yours';
  $('engine-clock').innerHTML=state.demo?'LOCAL ONLY':phase==='WaitingBot'?'<span class="signal"></span> SEARCH PENDING':g?'<span class="signal"></span> ICP AUTHORITY':'<span class="signal muted-signal"></span> OFFLINE';
  $('board-state').textContent=state.demo?(state.demo.isGameOver()?'Local demonstration ended':`Local rules board · ${state.demo.turn()==='w'?'White':'Black'} to move`):g?(phase==='WaitingHuman'?'Authoritative position · your move':phase==='WaitingBot'?'Human move committed · awaiting ICP search':'Terminal result recorded'):'Board preview · no game in progress';
  $('turn-status').textContent=state.demo?'Local only · no fees or prize':g?(phase==='WaitingHuman'?'White to move':phase==='WaitingBot'?'Black search pending':'Game ended'):'Awaiting a verified game';
  const terminal=g?.terminal[0];$('terminal-banner').classList.toggle('hidden',!terminal);if(terminal){const result=variant(terminal.result);$('terminal-banner').textContent=result==='HumanCheckmate'?'Human checkmate recorded. Total settlement: 100,000 GH0ST. Payout is complete only after a verified Robinhood settlement receipt.':result==='ServiceFault'||result==='EngineAbort'?'Service fault recorded. Your 25,000 GH0ST entry is refundable through settlement.':`${result.replace(/([a-z])([A-Z])/g,'$1 $2')} recorded. No prize payout; the entry fee is retained.`;}
  $('settlement').classList.toggle('hidden',!terminal);$('settle-result').disabled=state.busy||!state.signedResult||!state.material||!w.wallet||!noPending;
  const pending=w.pending||s.pendingMove;$('recovery').classList.toggle('hidden',!pending);$('pending-text').textContent=w.pending?`${w.pending.kind}: ${w.pending.hash||'wallet outcome uncertain'}. New transactions are blocked.`:'A saved human move is unresolved. No automatic resend will occur.';$('pending-hash').classList.toggle('hidden',!w.pending||!!w.pending.hash);
  $('readiness-tag').textContent=ready?'Verified':'Unconfigured';$('readiness-list').innerHTML=(ready?['Certified ICP module identities verified.','Pinned engine configuration verified.','Canonical GH0ST and original vault constructor verified.','Full prize reserve available.']:state.releaseError?[state.releaseError,...(state.config.blockers||[])]:state.config.blockers).map(x=>`<li>${escapeHTML(x)}</li>`).join('');
  renderBoard();renderMoves();renderReceipt();renderClock();
}
function renderClock(){const deadline=state.game?.entry.game_deadline;if(!deadline){$('game-clock').innerHTML=state.demo?'LOCAL <small>no deadline</small>':'24h <small>game window</small>';return;}const seconds=Math.max(0,Number(deadline)-Math.floor(Date.now()/1000));$('game-clock').textContent=`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
async function run(work){if(state.busy)return;state.busy=true;render();try{return await work();}catch(e){notice(readableError(e));}finally{state.busy=false;render();}}
async function verifyRelease(){
  state.releaseError=null;try{await state.service.verify();await state.wallet.verify();notice('Release identities and vault terms verified. Check the available prize pool before entry.');}catch(e){state.releaseError=readableError(e);state.service.verified=false;state.wallet.verified=false;notice(state.releaseError);}render();
}
async function refreshGame(){
  if(!state.gameId){notice('No live game is loaded. Paid entry is currently disabled.');return;}
  const game=await state.service.game(state.gameId);if(!game){notice('Entry is saved, but the canonical entry verifier has not admitted the game yet. No second entry fee will be sent.');return;}
  const c=state.config,e=game.entry;
  if(!same(hex(e.game_id),state.gameId)||!same(hex(e.vault),c.vaultAddress)||Number(e.chain_id)!==4663||!same(hex(e.engine_config_hash),c.engineConfigHash))throw new Error('The authority game is bound to a different vault, chain, game ID, or engine configuration.');
  if(e.player_principal.toText()===state.service.principal?.toText()&&!same(hex(e.principal_hash),await state.service.hash()))throw new Error('The authority game principal hash does not match your signed-in identity.');
  const ledger=await state.wallet.vault().games(state.gameId);
  if(!same(ledger.player,hex(e.player))||!same(ledger.principalHash,hex(e.principal_hash))||ledger.nonce!==BigInt(hex(e.nonce)))throw new Error('The canonical vault entry does not match the authority game.');
  state.game=game;state.selected=null;state.legal=variant(game.phase)==='WaitingHuman'?await state.service.legalMoves(state.gameId):[];
  if(game.terminal.length)state.material=await state.service.resultMaterial(state.gameId);
  render();
}
async function askDialog(id){const dialog=$(id);return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true});dialog.showModal();});}
async function selectSquare(square){
  if(!canMove()){notice(state.demo?'The local rules demonstration has ended. Reset the board to continue.':state.game?'Wait for the authoritative position and sign in with the original identity and payout wallet.':'This is a board preview. Paid play remains closed; the local rules board is available below.');return;}
  const legal=legalMoves();const candidate=state.selected?legal.filter(m=>m.slice(0,2)===state.selected&&m.slice(2,4)===square):[];
  if(candidate.length){
    let uci=candidate[0];if(candidate.some(m=>m.length===5)){const promote=await askDialog('promotion-dialog');if(!['q','r','b','n'].includes(promote))return;uci=candidate.find(m=>m.endsWith(promote));}
    if(state.demo){state.demo.move(uci);state.selected=null;render();return;}
    await run(async()=>{state.game=await state.service.submit(state.gameId,state.game,uci);state.selected=null;await refreshGame();if(variant(state.game.phase)==='WaitingBot'){notice('Your move is committed on ICP. Starting the fixed-budget engine search.');state.game=await state.service.action('run_bot',state.gameId);await refreshGame();}notice('Authoritative game updated.');});return;
  }
  state.selected=state.selected===square?null:legal.some(m=>m.slice(0,2)===square)?square:null;renderBoard();
}
function download(filename,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?hex(v):v,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function init(){
  const [config,artifactPackage]=await Promise.all([fetch('./public-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Release configuration unavailable.');return r.json();}),fetch('./vault-artifact.json').then(r=>{if(!r.ok)throw new Error('Vault artifact unavailable.');return r.json();})]);
  state.config=config;state.service=new ChessService(config,{changed:()=>render()});state.wallet=new ChessWallet(config,artifactPackage.contracts.RHChessChallengeVault,{notice,changed:()=>render(),verifyAuthority:()=>state.service.verify(),onEntry:async entry=>{state.gameId=entry.gameId;$('game-id').value=entry.gameId;notice('Entry receipt verified. Awaiting canonical entry admission; no second entry fee will be sent.');await refreshGame();}});
  try{const saved=JSON.parse(localStorage.getItem('gh0st-chess-entry-v1'));if(saved?.gameId){bytes(saved.gameId);state.gameId=saved.gameId;$('game-id').value=saved.gameId;}}catch{}
  $('connect-wallet').onclick=()=>run(async()=>{await state.wallet.connect();notice('Wallet connected to Robinhood Chain. No token approval or entry fee has been sent.');});
  $('sign-in').onclick=()=>run(async()=>{if(state.service.signedIn())await state.service.signOut();else await state.service.signIn();notice(state.service.signedIn()?'Internet Identity connected. Your payout wallet is bound only when you explicitly enter.':'Signed out.');});
  $('verify-release').onclick=()=>run(verifyRelease);
  $('approve-entry').onclick=()=>run(async()=>{await state.service.verify();await state.wallet.approveExact();});
  $('enter-game').onclick=()=>run(async()=>{await state.service.verify();await state.wallet.enter(await state.service.hash());});
  $('load-game').onclick=()=>run(async()=>{bytes($('game-id').value.trim());state.gameId=$('game-id').value.trim();state.demo=null;await verifyRelease();if(!state.service.verified)throw new Error('Cannot load a live game before the release is verified.');await refreshGame();});
  $('refresh-game').onclick=()=>run(refreshGame);
  $('resolve-pending').onclick=()=>run(async()=>{if(state.wallet.pending)await state.wallet.resolve($('pending-hash').value.trim());else{const savedGameId=state.service.pendingMove?.gameId;const game=await state.service.reconcileMove();if(game){state.game=game;state.gameId=savedGameId||state.gameId;await refreshGame();}}});
  $('local-demo').onclick=()=>{state.demo=new Chess();state.selected=null;notice('LOCAL RULES BOARD: play both sides on this device. No engine, onchain execution, entry fee, or prize.');render();};
  $('exit-demo').onclick=()=>{state.demo=null;state.selected=null;notice('Returned to the staged challenge. Paid entries remain closed.');render();};
  $('reset-demo').onclick=()=>{state.demo?.reset();state.selected=null;render();};$('flip-board').onclick=()=>{state.flipped=!state.flipped;renderBoard();};
  $('board').addEventListener('click',event=>{const square=event.target.closest('[data-square]');if(square)selectSquare(square.dataset.square);});
  $('board').addEventListener('keydown',event=>{const target=event.target.closest('[data-square]');if(!target)return;const all=[...$('board').querySelectorAll('[data-square]')];const index=all.indexOf(target);const step={ArrowRight:1,ArrowLeft:-1,ArrowUp:-8,ArrowDown:8}[event.key];if(step){event.preventDefault();all[Math.max(0,Math.min(63,index+step))].focus();}});
  $('resume-engine').onclick=()=>run(async()=>{await refreshGame();if(variant(state.game?.phase)!=='WaitingBot')return;state.game=await state.service.action('run_bot',state.gameId);await refreshGame();});
  $('claim-draw').onclick=()=>run(async()=>{state.game=await state.service.action('claim_draw',state.gameId);await refreshGame();});
  $('resign').onclick=async()=>{if(await askDialog('resign-dialog')==='resign')run(async()=>{state.game=await state.service.action('resign',state.gameId);await refreshGame();});};
  $('download-proof').onclick=()=>download(`gh0st-chess-${state.gameId?.slice(2,10)||'game'}.json`,{format:'GH0ST_CHESS_GAME_RECEIPT_V1',gameId:state.gameId,source:'ICP authority response; a download is not a payout receipt',release:state.config,game:state.game,resultMaterial:state.material});
  $('settlement-file').onchange=()=>run(async()=>{const file=$('settlement-file').files[0];if(!file)return;if(file.size>32768)throw new Error('Signed result is too large.');state.signedResult=JSON.parse(await file.text());notice('Signed result loaded. Submission remains a separate wallet action.');});
  $('settle-result').onclick=()=>run(async()=>{await state.wallet.settle(state.signedResult,state.material);await refreshGame();});$('refund-entry').onclick=()=>run(()=>state.wallet.refund(state.gameId));
  render();try{await state.service.restore();}catch{notice('Internet Identity session storage is unavailable. The rules board still works; paid actions remain disabled.');}render();setInterval(renderClock,1000);
  // Unconfigured staging performs no release network calls and never starts an engine.
  if(config.status==='live')await run(verifyRelease);
}
init().catch(error=>{notice(`Challenge unavailable: ${readableError(error)} All paid actions remain disabled.`);$('readiness-list').innerHTML='<li>Release data could not be loaded. Paid actions are disabled.</li>';});
