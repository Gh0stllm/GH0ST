import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { compileHybrid } from '../evm/compile-hybrid.mjs';
import { ethers, localChain, save } from '../evm/lib.mjs';

// LOCAL replay only: saved native CPU Stockfish decisions are authorized by a test
// ECDSA signer and mined in Ganache. This does NOT run ICP inference or mainnet.
const artifacts=compileHybrid(false);
const chain=await localChain(4663);
const {provider,eip1193,signers,addresses}=chain;
const [owner,player,relayer]=signers;
const tokenAddress='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const attestor=new ethers.Wallet('0x'+'11'.repeat(32));
const configHash=ethers.id('LOCAL REPLAY ONLY SF19 RETAINED 24M NODES HASH128M');
const fee=25_000n*10n**18n,prize=1_000_000n*10n**18n;
const abi=ethers.AbiCoder.defaultAbiCoder();
const types={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
const receipts=[],games=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const square=s=>s.charCodeAt(0)-97+8*(Number(s[1])-1);
const encode=m=>(square(m.from)<<6)|square(m.to)|(({n:2,b:3,r:4,q:5}[m.promotion]??0)<<12);
const pos=c=>{
 let board=0n;for(let i=0;i<64;i++){const p=c.get(String.fromCharCode(97+i%8)+(Math.floor(i/8)+1));if(p)board|=BigInt(({p:1,n:2,b:3,r:4,q:5,k:6}[p.type])+(p.color==='b'?8:0))<<BigInt(i*4);}
 const f=c.fen({forceEnpassantSquare:true}).split(' '); const last=c.history({verbose:true}).at(-1);
 const enPassant=last?.piece==='p'&&Math.abs(square(last.from)-square(last.to))===16?(square(last.from)+square(last.to))/2:f[3]==='-'?64:square(f[3]);
 return {board,castling:[['K',1],['Q',2],['k',4],['q',8]].reduce((v,[x,b])=>v+(f[2].includes(x)?b:0),0),enPassant,halfmoveClock:Number(f[4]),blackToMove:f[1]==='b'};
};
const plain=g=>({board:g.board,castling:Number(g.castling),enPassant:Number(g.enPassant),halfmoveClock:Number(g.halfmoveClock),blackToMove:g.blackToMove});
async function tx(label,promise,extra={}){
 const sent=await promise;const r=await sent.wait();assert.equal(r.status,1,label);
 receipts.push({label,transactionHash:r.hash,blockNumber:r.blockNumber,gasUsed:r.gasUsed.toString(),...extra});return r;
}
async function deploy(name,args){const c=await new ethers.ContractFactory(artifacts[name].abi,artifacts[name].bytecode,owner).deploy(...args);await tx('local deploy '+name,Promise.resolve(c.deploymentTransaction()));return c.waitForDeployment();}
try{
 assert.equal((await provider.getNetwork()).chainId,4663n);
 const tokenTemplate=await deploy('ChessTestToken',[18]);
 // Local-only code injection permits canonical address binding without touching a public network.
 await eip1193.request({method:'evm_setAccountCode',params:[tokenAddress,await provider.getCode(tokenTemplate.target)]});
 const token=new ethers.Contract(tokenAddress,artifacts.ChessTestToken.abi,owner);
 assert.equal(await token.decimals(),18n);
 await tx('mint local mock pool',token.mint(addresses[0],prize));
 await tx('mint local mock entries',token.mint(addresses[1],fee*4n));
 const game=await deploy('HybridChessGame',[tokenAddress,addresses[0],attestor.address,configHash]);
 assert.equal(await game.ENTRY_FEE(),fee);assert.equal(await game.TOTAL_PRIZE(),prize);
 await tx('approve local pool',token.approve(game.target,prize));await tx('fund local pool',game.fundPool(prize));await tx('explicit local unpause',game.setPaused(false));
 let nonce=0;
 for(const id of ['48m-larsen','48m-king-pawn']){
  const sourcePath=`benchmarks/results/retained24m-vs48m/${id}.json`;
  const raw=fs.readFileSync(new URL('../'+sourcePath,import.meta.url));const source=JSON.parse(raw);
  if(!source.completed){if(id==='48m-larsen')throw Error('required Larsen game incomplete');continue;}
  assert.equal(source.ghost_nodes,24_000_000);assert.equal(source.challenger_nodes,48_000_000);
  assert.equal(source.result,'1/2-1/2');assert.equal(source.termination,'claimed_threefold_current');
  const beforePlayer=await token.balanceOf(addresses[1]);const beforePool=await token.balanceOf(game.target);
  await tx('approve local entry '+id,token.connect(player).approve(game.target,fee));
  const gameId=await game.gameIdFor(addresses[1],++nonce);
  await tx('reserve prize and enter '+id,game.connect(player).enterGame(nonce));
  assert.equal(await game.totalReserved(),prize);
  const c=new Chess();let transcript=ethers.id('GH0ST_CHESS_INITIAL_V1');const encodedHistory=[],moves=[];
  let terminal;
  for(const saved of source.moves){
   assert.equal(saved.ply,encodedHistory.length+1);assert.equal(c.fen(),saved.fen_before);
   const current=await game.getGame(gameId);assert.equal(current.result,0n);assert.equal(current.ply,BigInt(saved.ply-1));assert.deepEqual(plain(current),pos(c));assert.equal(current.transcriptHash,transcript);
   const move=c.move({from:saved.uci.slice(0,2),to:saved.uci.slice(2,4),promotion:saved.uci[4]});assert.ok(move);assert.equal(move.san,saved.san);
   const encodedMove=encode(move);encodedHistory.push(encodedMove);
   let receipt;
   if(current.blackToMove){
    assert.ok(saved.actual_nodes>=24_000_000||saved.depth>=245);
    const request={gameId,player:addresses[1],ply:current.ply,positionHash:current.positionHash,transcriptHash:transcript,encodedMove,engineConfigHash:configHash,validUntil:current.turnDeadline};
    const domain={name:'GH0ST Hybrid Chess',version:'1',chainId:4663,verifyingContract:game.target};
    assert.equal(await game.botMoveDigest(request),ethers.TypedDataEncoder.hash(domain,types,request));
    const signature=await attestor.signTypedData(domain,types,request);
    receipt=await tx('apply saved Black move',game.connect(relayer).playBotMove(request,signature,{gasLimit:29_000_000}),{game:id,ply:saved.ply,uci:saved.uci});
   }else receipt=await tx('apply saved White move',game.connect(player).playHumanMove(gameId,encodedMove,{gasLimit:29_000_000}),{game:id,ply:saved.ply,uci:saved.uci});
   transcript=ethers.keccak256(abi.encode(['bytes32','uint16'],[transcript,encodedMove]));
   terminal=await game.getGame(gameId);const expected=pos(c);
   assert.deepEqual(plain(terminal),expected);assert.equal(terminal.ply,BigInt(saved.ply));assert.equal(terminal.transcriptHash,transcript);
   assert.equal(terminal.positionHash,ethers.keccak256(abi.encode(['uint256','uint8','uint8','bool'],[expected.board,expected.castling,expected.enPassant,expected.blackToMove])));
   const events=receipt.logs.flatMap(log=>{try{const e=game.interface.parseLog(log);return e?[e]:[];}catch{return[];}});
   const moved=events.find(e=>e.name==='MovePlayed');assert.ok(moved);assert.equal(moved.args.encodedMove,BigInt(encodedMove));assert.equal(moved.args.positionHash,terminal.positionHash);assert.equal(moved.args.transcriptHash,transcript);
   if(saved.ply<source.moves.length)assert.equal(terminal.result,0n);
   else{assert.equal(terminal.result,3n);const settled=events.find(e=>e.name==='GameSettled');assert.ok(settled);assert.equal(settled.args.result,3n);assert.equal(settled.args.paid,0n);}
   moves.push({ply:saved.ply,uci:saved.uci,encodedMove,positionHash:terminal.positionHash,transcriptHash:transcript,gasUsed:receipt.gasUsed.toString(),transactionHash:receipt.hash});
  }
  assert.equal(c.fen(),source.final_fen);assert.ok(c.isThreefoldRepetition());assert.equal(c.turn(),'b');
  assert.equal(terminal.result,3n);assert.equal(await token.balanceOf(addresses[1]),beforePlayer-fee);
  assert.equal(await token.balanceOf(game.target),beforePool+fee);assert.equal(await game.totalReserved(),0n);assert.equal(await game.activeGameId(),ethers.ZeroHash);assert.equal(await game.activeGames(),0n);assert.equal(await game.paused(),false);assert.equal(await game.isSolvent(),true);
  assert.deepEqual(Array.from(await game.getMoves(gameId),Number),encodedHistory);
  games.push({id,source:sourcePath,sourceSha256:sha(raw),sourceScope:source.scope,replayScope:'LOCAL Ganache chain4663 game replay using saved native CPU engine moves and a test ECDSA signer. Not ICP inference, mainnet, or a paid public game.',gameId,plies:moves.length,whiteNodeBudget:source.challenger_nodes,blackNodeBudget:source.ghost_nodes,result:'native automatic Black current-position threefold draw',resultCode:3,totalPrizePaid:'0',entryFeeRetained:fee.toString(),reservedAfter:'0',finalFen:c.fen(),finalPositionHash:terminal.positionHash,finalTranscriptHash:transcript,maxMoveGas:Math.max(...moves.map(x=>Number(x.gasUsed))),totalMoveGas:moves.reduce((a,x)=>a+BigInt(x.gasUsed),0n).toString(),moves});
 }
 assert.equal(games[0].plies,65);
 const report={format:'GH0ST_HYBRID_SAVED_ENGINE_REPLAY_V1',localOnly:true,passed:true,chainId:4663,note:'All transactions are isolated Ganache receipts, with mock GH0ST code injected at its canonical address. Full saved native CPU engine games are replayed through the actual Solidity game and escrow; no ICP searches or public transactions occur here.',contract:game.target,contractRuntimeSha256:sha(ethers.getBytes(await provider.getCode(game.target))),sourceSha256:{game:sha(fs.readFileSync(new URL('../contracts/HybridChessGame.sol',import.meta.url))),rules:sha(fs.readFileSync(new URL('../contracts/HybridChessRules.sol',import.meta.url)))},economics:{entry:fee.toString(),totalCheckmatePrize:prize.toString(),decimals:18},games,receiptCount:receipts.length,receipts};
 save('evm/replayed-engine-games.json',report);
 console.log(JSON.stringify({passed:true,games:games.map(g=>({id:g.id,plies:g.plies,resultCode:g.resultCode,maxMoveGas:g.maxMoveGas,totalMoveGas:g.totalMoveGas})),receipts:receipts.length}));
}finally{await chain.close();}
