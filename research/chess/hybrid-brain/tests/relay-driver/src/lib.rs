//! TEST ONLY: actual inter-canister caller for protected-relay isolation tests.
use candid::Principal;
use std::cell::Cell;
thread_local! { static TARGET: Cell<Principal> = const { Cell::new(Principal::anonymous()) }; }
#[ic_cdk::init] fn init(target: Principal) { TARGET.with(|t|t.set(target)); }
#[ic_cdk::update] async fn drive(method: String, payload: Vec<u8>) -> Result<Vec<u8>, String> {
    if !["refresh_status", "request_bot", "advance_job"].contains(&method.as_str()) { return Err("test method denied".into()); }
    ic_cdk::call::Call::bounded_wait(TARGET.with(Cell::get), &method).with_raw_args(&payload)
        .await.map(|r|r.into_bytes()).map_err(|e|e.to_string())
}
