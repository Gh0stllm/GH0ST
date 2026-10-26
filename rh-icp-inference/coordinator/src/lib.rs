#![allow(deprecated)] // CDK 0.18 API pinned; upgrade deliberately, with Candid checks.
pub mod core;
pub mod persona;
pub mod swaps;
pub mod types;

use core::*;
use ic_cdk::api::management_canister::{
    ecdsa::{
        ecdsa_public_key, sign_with_ecdsa, EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgument,
        SignWithEcdsaArgument,
    },
    http_request::{
        http_request, CanisterHttpRequestArgument, HttpMethod, HttpResponse, TransformArgs,
        TransformContext,
    },
    main::{canister_status, CanisterIdRecord},
};
use ic_cdk::{init, post_upgrade, pre_upgrade, query, update};
use serde_json::{json, Value};
use std::cell::RefCell;
use types::*;

thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
const RPC_CYCLES: u128 = 1_000_000_000;
const MAX_JOBS: usize = 256;
const SIGNING_RESERVE: u128 = 35_000_000_000;

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
            "gh0st-{}-a{}.cache",
            j.request.id.trim_start_matches("0x"),
            v.attempt
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
    // Never silently replay an interrupted model call: it may have committed.
    for job in state.jobs.values_mut() {
        if job.busy {
            job.busy = false;
            job.phase = Phase::Failed;
            job.error = "upgrade interrupted a call; reconcile before resubmission".into();
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
        max_response_bytes: Some(65_536),
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
    let (response,) = http_request(args, RPC_CYCLES)
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
        if s.paused || s.verifying || s.active.is_some() || s.jobs.len() >= MAX_JOBS {
            return Err("paused, busy, or job retention limit reached".to_string());
        }
        s.verifying = true;
        Ok(())
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
    if let Some(job) = STATE.with(|s| {
        s.borrow()
            .jobs
            .values()
            .find(|j| {
                j.source.is_some()
                    && j.request.tx_hash == tx_hash
                    && j.request.log_index == log_index
            })
            .cloned()
    }) {
        return Ok(job);
    }
    if ic_cdk::api::canister_balance128() < SIGNING_RESERVE + 8 * RPC_CYCLES {
        return Err("coordinator cycle reserve too low for swap verification".into());
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.paused || s.verifying || s.active.is_some() || s.jobs.len() >= MAX_JOBS {
            return Err("paused, busy, or job retention limit reached".to_string());
        }
        s.verifying = true;
        Ok(())
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
    status
        .cycles
        .to_string()
        .parse()
        .map_err(|_| "cycle balance overflow".into())
}
async fn model_call(c: &Config, method: &str, args: Vec<String>) -> Result<ModelOutput, String> {
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
    if j.request.deadline <= now() {
        return Err("request expired".into());
    }
    if ic_cdk::api::canister_balance128() < SIGNING_RESERVE + 8 * RPC_CYCLES {
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
            if j.voice.as_ref().is_some_and(|v| v.attempt > 1)
                && (j.chunks >= persona::max_chunks(j)
                    || j.model_cycles + CHUNK_RESERVE > c.model_cycle_budget)
            {
                return Err("persona repair has no remaining model cycle/chunk reserve".into());
            }
            // A quality repair is a new cache, not a new budget. Preserve the
            // first attempt's baseline across all later model calls.
            if j.voice.as_ref().is_none_or(|v| v.attempt == 1) {
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
            j.model_cycles = j
                .model_cycles_before
                .checked_sub(after)
                .ok_or("model funded during measurement; retry with a new request")?;
            if j.model_cycles > c.model_cycle_budget {
                return Err("model cycle budget exceeded while preparing cache".into());
            }
            j.phase = Phase::Running;
        }
        Phase::Running => {
            if j.chunks >= persona::max_chunks(j)
                || j.model_cycles + CHUNK_RESERVE > c.model_cycle_budget
            {
                return Err("model cycle/chunk budget reached".into());
            }
            let remaining = u64::from(j.request.max_tokens)
                .checked_sub(j.output_tokens)
                .ok_or("token overflow")?;
            if remaining == 0 {
                return Err("unexpected exhausted token budget".into());
            }
            let prompt = if j.prompt_ingested {
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
                    persona::seed(&j.request.id, v.attempt, j.output_tokens, &v.profile_hash)?
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
            let r = model_call(c, "run_update", args).await?;
            let tokens = r
                .n_tokens_generated
                .ok_or("upstream exact-token accounting missing")?;
            if tokens > remaining.min(per_call) {
                return Err("model exceeded token cap".into());
            }
            j.output_tokens += tokens;
            j.input_tokens = j
                .input_tokens
                .max(r.n_prompt_tokens.ok_or("prompt accounting missing")?);
            j.prompt_ingested = r
                .n_prompt_tokens_remaining
                .ok_or("remaining prompt accounting missing")?
                == 0
                && r.prompt_remaining.is_empty();
            j.answer.push_str(&r.output);
            j.chunks += 1;
            if j.answer.len() > 8192 {
                return Err("answer byte cap exceeded".into());
            }
            let after = model_balance(c).await?;
            j.model_cycles = j
                .model_cycles_before
                .checked_sub(after)
                .ok_or("model funded during measurement; measurement invalid")?;
            if j.model_cycles > c.model_cycle_budget {
                return Err("model cycle budget exceeded".into());
            }
            if r.generated_eog || j.output_tokens == u64::from(j.request.max_tokens) {
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
                            persona::prepare_repair(j, &reason)?;
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
                    persona::prepare_repair(j, &reason)?;
                    return Ok(());
                }
            }
            let digest = result_digest(c, j)?;
            let public = public_key(c).await?;
            let (r,) = sign_with_ecdsa(SignWithEcdsaArgument {
                message_hash: digest.to_vec(),
                derivation_path: derivation(),
                key_id: key_id(c),
            })
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
        if s.paused {
            return Err("paused".to_string());
        }
        let job = s.jobs.get_mut(&id).ok_or("unknown request")?;
        if job.busy {
            return Err("job already in flight".into());
        }
        if job.phase == Phase::Complete || job.phase == Phase::Failed {
            return Ok(job.clone());
        }
        job.busy = true;
        Ok(job.clone())
    })?;
    if job.phase == Phase::Complete || job.phase == Phase::Failed {
        return Ok(job);
    }
    let old_phase = job.phase.clone();
    if let Err(e) = step(&config(), &mut job).await {
        let terminal_voice_error = e.starts_with("persona ") || e.starts_with("repair ");
        job.error = e;
        // Signing retries are safe: the answer/digest are already fixed.
        job.phase = if old_phase == Phase::ReadyToSign
            && job.request.deadline > now()
            && !terminal_voice_error
        {
            Phase::ReadyToSign
        } else {
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
    if ic_cdk::api::canister_balance128() < SIGNING_RESERVE + 8 * RPC_CYCLES {
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
        let job = s.jobs.get_mut(&id).ok_or("unknown request")?;
        if job.busy {
            return Err("job is in flight".into());
        }
        if job.phase == Phase::Complete {
            return Err("signed result is already complete".into());
        }
        job.phase = Phase::Failed;
        job.error = "stopped by operator; request retained".into();
        if s.active.as_ref() == Some(&id) {
            s.active = None;
        }
        Ok(())
    })
}

/// Remove stable-memory prompt caches after completion/failure. Does not delete
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
    if j.busy || !matches!(j.phase, Phase::Complete | Phase::Failed) {
        return Err("job not terminal".into());
    }
    let mut clean = j.clone();
    for attempt in 1..=j.voice.as_ref().map(|v| v.attempt).unwrap_or(1) {
        if let Some(v) = clean.voice.as_mut() {
            v.attempt = attempt;
        }
        model_call(
            &config(),
            "remove_prompt_cache",
            vec!["--prompt-cache".into(), cache(&clean)],
        )
        .await?;
    }
    Ok(())
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
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
