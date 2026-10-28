use crate::types::{Config, DeferredSwap, Job, Phase, RecoveryInfo, Request, State};
use ethabi::{ParamType, Token};
use serde_json::Value;
use sha3::{Digest, Keccak256};

pub const EVENT: &str = "InferenceRequested(bytes32,address,bytes32,bytes32,uint32,uint64,string)";
pub const RESULT: &str = "InferenceResult(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)";
pub const DOMAIN: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
pub const CHUNK_RESERVE: u128 = 40_000_000_000;
pub const MAX_RECOVERY_GRANT: u128 = 2_000_000_000_000;
pub const MAX_RECOVERY_BUDGET: u128 = 4_000_000_000_000;
pub const MAX_RECOVERY_CHUNKS: u32 = 192;
pub const MAX_SIGNING_RETRIES: u32 = 3;

pub fn recovery_info(c: &Config, j: &Job) -> RecoveryInfo {
    j.recovery.clone().unwrap_or(RecoveryInfo {
        total_budget: c.model_cycle_budget, grants: 0, carry_cycles: 0,
        segment_baseline: None, rebuilding: false, replay_target: String::new(),
        replay_target_tokens: 0, replay_output: String::new(), replay_tokens: 0,
        replay_prompt_ingested: false, parked: false, requires_owner: false,
        last_error: String::new(), chunks_at_recovery: j.chunks,
        max_chunks: if unlimited_swap(c,j) {0} else {crate::persona::max_chunks(j)}, retry_after: 0,
        safe_retry_count: 0, resume_deadline: 0, accounting_uncertain: false, cache_evidence_hash: None,
    })
}
pub fn job_budget(c: &Config, j: &Job) -> u128 {
    if j.source.is_some() && c.model_cycle_budget == 0 { return 0; }
    if c.model_cycle_budget == 0 { return MAX_RECOVERY_GRANT; } // Legacy manual-request safety bound.
    j.recovery.as_ref().map_or(c.model_cycle_budget, |r| r.total_budget)
}
pub fn unlimited_swap(c: &Config, j: &Job) -> bool { j.source.is_some() && c.model_cycle_budget == 0 }
pub fn job_deadline(c: &Config, j: &Job) -> u64 {
    if unlimited_swap(c, j) { return 0; }
    j.recovery.as_ref().map_or(j.request.deadline, |r| r.resume_deadline.max(j.request.deadline))
}
pub fn is_deferred(s: &State, id: &str) -> bool {
    s.deferred_swaps.as_ref().is_some_and(|items| items.iter().any(|item| item.id == id))
}
pub fn update_model_cost(j: &mut Job, balance: u128) -> Result<(), String> {
    let (baseline, carry) = match j.recovery.as_ref().and_then(|r| r.segment_baseline.map(|b| (b, r.carry_cycles))) {
        Some(value) => value,
        None if j.model_cycles_before != 0 => (j.model_cycles_before, 0),
        None => return Ok(()), // No model call has started.
    };
    let cost = carry.checked_add(baseline.checked_sub(balance)
        .ok_or("model funded during measurement; explicit reconciliation required")?)
        .ok_or("cumulative model cost overflow")?;
    if cost < j.model_cycles { return Err("model cost moved backwards; explicit reconciliation required".into()); }
    j.model_cycles = cost;
    Ok(())
}
pub fn hold_job(c: &Config, j: &mut Job, reason: &str) {
    let mut r = recovery_info(c, j);
    r.requires_owner = true;
    r.retry_after = 0;
    r.last_error = reason.into();
    j.recovery = Some(r);
    j.error = reason.into();
    j.phase = Phase::Failed;
}
pub fn signing_retry(c: &Config, j: &Job, reason: &str, now: u64) -> RecoveryInfo {
    let mut r = recovery_info(c, j);
    r.safe_retry_count = r.safe_retry_count.saturating_add(1);
    r.last_error = reason.into();
    r.requires_owner = r.safe_retry_count >= MAX_SIGNING_RETRIES;
    r.retry_after = if r.requires_owner { 0 } else { now.saturating_add(1u64 << r.safe_retry_count.min(6)) };
    r
}
pub fn untouched(j: &Job) -> bool {
    j.phase == Phase::Verified && !j.busy && j.model_cycles_before == 0 && j.model_cycles == 0 &&
        j.chunks == 0 && j.input_tokens == 0 && j.output_tokens == 0 && !j.prompt_ingested &&
        j.answer.is_empty() && j.signature.is_empty() && j.digest.is_empty() && j.signer.is_empty()
}
fn owner_paused(s: &State, caller: candid::Principal) -> Result<(), String> {
    if s.owner != Some(caller) { return Err("owner only".into()); }
    if !s.paused || s.verifying || s.jobs.values().any(|j| j.busy) ||
        s.voice.as_ref().is_some_and(|v| v.remembering.is_some()) {
        return Err("pause and reconcile all in-flight work first".into());
    }
    Ok(())
}
fn job_order(j: &Job) -> (u64, u64, &str) {
    (j.request.block_number, j.request.log_index, &j.request.id)
}
pub fn recover_state(s: &mut State, caller: candid::Principal, id: &str, grant: u128, now: u64) -> Result<Job, String> {
    owner_paused(s, caller)?;
    let c = s.config.as_ref().ok_or("not initialized")?;
    let mut target = s.jobs.get(id).cloned().ok_or("unknown recovery source")?;
    let source = target.source.as_ref().ok_or("recovery is limited to retained swap jobs")?;
    if crate::swaps::source_id(c.chain_id, source)? != id || target.request.id != id ||
        target.request.prompt_hash != hex0(hash(target.request.prompt.as_bytes())) {
        return Err("recovery source or prompt binding differs".into());
    }
    if s.jobs.values().any(|j| j.source.is_some() && j.phase != Phase::Complete && !is_deferred(s, &j.request.id) &&
        j.request.id != id && job_order(j) < job_order(&target)) {
        return Err("recover the earliest unfulfilled swap first".into());
    }
    let signing_hold = target.phase == Phase::ReadyToSign &&
        target.recovery.as_ref().is_some_and(|r| r.requires_owner);
    if target.phase != Phase::Failed && !signing_hold { return Err("job is not held for owner recovery".into()); }
    let uncapped = unlimited_swap(c, &target);
    if !uncapped && (grant > MAX_RECOVERY_GRANT || (!signing_hold && grant == 0)) {
        return Err("recovery grant must be positive and at most 2T cycles".into());
    }
    if !uncapped && target.error.starts_with("persona quality gate exhausted") {
        return Err("quality policy exhausted; retain the job for a separately reviewed policy change".into());
    }
    if target.answer.is_empty() != (target.output_tokens == 0) || target.output_tokens > u64::from(target.request.max_tokens) ||
        target.answer.len() > 8192 {
        return Err("retained output checkpoint needs explicit reconciliation".into());
    }
    let mut r = recovery_info(c, &target);
    let budget = if uncapped { 0 } else { r.total_budget.max(target.model_cycles.checked_add(grant).ok_or("recovery budget overflow")?) };
    if r.accounting_uncertain { return Err("model accounting must be reconciled before recovery".into()); }
    if !uncapped && (budget > MAX_RECOVERY_BUDGET || (!signing_hold && target.model_cycles.checked_add(CHUNK_RESERVE).is_none_or(|n| n > budget)) ||
        target.chunks >= MAX_RECOVERY_CHUNKS) {
        return Err("bounded recovery allowance exhausted; job remains held".into());
    }
    let mut next = s.clone();
    if let Some(other_id) = &s.active {
        if other_id != id {
            let other = s.jobs.get(other_id).ok_or("active job missing")?;
            if !untouched(other) || other.source.is_none() || job_order(other) <= job_order(&target) {
                return Err("later active job has model work; explicit checkpoint reconciliation required".into());
            }
            let mut parked = other.clone();
            let mut info = recovery_info(c, &parked);
            info.parked = true;
            info.resume_deadline = if uncapped {0} else {now.checked_add(3600).ok_or("park deadline overflow")?};
            parked.recovery = Some(info);
            next.jobs.insert(other_id.clone(), parked);
        }
    }
    r.total_budget = budget;
    r.requires_owner = false;
    r.parked = false;
    r.last_error = target.error.clone();
    r.retry_after = 0;
    r.safe_retry_count = 0;
    r.resume_deadline = if uncapped {0} else {now.checked_add(3600).ok_or("recovery deadline overflow")?};
    if !signing_hold {
        r.grants = r.grants.saturating_add(1);
        r.carry_cycles = target.model_cycles;
        r.segment_baseline = None;
        r.rebuilding = true;
        r.replay_target = target.answer.clone();
        r.replay_target_tokens = target.output_tokens;
        r.replay_output.clear(); r.replay_tokens = 0; r.replay_prompt_ingested = false;
        r.chunks_at_recovery = target.chunks;
        r.max_chunks = if uncapped { 0 } else { r.max_chunks.max(target.chunks.saturating_add(96)).min(MAX_RECOVERY_CHUNKS) };
        target.phase = Phase::Verified;
    }
    target.error.clear(); target.recovery = Some(r);
    next.jobs.insert(id.into(), target.clone()); next.active = Some(id.into());
    if let Some(items) = &mut next.deferred_swaps { items.retain(|item| item.id != id); }
    *s = next;
    Ok(target)
}
pub fn resume_state(s: &mut State, caller: candid::Principal, id: &str, now: u64) -> Result<Job, String> {
    let worker = s.config.as_ref().ok_or("not initialized")?.worker;
    if s.owner != Some(caller) && caller != worker { return Err("owner or configured worker only".into()); }
    if (s.paused && s.owner != Some(caller)) || s.verifying || s.jobs.values().any(|j| j.busy) ||
        s.voice.as_ref().is_some_and(|v| v.remembering.is_some()) {
        return Err("parked job cannot resume while paused or in flight".into());
    }
    if s.active.is_some() { return Err("another job remains active".into()); }
    let mut target = s.jobs.get(id).cloned().ok_or("unknown parked job")?;
    if !untouched(&target) || !target.recovery.as_ref().is_some_and(|r| r.parked) {
        return Err("job is not a zero-footprint parked swap".into());
    }
    if s.jobs.values().any(|j| j.source.is_some() && j.phase != Phase::Complete && !is_deferred(s, &j.request.id) &&
        j.request.id != id && job_order(j) < job_order(&target)) {
        return Err("an earlier swap remains unfulfilled".into());
    }
    let deadline = job_deadline(s.config.as_ref().unwrap(), &target);
    if deadline != 0 && deadline <= now { return Err("owner-granted parked deadline expired".into()); }
    let r = target.recovery.as_mut().unwrap();
    r.parked = false;
    s.jobs.insert(id.into(), target.clone()); s.active = Some(id.into());
    Ok(target)
}
pub fn enable_unlimited_state(s: &mut State, caller: candid::Principal, expected_budget: u128) -> Result<(), String> {
    owner_paused(s, caller)?;
    let c = s.config.as_mut().ok_or("not initialized")?;
    if c.model_cycle_budget != expected_budget { return Err("execution policy changed since review".into()); }
    c.model_cycle_budget = 0;
    Ok(())
}
pub fn defer_failed_state(s: &mut State, caller: candid::Principal, id: &str, expected_cycles: u128, reason: &str, now: u64) -> Result<(), String> {
    owner_paused(s, caller)?;
    let j = s.jobs.get(id).ok_or("unknown swap")?;
    if j.source.is_none() || j.phase != Phase::Failed || j.model_cycles != expected_cycles ||
        s.active.as_deref() == Some(id) || reason.trim().is_empty() || reason.len() > 240 ||
        j.recovery.as_ref().is_some_and(|r| r.accounting_uncertain) {
        return Err("deferral requires the exact reconciled failed swap and reason".into());
    }
    let items = s.deferred_swaps.get_or_insert_with(Vec::new);
    if items.iter().any(|item| item.id == id) { return Err("swap is already explicitly deferred".into()); }
    items.push(DeferredSwap { id:id.into(), model_cycles:expected_cycles, reason:reason.into(), deferred_at:now });
    Ok(())
}
pub fn resume_retained_state(s: &mut State, caller: candid::Principal, id: &str, expected_cycles: u128, expected_chunks: u32, evidence: &str) -> Result<Job, String> {
    owner_paused(s, caller)?;
    let c = s.config.as_ref().ok_or("not initialized")?;
    let mut j = s.jobs.get(id).cloned().ok_or("unknown retained swap")?;
    let source = j.source.as_ref().ok_or("retained resume is limited to swaps")?;
    if !unlimited_swap(c,&j) || j.phase != Phase::Failed || j.error != "model cycle/chunk budget reached" ||
        j.model_cycles != expected_cycles || j.chunks != expected_chunks || j.model_cycles_before == 0 ||
        !j.answer.is_empty() || j.output_tokens != 0 || j.prompt_ingested || j.voice.is_none() ||
        !j.signature.is_empty() || !j.digest.is_empty() || !j.signer.is_empty() ||
        crate::swaps::source_id(c.chain_id,source)? != id || j.request.id != id ||
        j.request.prompt_hash != hex0(hash(j.request.prompt.as_bytes())) ||
        s.active.as_ref().is_some_and(|active| active != id) ||
        bytes(evidence,32)? == vec![0;32] {
        return Err("retained cache checkpoint differs from reviewed pre-call failure".into());
    }
    if s.jobs.values().any(|other| other.source.is_some() && other.phase != Phase::Complete &&
        other.request.id != id && !is_deferred(s,&other.request.id) && job_order(other) < job_order(&j)) {
        return Err("an earlier swap remains unfulfilled".into());
    }
    let mut r = recovery_info(c,&j);
    if r.accounting_uncertain || r.rebuilding || r.parked { return Err("retained cache requires reconciliation".into()); }
    r.total_budget=0; r.max_chunks=0; r.resume_deadline=0; r.requires_owner=false;
    r.retry_after=0; r.last_error=j.error.clone(); r.cache_evidence_hash=Some(evidence.to_lowercase());
    j.error.clear(); j.phase=Phase::Running; j.recovery=Some(r);
    s.jobs.insert(id.into(),j.clone()); s.active=Some(id.into());
    if let Some(items)=&mut s.deferred_swaps { items.retain(|item| item.id!=id); }
    Ok(j)
}

pub fn rebind_state(s: &mut State, caller: candid::Principal, old_gateway: &str, old_artifact: &str,
    gateway: &str, artifact: &str) -> Result<(), String> {
    owner_paused(s, caller)?;
    // Exact-duplicate filtering can deliberately leave a signed source job
    // unremembered: its answer was already delivered for a distinct source.
    // Keep both immutable records and do not invent a delivery acknowledgement.
    let settled_signed = |j: &Job| j.phase == Phase::Complete && !j.busy && j.signature.len() == 65 &&
        bytes(&j.digest, 32).is_ok() && bytes(&j.signer, 20).is_ok() &&
        !j.recovery.as_ref().is_some_and(|r| r.accounting_uncertain || r.rebuilding || r.parked);
    let delivered_duplicate = |j: &Job| settled_signed(j) && j.source.is_some() && !j.answer.is_empty() && s.jobs.values().any(|other|
        other.request.id != j.request.id && other.source.is_some() && settled_signed(other) &&
        other.voice.as_ref().is_some_and(|v| v.remembered) &&
        other.request.model_id == j.request.model_id && job_order(other) < job_order(j) &&
        other.answer.as_bytes() == j.answer.as_bytes());
    if s.jobs.values().any(|j| j.phase == Phase::Running ||
        (j.phase == Phase::Verified && !untouched(j)) ||
        (j.phase == Phase::Complete && j.voice.as_ref().is_some_and(|v| !v.remembered) &&
            !delivered_duplicate(j))) {
        return Err("rebind requires checkpointed model work and acknowledged completed thoughts".into());
    }
    let c = s.config.as_ref().ok_or("not initialized")?;
    if c.gateway != old_gateway.to_lowercase() || c.artifact_hash != old_artifact.to_lowercase() {
        return Err("gateway/artifact changed since review".into());
    }
    if bytes(gateway, 20)? == vec![0;20] || bytes(artifact,32)? == vec![0;32] {
        return Err("zero gateway or artifact".into());
    }
    let mut updated = c.clone(); updated.gateway = gateway.to_lowercase(); updated.artifact_hash = artifact.to_lowercase();
    validate_config(&updated)?;
    s.config = Some(updated);
    Ok(())
}

/// A replay restores only the known cache prefix. Never append it twice to the
/// retained answer, and halt if deterministic replay differs from that prefix.
pub fn apply_replay(j: &mut Job, output: &str, tokens: u64, prompt_ingested: bool, eog: bool) -> Result<bool, String> {
    let r = j.recovery.as_mut().ok_or("missing recovery replay state")?;
    if !r.rebuilding || r.replay_target_tokens == 0 { return Err("not replaying a retained prefix".into()); }
    r.replay_prompt_ingested = prompt_ingested;
    r.replay_tokens = r.replay_tokens.checked_add(tokens).ok_or("replay token overflow")?;
    r.replay_output.push_str(output);
    if r.replay_tokens > r.replay_target_tokens || !r.replay_target.starts_with(&r.replay_output) ||
        (eog && r.replay_tokens < r.replay_target_tokens) {
        return Err("recovery prefix differs; hold for explicit reconciliation".into());
    }
    if r.replay_tokens == r.replay_target_tokens {
        if r.replay_output != r.replay_target || !prompt_ingested {
            return Err("recovery prefix token/text accounting differs".into());
        }
        r.rebuilding = false;
        j.prompt_ingested = true;
        return Ok(true);
    }
    Ok(false)
}

pub fn hash(b: impl AsRef<[u8]>) -> [u8; 32] {
    Keccak256::digest(b.as_ref()).into()
}
pub fn hex0(b: impl AsRef<[u8]>) -> String {
    format!("0x{}", hex::encode(b))
}
pub fn bytes(s: &str, len: usize) -> Result<Vec<u8>, String> {
    let b = hex::decode(s.strip_prefix("0x").ok_or("missing 0x")?).map_err(|_| "invalid hex")?;
    if b.len() != len {
        return Err(format!("expected {len} bytes"));
    }
    Ok(b)
}
pub fn quantity(v: &Value) -> Result<u64, String> {
    u64::from_str_radix(
        v.as_str()
            .ok_or("missing hex quantity")?
            .strip_prefix("0x")
            .ok_or("bad quantity")?,
        16,
    )
    .map_err(|_| "quantity overflow".into())
}
fn string(v: &Value) -> Result<String, String> {
    Ok(v.as_str().ok_or("missing string")?.to_lowercase())
}

pub fn validate_config(c: &Config) -> Result<(), String> {
    bytes(&c.gateway, 20)?;
    bytes(&c.model_id, 32)?;
    bytes(&c.artifact_hash, 32)?;
    bytes(&c.model_wasm_hash, 32)?;
    crate::swaps::validate_pools(c.swap_sources.as_deref())?;
    crate::persona::validate_profile()?;
    if c.worker == candid::Principal::anonymous()
        || c.model_canister == candid::Principal::anonymous()
        || c.chain_id == 0
        || c.confirmations < 2
        || c.confirmations > 100
        || c.rpc_urls.len() != 2
        || c.rpc_urls[0] == c.rpc_urls[1]
        || c.rpc_urls
            .iter()
            .any(|s| !s.starts_with("https://") || s.len() > 512)
        || (c.model_cycle_budget != 0 && c.model_cycle_budget < CHUNK_RESERVE * 2)
        || c.model_cycle_budget > 2_000_000_000_000
        || !["key_1", "test_key_1", "dfx_test_key"].contains(&c.ecdsa_key_name.as_str())
    {
        return Err("invalid configuration".into());
    }
    Ok(())
}

pub fn parse_receipt(
    v: &Value,
    config: &Config,
    tx: &str,
    log_index: u64,
) -> Result<Request, String> {
    if quantity(&v["status"])? != 1 || string(&v["transactionHash"])? != tx.to_lowercase() {
        return Err("failed or mismatched transaction".into());
    }
    let logs = v["logs"].as_array().ok_or("missing logs")?;
    let log = logs
        .iter()
        .find(|l| quantity(&l["logIndex"]).ok() == Some(log_index))
        .ok_or("request log absent")?;
    if log["removed"].as_bool().unwrap_or(false)
        || string(&log["address"])? != config.gateway.to_lowercase()
    {
        return Err("wrong gateway or removed log".into());
    }
    let topics = log["topics"].as_array().ok_or("missing topics")?;
    if topics.len() != 4 || topics[0].as_str() != Some(hex0(hash(EVENT)).as_str()) {
        return Err("wrong request event".into());
    }
    let id = string(&topics[1])?;
    bytes(&id, 32)?;
    let requester_word = bytes(topics[2].as_str().ok_or("requester missing")?, 32)?;
    if requester_word[..12] != [0u8; 12] {
        return Err("noncanonical address".into());
    }
    let model_id = string(&topics[3])?;
    if model_id != config.model_id.to_lowercase() {
        return Err("unsupported model".into());
    }
    let data = hex::decode(
        log["data"]
            .as_str()
            .ok_or("event data missing")?
            .strip_prefix("0x")
            .ok_or("bad data")?,
    )
    .map_err(|_| "bad data")?;
    let fields = ethabi::decode(
        &[
            ParamType::FixedBytes(32),
            ParamType::Uint(32),
            ParamType::Uint(64),
            ParamType::String,
        ],
        &data,
    )
    .map_err(|_| "bad event ABI")?;
    // Canonical re-encoding rejects truncation, high bits and trailing ambiguity.
    if ethabi::encode(&fields) != data {
        return Err("noncanonical event ABI".into());
    }
    let prompt_hash = hex0(fields[0].clone().into_fixed_bytes().ok_or("prompt hash")?);
    let max = fields[1].clone().into_uint().ok_or("max tokens")?;
    let deadline = fields[2].clone().into_uint().ok_or("deadline")?;
    if max > 128.into() || max.is_zero() || deadline > u64::MAX.into() {
        return Err("invalid request limits".into());
    }
    let prompt = fields[3].clone().into_string().ok_or("prompt")?;
    if prompt.is_empty() || prompt.len() > 4096 || hex0(hash(prompt.as_bytes())) != prompt_hash {
        return Err("prompt hash/size mismatch".into());
    }
    let block_hash = string(&v["blockHash"])?;
    bytes(&block_hash, 32)?;
    Ok(Request {
        id,
        requester: hex0(&requester_word[12..]),
        model_id,
        prompt_hash,
        prompt,
        max_tokens: max.low_u32(),
        deadline: deadline.low_u64(),
        tx_hash: tx.to_lowercase(),
        log_index,
        block_number: quantity(&v["blockNumber"])?,
        block_hash,
    })
}

pub fn framed_prompt(prompt: &str) -> Result<String, String> {
    // Prevent user-supplied role delimiters; the prompt itself remains public.
    if ["<|im_start|>", "<|im_end|>", "<|endoftext|>"]
        .iter()
        .any(|s| prompt.contains(s))
    {
        return Err("reserved prompt delimiter".into());
    }
    Ok(format!(
        "<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    ))
}

pub fn result_digest(config: &Config, job: &Job) -> Result<[u8; 32], String> {
    let fixed = |s: &str| -> Result<Token, String> { Ok(Token::FixedBytes(bytes(s, 32)?)) };
    let domain = hash(ethabi::encode(&[
        Token::FixedBytes(hash(DOMAIN).to_vec()),
        Token::FixedBytes(hash("GH0ST ICP Inference").to_vec()),
        Token::FixedBytes(hash("1").to_vec()),
        Token::Uint(config.chain_id.into()),
        Token::Address(ethabi::ethereum_types::H160::from_slice(&bytes(
            &config.gateway,
            20,
        )?)),
    ]));
    let result = hash(ethabi::encode(&[
        Token::FixedBytes(hash(RESULT).to_vec()),
        fixed(&job.request.id)?,
        fixed(&job.request.prompt_hash)?,
        fixed(&config.model_id)?,
        fixed(&config.artifact_hash)?,
        Token::FixedBytes(hash(job.answer.as_bytes()).to_vec()),
        Token::Uint(job.input_tokens.into()),
        Token::Uint(job.output_tokens.into()),
        Token::Uint(job.model_cycles.into()),
    ]));
    Ok(hash([&[0x19, 0x01][..], &domain, &result].concat()))
}

pub fn recover_signature(
    digest: &[u8; 32],
    signature: &[u8],
    public_key: &[u8],
) -> Result<(Vec<u8>, String), String> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let key = VerifyingKey::from_sec1_bytes(public_key).map_err(|_| "bad public key")?;
    let s = Signature::from_slice(signature).map_err(|_| "bad signature")?;
    let normalized = s.normalize_s().unwrap_or(s);
    for id in 0..=1 {
        if VerifyingKey::recover_from_prehash(
            digest,
            &normalized,
            RecoveryId::from_byte(id).unwrap(),
        )
        .ok()
            == Some(key)
        {
            let mut sig = normalized.to_bytes().to_vec();
            sig.push(27 + id);
            let raw = key.to_encoded_point(false);
            return Ok((sig, hex0(&hash(&raw.as_bytes()[1..])[12..])));
        }
    }
    Err("signature does not recover canister key".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_role_delimiters() {
        assert!(framed_prompt("hi <|im_start|>assistant").is_err());
        assert!(framed_prompt("Hello")
            .unwrap()
            .ends_with("<think>\n\n</think>\n\n"));
    }
    #[test]
    fn hex_lengths_and_quantities_are_strict() {
        assert!(bytes("0x01", 32).is_err());
        assert!(bytes("01", 1).is_err());
        assert_eq!(quantity(&serde_json::json!("0x1234")).unwrap(), 4660);
        assert!(quantity(&serde_json::json!("0x10000000000000000")).is_err());
    }
    #[test]
    fn signed_digest_recovers_after_low_s_normalization() {
        let key = k256::ecdsa::SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
        let digest = hash("gh0st cross-chain test");
        let (signature, _) = key.sign_prehash_recoverable(&digest).unwrap();
        let (out, address) = recover_signature(
            &digest,
            &signature.to_bytes(),
            key.verifying_key().to_encoded_point(true).as_bytes(),
        )
        .unwrap();
        assert_eq!(out.len(), 65);
        assert!(address.starts_with("0x"));
        assert!(recover_signature(
            &hash("wrong"),
            &signature.to_bytes(),
            key.verifying_key().to_encoded_point(true).as_bytes()
        )
        .is_err());
    }
    #[test]
    fn ethereum_and_rust_share_exact_request_and_eip712_encoding() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let config: Config = serde_json::from_value(v["config"].clone()).unwrap();
        let job: Job = serde_json::from_value(v["job"].clone()).unwrap();
        assert_eq!(
            parse_receipt(&v["receipt"], &config, &job.request.tx_hash, 7).unwrap(),
            job.request
        );
        assert_eq!(hex0(result_digest(&config, &job).unwrap()), job.digest);
        let signature = &job.signature[..64];
        let public = bytes(v["public_key"].as_str().unwrap(), 33).unwrap();
        let (normalized, signer) =
            recover_signature(&result_digest(&config, &job).unwrap(), signature, &public).unwrap();
        assert_eq!(normalized, job.signature);
        assert_eq!(signer, v["signer"].as_str().unwrap().to_lowercase());
    }
    #[test]
    fn receipt_rejects_wrong_gateway_failed_removed_and_tampered_prompt() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let config: Config = serde_json::from_value(v["config"].clone()).unwrap();
        let tx = v["job"]["request"]["tx_hash"].as_str().unwrap();
        let mut receipt = v["receipt"].clone();
        receipt["status"] = json_value("0x0");
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        receipt["logs"][0]["removed"] = Value::Bool(true);
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        receipt["logs"][0]["address"] = json_value("0x0000000000000000000000000000000000000000");
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        let mut data = receipt["logs"][0]["data"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        data[3] = if data[3] == b'0' { b'1' } else { b'0' };
        receipt["logs"][0]["data"] = json_value(std::str::from_utf8(&data).unwrap());
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        assert!(parse_receipt(&v["receipt"], &config, tx, 8).is_err());
    }
    fn json_value(s: &str) -> Value {
        Value::String(s.into())
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use crate::types::{SwapSource, VoiceJob};
    use candid::{CandidType, Principal};
    fn setup() -> (State, String, String) {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let mut c: Config = serde_json::from_value(v["config"].clone()).unwrap();
        c.model_cycle_budget = MAX_RECOVERY_GRANT;
        c.worker = Principal::from_slice(&[8]);
        let make = |n: u8, block: u64| {
            let source = SwapSource { manager: hex0([3;20]), pool_id: hex0([4;32]), transaction_hash: hex0([n;32]), log_index: n as u64 };
            let id = crate::swaps::source_id(c.chain_id, &source).unwrap();
            let prompt = format!("the original bounded prompt for swap {n}");
            let mut j = Job::new(Request { id: id.clone(), requester: hex0([5;20]), model_id: c.model_id.clone(),
                prompt_hash: hex0(hash(prompt.as_bytes())), prompt: prompt.clone(), max_tokens: 80, deadline: 1000,
                tx_hash: source.transaction_hash.clone(), log_index: source.log_index, block_number: block, block_hash: hex0([6;32]) });
            j.source = Some(source);
            let ph = crate::persona::profile_hash();
            j.voice = Some(VoiceJob { profile_version: crate::persona::profile().version, profile_hash: ph.clone(),
                seed: crate::persona::seed(&id,1,0,&ph).unwrap(), attempt: 1, generation: None, base_prompt: prompt,
                memory_hash: hex0([7;32]), direction: "buy".into(), previous_input_tokens: 0,
                previous_output_tokens: 0, quality_error: String::new(), remembered: false });
            j
        };
        let mut failed = make(10,100); let parked = make(11,101);
        let first = failed.request.id.clone(); let second = parked.request.id.clone();
        failed.phase = Phase::Failed; failed.model_cycles = 1_979_265_355_131;
        failed.model_cycles_before = 20_000_000_000_000; failed.chunks = 66; failed.input_tokens = 310;
        failed.error = "model cycle/chunk budget reached".into(); failed.voice.as_mut().unwrap().attempt = 2;
        let mut s = State { owner: Some(Principal::from_slice(&[9])), config: Some(c), paused: true,
            active: Some(second.clone()), ..State::default() };
        s.jobs.insert(first.clone(),failed); s.jobs.insert(second.clone(),parked);
        (s,first,second)
    }
    #[test]
    fn owner_recovery_preserves_source_prompt_seed_old_spend_and_parks_only_unstarted_later_job() {
        let (mut s,id,later)=setup(); let old=s.jobs[&id].clone(); let owner=s.owner.unwrap();
        let got=recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).unwrap();
        assert_eq!(got.phase,Phase::Verified); assert_eq!(got.model_cycles,old.model_cycles); assert_eq!(got.chunks,old.chunks);
        assert_eq!(candid::encode_one(&got.request).unwrap(),candid::encode_one(&old.request).unwrap());
        assert_eq!(candid::encode_one(&got.voice).unwrap(),candid::encode_one(&old.voice).unwrap());
        assert_eq!(got.model_cycles_before,old.model_cycles_before);
        let r=got.recovery.unwrap(); assert!(r.rebuilding); assert!(!r.requires_owner);
        assert_eq!(r.total_budget,old.model_cycles+MAX_RECOVERY_GRANT); assert_eq!(r.carry_cycles,old.model_cycles);
        assert_eq!(r.resume_deadline,5600); assert_eq!(r.max_chunks,162);
        assert_eq!(s.active.as_deref(),Some(id.as_str())); assert!(s.jobs[&later].recovery.as_ref().unwrap().parked);
        assert!(untouched(&s.jobs[&later]));
    }
    #[test]
    fn recovery_rejects_worker_unpaused_excess_grant_and_later_model_work_atomically() {
        for mode in ["worker","unpaused","grant","later_work","busy"] {
            let (mut s,id,later)=setup(); let owner=s.owner.unwrap();
            let caller=if mode=="worker" {s.config.as_ref().unwrap().worker}else{owner};
            if mode=="unpaused" {s.paused=false;} if mode=="later_work" {s.jobs.get_mut(&later).unwrap().model_cycles=1;}
            if mode=="busy" {s.jobs.get_mut(&later).unwrap().busy=true;}
            let before=candid::encode_one(&s).unwrap();
            let grant=if mode=="grant" {MAX_RECOVERY_GRANT+1}else{MAX_RECOVERY_GRANT};
            assert!(recover_state(&mut s,caller,&id,grant,2000).is_err(),"{mode}");
            assert_eq!(candid::encode_one(&s).unwrap(),before);
        }
    }
    #[test]
    fn cost_segments_keep_prior_spend_and_reject_topups_or_backward_accounting() {
        let (mut s,id,_)=setup();let owner=s.owner.unwrap();recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).unwrap();
        let j=s.jobs.get_mut(&id).unwrap();let old=j.model_cycles;
        j.recovery.as_mut().unwrap().segment_baseline=Some(10_000_000_000_000);
        update_model_cost(j,9_500_000_000_000).unwrap();assert_eq!(j.model_cycles,old+500_000_000_000);
        assert_eq!(j.model_cycles_before,20_000_000_000_000);
        assert!(update_model_cost(j,10_000_000_000_001).is_err());
        assert!(update_model_cost(j,9_900_000_000_000).is_err());
    }
    #[test]
    fn repeated_grants_never_exceed_four_trillion_cumulative_ceiling() {
        let (mut s,id,_)=setup();let owner=s.owner.unwrap();recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).unwrap();
        let c=s.config.clone().unwrap();let j=s.jobs.get_mut(&id).unwrap();j.model_cycles=3_900_000_000_000;
        hold_job(&c,j,"model cycle/chunk budget reached");
        assert!(recover_state(&mut s,owner,&id,200_000_000_000,2001).is_err());
        let got=recover_state(&mut s,owner,&id,100_000_000_000,2001).unwrap();
        assert_eq!(got.recovery.unwrap().total_budget,MAX_RECOVERY_BUDGET);
    }
    #[test]
    fn parked_job_only_resumes_after_prior_complete_without_worker_budget_or_deadline_extension() {
        let (mut s,id,later)=setup();let owner=s.owner.unwrap();let worker=s.config.as_ref().unwrap().worker;
        recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).unwrap();s.paused=false;
        assert!(resume_state(&mut s,worker,&later,2010).is_err());
        s.jobs.get_mut(&id).unwrap().phase=Phase::Complete;s.active=None;
        let before=s.jobs[&later].recovery.as_ref().unwrap().clone();
        let got=resume_state(&mut s,worker,&later,2010).unwrap();
        assert_eq!(got.phase,Phase::Verified);assert!(!got.recovery.as_ref().unwrap().parked);
        assert_eq!(got.recovery.as_ref().unwrap().total_budget,before.total_budget);
        assert_eq!(got.recovery.as_ref().unwrap().resume_deadline,before.resume_deadline);
        assert_eq!(got.model_cycles,0); assert_eq!(got.chunks,0);
    }
    #[test]
    fn exact_prefix_replay_does_not_duplicate_answer_and_mismatch_holds() {
        let (mut s,id,_)=setup();let owner=s.owner.unwrap();
        {let j=s.jobs.get_mut(&id).unwrap();j.answer="a spoon".into();j.output_tokens=2;j.prompt_ingested=true;}
        recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).unwrap();
        let j=s.jobs.get_mut(&id).unwrap();let answer=j.answer.clone();
        assert!(!apply_replay(j,"a ",1,true,false).unwrap());assert_eq!(j.answer,answer);assert_eq!(j.output_tokens,2);
        assert!(apply_replay(j,"spoon",1,true,false).unwrap());assert_eq!(j.answer,answer);assert!(!j.recovery.as_ref().unwrap().rebuilding);
        j.recovery.as_mut().unwrap().rebuilding=true;j.recovery.as_mut().unwrap().replay_output.clear();j.recovery.as_mut().unwrap().replay_tokens=0;
        assert!(apply_replay(j,"different",1,true,false).is_err());assert_eq!(j.answer,answer);
    }
    #[test]
    fn rebind_is_owner_paused_expected_pair_and_changes_no_other_state() {
        let (mut s,_,_)=setup();let before=s.clone();let c=s.config.clone().unwrap();let owner=s.owner.unwrap();
        assert!(rebind_state(&mut s,c.worker,&c.gateway,&c.artifact_hash,&hex0([1;20]),&hex0([2;32])).is_err());
        rebind_state(&mut s,owner,&c.gateway,&c.artifact_hash,&hex0([1;20]),&hex0([2;32])).unwrap();
        s.config.as_mut().unwrap().gateway=c.gateway;s.config.as_mut().unwrap().artifact_hash=c.artifact_hash;
        assert_eq!(candid::encode_one(s).unwrap(),candid::encode_one(before).unwrap());
    }
    fn duplicate_rebind_setup() -> (State, String, String) {
        let (mut s, earlier, duplicate) = setup();
        s.active = None;
        for id in [&earlier, &duplicate] {
            let j = s.jobs.get_mut(id).unwrap();
            j.phase = Phase::Complete;
            j.answer = "the cupboard has elected another mayor and nobody has asked the spoons.".into();
            j.signature = vec![7; 65];
            j.digest = hex0([8; 32]);
            j.signer = hex0([9; 20]);
            j.error.clear();
        }
        s.jobs.get_mut(&earlier).unwrap().voice.as_mut().unwrap().remembered = true;
        (s, earlier, duplicate)
    }
    fn attempt_rebind(s: &mut State) -> Result<(), String> {
        let c = s.config.clone().unwrap();
        let owner = s.owner.unwrap();
        rebind_state(s, owner, &c.gateway, &c.artifact_hash, &hex0([1; 20]), &hex0([2; 32]))
    }
    #[test]
    fn rebind_exact_previously_delivered_duplicate_preserves_every_record() {
        let (mut s, earlier, duplicate) = duplicate_rebind_setup();
        let before = s.clone();
        attempt_rebind(&mut s).unwrap();
        assert!(s.jobs[&earlier].voice.as_ref().unwrap().remembered);
        assert!(!s.jobs[&duplicate].voice.as_ref().unwrap().remembered);
        s.config = before.config.clone();
        assert_eq!(candid::encode_one(s).unwrap(), candid::encode_one(before).unwrap());
    }
    #[test]
    fn rebind_duplicate_exception_rejects_unique_near_match_and_empty_answers() {
        for case in ["unique", "case", "space", "empty"] {
            let (mut s, earlier, duplicate) = duplicate_rebind_setup();
            match case {
                "unique" => s.jobs.get_mut(&duplicate).unwrap().answer = "a different thought".into(),
                "case" => s.jobs.get_mut(&duplicate).unwrap().answer.make_ascii_uppercase(),
                "space" => s.jobs.get_mut(&duplicate).unwrap().answer.push(' '),
                "empty" => { s.jobs.get_mut(&duplicate).unwrap().answer.clear(); s.jobs.get_mut(&earlier).unwrap().answer.clear(); },
                _ => unreachable!(),
            }
            let before = candid::encode_one(&s).unwrap();
            assert!(attempt_rebind(&mut s).is_err(), "{case}");
            assert_eq!(candid::encode_one(&s).unwrap(), before);
        }
    }
    #[test]
    fn rebind_duplicate_exception_requires_distinct_earlier_remembered_source_same_model() {
        for case in ["self_only", "not_remembered", "not_complete", "not_source", "duplicate_not_source", "different_model", "later"] {
            let (mut s, earlier, duplicate) = duplicate_rebind_setup();
            match case {
                "self_only" => { s.jobs.remove(&earlier); },
                "not_remembered" => s.jobs.get_mut(&earlier).unwrap().voice.as_mut().unwrap().remembered = false,
                "not_complete" => s.jobs.get_mut(&earlier).unwrap().phase = Phase::Failed,
                "not_source" => s.jobs.get_mut(&earlier).unwrap().source = None,
                "duplicate_not_source" => s.jobs.get_mut(&duplicate).unwrap().source = None,
                "different_model" => s.jobs.get_mut(&earlier).unwrap().request.model_id = hex0([99; 32]),
                "later" => s.jobs.get_mut(&earlier).unwrap().request.block_number = 200,
                _ => unreachable!(),
            }
            let before = candid::encode_one(&s).unwrap();
            assert!(attempt_rebind(&mut s).is_err(), "{case}");
            assert_eq!(candid::encode_one(&s).unwrap(), before);
        }
    }
    #[test]
    fn rebind_duplicate_exception_requires_both_signed_and_reconciled() {
        for which in ["earlier", "duplicate"] {
            for case in ["signature", "digest", "signer", "busy", "uncertain", "rebuilding", "parked"] {
                let (mut s, earlier, duplicate) = duplicate_rebind_setup();
                let id = if which == "earlier" { earlier } else { duplicate };
                if case == "signature" {
                    s.jobs.get_mut(&id).unwrap().signature.pop();
                } else if case == "digest" {
                    s.jobs.get_mut(&id).unwrap().digest.clear();
                } else if case == "signer" {
                    s.jobs.get_mut(&id).unwrap().signer.clear();
                } else if case == "busy" {
                    s.jobs.get_mut(&id).unwrap().busy = true;
                } else {
                    let mut recovery = recovery_info(s.config.as_ref().unwrap(), &s.jobs[&id]);
                    match case {
                        "uncertain" => recovery.accounting_uncertain = true,
                        "rebuilding" => recovery.rebuilding = true,
                        "parked" => recovery.parked = true,
                        _ => unreachable!(),
                    }
                    s.jobs.get_mut(&id).unwrap().recovery = Some(recovery);
                }
                let before = candid::encode_one(&s).unwrap();
                assert!(attempt_rebind(&mut s).is_err(), "{which} {case}");
                assert_eq!(candid::encode_one(&s).unwrap(), before);
            }
        }
    }
    #[test]
    fn rebind_duplicate_exception_keeps_owner_pause_inflight_and_binding_guards() {
        for case in ["unpaused", "verifying", "busy", "running", "remembering", "wrong_binding"] {
            let (mut s, _, duplicate) = duplicate_rebind_setup();
            match case {
                "unpaused" => s.paused = false,
                "verifying" => s.verifying = true,
                "busy" => s.jobs.get_mut(&duplicate).unwrap().busy = true,
                "running" => s.jobs.get_mut(&duplicate).unwrap().phase = Phase::Running,
                "remembering" => s.voice.get_or_insert_with(Default::default).remembering = Some(duplicate),
                _ => {},
            }
            let before = candid::encode_one(&s).unwrap();
            let result = if case == "wrong_binding" {
                let c = s.config.clone().unwrap();
                let owner = s.owner.unwrap();
                rebind_state(&mut s, owner, &hex0([99; 20]), &c.artifact_hash, &hex0([1; 20]), &hex0([2; 32]))
            } else { attempt_rebind(&mut s) };
            assert!(result.is_err(), "{case}");
            assert_eq!(candid::encode_one(&s).unwrap(), before);
        }
        let (mut s, _, _) = duplicate_rebind_setup();
        let c = s.config.clone().unwrap();
        assert!(rebind_state(&mut s, c.worker, &c.gateway, &c.artifact_hash, &hex0([1; 20]), &hex0([2; 32])).is_err());
    }
    #[test]
    fn inconsistent_output_checkpoint_is_not_replayed() {
        let (mut s,id,_)=setup();let owner=s.owner.unwrap();
        s.jobs.get_mut(&id).unwrap().answer="unaccounted text".into();
        assert!(recover_state(&mut s,owner,&id,MAX_RECOVERY_GRANT,2000).is_err());
    }
    #[test]
    fn signing_retries_back_off_and_stop_without_replaying_the_model() {
        let (s,id,_)=setup();let c=s.config.unwrap();let mut j=s.jobs[&id].clone();
        j.phase=Phase::ReadyToSign;j.answer="a spoon has filed its complaint against gravity.".into();j.output_tokens=10;
        j.recovery=Some(signing_retry(&c,&j,"transient signing failure",100));
        assert_eq!(j.recovery.as_ref().unwrap().retry_after,102);assert!(!j.recovery.as_ref().unwrap().requires_owner);
        j.recovery=Some(signing_retry(&c,&j,"transient signing failure",102));
        assert_eq!(j.recovery.as_ref().unwrap().retry_after,106);
        j.recovery=Some(signing_retry(&c,&j,"transient signing failure",106));
        assert!(j.recovery.as_ref().unwrap().requires_owner);assert_eq!(j.recovery.as_ref().unwrap().retry_after,0);
        assert_eq!(j.answer,"a spoon has filed its complaint against gravity.");assert_eq!(j.output_tokens,10);
    }
    #[derive(CandidType)]
    struct LegacyJob { request: Request, source: Option<SwapSource>, voice: Option<VoiceJob>, phase: Phase,
        busy: bool, answer: String, input_tokens:u64, output_tokens:u64, model_cycles_before:u128,model_cycles:u128,
        chunks:u32,prompt_ingested:bool,signature:Vec<u8>,digest:String,signer:String,error:String }
    #[test]
    fn old_candid_job_without_recovery_decodes_with_none() {
        let(s,id,_)=setup();let j=s.jobs[&id].clone();
        let old=LegacyJob{request:j.request,source:j.source,voice:j.voice,phase:j.phase,busy:j.busy,answer:j.answer,
            input_tokens:j.input_tokens,output_tokens:j.output_tokens,model_cycles_before:j.model_cycles_before,model_cycles:j.model_cycles,
            chunks:j.chunks,prompt_ingested:j.prompt_ingested,signature:j.signature,digest:j.digest,signer:j.signer,error:j.error};
        let decoded:Job=candid::decode_one(&candid::encode_one(old).unwrap()).unwrap();assert!(decoded.recovery.is_none());
        assert_eq!(decoded.model_cycles,1_979_265_355_131);assert_eq!(decoded.chunks,66);
    }
    #[test]
    fn explicit_owner_policy_zero_has_no_swap_budget_or_deadline_and_preserves_state() {
        let (mut s,id,_)=setup(); let original=s.clone(); let owner=s.owner.unwrap(); let worker=s.config.as_ref().unwrap().worker;
        assert!(enable_unlimited_state(&mut s, worker,MAX_RECOVERY_GRANT).is_err());
        assert!(enable_unlimited_state(&mut s,owner,17).is_err());
        enable_unlimited_state(&mut s,owner,MAX_RECOVERY_GRANT).unwrap();
        let c=s.config.as_ref().unwrap();validate_config(c).unwrap();
        assert_eq!(job_budget(c,&s.jobs[&id]),0);assert_eq!(job_deadline(c,&s.jobs[&id]),0);
        let mut manual=s.jobs[&id].clone(); manual.source=None;
        assert_eq!(job_budget(c,&manual),MAX_RECOVERY_GRANT);assert_eq!(job_deadline(c,&manual),1000);
        s.config.as_mut().unwrap().model_cycle_budget=MAX_RECOVERY_GRANT;
        assert_eq!(candid::encode_one(s).unwrap(),candid::encode_one(original).unwrap());
    }
    #[test]
    fn retained_resume_is_exact_cache_preserving_and_rejects_changed_checkpoint() {
        for mode in ["good","cost","chunks","evidence","error","busy","uncertain"] {
            let(mut s,id,_)=setup();s.active=None;let owner=s.owner.unwrap();
            enable_unlimited_state(&mut s,owner,MAX_RECOVERY_GRANT).unwrap();
            let old=s.jobs[&id].clone();let mut cost=old.model_cycles;let mut chunks=old.chunks;let mut evidence=hex0([8;32]);
            match mode {"cost"=>cost+=1,"chunks"=>chunks+=1,"evidence"=>evidence=hex0([0;32]),
                "error"=>s.jobs.get_mut(&id).unwrap().error="unknown call outcome".into(),
                "busy"=>s.jobs.get_mut(&id).unwrap().busy=true,
                "uncertain"=>{let mut r=recovery_info(s.config.as_ref().unwrap(),&old);r.accounting_uncertain=true;s.jobs.get_mut(&id).unwrap().recovery=Some(r);},_=>{}}
            let before=candid::encode_one(&s).unwrap();
            let result=resume_retained_state(&mut s,owner,&id,cost,chunks,&evidence);
            if mode!="good" {assert!(result.is_err(),"{mode}");assert_eq!(candid::encode_one(&s).unwrap(),before);continue;}
            let got=result.unwrap();assert_eq!(got.phase,Phase::Running);assert_eq!(got.model_cycles,old.model_cycles);
            assert_eq!(got.model_cycles_before,old.model_cycles_before);assert_eq!(got.chunks,old.chunks);
            assert_eq!(got.input_tokens,old.input_tokens);assert_eq!(got.output_tokens,0);assert!(!got.prompt_ingested);
            assert_eq!(candid::encode_one(&got.request).unwrap(),candid::encode_one(&old.request).unwrap());
            assert_eq!(candid::encode_one(&got.voice).unwrap(),candid::encode_one(&old.voice).unwrap());
            let r=got.recovery.unwrap();assert!(!r.rebuilding);assert!(!r.requires_owner);assert_eq!(r.total_budget,0);
            assert_eq!(r.cache_evidence_hash,Some(evidence));assert_eq!(s.active.as_deref(),Some(id.as_str()));
        }
    }
    #[test]
    fn explicit_deferral_preserves_failed_job_and_allows_later_retained_resume() {
        let(mut s,first,later)=setup();s.active=None;let owner=s.owner.unwrap();
        enable_unlimited_state(&mut s,owner,MAX_RECOVERY_GRANT).unwrap();
        {let j=s.jobs.get_mut(&later).unwrap();j.phase=Phase::Failed;j.model_cycles=7;j.model_cycles_before=100;
            j.chunks=1;j.error="model cycle/chunk budget reached".into();}
        assert!(resume_retained_state(&mut s,owner,&later,7,1,&hex0([8;32])).is_err());
        let old=candid::encode_one(&s.jobs[&first]).unwrap();let spent=s.jobs[&first].model_cycles;
        assert!(defer_failed_state(&mut s,owner,&first,spent+1,"owner deferred",2000).is_err());
        defer_failed_state(&mut s,owner,&first,spent,"owner deferred",2000).unwrap();
        assert_eq!(candid::encode_one(&s.jobs[&first]).unwrap(),old);assert!(is_deferred(&s,&first));
        resume_retained_state(&mut s,owner,&later,7,1,&hex0([8;32])).unwrap();
        assert_eq!(s.active.as_deref(),Some(later.as_str()));
    }
    #[test]
    fn unlimited_rebuild_retains_cost_above_old_four_trillion_and_has_no_deadline() {
        let(mut s,id,_)=setup();let owner=s.owner.unwrap();enable_unlimited_state(&mut s,owner,MAX_RECOVERY_GRANT).unwrap();
        {let j=s.jobs.get_mut(&id).unwrap();j.model_cycles=9_000_000_000_000;j.chunks=10_000;}
        let got=recover_state(&mut s,owner,&id,0,2000).unwrap();let r=got.recovery.unwrap();
        assert_eq!(got.model_cycles,9_000_000_000_000);assert_eq!(got.chunks,10_000);assert_eq!(r.total_budget,0);
        assert_eq!(r.max_chunks,0);assert_eq!(r.resume_deadline,0);assert!(r.rebuilding);assert_eq!(r.carry_cycles,got.model_cycles);
    }

}
