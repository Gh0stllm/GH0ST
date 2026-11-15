import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { compileHybrid } from '../evm/compile-hybrid.mjs';
import { ethers, localChain, save } from '../evm/lib.mjs';
const a=compileHybrid(); const chain=await localChain();
const {provider,eip1193,signers,addresses}=chain; const [owner,player,relayer]=signers;
const signer=new ethers.Wallet('0x'+'11'.repeat(32));
const config=ethers.id('GH0ST Hybrid v1 retained Stockfish19 3m TEST CONFIG');
const FEE=25_000n*10n**18n,PRIZE=1_000_000n*10n**18n;
const checks=[],receipts=[]; let kiwipeteLeaves=0;
const types={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
const domain=target=>({name:'GH0ST Hybrid Chess',version:'1',chainId:31337,verifyingContract:target});
const sq=s=>(s.charCodeAt(0)-97)+8*(Number(s[1])-1);
const enc=m=>(sq(m.from)<<6)|sq(m.to)|(({n:2,b:3,r:4,q:5}[m.promotion]??0)<<12);
function position(chess){let b=0n;for(let i=0;i<64;i++){const p=chess.get(String.fromCharCode(97+i%8)+(1+Math.floor(i/8)));if(p)b|=BigInt({p:1,n:2,b:3,r:4,q:5,k:6}[p.type]+(p.color==='b'?8:0))<<BigInt(i*4);}
 const f=chess.fen({forceEnpassantSquare:true}).split(' ');const castling=[['K',1],['Q',2],['k',4],['q',8]].reduce((v,[c,n])=>v+(f[2].includes(c)?n:0),0);
 const last=chess.history({verbose:true}).at(-1); const rawEp=last?.piece==='p' && Math.abs(sq(last.to)-sq(last.from))===16 ? (sq(last.to)+sq(last.from))/2 : f[3]==='-'?64:sq(f[3]);
 return {board:b,castling,enPassant:rawEp,halfmoveClock:Number(f[4]),blackToMove:f[1]==='b'};
}
function plain(p){return {board:p.board,castling:Number(p.castling),enPassant:Number(p.enPassant),halfmoveClock:Number(p.halfmoveClock),blackToMove:p.blackToMove};}
async function tx(label,p){const t=await p;const r=await t.wait();assert.equal(r.status,1);receipts.push({label,hash:r.hash,gasUsed:r.gasUsed.toString(),block:r.blockNumber});return r;}
async function reject(label,fn){let e;try{const t=await fn();if(t?.wait)await t.wait();}catch(x){e=x;}assert.ok(e,label);checks.push(label);}
async function deploy(name,args=[]){const c=await new ethers.ContractFactory(a[name].abi,a[name].bytecode,owner).deploy(...args);await tx('deploy '+name,Promise.resolve(c.deploymentTransaction()));return c.waitForDeployment();}
let nonce=0;
async function enter(v){await tx('approve exact25k',token.connect(player).approve(v.target,FEE));const id=await v.gameIdFor(addresses[1],++nonce);await tx('entry reserve1m',v.connect(player).enterGame(nonce));return id;}
async function bot(v,id,move,overrides={}){const g=await v.getGame(id);const m={gameId:id,player:g.player,ply:g.ply,positionHash:g.positionHash,transcriptHash:g.transcriptHash,encodedMove:move,engineConfigHash:config,validUntil:g.turnDeadline,...overrides};return {m,sig:await signer.signTypedData(domain(v.target),types,m)};}
async function play(v,id,chess,uci){const m=chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});assert.ok(m);const encoded=enc(m);const before=await v.getGame(id);if(before.blackToMove){const b=await bot(v,id,encoded);await tx('signed legalBlack move',v.connect(relayer).playBotMove(b.m,b.sig,{gasLimit:29_000_000}));}else await tx('legalWhite move',v.connect(player).playHumanMove(id,encoded,{gasLimit:29_000_000}));const g=await v.getGame(id);assert.deepEqual(plain(g),position(chess));return g;}
let token;
try{
 const rules=await deploy('HybridChessRulesView');
 assert.deepEqual(plain(await rules.initial()),position(new Chess())); checks.push('orthodox initial board exact');
 const scenarios=[
 ['castle both','r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',['e1g1','e8c8']],
 ['en passant','4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',['e5d6']],
 ['rookcapture rights','r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',['a1a8']],
 ...['n','b','r','q'].map(p=>['White promotion '+p,'4k3/P7/8/8/8/8/8/4K3 w - - 0 1',['a7a8'+p]]),
 ...['n','b','r','q'].map(p=>['Black promotion '+p,'4k3/8/8/8/8/8/p7/4K3 b - - 0 1',['a2a1'+p]]),
 ];
 for(const[label,fen,moves]of scenarios){const c=new Chess(fen);for(const u of moves){const p=position(c),m=c.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});assert.deepEqual(plain(await rules.applyMove(p,enc(m))),position(c),label);}checks.push(label);}
 const illegal=[['castle throughcheck','4kr2/8/8/8/8/8/8/4K2R w K - 0 1','e1g1'],['enpassant discovered selfcheck','k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1','e5d6'],['kingcapture illegal','8/8/8/8/8/8/4k3/4K3 w - - 0 1','e1e2']];
 for(const[label,fen,u]of illegal){const c=new Chess(fen,{skipValidation:true});await reject(label,()=>rules.applyMove(position(c),(sq(u.slice(0,2))<<6)|sq(u.slice(2,4))));}
 let seed=48271;const random=n=>{seed=(seed*16807)%2147483647;return seed%n;};let differential=0, rejected=0;
 // Every move from 80 deterministic positions is checked, rather than testing only the chosen path.
 for(let game=0;game<4;game++){
  const c=new Chess();for(let ply=0;ply<20&&!c.isGameOver();ply++){
   const p=position(c);const legal=c.moves({verbose:true});
   const candidates=legal.map(m=>({m,child:(()=>{const x=new Chess(c.fen({forceEnpassantSquare:true}));x.move(m);return position(x);})()}));
   for(let off=0;off<candidates.length;off+=8)await Promise.all(candidates.slice(off,off+8).map(async({m,child})=>{assert.deepEqual(plain(await rules.applyMove(p,enc(m))),child);differential++;}));
   for(let t=0;t<3;t++){const from=random(64),to=random(64);const u=String.fromCharCode(97+from%8)+(1+Math.floor(from/8))+String.fromCharCode(97+to%8)+(1+Math.floor(to/8));if(!legal.some(m=>m.from+m.to===u)){await reject('differential illegal '+u,()=>rules.applyMove(p,(from<<6)|to));rejected++;}}
   const expectedStatus=await rules.status(p);assert.equal(expectedStatus.check,c.isCheck());assert.equal(expectedStatus.legal,legal.length>0);assert.equal(expectedStatus.dead,c.isInsufficientMaterial());
   c.move(legal[random(legal.length)]);
  }
 }
 checks.push(`differential ${differential} complete legal branches / ${rejected} illegal moves from80 positions versus chess.js`);
 // Exact start-position perft depth2: all20 roots and all400 leafpositions checked on EVM.
 const start=new Chess();let leaves=0;for(const m of start.moves({verbose:true})){const p1=plain(await rules.applyMove(position(start),enc(m)));const c=new Chess();c.move(m);for(const n of c.moves({verbose:true})){const d=new Chess(c.fen({forceEnpassantSquare:true}));d.move(n);assert.deepEqual(plain(await rules.applyMove(p1,enc(n))),position(d));leaves++;}}assert.equal(leaves,400);checks.push('start perft depth2 all400 leafboards exact');
 
 const kiwi=new Chess('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'); assert.equal(kiwi.moves().length,48);
 for(const m of kiwi.moves({verbose:true})){const p1=plain(await rules.applyMove(position(kiwi),enc(m)));const c=new Chess(kiwi.fen());c.move(m);const children=c.moves({verbose:true});for(let off=0;off<children.length;off+=8)await Promise.all(children.slice(off,off+8).map(async n=>{const d=new Chess(c.fen({forceEnpassantSquare:true}));d.move(n);assert.deepEqual(plain(await rules.applyMove(p1,enc(n))),position(d));kiwipeteLeaves++;}));}
 assert.equal(kiwipeteLeaves,2039); checks.push('Kiwipete perft depth2 all2039 leafboards exact');
 const noEp=position(new Chess('4k3/8/8/8/8/8/8/4K3 b - - 0 1'));const phantomEp={...noEp,enPassant:20};assert.equal((await rules.status(noEp)).positionKey,(await rules.status(phantomEp)).positionKey);checks.push('noncapturable EP omitted fromrepetitionkey');
 const pinnedEp=position(new Chess('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'));assert.equal((await rules.status(pinnedEp)).positionKey,(await rules.status({...pinnedEp,enPassant:64})).positionKey);checks.push('illegal pinnedEP omitted fromrepetitionkey');
 token=await deploy('ChessTestToken',[18]);await tx('mint testowner',token.mint(addresses[0],PRIZE*10n));await tx('mint testplayer',token.mint(addresses[1],PRIZE));
 const v=await deploy('HybridChessGame',[token.target,addresses[0],signer.address,config]);assert.equal(await v.paused(),true);await reject('starts paused',()=>v.connect(player).enterGame(1));
 await tx('explicit unpause testonly',v.setPaused(false));await tx('approve almostfunded',token.approve(v.target,PRIZE-FEE));await tx('fund belowfullprize',v.fundPool(PRIZE-FEE));await tx('player approval',token.connect(player).approve(v.target,FEE));await reject('reject entry untilfull1m reserved beforefee',()=>v.connect(player).enterGame(1));
 await tx('approve poolremainder',token.approve(v.target,FEE));await tx('fund exact1m',v.fundPool(FEE));let id=await enter(v);assert.equal(await v.totalReserved(),PRIZE);assert.equal(await v.activeGameId(),id);await reject('singlecapacity excludessecondpaidgame',()=>v.connect(player).enterGame(999));await reject('cannot withdraw reserves',()=>v.withdrawPool(FEE+1n));
 await reject('illegalhuman move',()=>v.connect(player).playHumanMove(id,(sq('e2')<<6)|sq('e5')));
 let c=new Chess();await play(v,id,c,'e2e4');const b=await bot(v,id,(sq('e7')<<6)|sq('e5'));await reject('wrongcaller cannotWhite move',()=>v.connect(owner).playHumanMove(id,1));
 const bad=await bot(v,id,b.m.encodedMove,{ply:0});await reject('stalesignedply',()=>v.playBotMove(bad.m,bad.sig));
 await reject('alteredsignedmove',()=>v.playBotMove({...b.m,encodedMove:(sq('d7')<<6)|sq('d5')},b.sig));
 await tx('validBlack',v.playBotMove(b.m,b.sig,{gasLimit:29_000_000}));c.move('e5');await reject('same signedbot replay',()=>v.playBotMove(b.m,b.sig));
 await tx('humanresign',v.connect(player).resign(id));assert.equal((await v.getGame(id)).result,4n);assert.equal(await v.totalReserved(),0n);
 // Legal White checkmate directly triggersexact1M payment, with no terminaloracle.
 id=await enter(v);c=new Chess();const before=await token.balanceOf(addresses[1]);for(const u of ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6','h5f7'])await play(v,id,c,u);assert.ok(c.isCheckmate());assert.equal((await v.getGame(id)).result,1n);assert.equal(await token.balanceOf(addresses[1])-before,PRIZE);checks.push('native Scholarsmate pays exact1million to originalwallet');await reject('cannot doublepay',()=>v.claimTimeout(id));
 assert.equal(await v.paused(),true);await reject('winner automatically pauses another entry',()=>v.connect(player).enterGame(9998));checks.push('winner ends round until explicit owner reopening');
 await tx('approve replenish afterwinner',token.approve(v.target,PRIZE)); await tx('manual replenish afterwinner',v.fundPool(PRIZE));
 await reject('funding alone cannot silently reopen won round',()=>v.connect(player).enterGame(9998));await tx('explicit reviewed round reopen testonly',v.setPaused(false));
 // Bot serviceoutage mustrefundentry while preservingunused collateral.
 id=await enter(v);c=new Chess();await play(v,id,c,'e2e4');let g=await v.getGame(id);await reject('earlytimeout',()=>v.claimTimeout(id));await eip1193.request({method:'evm_mine',params:[Number(g.turnDeadline+1n)]});const bal=await token.balanceOf(addresses[1]);await tx('test hostilefalseoutgoing',token.configure(0,false,true)); await reject('refund false-return token rollsback',()=>v.connect(relayer).claimTimeout(id)); assert.equal((await v.getGame(id)).result,0n); assert.equal(await token.balanceOf(addresses[1]),bal); await tx('restore token outgoing',token.configure(0,false,false)); await tx('botoutagerefund',v.connect(relayer).claimTimeout(id));assert.equal(await token.balanceOf(addresses[1])-bal,FEE);assert.equal((await v.getGame(id)).result,6n);
 id=await enter(v);g=await v.getGame(id);await eip1193.request({method:'evm_mine',params:[Number(g.turnDeadline+1n)]});const bal2=await token.balanceOf(addresses[1]);await tx('playerabandon',v.connect(relayer).claimTimeout(id));assert.equal(await token.balanceOf(addresses[1]),bal2);assert.equal((await v.getGame(id)).result,5n);
 // Threefold repetition is assessed by nativeboardjournal; Blackclaims automatically.
 id=await enter(v);c=new Chess();for(const u of ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8','g1f3']){g=await play(v,id,c,u);if(g.result!==0n)break;}assert.equal(g.result,3n);checks.push('nativeBlack currentthreefold claimsdraw');
 
 const beforePool=await token.balanceOf(v.target); await tx('approve hostilefunding',token.approve(v.target,FEE));await tx('test transfer tax',token.configure(100,false,false));await reject('taxed funding atomicallyrejects',()=>v.fundPool(FEE));assert.equal(await token.balanceOf(v.target),beforePool);await tx('test incomingfalse',token.configure(0,true,false));await tx('approve hostileentry',token.connect(player).approve(v.target,FEE));await reject('false-return entry atomicallyrejects',()=>v.connect(player).enterGame(888));assert.equal(await v.activeGameId(),ethers.ZeroHash);assert.equal(await v.nonceUsed(addresses[1],888),false);await tx('restore token exact',token.configure(0,false,false));
 await tx('configure callback',token.setCallback(v.target,v.interface.encodeFunctionData('enterGame',[9999]),true));await tx('guardedfund callback',v.fundPool(FEE));assert.equal(await token.callbackAttempted(),true);assert.equal(await token.callbackSucceeded(),false);assert.equal(v.interface.parseError(await token.callbackResult()).name,'Reentrancy');await tx('disable callback',token.setCallback(v.target,'0x',false));checks.push('token reentry blocked and failedincoming/outgoing/tax fullyrollback');
 // Historical baseline checkmate transcript independentlyreplayed wholly through nativeSolidityrules.
 const run=JSON.parse(fs.readFileSync(new URL('../benchmarks/results/baseline-3m/summary.json',import.meta.url),'utf8'));
 const files=fs.readdirSync(new URL('../benchmarks/results/baseline-3m/',import.meta.url));
 const pgnfile=files.find(f=>f.endsWith('.pgn')&&fs.readFileSync(new URL('../benchmarks/results/baseline-3m/'+f,import.meta.url),'utf8').includes('Qa8#'));
 assert.ok(pgnfile,'saved195plycheckmatePGNfound');
 const historical=new Chess();historical.loadPgn(fs.readFileSync(new URL('../benchmarks/results/baseline-3m/'+pgnfile,import.meta.url),'utf8'));const hist=historical.history({verbose:true});const replay=new Chess();let pos=position(replay);for(const m of hist){pos=plain(await rules.applyMove(pos,enc(m)));replay.move(m);assert.deepEqual(pos,position(replay));}assert.ok(replay.isCheckmate());const terminal=await rules.status(pos);assert.equal(terminal.check,true);assert.equal(terminal.legal,false);checks.push(`historical98.Qa8# all${hist.length}plies replayedonEVM`);
 save('evm/hybrid-test-report.json',{format:'GH0ST_HYBRID_CHESS_LOCAL_V1',localOnly:true,passed:true,checkCount:checks.length,checks,differentialLegalBranches:differential,illegalSamples:rejected,perftDepth2:leaves,kiwipeteDepth2:kiwipeteLeaves,historicalMatePlies:hist.length,contracts:Object.fromEntries(Object.entries(a).map(([n,v])=>[n,{runtimeBytes:v.runtimeBytes}])),receipts});
 console.log(JSON.stringify({passed:true,checks:checks.length,differential,leaves,kiwipeteLeaves,receipts:receipts.length,maxGas:Math.max(...receipts.map(r=>Number(r.gasUsed)))}));
}finally{await chain.close();}
