//! TEST ONLY: replays one captured genuine full-Stockfish24m signed result.
//! This is not inference, a production coordinator, or a production endpoint.
use candid::CandidType;
use gh0st_chess_hybrid_brain::{Address,Advance,Hash,Job,R,Request,hex};
use serde::Deserialize;
use std::cell::RefCell;
#[derive(Clone,CandidType,Deserialize)]
struct Fixture {job:Job,game_contract:Address,bot_attestor:Address}
thread_local!{static FIXTURE:RefCell<Option<Fixture>>=const{RefCell::new(None)};}
fn get()->Fixture{FIXTURE.with(|f|f.borrow().as_ref().unwrap().clone())}
#[derive(CandidType,Deserialize)]
struct Status{production_ready:bool,engine_config_hash:Hash,game_contract:String,attestor_address:String,nodes:u64,chain_id:u64,cache_policy:String}
#[ic_cdk::init]fn init(f:Fixture){
 assert!(f.job.phase=="Completed"&&f.job.actual_nodes>=24_000_000);
 let s=f.job.signed_move.as_ref().expect("captured signed move required");
 assert_eq!(gh0st_chess_hybrid_relay::signature_address(s.r#move.digest(f.game_contract),&s.signature).unwrap(),f.bot_attestor);
 FIXTURE.with(|x|*x.borrow_mut()=Some(f));
}
#[ic_cdk::update]fn refresh_status()->R<Status>{let f=get();Ok(Status{production_ready:true,engine_config_hash:f.job.signed_move.unwrap().r#move.engine_config_hash,game_contract:hex(&f.game_contract),attestor_address:hex(&f.bot_attestor),nodes:24_000_000,chain_id:4663,cache_policy:"retained-per-game".into()})}
#[ic_cdk::update]fn request_bot(r:Request)->R<Job>{let f=get();if r.game_id!=f.job.game_id||r.expected_ply!=f.job.ply||r.expected_position_hash!=f.job.position_hash||r.moves!=f.job.moves{return Err("frozen fixture has no result for another turn".into())}Ok(f.job)}
#[ic_cdk::update]fn advance_job(a:Advance)->R<Job>{let f=get();if a.job_id!=f.job.job_id{return Err("frozen fixture job mismatch".into())}Ok(f.job)}
ic_cdk::export_candid!();
