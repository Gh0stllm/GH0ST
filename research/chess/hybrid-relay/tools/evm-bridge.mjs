// Isolated EVM fixture driven over stdin. No network endpoint, real wallet or mainnet transaction.
// The real game contract runs on a synthetic chain4663 with a test ERC20 at the canonical address.
import { createInterface } from 'node:readline';
import { compileHybrid } from '../../evm/compile-hybrid.mjs';
import { ethers, localChain } from '../../evm/lib.mjs';
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
const output=x=>process.stdout.write(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v)+'\n');
let chain,game,token,gameId;const receipts=[];
const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559',FEE=25_000n*10n**18n,PRIZE=1_000_000n*10n**18n;
const artifacts=compileHybrid(false);
async function tx(label,p){const t=await p,r=await t.wait();if(r.status!==1)throw Error('fixture transaction failed');receipts.push({label,hash:r.hash,gasUsed:r.gasUsed.toString(),blockNumber:r.blockNumber});return r;}
async function deploy(name,args){const c=await new ethers.ContractFactory(artifacts[name].abi,artifacts[name].bytecode,chain.signers[0]).deploy(...args);await tx('deploy '+name,Promise.resolve(c.deploymentTransaction()));return c.waitForDeployment();}
async function mine(seconds=0){const h=await chain.eip1193.request({method:'eth_getBlockByNumber',params:['latest',false]});if(seconds)await chain.eip1193.request({method:'evm_mine',params:[Number(BigInt(h.timestamp))+seconds]});for(let i=0;i<14;i++)await chain.eip1193.request({method:'evm_mine',params:[]});return await chain.eip1193.request({method:'eth_getBlockByNumber',params:['latest',false]});}
function plain(g){return{player:g.player,nonce:g.nonce,opened_at:g.openedAt,turn_deadline:g.turnDeadline,result:g.result,ply:g.ply,position_hash:g.positionHash,transcript_hash:g.transcriptHash,board:ethers.toBeHex(g.board,32),castling:g.castling,en_passant:g.enPassant,halfmove_clock:g.halfmoveClock,black_to_move:g.blackToMove};}
async function inspect(){return{game_id:gameId,game:gameId?plain(await game.getGame(gameId)):null,moves:gameId?await game.getMoves(gameId):[],reserved:await game.totalReserved(),pool_balance:await token.balanceOf(game.target),player_balance:await token.balanceOf(chain.addresses[1]),paused:await game.paused(),block:await chain.eip1193.request({method:'eth_getBlockByNumber',params:['latest',false]}),receipts};}
for await(const line of rl){if(!line.trim())continue;try{const x=JSON.parse(line);let result;
 if(x.command==='setup'){
  chain=await localChain(4663);
  await chain.eip1193.request({method:'miner_setGasPrice',params:['0x1312d00']});
  // Deploy the test token first so its immutable decimals are patched by Solidity itself.
  const deployed=await deploy('ChessTestToken',[18]);const code=await chain.provider.getCode(deployed.target);
  await chain.eip1193.request({method:'evm_setAccountCode',params:[TOKEN,code]});
  token=new ethers.Contract(TOKEN,artifacts.ChessTestToken.abi,chain.signers[0]);
  await tx('mint synthetic pool tokens',token.mint(chain.addresses[0],5n*PRIZE));
  await tx('mint synthetic player tokens',token.mint(chain.addresses[1],100_000n*10n**18n));
  game=await deploy('HybridChessGame',[TOKEN,chain.addresses[0],x.attestor,x.engine_config_hash]);
  const runtime=await chain.provider.getCode(game.target);
  result={contract:game.target,runtime_hash:ethers.keccak256(runtime),runtime_bytes:(runtime.length-2)/2,chain_id:4663,owner:chain.addresses[0],player:chain.addresses[1],token:TOKEN,synthetic_token_runtime_hash:ethers.keccak256(code),block:await mine(),receipts};
 }else if(x.command==='fund_relayer'){
  await chain.eip1193.request({method:'evm_setAccountBalance',params:[x.address,'0xde0b6b3a7640000']});
  result={address:x.address,balance:await chain.eip1193.request({method:'eth_getBalance',params:[x.address,'latest']})};
 }else if(x.command==='decode_transaction'){
  const t=ethers.Transaction.from(x.raw);result={hash:t.hash,from:t.from,to:t.to,nonce:t.nonce,chainId:t.chainId,type:t.type,value:t.value,gasLimit:t.gasLimit,maxFeePerGas:t.maxFeePerGas,maxPriorityFeePerGas:t.maxPriorityFeePerGas,data:t.data};
 }else if(x.command==='recover_attestor'){
  const m=x.move;const domain={name:'GH0ST Hybrid Chess',version:'1',chainId:4663,verifyingContract:x.contract};
  const types={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
  result={address:ethers.verifyTypedData(domain,types,{gameId:m.game_id,player:m.player,ply:m.ply,positionHash:m.position_hash,transcriptHash:m.transcript_hash,encodedMove:m.encoded_move,engineConfigHash:m.engine_config_hash,validUntil:m.valid_until},x.signature)};
 }else if(x.command==='rpc'){
  const one=async r=>{try{return{jsonrpc:'2.0',id:r.id,result:await chain.eip1193.request({method:r.method,params:r.params})}}catch(e){return{jsonrpc:'2.0',id:r.id,error:{code:e.code||-32000,message:String(e.message)}}}};
  result=Array.isArray(x.body)?await Promise.all(x.body.map(one)):await one(x.body);
 }else if(x.command==='fund_enter'){
  await tx('explicit synthetic pool approval',token.approve(game.target,PRIZE));await tx('fund full synthetic1m reserve',game.fundPool(PRIZE));await tx('open fixture entries',game.setPaused(false));
  await tx('exact synthetic25k approval',token.connect(chain.signers[1]).approve(game.target,FEE));
  gameId=await game.gameIdFor(chain.addresses[1],7);await tx('reserve1m and enter25k',game.connect(chain.signers[1]).enterGame(7));
  await tx('human e2e4',game.connect(chain.signers[1]).playHumanMove(gameId,(12<<6)|28,{gasLimit:29_000_000}));await mine();result=await inspect();
 }else if(x.command==='apply_bot'){
  const m=x.move;await tx('ICP signed nativeBlack move',game.playBotMove({gameId:m.game_id,player:m.player,ply:m.ply,positionHash:m.position_hash,transcriptHash:m.transcript_hash,encodedMove:m.encoded_move,engineConfigHash:m.engine_config_hash,validUntil:m.valid_until},x.signature,{gasLimit:29_000_000}));
  await mine();result=await inspect();
 }else if(x.command==='timeout'){
  // A new legitimate White move makes Black's turn due; then advance only synthetic time.
  await tx('human g1f3 before simulated outage',game.connect(chain.signers[1]).playHumanMove(gameId,(6<<6)|21,{gasLimit:29_000_000}));
  const g=await game.getGame(gameId);await chain.eip1193.request({method:'evm_mine',params:[Number(g.turnDeadline)+1]});
  const before=await token.balanceOf(chain.addresses[1]);await tx('native service-timeout entry refund',game.connect(chain.signers[2]).claimTimeout(gameId));
  result={...await inspect(),refund:await token.balanceOf(chain.addresses[1])-before};
 }else if(x.command==='mine'){result={block:await mine(Number(x.seconds||0))};
 }else if(x.command==='inspect'){result=await inspect();}
 else if(x.command==='close'){if(chain)await chain.close();output({ok:true});break;}
 else throw Error('unknown bridge command');
 output({ok:true,result});
 }catch(e){output({ok:false,error:String(e.stack||e)});}}
if(chain)try{await chain.close();}catch{}
rl.close();process.stdin.destroy();
