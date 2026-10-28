#![allow(deprecated)] // CDK 0.18 API pinned; upgrade deliberately, with Candid checks.
pub mod core;
pub mod persona;
pub mod retention;
pub mod swaps;
pub mod types;

use core::*;
use ic_cdk::api::management_canister::{
    ecdsa::{
        ecdsa_public_key, EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument,
    },
    http_request::{
        http_request, CanisterHttpRequestArgument, HttpMethod, HttpResponse, TransformArgs,
        TransformContext,
    },
    main::{canister_status, CanisterIdRecord},
};
use ic_cdk::{init, post_upgrade, pre_upgrade, query, update};
use ic_cdk::management_canister as management;
use serde_json::{json, Value};
use std::cell::RefCell;
use types::*;

thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
const RPC_MAX_RESPONSE_BYTES: u64 = 65_536;
// This includes the longest allowed URL (512 bytes), JSON-RPC request body,
// HTTP header names/values and transform method/context. Keep admission reserve
// independent of a particular subnet's node count or current cycle schedule.
const RPC_MAX_REQUEST_BYTES: u64 = 4_096;
const RPC_VERIFICATION_CALLS: u128 = 8;
// Working-cycle cushion, in addition to the current system-quoted signature
// and HTTP fees. This is a balance reserve, not a cap on the attached fee.
const EXECUTION_RESERVE: u128 = 10_000_000_000;

fn rpc_request_bytes(args: &CanisterHttpRequestArgument) -> u64 {
    // Same charged-byte definition as the pinned CDK 0.18.7
    // management_canister::cost_http_request: URL, headers, body, transform
    // method and context, rather than the Candid-encoded envelope length.
    (args.url.len()
        + args
            .headers
            .iter()
            .map(|header| header.name.len() + header.value.len())
            .sum::<usize>()
        + args.body.as_ref().map_or(0, Vec::len)
        + args.transform.as_ref().map_or(0, |transform| {
            transform.function.0.method.len() + transform.context.len()
        })) as u64
}

fn rpc_cycle_allowance(
    args: &CanisterHttpRequestArgument,
    current_cost: impl FnOnce(u64, u64) -> u128,
) -> Result<u128, String> {
    let request_bytes = rpc_request_bytes(args);
    if request_bytes > RPC_MAX_REQUEST_BYTES
        || args.max_response_bytes != Some(RPC_MAX_RESPONSE_BYTES)
    {
        return Err("RPC request exceeds its bounded cycle reserve".into());
    }
    Ok(current_cost(request_bytes, RPC_MAX_RESPONSE_BYTES))
}

fn signing_args(key_name: &str, digest: [u8; 32]) -> management::SignWithEcdsaArgs {
    management::SignWithEcdsaArgs {
        message_hash: digest.to_vec(),
        derivation_path: derivation(),
        key_id: management::EcdsaKeyId {
            curve: management::EcdsaCurve::Secp256k1,
            name: key_name.into(),
        },
    }
}

fn signing_reserve(key_name: &str) -> Result<u128, String> {
    let fee = management::cost_sign_with_ecdsa(&signing_args(key_name, [0; 32]))
        .map_err(|error| format!("ECDSA fee: {error}"))?;
    Ok(fee + EXECUTION_RESERVE)
}

fn rpc_verification_reserve(key_name: &str) -> Result<u128, String> {
    Ok(signing_reserve(key_name)?
        + RPC_VERIFICATION_CALLS
            * ic_cdk::api::cost_http_request(RPC_MAX_REQUEST_BYTES, RPC_MAX_RESPONSE_BYTES))
}

fn config() -> Config {
    STATE.with(|s| s.borrow().config.clone().expect("not initialized"))
}
fn authorized() -> Result<(), String> {
    let caller = ic_cdk::caller();
    STATE.with(|s| {
        let s = s.borrow();
        if s.owner == Some(caller) || s.config.as_ref().map(|c| c.worker) == Some(caller) {
            Ok(())
        } else {
            Err("unauthorized".into())
        }
    })
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000_000
}
fn key_id(c: &Config) -> EcdsaKeyId {
    EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: c.ecdsa_key_name.clone(),
    }
}
fn derivation() -> Vec<Vec<u8>> {
    vec![b"gh0st-rh-icp-v1".to_vec()]
}
fn cache(j: &Job) -> String {
    match &j.voice {
        Some(v) => format!(
            "gh0st-{}-{}.cache",
            j.request.id.trim_start_matches("0x"),
            persona::generation_cache_tag(v)
        ),
        None => format!("gh0st-{}.cache", j.request.id.trim_start_matches("0x")),
    }
}

#[init]
fn init(c: Config) {
    validate_config(&c).unwrap_or_else(|e| ic_cdk::trap(&e));
    STATE.with(|s| {
        *s.borrow_mut() = State {
            owner: Some(ic_cdk::caller()),
            config: Some(c),
            ..State::default()
        }
    });
}
#[pre_upgrade]
fn pre_upgrade() {
    STATE.with(|s| ic_cdk::storage::stable_save((s.borrow().clone(),)).expect("stable save"));
}
#[post_upgrade]
fn post_upgrade() {
    let (mut state,): (State,) = ic_cdk::storage::stable_restore().expect("stable restore");
    let restored_config = state.config.clone();
    // Never silently replay an interrupted model call: it may have committed.
    for job in state.jobs.values_mut() {
        if job.busy {
            job.busy = false;
            if let Some(c) = &restored_config {
                hold_job(c, job, "upgrade interrupted a call; reconcile before resubmission");
                job.recovery.as_mut().unwrap().accounting_uncertain = true;
            } else {
                job.phase = Phase::Failed;
                job.error = "upgrade interrupted a call; reconcile before resubmission".into();
            }
        }
    }
    state.verifying = false;
    if let Some(voice) = state.voice.as_mut() {
        voice.remembering = None;
    }
    if state
        .active
        .as_ref()
        .is_some_and(|id| state.jobs.get(id).is_none_or(|j| j.phase == Phase::Failed))
    {
        state.active = None;
    }
    STATE.with(|s| *s.borrow_mut() = state);
}
#[query]
fn get_config() -> Config {
    config()
}
#[query]
fn get_job(id: String) -> Option<Job> {
    STATE.with(|s| s.borrow().jobs.get(&id.to_lowercase()).cloned())
}
#[query]
fn list_jobs() -> Vec<Job> {
    STATE.with(|s| s.borrow().jobs.values().cloned().collect())
}
/// Bounded operational status; completed/failed history consumes no work slot.
#[query]
fn retention_status() -> retention::RetentionStatus {
    STATE.with(|s| retention::status(&s.borrow()))
}
/// Prefer this bounded history reader to the legacy full-history list_jobs.
#[query]
fn list_jobs_page(after: Option<String>, limit: u32) -> retention::JobPage {
    STATE.with(|s| retention::page(&s.borrow(), after.as_deref(), limit)
        .unwrap_or_else(|e| ic_cdk::trap(&e)))
}
#[query]
fn get_voice_state() -> VoiceState {
    STATE.with(|s| s.borrow().voice.clone().unwrap_or_default())
}
#[update]
fn set_paused(value: bool) -> Result<(), String> {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.owner != Some(ic_cdk::caller()) {
            return Err("unauthorized".into());
        }
        s.paused = value;
        Ok(())
    })
}

/// The canister must exist to derive its key before the EVM gateway is deployed.
/// Bind that gateway once; later changes require a separately reviewed upgrade.
#[update]
fn bind_gateway(gateway: String) -> Result<(), String> {
    let value = bytes(&gateway, 20)?;
    if value == vec![0; 20] {
        return Err("zero gateway".into());
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.owner != Some(ic_cdk::caller()) {
            return Err("unauthorized".into());
        }
        let c = s.config.as_mut().ok_or("not initialized")?;
        if bytes(&c.gateway, 20)? != vec![0; 20] {
            return Err("gateway already bound".into());
        }
        c.gateway = gateway.to_lowercase();
        Ok(())
    })
}

/// Owner-reviewed artifact migration only. Never grants model budget or changes
/// the worker, model, chain, source IDs, prompts or existing result signatures.
#[update]
fn rebind_gateway(expected_gateway: String, expected_artifact_hash: String,
    gateway: String, artifact_hash: String) -> Result<(), String> {
    STATE.with(|s| rebind_state(&mut s.borrow_mut(), ic_cdk::caller(),
        &expected_gateway, &expected_artifact_hash, &gateway, &artifact_hash))
}

/// Explicit bounded owner recovery; workers cannot grant themselves more work.
#[update]
async fn recover_job(id: String, additional_budget: u128) -> Result<Job, String> {
    let id = id.to_lowercase();
    bytes(&id, 32)?;
    let uncertain = STATE.with(|s| {
        let s = s.borrow();
        if s.owner != Some(ic_cdk::caller()) || !s.paused || s.verifying || s.jobs.values().any(|j| j.busy) {
            return Err("owner must pause and reconcile in-flight work".to_string());
        }
        Ok(s.jobs.get(&id).ok_or("unknown recovery source")?.recovery.as_ref()
            .is_some_and(|r| r.accounting_uncertain))
    })?;
    let balance = if uncertain {
        STATE.with(|s| s.borrow_mut().verifying = true);
        let result = model_balance(&config()).await;
        STATE.with(|s| s.borrow_mut().verifying = false);
        Some(result?)
    } else { None };
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let mut candidate = s.clone();
        if let Some(balance) = balance {
            let job = candidate.jobs.get_mut(&id).ok_or("unknown recovery source")?;
            update_model_cost(job, balance)?;
            job.recovery.as_mut().ok_or("missing uncertain accounting")?.accounting_uncertain = false;
        }
        let recovered = recover_state(&mut candidate, ic_cdk::caller(), &id, additional_budget, now())?;
        *s = candidate;
        Ok(recovered)
    })
}

#[update]
fn resume_job(id: String) -> Result<Job, String> {
    let id = id.to_lowercase(); bytes(&id, 32)?;
    STATE.with(|s| resume_state(&mut s.borrow_mut(), ic_cdk::caller(), &id, now()))
}

#[update]
fn enable_unlimited_swaps(expected_budget: u128) -> Result<(), String> {
    STATE.with(|s| enable_unlimited_state(&mut s.borrow_mut(), ic_cdk::caller(), expected_budget))
}
#[update]
fn defer_failed_swap(id: String, expected_cycles: u128, reason: String) -> Result<(), String> {
    let id=id.to_lowercase(); bytes(&id,32)?;
    STATE.with(|s| defer_failed_state(&mut s.borrow_mut(),ic_cdk::caller(),&id,expected_cycles,&reason,now()))
}
#[query]
fn get_deferred_swaps() -> Vec<DeferredSwap> { STATE.with(|s| s.borrow().deferred_swaps.clone().unwrap_or_default()) }
#[update]
fn resume_retained_job(id: String, expected_cycles: u128, expected_chunks: u32, cache_evidence_hash: String) -> Result<Job,String> {
    let id=id.to_lowercase(); bytes(&id,32)?;
    STATE.with(|s| resume_retained_state(&mut s.borrow_mut(),ic_cdk::caller(),&id,expected_cycles,expected_chunks,&cache_evidence_hash))
}

/// Canonical JSON and no volatile HTTP headers, so IC nodes agree on replies.
#[query]
fn transform(args: TransformArgs) -> HttpResponse {
    let mut response = args.response;
    response.headers = vec![];
    if let Ok(v) = serde_json::from_slice::<Value>(&response.body) {
        // Retain only the JSON-RPC result/error; providers sometimes add metadata.
        response.body =
            serde_json::to_vec(&json!({"result":v.get("result"),"error":v.get("error")})).unwrap();
    }
    response
}

async fn rpc(url: &str, method: &str, params: Value) -> Result<Value, String> {
    let args = CanisterHttpRequestArgument {
        url: url.into(),
        max_response_bytes: Some(RPC_MAX_RESPONSE_BYTES),
        method: HttpMethod::POST,
        headers: vec![ic_cdk::api::management_canister::http_request::HttpHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body: Some(
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
                .unwrap(),
        ),
        transform: Some(TransformContext::from_name("transform".into(), vec![])),
    };
    let cycles = rpc_cycle_allowance(&args, ic_cdk::api::cost_http_request)?;
    if ic_cdk::api::canister_balance128() < signing_reserve(&config().ecdsa_key_name)? + cycles {
        return Err("coordinator cycle reserve too low for RPC".into());
    }
    let (response,) = http_request(args, cycles)
        .await
        .map_err(|e| format!("RPC transport: {e:?}"))?;
    if response.status != candid::Nat::from(200u16) {
        return Err("RPC HTTP failure".into());
    }
    let body: Value = serde_json::from_slice(&response.body).map_err(|_| "RPC JSON failure")?;
    if !body["error"].is_null() || body["result"].is_null() {
        return Err("RPC error or unconfirmed data".into());
    }
    Ok(body["result"].clone())
}

async fn verify_request(c: &Config, tx: &str, log_index: u64) -> Result<Request, String> {
    bytes(tx, 32)?;
    if bytes(&c.gateway, 20)? == vec![0; 20] {
        return Err("gateway not bound".into());
    }
    let mut agreed: Option<Request> = None;
    for url in &c.rpc_urls {
        if quantity(&rpc(url, "eth_chainId", json!([])).await?)? != c.chain_id {
            return Err("RPC chain mismatch".into());
        }
        let receipt = rpc(url, "eth_getTransactionReceipt", json!([tx])).await?;
        let req = parse_receipt(&receipt, c, tx, log_index)?;
        let anchor = req
            .block_number
            .checked_add(c.confirmations)
            .ok_or("block overflow")?;
        let block = format!("0x{anchor:x}");
        // A numbered descendant exists. No changing `latest` response to break
        // HTTP-outcall consensus between replicas. This is confirmation depth,
        // not a cryptographic/L1-finality proof.
        quantity(&rpc(url, "eth_getBlockTransactionCountByNumber", json!([block])).await?)?;
        let calldata = format!(
            "{}{}",
            hex0(&hash("requests(bytes32)")[..4]),
            req.id.trim_start_matches("0x")
        );
        let value = rpc(
            url,
            "eth_call",
            json!([{"to":c.gateway,"data":calldata},block]),
        )
        .await?;
        let data = hex::decode(
            value
                .as_str()
                .ok_or("bad gateway state")?
                .trim_start_matches("0x"),
        )
        .map_err(|_| "bad gateway hex")?;
        let state = ethabi::decode(
            &[
                ethabi::ParamType::Address,
                ethabi::ParamType::Uint(32),
                ethabi::ParamType::Uint(64),
                ethabi::ParamType::Uint(8),
                ethabi::ParamType::FixedBytes(32),
                ethabi::ParamType::FixedBytes(32),
            ],
            &data,
        )
        .map_err(|_| "gateway state ABI")?;
        if state[3].clone().into_uint() != Some(1u64.into())
            || state[0].clone().into_address().map(|a| hex0(a.as_bytes()))
                != Some(req.requester.clone())
            || state[1].clone().into_uint() != Some(req.max_tokens.into())
            || state[2].clone().into_uint() != Some(req.deadline.into())
            || state[4].clone().into_fixed_bytes().map(hex0) != Some(req.prompt_hash.clone())
        {
            return Err("request no longer pending or state mismatch".into());
        }
        framed_prompt(&req.prompt)?;
        if req.deadline <= now() + 120 {
            return Err("request needs at least 120 seconds before deadline".into());
        }
        if agreed.as_ref().is_some_and(|previous| previous != &req) {
            return Err("RPC providers disagree".into());
        }
        agreed = Some(req);
    }
    agreed.ok_or_else(|| "no providers".into())
}

#[update]
async fn submit_request(tx_hash: String, log_index: u64) -> Result<Job, String> {
    authorized()?;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        retention::require_admission(&s)?;
        s.verifying = true;
        Ok::<(), String>(())
    })?;
    let verified = verify_request(&config(), &tx_hash, log_index).await;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.verifying = false;
        let request = verified?;
        if let Some(job) = s.jobs.get(&request.id) {
            return Ok(job.clone());
        }
        let job = Job::new(request);
        s.active = Some(job.request.id.clone());
        s.jobs.insert(job.request.id.clone(), job.clone());
        Ok(job)
    })
}

async fn verify_swap(c: &Config, tx: &str, log_index: u64) -> Result<swaps::VerifiedSwap, String> {
    bytes(tx, 32)?;
    if bytes(&c.gateway, 20)? == vec![0; 20] {
        return Err("gateway not bound".into());
    }
    if c.swap_sources.as_deref().unwrap_or_default().is_empty() {
        return Err("no registered swap sources".into());
    }
    let mut agreed: Option<swaps::VerifiedSwap> = None;
    for url in &c.rpc_urls {
        if quantity(&rpc(url, "eth_chainId", json!([])).await?)? != c.chain_id {
            return Err("RPC chain mismatch".into());
        }
        let receipt = rpc(url, "eth_getTransactionReceipt", json!([tx])).await?;
        let swap = swaps::parse_swap_receipt(&receipt, c, tx, log_index)?;
        let anchor = swap
            .block_number
            .checked_add(c.confirmations)
            .ok_or("block overflow")?;
        quantity(
            &rpc(
                url,
                "eth_getBlockTransactionCountByNumber",
                json!([format!("0x{anchor:x}")]),
            )
            .await?,
        )?;
        // Read the receipt again after establishing confirmation depth. An
        // orphaned or changed receipt fails instead of triggering inference.
        let confirmed = rpc(url, "eth_getTransactionReceipt", json!([tx])).await?;
        if swaps::parse_swap_receipt(&confirmed, c, tx, log_index)? != swap {
            return Err("swap receipt changed during confirmation verification".into());
        }
        if agreed.as_ref().is_some_and(|previous| previous != &swap) {
            return Err("RPC providers disagree on swap".into());
        }
        agreed = Some(swap);
    }
    agreed.ok_or_else(|| "no providers".into())
}

/// A confirmed existing-pool Swap log can start inference without modifying the
/// pool or creating a separate RH request transaction. The caller supplies only
/// the transaction hash and log index; source facts and prompt are derived here.
#[update]
async fn submit_swap(tx_hash: String, log_index: u64) -> Result<Job, String> {
    authorized()?;
    bytes(&tx_hash, 32)?;
    let tx_hash = tx_hash.to_lowercase();
    // Retrieval is idempotent even while another job is active or the queue is
    // paused/full, and avoids repeating verification costs for a known source.
    if let Some(job) = STATE.with(|s| retention::known_swap(&s.borrow(), &tx_hash, log_index)) {
        return Ok(job);
    }
    if ic_cdk::api::canister_balance128() < rpc_verification_reserve(&config().ecdsa_key_name)? {
        return Err("coordinator cycle reserve too low for swap verification".into());
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        retention::require_admission(&s)?;
        s.verifying = true;
        Ok::<(), String>(())
    })?;
    let verified = verify_swap(&config(), &tx_hash, log_index).await;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.verifying = false;
        let swap = verified?;
        let (request, voice) = persona::create_request(
            s.config.as_ref().ok_or("not initialized")?,
            &swap,
            now(),
            &s.voice.clone().unwrap_or_default(),
        )?;
        if let Some(job) = s.jobs.get(&request.id) {
            return Ok(job.clone());
        }
        let mut job = Job::new(request);
        job.source = Some(swap.source);
        job.voice = Some(voice);
        s.active = Some(job.request.id.clone());
        s.jobs.insert(job.request.id.clone(), job.clone());
        Ok(job)
    })
}

async fn model_balance(c: &Config) -> Result<u128, String> {
    let (status,) = canister_status(CanisterIdRecord {
        canister_id: c.model_canister,
    })
    .await
    .map_err(|e| format!("model status (coordinator must be controller): {e:?}"))?;
    if status.module_hash.as_ref() != Some(&bytes(&c.model_wasm_hash, 32)?) {
        return Err("model Wasm hash differs from pinned build".into());
    }
    cycle_balance_u128(&status.cycles)
}

fn cycle_balance_u128(cycles: &candid::Nat) -> Result<u128, String> {
    // Nat's Display adds digit separators. Convert the underlying BigUint
    // directly so valid cycle balances do not fail a decimal string parse.
    u128::try_from(&cycles.0).map_err(|_| "cycle balance overflow".into())
}
async fn model_call(c: &Config, method: &str, args: Vec<String>) -> Result<ModelOutput, String> {
    // A balance floor is an admission check, never a cumulative job ceiling.
    // run_update_full still obeys the pinned model's per-message limits.
    if ["new_chat", "run_update", "run_update_full"].contains(&method) && model_balance(c).await? < 3_000_000_000_000 + CHUNK_RESERVE {
        return Err("model balance reserve too low; retain this job and cache".into());
    }
    let (r,): (ModelResult,) = ic_cdk::call(c.model_canister, method, (ModelInput { args },))
        .await
        .map_err(|e| format!("model call failed; do not replay blindly: {e:?}"))?;
    match r {
        ModelResult::Ok(v) if v.status_code == 200 => Ok(v),
        ModelResult::Err(v) | ModelResult::Ok(v) => {
            Err(format!("model status {}: {}", v.status_code, v.error))
        }
    }
}
fn generation_method(prompt_ingested: bool, swap: bool) -> &'static str {
    if swap && !prompt_ingested { "run_update_full" } else { "run_update" }
}
async fn prepare_next_candidate(c: &Config, j: &mut Job, reason: &str) -> Result<(),String> {
    // Delete only a completed, rejected candidate. Its text/cost already passed
    // accounting; the next cache has a distinct arbitrary-precision identity.
    if unlimited_swap(c,j) {
        model_call(c,"remove_prompt_cache",vec!["--prompt-cache".into(),cache(j)]).await?;
        update_model_cost(j,model_balance(c).await?)?;
    }
    persona::prepare_repair_with_policy(j,reason,unlimited_swap(c,j))
}

async fn public_key(c: &Config) -> Result<Vec<u8>, String> {
    let (r,) = ecdsa_public_key(EcdsaPublicKeyArgument {
        canister_id: None,
        derivation_path: derivation(),
        key_id: key_id(c),
    })
    .await
    .map_err(|e| format!("ECDSA key: {e:?}"))?;
    Ok(r.public_key)
}
#[update]
async fn signer_address() -> Result<String, String> {
    authorized()?;
    let key = public_key(&config()).await?;
    let pk = k256::PublicKey::from_sec1_bytes(&key).map_err(|_| "bad public key")?;
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    Ok(hex0(
        &hash(&pk.to_encoded_point(false).as_bytes()[1..])[12..],
    ))
}
async fn step(c: &Config, j: &mut Job) -> Result<(), String> {
    if job_deadline(c, j) != 0 && job_deadline(c, j) <= now() {
        return Err("request expired".into());
    }
    if ic_cdk::api::canister_balance128() < rpc_verification_reserve(&c.ecdsa_key_name)? {
        return Err("coordinator cycle reserve too low".into());
    }
    if j.voice
        .as_ref()
        .is_some_and(|v| v.profile_hash != persona::profile_hash())
    {
        return Err("persona profile changed during this job; inspect the retained source".into());
    }
    match j.phase {
        Phase::Verified => {
            if !unlimited_swap(c,j) && j.voice.as_ref().is_some_and(|v| v.attempt > 1)
                && (j.chunks >= persona::max_chunks(j)
                    || j.model_cycles.checked_add(CHUNK_RESERVE).is_none_or(|n| n > job_budget(c, j)))
            {
                return Err("persona repair has no remaining model cycle/chunk reserve".into());
            }
            // A quality repair is a new cache, not a new budget. Preserve the
            // first attempt's baseline across all later model calls.
            if j.recovery.as_ref().is_some_and(|r| r.rebuilding) {
                let baseline = model_balance(c).await?;
                j.recovery.as_mut().unwrap().segment_baseline = Some(baseline);
            } else if j.voice.as_ref().is_none_or(|v| v.attempt == 1) {
                j.model_cycles_before = model_balance(c).await?;
            }
            model_call(
                c,
                "new_chat",
                vec![
                    "--prompt-cache".into(),
                    cache(j),
                    "--cache-type-k".into(),
                    "q8_0".into(),
                    "--cache-type-v".into(),
                    "q8_0".into(),
                ],
            )
            .await?;
            let after = model_balance(c).await?;
            update_model_cost(j, after)?;
            if job_budget(c,j) != 0 && j.model_cycles > job_budget(c, j) {
                return Err("model cycle budget exceeded while preparing cache".into());
            }
            j.phase = Phase::Running;
        }
        Phase::Running => {
            if !unlimited_swap(c,j) && (j.chunks >= persona::max_chunks(j)
                || j.model_cycles.checked_add(CHUNK_RESERVE).is_none_or(|n| n > job_budget(c, j)))
            {
                return Err("model cycle/chunk budget reached".into());
            }
            let replaying = j.recovery.as_ref().is_some_and(|r| r.rebuilding && r.replay_target_tokens > 0);
            let remaining = if replaying {
                let r = j.recovery.as_ref().unwrap();
                r.replay_target_tokens.checked_sub(r.replay_tokens).ok_or("replay token overflow")?
            } else { u64::from(j.request.max_tokens).checked_sub(j.output_tokens).ok_or("token overflow")? };
            if remaining == 0 {
                return Err("unexpected exhausted token budget".into());
            }
            let ingested = j.recovery.as_ref().filter(|r| r.rebuilding)
                .map_or(j.prompt_ingested, |r| r.replay_prompt_ingested);
            let prompt = if ingested {
                String::new()
            } else {
                framed_prompt(&j.request.prompt)?
            };
            let mut args = vec![
                "--prompt-cache".into(),
                cache(j),
                "--prompt-cache-all".into(),
                "--cache-type-k".into(),
                "q8_0".into(),
                "--cache-type-v".into(),
                "q8_0".into(),
            ];
            let per_call = if let Some(v) = &j.voice {
                let p = persona::profile();
                args.extend(vec![
                    "--temp".into(),
                    p.sampling.temperature.to_string(),
                    "--top-p".into(),
                    p.sampling.top_p.to_string(),
                    "--top-k".into(),
                    p.sampling.top_k.to_string(),
                    "--min-p".into(),
                    p.sampling.min_p.to_string(),
                    "--repeat-penalty".into(),
                    p.sampling.repeat_penalty.to_string(),
                    "--repeat-last-n".into(),
                    "64".into(),
                    "--seed".into(),
                    persona::generation_seed(&j.request.id, v,
                        if replaying { j.recovery.as_ref().unwrap().replay_tokens } else { j.output_tokens })?
                        .to_string(),
                ]);
                if !p.sampling.grammar.is_empty() {
                    args.extend(vec!["--grammar".into(), p.sampling.grammar.clone()]);
                }
                p.sampling.tokens_per_call
            } else {
                args.extend(vec![
                    "--temp".into(),
                    "0".into(),
                    "--seed".into(),
                    "42".into(),
                    "--repeat-penalty".into(),
                    "1.1".into(),
                ]);
                16
            };
            args.extend(vec![
                "-p".into(),
                prompt,
                "-n".into(),
                remaining.min(per_call).to_string(),
            ]);
            let r = model_call(c, generation_method(ingested, j.source.is_some()), args).await?;
            let tokens = r
                .n_tokens_generated
                .ok_or("upstream exact-token accounting missing")?;
            if tokens > remaining.min(per_call) {
                return Err("model exceeded token cap".into());
            }
            j.chunks = if unlimited_swap(c,j) { j.chunks.saturating_add(1) } else { j.chunks.checked_add(1).ok_or("chunk count overflow")? };
            j.input_tokens = j
                .input_tokens
                .max(r.n_prompt_tokens.ok_or("prompt accounting missing")?);
            let prompt_ingested = r
                .n_prompt_tokens_remaining
                .ok_or("remaining prompt accounting missing")?
                == 0
                && r.prompt_remaining.is_empty();
            let replay_finished = if replaying {
                apply_replay(j, &r.output, tokens, prompt_ingested, r.generated_eog)?
            } else {
                j.output_tokens += tokens;
                j.prompt_ingested = prompt_ingested;
                j.answer.push_str(&r.output);
                if let Some(recovery) = &mut j.recovery {
                    if recovery.rebuilding {
                        recovery.replay_prompt_ingested = prompt_ingested;
                        if prompt_ingested { recovery.rebuilding = false; }
                    }
                }
                true
            };
            if j.answer.len() > 8192 {
                return Err("answer byte cap exceeded".into());
            }
            let after = model_balance(c).await?;
            update_model_cost(j, after)?;
            if job_budget(c,j) != 0 && j.model_cycles > job_budget(c, j) {
                return Err("model cycle budget exceeded".into());
            }
            if replay_finished && (r.generated_eog || j.output_tokens == u64::from(j.request.max_tokens)) {
                if j.voice.is_none() && (j.answer.trim().is_empty() || j.output_tokens == 0) {
                    return Err("empty model response".into());
                }
                if j.voice.is_some() {
                    let recent = STATE.with(|s| {
                        s.borrow()
                            .voice
                            .as_ref()
                            .map(persona::recent_references)
                            .unwrap_or_default()
                    });
                    match persona::validate_thought(&j.answer, &recent) {
                        Ok(answer) => j.answer = answer,
                        Err(reason) => {
                            prepare_next_candidate(c, j, &reason).await?;
                            return Ok(());
                        }
                    }
                }
                j.phase = Phase::ReadyToSign;
            }
        }
        Phase::ReadyToSign => {
            if j.voice.is_some() {
                let recent = STATE.with(|s| {
                    s.borrow()
                        .voice
                        .as_ref()
                        .map(persona::recent_references)
                        .unwrap_or_default()
                });
                if let Err(reason) = persona::validate_thought(&j.answer, &recent) {
                    prepare_next_candidate(c, j, &reason).await?;
                    return Ok(());
                }
            }
            let digest = result_digest(c, j)?;
            let public = public_key(c).await?;
            // CDK's current helper queries the system fee for this key and
            // attaches it, rather than using the legacy fixed 26.15B payment.
            let r = management::sign_with_ecdsa(&signing_args(&c.ecdsa_key_name, digest))
            .await
            .map_err(|e| format!("ECDSA signing: {e:?}"))?;
            let (signature, signer) = recover_signature(&digest, &r.signature, &public)?;
            j.signature = signature;
            j.signer = signer;
            j.digest = hex0(digest);
            j.phase = Phase::Complete;
        }
        Phase::Complete => {}
        Phase::Failed => return Err("failed jobs are retained and never silently replayed".into()),
    }
    Ok(())
}

#[update]
async fn advance(id: String) -> Result<Job, String> {
    authorized()?;
    let id = id.to_lowercase();
    let mut job = STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.paused || s.verifying {
            return Err("paused or verifying".to_string());
        }
        let active = s.active.clone();
        let job = s.jobs.get_mut(&id).ok_or("unknown request")?;
        if job.busy {
            return Err("job already in flight".into());
        }
        if job.phase == Phase::Complete || job.phase == Phase::Failed {
            return Ok(job.clone());
        }
        if job.recovery.as_ref().is_some_and(|r| r.parked || r.requires_owner || r.retry_after > now()) {
            return Ok(job.clone());
        }
        if active.as_deref() != Some(id.as_str()) { return Err("job is not the active model stream".into()); }
        job.busy = true;
        Ok(job.clone())
    })?;
    if job.phase == Phase::Complete || job.phase == Phase::Failed {
        return Ok(job);
    }
    if job.recovery.as_ref().is_some_and(|r| r.parked || r.requires_owner || r.retry_after > now()) {
        return Ok(job);
    }
    let old_phase = job.phase.clone();
    let c = config();
    if let Err(mut e) = step(&c, &mut job).await {
        if old_phase != Phase::ReadyToSign && (job.model_cycles_before != 0 ||
            job.recovery.as_ref().is_some_and(|r| r.segment_baseline.is_some())) {
            match model_balance(&c).await.and_then(|balance| update_model_cost(&mut job, balance)) {
                Ok(()) => {},
                Err(_) => {
                    let mut r = recovery_info(&c, &job); r.accounting_uncertain = true; job.recovery = Some(r);
                    e.push_str("; model accounting requires reconciliation");
                }
            }
        }
        let terminal_voice_error = e.starts_with("persona ") || e.starts_with("repair ");
        job.error = e.clone();
        // Signing retries are safe: the answer/digest are already fixed.
        job.phase = if old_phase == Phase::ReadyToSign
            && (job_deadline(&c,&job) == 0 || job_deadline(&c,&job) > now())
            && !terminal_voice_error
        {
            job.recovery = Some(signing_retry(&c, &job, &e, now()));
            Phase::ReadyToSign
        } else {
            hold_job(&c, &mut job, &e);
            Phase::Failed
        };
    } else {
        job.error.clear();
    }
    job.busy = false;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if job.phase == Phase::Complete && old_phase != Phase::Complete && job.voice.is_some() {
            persona::record_output(s.voice.get_or_insert_with(VoiceState::default), &job.answer);
        }
        if job.phase == Phase::Complete || job.phase == Phase::Failed {
            s.active = None;
        }
        s.jobs.insert(id, job.clone());
    });
    Ok(job)
}

async fn verify_delivered(
    c: &Config,
    job: &Job,
    tx: &str,
    log_index: u64,
) -> Result<persona::DeliveredProof, String> {
    let mut agreed = None;
    for url in &c.rpc_urls {
        if quantity(&rpc(url, "eth_chainId", json!([])).await?)? != c.chain_id {
            return Err("delivery RPC chain mismatch".into());
        }
        let receipt = rpc(url, "eth_getTransactionReceipt", json!([tx])).await?;
        let proof = persona::parse_delivered(&receipt, c, job, tx, log_index)?;
        let anchor = proof
            .block_number
            .checked_add(c.confirmations)
            .ok_or("delivery block overflow")?;
        quantity(
            &rpc(
                url,
                "eth_getBlockTransactionCountByNumber",
                json!([format!("0x{anchor:x}")]),
            )
            .await?,
        )?;
        let reread = rpc(url, "eth_getTransactionReceipt", json!([tx])).await?;
        if persona::parse_delivered(&reread, c, job, tx, log_index)? != proof {
            return Err("delivery receipt changed during verification".into());
        }
        if agreed.as_ref().is_some_and(|previous| previous != &proof) {
            return Err("delivery RPC providers disagree".into());
        }
        agreed = Some(proof);
    }
    agreed.ok_or_else(|| "no delivery providers".into())
}

/// A retained thought becomes character memory only after independently
/// verifying its exact, confirmed RH fulfillment. Repeated acknowledgements are
/// free of repeated RPC work and cannot append duplicate memories.
#[update]
async fn remember_delivered(
    id: String,
    callback_tx_hash: String,
    log_index: u64,
) -> Result<VoiceState, String> {
    authorized()?;
    let id = id.to_lowercase();
    bytes(&callback_tx_hash, 32)?;
    let job = get_job(id.clone()).ok_or("unknown voice request")?;
    let voice = job
        .voice
        .as_ref()
        .ok_or("manual request is not a voice thought")?;
    if job.phase != Phase::Complete || job.source.is_none() {
        return Err("voice thought is not signed and complete".into());
    }
    if voice.remembered {
        return Ok(get_voice_state());
    }
    if ic_cdk::api::canister_balance128() < rpc_verification_reserve(&config().ecdsa_key_name)? {
        return Err("coordinator cycle reserve too low for memory confirmation".into());
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let memory = s.voice.get_or_insert_with(VoiceState::default);
        if memory.remembering.is_some() {
            return Err("another delivery memory verification is in flight".to_string());
        }
        memory.remembering = Some(id.clone());
        Ok(())
    })?;
    let result = verify_delivered(&config(), &job, &callback_tx_hash, log_index).await;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let memory = s.voice.get_or_insert_with(VoiceState::default);
        memory.remembering = None;
        let proof = result?;
        persona::remember_verified(&mut s, &id, &proof)
    })
}

/// Stop a job without repeating or replacing any inference output. An in-flight
/// model call must finish first so its callback cannot overwrite this decision.
#[update]
fn abort(id: String) -> Result<(), String> {
    authorized()?;
    let id = id.to_lowercase();
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let c = s.config.clone().ok_or("not initialized")?;
        let job = s.jobs.get_mut(&id).ok_or("unknown request")?;
        if job.busy {
            return Err("job is in flight".into());
        }
        if job.phase == Phase::Complete {
            return Err("signed result is already complete".into());
        }
        hold_job(&c, job, "stopped by operator; request retained");
        if s.active.as_ref() == Some(&id) {
            s.active = None;
        }
        Ok(())
    })
}

/// Remove stable-memory prompt caches only after completion. Held failed caches
/// remain available for explicit recovery. Does not delete
/// request tombstones or signatures; replay protection survives upgrades.
#[update]
async fn cleanup(id: String) -> Result<(), String> {
    authorized()?;
    if STATE.with(|s| s.borrow().active.is_some() || s.borrow().verifying) {
        return Err(
            "another request is active; cleanup would contaminate its cycle measurement".into(),
        );
    }
    let j = get_job(id).ok_or("unknown request")?;
    if j.busy || j.phase != Phase::Complete {
        return Err("only completed jobs may be cleaned; held recovery caches are retained".into());
    }
    let mut clean = j.clone();
    let cleanup_generations = if j.voice.as_ref().is_some_and(|v| v.generation.is_some()) { 0 } else { j.voice.as_ref().map(|v| v.attempt).unwrap_or(1) };
    for attempt in 1..=cleanup_generations {
        if let Some(v) = clean.voice.as_mut() {
            v.attempt = attempt;
            v.generation = None;
        }
        model_call(
            &config(),
            "remove_prompt_cache",
            vec!["--prompt-cache".into(), cache(&clean)],
        )
        .await?;
    }
    if j.voice.as_ref().is_some_and(|v| v.generation.is_some()) {
        model_call(&config(),"remove_prompt_cache",vec!["--prompt-cache".into(),cache(&j)]).await?;
    }
    Ok(())
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
    #[test]
    fn full_update_only_accelerates_uningested_swap_prompts() {
        assert_eq!(super::generation_method(false,true),"run_update_full");
        assert_eq!(super::generation_method(true,true),"run_update");
        assert_eq!(super::generation_method(false,false),"run_update");
        assert_eq!(super::generation_method(true,false),"run_update");
    }

    #[test]
    fn cycle_balance_conversion_is_exact_despite_nat_display_separators() {
        for expected in [0u128, 999, 1000, 17_122_150_652_073, u64::MAX as u128 + 1, u128::MAX] {
            let value = candid::Nat::from(expected);
            assert_eq!(super::cycle_balance_u128(&value).unwrap(), expected);
        }
        let live_size = candid::Nat::from(17_122_150_652_073u128);
        assert!(live_size.to_string().contains('_'));
        assert!(live_size.to_string().parse::<u128>().is_err());
    }

    #[test]
    fn cycle_balance_conversion_rejects_real_u128_overflow() {
        let too_large = candid::Nat(candid::Nat::from(u128::MAX).0 + 1u8);
        assert_eq!(super::cycle_balance_u128(&too_large).unwrap_err(), "cycle balance overflow");
    }

    #[test]
    fn current_signing_api_preserves_legacy_candid_request_exactly() {
        use ic_cdk::api::management_canister::ecdsa::SignWithEcdsaArgument;
        let digest = [0xa5; 32];
        let legacy = SignWithEcdsaArgument {
            message_hash: digest.to_vec(),
            derivation_path: super::derivation(),
            key_id: super::EcdsaKeyId {
                curve: super::EcdsaCurve::Secp256k1,
                name: "key_1".into(),
            },
        };
        let current = super::signing_args("key_1", digest);
        assert_eq!(candid::encode_one(legacy).unwrap(), candid::encode_one(current).unwrap());
    }

    fn rpc_args() -> super::CanisterHttpRequestArgument {
        use ic_cdk::api::management_canister::http_request::{HttpHeader, TransformFunc};
        super::CanisterHttpRequestArgument {
            url: "https://rpc.example/é".into(),
            max_response_bytes: Some(super::RPC_MAX_RESPONSE_BYTES),
            method: super::HttpMethod::POST,
            headers: vec![HttpHeader { name: "Content-Type".into(), value: "application/json".into() }],
            body: Some(b"{\"method\":\"eth_chainId\"}".to_vec()),
            transform: Some(super::TransformContext {
                function: TransformFunc(candid::Func {
                    principal: candid::Principal::anonymous(), method: "transform".into(),
                }),
                context: vec![1, 2, 3],
            }),
        }
    }

    #[test]
    fn rpc_allowance_uses_current_system_price_and_all_charged_bytes() {
        let args = rpc_args();
        let expected_bytes = "https://rpc.example/é".len() + "Content-Type".len()
            + "application/json".len() + b"{\"method\":\"eth_chainId\"}".len()
            + "transform".len() + 3;
        let cycles = super::rpc_cycle_allowance(&args, |request_bytes, response_bytes| {
            assert_eq!(request_bytes, expected_bytes as u64);
            assert_eq!(response_bytes, 65_536);
            // A 34-node subnet quote may exceed the former hard-coded 1B.
            2_100_000_000
        }).unwrap();
        assert_eq!(cycles, 2_100_000_000);
    }

    #[test]
    fn rpc_allowance_rejects_unbounded_requests_before_pricing() {
        let mut args = rpc_args();
        args.body = Some(vec![0; super::RPC_MAX_REQUEST_BYTES as usize]);
        assert!(super::rpc_cycle_allowance(&args, |_, _| panic!("must not price")).is_err());
        args.body = None;
        args.max_response_bytes = None;
        assert!(super::rpc_cycle_allowance(&args, |_, _| panic!("must not price")).is_err());
    }

    #[test]
    fn export_candid() {
        let did = super::__export_service();
        std::fs::write("coordinator.did", did).unwrap();
    }
    #[test]
    fn stable_state_roundtrip_preserves_large_cycle_counters() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let mut job: super::types::Job = serde_json::from_value(v["job"].clone()).unwrap();
        job.model_cycles_before = u128::MAX - 1;
        job.model_cycles = u128::MAX / 2;
        let mut state = super::types::State::default();
        state.jobs.insert(job.request.id.clone(), job);
        let encoded = candid::encode_args((state,)).unwrap();
        let (decoded,): (super::types::State,) = candid::decode_args(&encoded).unwrap();
        assert_eq!(
            decoded.jobs.values().next().unwrap().model_cycles_before,
            u128::MAX - 1
        );
        assert_eq!(
            decoded.jobs.values().next().unwrap().model_cycles,
            u128::MAX / 2
        );
    }
}
