import { AuthClient } from '@icp-sdk/auth/client';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { bytes, hex, principalHash, validateConfig, same, randomBytes, variant } from './core.mjs';

// Exact interface from spec/chess-authority.did. Browser positions are never accepted.
export function idlFactory({IDL}) {
  const Blob=IDL.Vec(IDL.Nat8);
  const EngineConfig=IDL.Record({cycles_per_search:IDL.Nat64,hash_mb:IDL.Nat32,stockfish_commit:IDL.Text,nnue_sha256:IDL.Text,engine_canister:IDL.Principal,nodes:IDL.Nat64});
  const EngineAudit=IDL.Record({actual_nodes:IDL.Nat64,requested_nodes:IDL.Nat64,bestmove:IDL.Text,nnue_sha256:IDL.Text,job_id:Blob,depth:IDL.Nat32,engine_commit:IDL.Text,instructions:IDL.Nat64,stop_reason:IDL.Text});
  const VerifiedEntry=IDL.Record({transaction_hash:Blob,engine_config_hash:Blob,vault:Blob,player:Blob,log_index:IDL.Nat32,reconciliation_deadline:IDL.Nat64,opened_at:IDL.Nat64,game_deadline:IDL.Nat64,principal_hash:Blob,player_principal:IDL.Principal,game_id:Blob,chain_id:IDL.Nat64,nonce:Blob});
  const GameResult=IDL.Variant(Object.fromEntries(['Draw','BotCheckmate','HumanCheckmate','HumanResigned','ServiceFault','PlayerTimeout','EngineAbort'].map(x=>[x,IDL.Null])));
  const MoveRecord=IDL.Record({ply:IDL.Nat32,uci:IDL.Text,transcript_hash:Blob,position_hash:Blob,engine:IDL.Opt(EngineAudit)});
  const PendingSearch=IDL.Record({requested_at:IDL.Nat64,job_id:Blob,in_flight:IDL.Bool,position_hash:Blob});
  const Terminal=IDL.Record({result:GameResult,completed_at:IDL.Nat64,reason:IDL.Text});
  const Game=IDL.Record({fen:IDL.Text,position_hash:Blob,moves:IDL.Vec(MoveRecord),transcript_hash:Blob,pending:IDL.Opt(PendingSearch),entry:VerifiedEntry,requests:IDL.Vec(IDL.Tuple(Blob,Blob)),phase:IDL.Variant({WaitingBot:IDL.Null,Terminal:IDL.Null,WaitingHuman:IDL.Null}),repetition_keys:IDL.Vec(IDL.Text),terminal:IDL.Opt(Terminal),engine:EngineConfig});
  const Err=IDL.Variant(Object.fromEntries(['SearchAlreadyRunning','EntryAlreadyUsed','Anonymous','RequestConflict','StalePosition','UnknownGame','IllegalMove','NoDrawClaim','ChallengeInactive','WrongPhase','Unauthorized','Capacity','InvalidConfiguration','InvalidEngineResponse','InvalidEntry','Expired'].map(x=>[x,IDL.Null])));
  const Result=IDL.Variant({Ok:Game,Err});
  const ResultMaterial=IDL.Record({result:IDL.Nat8,transcript_hash:Blob,engine_config_hash:Blob,final_position_hash:Blob,player:Blob,principal_hash:Blob,game_id:Blob,nonce:Blob,completed_at:IDL.Nat64});
  return IDL.Service({
    get_status:IDL.Func([],[IDL.Record({blockers:IDL.Vec(IDL.Text),engine_config_hash:Blob,production_ready:IDL.Bool,schema_version:IDL.Nat32,paid_entries_enabled:IDL.Bool,engine_config:EngineConfig})],['query']),
    get_game:IDL.Func([Blob],[IDL.Opt(Game)],['query']),
    legal_moves:IDL.Func([Blob],[IDL.Variant({Ok:IDL.Vec(IDL.Text),Err})],['query']),
    submit_move:IDL.Func([IDL.Record({uci:IDL.Text,request_id:Blob,expected_position_hash:Blob,game_id:Blob,expected_ply:IDL.Nat32})],[Result],[]),
    run_bot:IDL.Func([Blob],[Result],[]),resign:IDL.Func([Blob],[Result],[]),claim_draw:IDL.Func([Blob,IDL.Opt(IDL.Text)],[Result],[]),
    expire:IDL.Func([Blob],[Result],[]),fault_stuck_search:IDL.Func([Blob],[Result],[]),
    result_material:IDL.Func([Blob],[IDL.Variant({Ok:IDL.Opt(ResultMaterial),Err})],['query']),
  });
}
const unwrap=result=>{if('Err'in result)throw new Error(`Authority: ${variant(result.Err)}. Refresh the game before continuing.`);return result.Ok;};
const MOVE_KEY='gh0st-chess-unresolved-move-v1';
export class ChessService {
  constructor(config,{changed=()=>{}}={}) {
    this.config=config;this.changed=changed;this.auth=null;this.principal=null;this.actor=null;this.verified=false;this.pendingMove=null;
    try{const p=JSON.parse(localStorage.getItem(MOVE_KEY));if(p?.gameId&&p?.requestId)this.pendingMove=p;}catch{}
  }
  getAuth(){
    if(!this.auth){this.auth=new AuthClient({namespace:'gh0st-chess',agentOptions:{host:this.config.icHost}});this.auth.subscribe(()=>{this.principal=this.auth.getPrincipal();this.actor=null;this.changed();});}
    return this.auth;
  }
  async restore(){await this.getAuth().getIdentity();this.principal=this.auth.getPrincipal();this.changed();return this.principal;}
  async signIn(){await this.getAuth().signIn();return this.restore();}
  async signOut(){await this.getAuth().signOut();this.principal=null;this.actor=null;this.changed();}
  signedIn(){return !!this.principal&&!this.principal.isAnonymous();}
  async hash(){if(!this.signedIn())throw new Error('Sign in with Internet Identity first.');return principalHash(this.principal);}
  publicActor(){
    if(!this.config.authorityCanisterId)throw new Error('The ICP authority has not been configured.');
    if(!this.public)this.public=Actor.createActor(idlFactory,{canisterId:this.config.authorityCanisterId,agent:HttpAgent.createSync({host:this.config.icHost})});
    return this.public;
  }
  async verify(){
    this.verified=false;validateConfig(this.config);
    const c=this.config;const agent=HttpAgent.createSync({host:c.icHost});
    for(const [id,expected,controllers] of [[c.authorityCanisterId,c.authorityModuleHash,c.authorityControllers],[c.engineCanisterId,c.engineModuleHash,c.engineControllers]]){
      const principal=Principal.fromText(id);if(principal.isAnonymous())throw new Error('Anonymous canister identity is invalid.');
      const status=await CanisterStatus.request({agent,canisterId:principal,paths:['module_hash','controllers']});
      const actual=status.get('module_hash');
      const digest=typeof actual==='string'?actual.replace(/^0x/,''):hex(new Uint8Array(actual||[])).slice(2);
      if(!same(digest,expected))throw new Error('A certified canister module hash differs from the reviewed release.');
      const actualControllers=status.get('controllers');
      if(!Array.isArray(actualControllers)||JSON.stringify(actualControllers.map(x=>x.toText()).sort())!==JSON.stringify([...controllers].sort()))throw new Error('The certified canister controller set differs from the reviewed release.');
    }
    const status=await this.publicActor().get_status();const e=status.engine_config;
    if(!status.production_ready||!status.paid_entries_enabled||status.schema_version!==1||status.blockers.length)throw new Error(status.blockers.join(' ')||'The authority is not accepting paid games.');
    if(!same(hex(status.engine_config_hash),c.engineConfigHash)||e.engine_canister.toText()!==c.engineCanisterId||e.stockfish_commit!==c.engineCommit||!same(e.nnue_sha256,c.nnueSha256)||e.nodes!==BigInt(c.nodes)||e.hash_mb!==c.hashMb||e.cycles_per_search!==BigInt(c.cyclesPerSearch))throw new Error('The authority search configuration differs from this release.');
    const engine=Actor.createActor(({IDL})=>IDL.Service({identity:IDL.Func([],[IDL.Record({engine_commit:IDL.Text,nnue_sha256:IDL.Text,config_hash:IDL.Vec(IDL.Nat8),nodes:IDL.Nat64,hash_mb:IDL.Nat32,authority:IDL.Text})],['query'])}),{canisterId:c.engineCanisterId,agent});
    const identity=await engine.identity();
    if(identity.authority!==c.authorityCanisterId||identity.engine_commit!==c.engineCommit||!same(identity.nnue_sha256,c.nnueSha256)||!same(hex(identity.config_hash),c.engineConfigHash)||identity.nodes!==BigInt(c.nodes)||identity.hash_mb!==c.hashMb)throw new Error('Engine identity or authorized game authority differs from the reviewed release.');
    this.verified=true;this.status=status;this.changed();return status;
  }
  async authenticatedActor(){
    if(!this.verified)throw new Error('Verify the release before using the onchain game.');
    const identity=await this.getAuth().getIdentity();const current=identity.getPrincipal();
    if(current.isAnonymous()||current.toText()!==this.principal?.toText())throw new Error('Your Internet Identity session changed. Sign in again.');
    return Actor.createActor(idlFactory,{canisterId:this.config.authorityCanisterId,agent:HttpAgent.createSync({host:this.config.icHost,identity})});
  }
  async game(gameId){const result=await this.publicActor().get_game(bytes(gameId));return result[0]||null;}
  async legalMoves(gameId){return unwrap(await this.publicActor().legal_moves(bytes(gameId)));}
  persistMove(value){if(value)localStorage.setItem(MOVE_KEY,JSON.stringify(value));else localStorage.removeItem(MOVE_KEY);this.pendingMove=value;this.changed();}
  async submit(gameId,game,uci){
    if(this.pendingMove)throw new Error('Reconcile the saved move before submitting another.');
    if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error('Choose a valid move.');
    const actor=await this.authenticatedActor();const legal=await this.legalMoves(gameId);if(!legal.includes(uci))throw new Error('This move is not legal in the authoritative position.');
    const pending={gameId,requestId:hex(randomBytes()),positionHash:hex(game.position_hash),expectedPly:game.moves.length,uci,principal:this.principal.toText()};
    // Persist intent before the update. An uncertain response must be reconciled, never re-sent automatically.
    this.persistMove(pending);
    try{const response=await actor.submit_move({game_id:bytes(gameId),request_id:bytes(pending.requestId),expected_position_hash:bytes(pending.positionHash),expected_ply:pending.expectedPly,uci});if('Err'in response){this.persistMove(null);return unwrap(response);}const result=unwrap(response);this.persistMove(null);return result;}
    catch(error){this.changed();throw error;}
  }
  async reconcileMove(){
    const p=this.pendingMove;if(!p)return null;const game=await this.game(p.gameId);
    if(!game)throw new Error('The saved move cannot yet be reconciled. No move was re-sent.');
    const recorded=game.requests.some(([request])=>same(hex(request),p.requestId));
    if(recorded){this.persistMove(null);return game;}
    throw new Error('The authority has not recorded the saved request. Its outcome is unresolved; no new move was sent.');
  }
  async action(method,gameId,intendedMove){
    if(this.pendingMove)throw new Error('Reconcile the saved move before another update.');
    if(!['run_bot','resign','claim_draw','expire','fault_stuck_search'].includes(method))throw new Error('Unsupported authority action.');
    const actor=await this.authenticatedActor();return unwrap(await actor[method](bytes(gameId),...(method==='claim_draw'?[intendedMove?[intendedMove]:[]]:[])));
  }
  async resultMaterial(gameId){return unwrap(await this.publicActor().result_material(bytes(gameId)))[0]||null;}
}
