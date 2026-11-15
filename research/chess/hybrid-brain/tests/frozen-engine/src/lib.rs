//! TEST ONLY: replay recorded genuine full24m search metadata. No inference is performed.
use candid::{CandidType,Principal};use serde::Deserialize;use std::cell::RefCell;
use gh0st_chess_hybrid_brain::{Hash,STOCKFISH_COMMIT,NNUE_SHA256,INITIAL_FEN,keccak};
#[derive(Clone,CandidType,Deserialize)]struct Frozen{bestmove:String,actual_nodes:u64,depth:u32,instructions:u64}
#[derive(Clone)]struct State{coordinator:Principal,config:Hash,reserved:Vec<u8>,reply:Frozen,progress:Option<Progress>,begins:u32,advances:u32,release_calls:u32}
thread_local!{static STATE:RefCell<Option<State>>=const{RefCell::new(None)};}
#[derive(Clone,CandidType,Deserialize)]struct Error{code:String,message:String,refundable:bool}
type R<T>=Result<T,Error>;
#[derive(Clone,CandidType,Deserialize)]struct Info{coordinator:Principal,reserved_game:Vec<u8>,active_job:Vec<u8>,config_hash:Hash,faulted:bool,fault_reason:String,capacity:u32,retained_jobs:u32,max_jobs:u32,nodes:u64,hash_mb:u32,quantum:u32,yield_policy:String,instruction_target:u64,engine_commit:String,nnue_sha256:String,cycle_balance:candid::Nat}
#[derive(Clone,CandidType,Deserialize)]struct Job{game_id:Hash,position_hash:Hash,ply:u32,initial_fen:String,moves:Vec<String>}
#[derive(Clone,CandidType,Deserialize)]struct Progress{game_id:Hash,job_id:Hash,position_hash:Hash,config_hash:Hash,ply:u32,step:u32,phase:String,bestmove:String,actual_nodes:u64,observed_nodes:u64,depth:u32,stop_reason:String,instructions:u64,instructions_total:u64,engine_commit:String,nnue_sha256:String}
fn state()->State{STATE.with(|s|s.borrow().as_ref().unwrap().clone())}
fn save(s:State){STATE.with(|v|*v.borrow_mut()=Some(s))}
fn auth()->R<()>{if ic_cdk::api::msg_caller()!=state().coordinator{Err(Error{code:"Unauthorized".into(),message:"fixture coordinator only".into(),refundable:false})}else{Ok(())}}
fn info()->Info{let s=state();Info{coordinator:s.coordinator,reserved_game:s.reserved.clone(),active_job:vec![],config_hash:s.config,faulted:false,fault_reason:String::new(),capacity:1,retained_jobs:if s.reserved.is_empty(){0}else{s.begins},max_jobs:512,nodes:24_000_000,hash_mb:128,quantum:0,yield_policy:"instruction-budget".into(),instruction_target:28_000_000_000,engine_commit:STOCKFISH_COMMIT.into(),nnue_sha256:NNUE_SHA256.into(),cycle_balance:ic_cdk::api::canister_cycle_balance().into()}}
#[ic_cdk::init]fn init(coordinator:Principal,config:Hash,reply:Frozen){assert_eq!(reply.bestmove,"e7e5");assert!(reply.actual_nodes>=24_000_000);save(State{coordinator,config,reserved:vec![],reply,progress:None,begins:0,advances:0,release_calls:0})}
#[ic_cdk::update]fn get_info()->R<Info>{auth()?;Ok(info())}
#[ic_cdk::update]fn reserve_game(id:Hash)->R<Info>{auth()?;let mut s=state();s.reserved=id.to_vec();save(s);Ok(info())}
#[ic_cdk::update]fn release_game(_:Hash)->R<Info>{auth()?;let mut s=state();s.reserved.clear();s.progress=None;s.release_calls+=1;let first=s.release_calls==1;save(s);if first{Err(Error{code:"FixtureLostAck".into(),message:"TEST fixture committed release but reply is unavailable".into(),refundable:true})}else{Ok(info())}}
#[ic_cdk::update]fn begin(j:Job)->R<Progress>{auth()?;assert_eq!(j.initial_fen,INITIAL_FEN);assert_eq!(j.moves,vec!["e2e4"]);assert_eq!(j.ply,1);let mut s=state();assert_eq!(s.reserved,j.game_id);s.begins+=1;let p=Progress{game_id:j.game_id,job_id:keccak(&[j.game_id,j.position_hash].concat()),position_hash:j.position_hash,config_hash:s.config,ply:1,step:1,phase:"Completed".into(),bestmove:s.reply.bestmove.clone(),actual_nodes:s.reply.actual_nodes,observed_nodes:s.reply.actual_nodes,depth:s.reply.depth,stop_reason:"node_budget".into(),instructions:s.reply.instructions,instructions_total:s.reply.instructions,engine_commit:STOCKFISH_COMMIT.into(),nnue_sha256:NNUE_SHA256.into()};s.progress=Some(p.clone());save(s);Ok(p)}
#[ic_cdk::update]fn advance(_:Hash,_:u32)->R<Progress>{auth()?;let mut s=state();s.advances+=1;let p=s.progress.clone().unwrap();save(s);Ok(p)}
#[ic_cdk::update]fn read_progress(_:Hash)->R<Progress>{auth()?;Ok(state().progress.unwrap())}
#[derive(CandidType,Deserialize)]struct Stats{begins:u32,advances:u32,release_calls:u32}
#[ic_cdk::query]fn stats()->Stats{let s=state();Stats{begins:s.begins,advances:s.advances,release_calls:s.release_calls}}
ic_cdk::export_candid!();
