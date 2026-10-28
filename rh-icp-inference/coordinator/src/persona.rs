//! Bounded, reproducible conditioning for GH0ST's public swap monologues.
//! This is a prompt/decoding profile, not a trained-weight checkpoint.
use crate::core::{bytes, hash, hex0, quantity};
use crate::swaps::{source_id, VerifiedSwap, GH0ST};
use crate::types::{Config, Job, Request, State, ThoughtMemory, VoiceJob, VoiceState};
use ethabi::ParamType;
use serde::Deserialize;
use serde_json::Value;

pub const PROFILE_JSON: &str = include_str!("../../persona-profile.json");
pub const FULFILLED_EVENT: &str =
    "InferenceFulfilled(bytes32,bytes32,string,uint64,uint64,uint128)";

#[derive(Clone, Deserialize)]
pub struct Profile {
    pub version: String,
    pub voice: String,
    pub examples: Vec<String>,
    pub sampling: Sampling,
    pub limits: Limits,
}
#[derive(Clone, Deserialize, serde::Serialize)]
pub struct Sampling {
    pub temperature: f64,
    pub top_p: f64,
    pub top_k: u32,
    #[serde(default)]
    pub min_p: f64,
    pub repeat_penalty: f64,
    pub tokens_per_call: u64,
    pub max_output_tokens: u32,
    #[serde(default)]
    pub grammar: String,
}
#[derive(Clone, Deserialize)]
pub struct Limits {
    pub min_characters: usize,
    pub max_characters: usize,
    pub recent_memories: usize,
    pub recent_outputs: usize,
    pub max_attempts: u8,
    #[serde(default = "default_chunk_limit")]
    pub max_chunks: u32,
}
fn default_chunk_limit() -> u32 {
    96
}

pub fn profile() -> Profile {
    serde_json::from_str(PROFILE_JSON).expect("embedded persona profile")
}
pub fn profile_hash() -> String {
    hex0(hash(PROFILE_JSON))
}
/// The 1.7B prompt may require many instruction-bounded ingestion calls. This
/// count spans both attempts; the original shared cycle budget is the hard cap.
pub fn max_chunks(job: &Job) -> u32 {
    if let Some(r) = &job.recovery {
        if r.grants > 0 { return r.max_chunks.min(crate::core::MAX_RECOVERY_CHUNKS); }
    }
    if job.voice.is_some() {
        profile().limits.max_chunks
    } else {
        48
    }
}

pub fn validate_profile() -> Result<(), String> {
    let p = profile();
    if p.version.len() > 64
        || p.voice.len() > 2048
        || !p.voice.is_ascii()
        || p.examples.len() > 4
        || p.examples.iter().any(|s| s.len() > 180 || !s.is_ascii())
        || p.limits.min_characters < 1
        || p.limits.max_characters > 180
        || p.limits.min_characters > p.limits.max_characters
        || p.limits.recent_memories > 2
        || p.limits.recent_outputs > 8
        || !(1..=2).contains(&p.limits.max_attempts)
        || !(1..=96).contains(&p.limits.max_chunks)
        || !(0.01..=1.5).contains(&p.sampling.temperature)
        || !(0.01..=1.0).contains(&p.sampling.top_p)
        || !(0.0..=1.0).contains(&p.sampling.min_p)
        || !(1..=1000).contains(&p.sampling.top_k)
        || !(1.0..=2.0).contains(&p.sampling.repeat_penalty)
        || !(1..=16).contains(&p.sampling.tokens_per_call)
        || !(1..=128).contains(&p.sampling.max_output_tokens)
        || p.sampling.grammar.len() > 512
        || !p.sampling.grammar.is_ascii()
    {
        return Err("invalid embedded persona profile".into());
    }
    Ok(())
}

/// Positive v4 pool Swap delta denotes output received by the swapping address;
/// negative denotes input paid. PoolManager emits the pool delta before hook
/// adjustments, so this is a pool-flow cue, not a claim about a trader's net funds.
/// Sources: Uniswap/v4-core Pool.sol swapDelta construction and PoolManager._swap.
pub fn direction(config: &Config, swap: &VerifiedSwap) -> Result<&'static str, String> {
    let pool = config
        .swap_sources
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|p| {
            p.manager.eq_ignore_ascii_case(&swap.source.manager)
                && p.pool_id.eq_ignore_ascii_case(&swap.source.pool_id)
        })
        .ok_or("unregistered voice source")?;
    let delta = if pool.currency0.eq_ignore_ascii_case(GH0ST) {
        &swap.amount0
    } else if pool.currency1.eq_ignore_ascii_case(GH0ST) {
        &swap.amount1
    } else {
        return Err("voice source lacks GH0ST".into());
    };
    let value: i128 = delta.parse().map_err(|_| "invalid verified GH0ST delta")?;
    Ok(if value > 0 {
        "buy"
    } else if value < 0 {
        "sell"
    } else {
        "neutral"
    })
}

pub fn seed(
    source_id: &str,
    attempt: u8,
    output_offset: u64,
    profile_hash: &str,
) -> Result<u32, String> {
    let mut raw = bytes(source_id, 32)?;
    raw.push(attempt);
    raw.extend_from_slice(&output_offset.to_be_bytes());
    raw.extend_from_slice(&bytes(profile_hash, 32)?);
    let mut value = u32::from_be_bytes(hash(raw)[..4].try_into().unwrap());
    // llama.cpp reserves UINT32_MAX as the request for a non-deterministic seed.
    if value == u32::MAX {
        value -= 1;
    }
    Ok(value)
}

/// An arbitrary precision generation number avoids turning the old u8
/// display field into an execution limit. Old caches and seeds stay identical.
pub fn generation(voice: &VoiceJob) -> candid::Nat {
    voice.generation.clone().unwrap_or_else(|| candid::Nat::from(voice.attempt))
}
pub fn generation_seed(source_id: &str, voice: &VoiceJob, output_offset: u64) -> Result<u32, String> {
    let n = generation(voice);
    if let Ok(attempt) = u8::try_from(&n.0) {
        return seed(source_id, attempt, output_offset, &voice.profile_hash);
    }
    let mut raw = b"gh0st-quality-generation-v1".to_vec();
    raw.extend(bytes(source_id, 32)?);
    raw.extend(n.0.to_bytes_be());
    raw.extend(output_offset.to_be_bytes());
    raw.extend(bytes(&voice.profile_hash, 32)?);
    let n = u32::from_be_bytes(hash(raw)[..4].try_into().unwrap());
    Ok(if n == u32::MAX { n-1 } else { n })
}
pub fn generation_cache_tag(voice: &VoiceJob) -> String {
    let n = generation(voice);
    if let Ok(attempt) = u8::try_from(&n.0) { format!("a{attempt}") }
    else { format!("g{}", hex::encode(hash(n.0.to_bytes_be()))) }
}

/// Compose a scene from independent source-derived choices. Neither prior
/// output text nor a rejected candidate becomes an example to imitate.
fn scene_instruction(source: &str, generation: &candid::Nat) -> Result<String, String> {
    let mut material = b"gh0st-scene-v2".to_vec();
    material.extend(bytes(source, 32)?);
    material.extend(generation.0.to_bytes_be());
    let digest = hash(material);
    let places = [
        "an empty swimming pool", "a midnight bus stop", "a flooded library", "a laundromat",
        "a roadside diner", "a courtroom hallway", "a train platform", "a supermarket freezer",
        "a hotel elevator", "a dentist's waiting room", "a museum storeroom", "an abandoned cinema",
        "a kitchen at dawn", "a dry fountain", "a ship's radio room", "a lost-property office",
        "a school roof", "a planetarium", "a rain-soaked car park", "a botanical greenhouse",
        "a cable car", "a customs desk", "a quiet pharmacy", "a public chess table",
    ];
    let objects = [
        "a brass key", "a paper crown", "a blank map", "a cracked bell", "a silk glove",
        "a bent antenna", "a red umbrella", "a glass marble", "an unlit match", "a wooden ruler",
        "a silver thimble", "a broken compass", "a sealed envelope", "a cracked teacup",
        "a borrowed shoe", "a chalk moon", "a ticking suitcase", "a tiny ladder", "an empty birdcage",
        "a stubborn magnet", "a soap sculpture", "a folding mirror", "a velvet rope", "a wind-up fish",
    ];
    let tensions = [
        "silence mistaken for permission", "something refusing to belong", "admission charged to a memory",
        "gravity treated as a suggestion", "a ceremony with nobody in charge", "an apology sent to the future",
        "a door remembering the wrong person", "a measurement changing what it measures",
        "a shadow promoted above its owner", "a shortcut taking the long way", "a secret made unnecessarily public",
        "an answer arriving before its question", "a small victory with an inconvenient cost",
        "a promise expiring before noon", "an ordinary rule applied too literally", "an absence leaving fingerprints",
    ];
    let openings = [
        "Begin with a concrete sensory detail.", "Let the object be the subject of the sentence.",
        "Start with a small action already in progress.", "Lead with the unexpected consequence.",
        "Use a quiet observation that takes a strange turn.", "Begin with a place rather than a speaker.",
        "Make a blunt declaration, then undermine it.", "Frame the thought as a tiny discovery.",
    ];
    Ok(format!("Scene cue: {}; {}; {}. {} Make one concrete observation with an unexpected consequence; do not list these instructions.",
        places[digest[0] as usize % places.len()], objects[digest[1] as usize % objects.len()],
        tensions[digest[2] as usize % tensions.len()], openings[digest[3] as usize % openings.len()]))
}

pub fn build_prompt(
    config: &Config,
    swap: &VerifiedSwap,
    memory: &VoiceState,
) -> Result<(String, String), String> {
    validate_profile()?;
    let p = profile();
    let direction = direction(config, swap)?;
    let id = source_id(config.chain_id, &swap.source)?;
    let cue = match direction {
        "buy" => "GH0ST left the pool: an arrival, acquisition or belief.",
        "sell" => "GH0ST entered the pool: a departure, shedding or impermanence.",
        _ => "The pool moved without a GH0ST balance change: an ambiguous pulse.",
    };
    let previous = memory.memories.iter().rev().find(|m| {
        m.pool_id.eq_ignore_ascii_case(&swap.source.pool_id)
            && m.manager
                .as_ref()
                .is_some_and(|manager| manager.eq_ignore_ascii_case(&swap.source.manager))
            && m.source_block <= swap.block_number
    });
    let rhythm = match previous {
        Some(m)
            if m.direction != direction && m.direction != "neutral" && direction != "neutral" =>
        {
            "The direction reversed since the last remembered pulse."
        }
        Some(m) if swap.block_number.saturating_sub(m.source_block) <= 2 => {
            "Another pulse arrived within two blocks."
        }
        Some(_) => "Some blocks have passed since the last remembered pulse.",
        None => "No earlier pulse from this pool is in confirmed memory.",
    };
    let memories: Vec<_> = memory
        .memories
        .iter()
        .rev()
        .take(p.limits.recent_memories)
        .collect();
    let memory_text = if memories.is_empty() {
        "- none".to_string()
    } else {
        memories
            .iter()
            .map(|m| format!("- {}", m.text))
            .collect::<Vec<_>>()
            .join("\n")
    };
    // Preserve the same commitment to exact confirmed memories without feeding
    // their wording back into the model. Only abstract continuity is prompted.
    let continuity = if memories.is_empty() { "A first sensation, with no established habit." }
        else if previous.is_some_and(|m| m.direction != direction) { "A familiar motion has changed direction." }
        else { "The motion is familiar; notice a different detail this time." };
    let scene = scene_instruction(&id, &candid::Nat::from(1u8))?;
    let prompt=format!("{}\nContinuity cue: {}\nVerified pulse: {} {}\n{}\nWrite the next thought.",p.voice,continuity,cue,rhythm,scene);
    if prompt.len() > 4096 {
        return Err("persona prompt exceeds byte cap".into());
    }
    Ok((prompt, hex0(hash(memory_text.as_bytes()))))
}

pub fn create_request(
    config: &Config,
    swap: &VerifiedSwap,
    timestamp: u64,
    memory: &VoiceState,
) -> Result<(Request, VoiceJob), String> {
    let (prompt, memory_hash) = build_prompt(config, swap, memory)?;
    let id = source_id(config.chain_id, &swap.source)?;
    let profile = profile();
    let ph = profile_hash();
    let voice = VoiceJob {
        profile_version: profile.version,
        profile_hash: ph.clone(),
        seed: seed(&id, 1, 0, &ph)?,
        attempt: 1,
        generation: None,
        base_prompt: prompt.clone(),
        memory_hash,
        direction: direction(config, swap)?.into(),
        previous_input_tokens: 0,
        previous_output_tokens: 0,
        quality_error: String::new(),
        remembered: false,
    };
    let request = Request {
        id,
        requester: swap.sender.clone(),
        model_id: config.model_id.clone(),
        prompt_hash: hex0(hash(prompt.as_bytes())),
        prompt,
        max_tokens: profile.sampling.max_output_tokens,
        deadline: timestamp
            .checked_add(3600)
            .ok_or("swap deadline overflow")?,
        tx_hash: swap.source.transaction_hash.clone(),
        log_index: swap.source.log_index,
        block_number: swap.block_number,
        block_hash: swap.block_hash.clone(),
    };
    Ok((request, voice))
}

pub fn validate_thought(text: &str, recent: &[String]) -> Result<String, String> {
    let p = profile();
    let answer = text.trim();
    if answer.len() < p.limits.min_characters || answer.len() > p.limits.max_characters {
        return Err("thought length is outside the persona bound".into());
    }
    if !answer.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Err("thought must be a single printable ASCII line".into());
    }
    let lower = answer.to_ascii_lowercase();
    if ["system:", "assistant:", "user:", "response:", "answer:"]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return Err("thought begins with a role or answer label".into());
    }
    if lower.split_whitespace().any(|word| {
        let token = word
            .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-')
            .trim_end_matches('.');
        let labels: Vec<_> = token.split('.').collect();
        labels.len() >= 2
            && labels.iter().all(|label| {
                !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            })
            && labels.last().is_some_and(|suffix| {
                (2..=24).contains(&suffix.len()) && suffix.chars().all(|c| c.is_ascii_alphabetic())
            })
    }) {
        return Err("thought contains a bare domain".into());
    }
    if ["http", "www.", "@", "#", "<|", "<think", "</think"]
        .iter()
        .any(|s| lower.contains(s))
    {
        return Err("thought contains a link, tag or role marker".into());
    }
    if [
        "as an ai",
        "as a language model",
        "here is",
        "here's",
        "monologue:",
        "thought:",
        "gh0st:",
        "i cannot",
        "i can't",
        "i am unable",
        "i'm unable",
        "currency0",
        "currency1",
        "amount0",
        "amount1",
        "pool deltas",
        "buy now",
        "sell now",
        "you should buy",
        "you should sell",
        "buy gh0st",
        "sell gh0st",
        "price will",
        "will pump",
        "guaranteed profit",
        "guaranteed return",
        "risk-free",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        return Err("thought contains boilerplate, raw data labels or trading instruction".into());
    }
    let finished = answer.ends_with(['.', '!', '?'])
        || answer
            .strip_suffix(['\'', ')'])
            .is_some_and(|body| body.ends_with(['.', '!', '?']));
    if answer.starts_with('"') || answer.ends_with('"') || !finished {
        return Err("thought needs a finished, unwrapped sentence".into());
    }
    if p.examples
        .iter()
        .chain(recent.iter())
        .any(|old| answer == old)
    {
        return Err("thought exactly repeats an example or recent output".into());
    }
    Ok(answer.to_string())
}

/// Reset only a completed, rejected candidate. The model baseline and global
/// chunk counter intentionally survive, so repair cannot erase compute spend.
pub fn prepare_repair(job: &mut Job, reason: &str) -> Result<(), String> {
    prepare_repair_with_policy(job, reason, false)
}
pub fn prepare_repair_with_policy(job: &mut Job, reason: &str, unlimited: bool) -> Result<(), String> {
    let p = profile();
    let voice = job
        .voice
        .as_mut()
        .ok_or("manual requests do not use voice repair")?;
    if !unlimited && voice.attempt >= p.limits.max_attempts {
        return Err(format!("persona quality gate exhausted: {reason}"));
    }
    voice.previous_input_tokens = voice.previous_input_tokens.saturating_add(job.input_tokens);
    voice.previous_output_tokens = voice
        .previous_output_tokens
        .saturating_add(job.output_tokens);
    if unlimited {
        let mut next = generation(voice); next.0 += 1u8;
        voice.generation = Some(next);
        voice.attempt = voice.attempt.saturating_add(1);
    } else { voice.attempt += 1; }
    voice.quality_error = reason.chars().take(240).collect();
    voice.seed = generation_seed(&job.request.id, voice, 0)?;
    // Keep the diagnostic in metadata, not in the generation prompt: naming a
    // repeated phrase was observed to prime this small model to say it again.
    let scene = scene_instruction(&job.request.id, &generation(voice))?;
    let context = voice.base_prompt.lines().filter(|line|
        !line.starts_with("Scene cue:") && !line.starts_with("Image seed:") && *line != "Write the next thought.")
        .collect::<Vec<_>>().join("\n");
    job.request.prompt=format!("{}\nA different angle for this attempt: {}\nFinish one sentence in 30-180 plain keyboard characters.",context,scene);
    if job.request.prompt.len() > 4096 {
        return Err("repair prompt exceeds byte cap".into());
    }
    job.request.prompt_hash = hex0(hash(job.request.prompt.as_bytes()));
    job.answer.clear();
    job.input_tokens = 0;
    job.output_tokens = 0;
    job.prompt_ingested = false;
    job.phase = crate::types::Phase::Verified;
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveredProof {
    pub tx_hash: String,
    pub log_index: u64,
    pub block_number: u64,
    pub block_hash: String,
}
pub fn parse_delivered(
    receipt: &Value,
    config: &Config,
    job: &Job,
    tx: &str,
    log_index: u64,
) -> Result<DeliveredProof, String> {
    bytes(tx, 32)?;
    if quantity(&receipt["status"])? != 1
        || receipt["transactionHash"]
            .as_str()
            .map(str::to_ascii_lowercase)
            != Some(tx.to_ascii_lowercase())
    {
        return Err("failed or mismatched thought delivery".into());
    }
    let logs = receipt["logs"].as_array().ok_or("missing delivery logs")?;
    let selected: Vec<_> = logs
        .iter()
        .filter(|l| quantity(&l["logIndex"]).ok() == Some(log_index))
        .collect();
    if selected.len() != 1 {
        return Err("delivery log absent or duplicated".into());
    }
    let log = selected[0];
    if log["removed"].as_bool().unwrap_or(false)
        || log["address"].as_str().map(str::to_ascii_lowercase)
            != Some(config.gateway.to_ascii_lowercase())
    {
        return Err("wrong gateway or removed delivery".into());
    }
    let topics = log["topics"].as_array().ok_or("missing delivery topics")?;
    if topics.len() != 3
        || topics[0].as_str().map(str::to_ascii_lowercase) != Some(hex0(hash(FULFILLED_EVENT)))
        || topics[1].as_str().map(str::to_ascii_lowercase) != Some(job.request.id.clone())
        || topics[2].as_str().map(str::to_ascii_lowercase)
            != Some(hex0(hash(job.answer.as_bytes())))
    {
        return Err("delivery thought identity/hash mismatch".into());
    }
    let data = hex::decode(
        log["data"]
            .as_str()
            .ok_or("missing delivery data")?
            .strip_prefix("0x")
            .ok_or("bad delivery data")?,
    )
    .map_err(|_| "bad delivery hex")?;
    let fields = ethabi::decode(
        &[
            ParamType::String,
            ParamType::Uint(64),
            ParamType::Uint(64),
            ParamType::Uint(128),
        ],
        &data,
    )
    .map_err(|_| "bad delivery ABI")?;
    if ethabi::encode(&fields) != data
        || fields[0].clone().into_string() != Some(job.answer.clone())
        || fields[1].clone().into_uint() != Some(job.input_tokens.into())
        || fields[2].clone().into_uint() != Some(job.output_tokens.into())
        || fields[3].clone().into_uint() != Some(job.model_cycles.into())
    {
        return Err("delivery fields differ from signed thought".into());
    }
    let block_hash = receipt["blockHash"]
        .as_str()
        .ok_or("missing delivery block")?
        .to_ascii_lowercase();
    bytes(&block_hash, 32)?;
    Ok(DeliveredProof {
        tx_hash: tx.to_ascii_lowercase(),
        log_index,
        block_number: quantity(&receipt["blockNumber"])?,
        block_hash,
    })
}

pub fn append_memory(
    state: &mut VoiceState,
    job: &Job,
    proof: &DeliveredProof,
) -> Result<(), String> {
    let source = job.source.as_ref().ok_or("not a swap thought")?;
    let direction = job
        .voice
        .as_ref()
        .ok_or("not a voice job")?
        .direction
        .clone();
    state.memories.retain(|m| m.request_id != job.request.id);
    state.memories.push(ThoughtMemory {
        request_id: job.request.id.clone(),
        text: job.answer.clone(),
        callback_tx_hash: proof.tx_hash.clone(),
        callback_log_index: proof.log_index,
        pool_id: source.pool_id.clone(),
        manager: Some(source.manager.clone()),
        source_block: job.request.block_number,
        direction,
    });
    let max = profile().limits.recent_memories;
    if state.memories.len() > max {
        state.memories.drain(..state.memories.len() - max);
    }
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or("memory revision overflow")?;
    Ok(())
}

pub fn record_output(state: &mut VoiceState, answer: &str) {
    state.recent_outputs.push(answer.to_string());
    let max = profile().limits.recent_outputs;
    if state.recent_outputs.len() > max {
        state
            .recent_outputs
            .drain(..state.recent_outputs.len() - max);
    }
}
pub fn recent_references(state: &VoiceState) -> Vec<String> {
    let mut refs = state.recent_outputs.clone();
    for memory in &state.memories {
        if !refs.contains(&memory.text) {
            refs.push(memory.text.clone());
        }
    }
    refs
}
pub fn remember_verified(
    state: &mut State,
    id: &str,
    proof: &DeliveredProof,
) -> Result<VoiceState, String> {
    let job = state.jobs.get(id).ok_or("unknown voice request")?.clone();
    let metadata = job.voice.as_ref().ok_or("not a voice thought")?;
    if metadata.remembered {
        return Ok(state.voice.clone().unwrap_or_default());
    }
    if job.phase != crate::types::Phase::Complete || job.source.is_none() {
        return Err("thought is not complete".into());
    }
    let memory = state.voice.get_or_insert_with(VoiceState::default);
    append_memory(memory, &job, proof)?;
    let out = memory.clone();
    state
        .jobs
        .get_mut(id)
        .unwrap()
        .voice
        .as_mut()
        .unwrap()
        .remembered = true;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        swaps::{pool_id, VerifiedSwap},
        types::{Phase, SwapPool, SwapSource},
    };
    use ethabi::{ethereum_types::U256, Token};
    fn config() -> Config {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let mut c: Config = serde_json::from_value(v["config"].clone()).unwrap();
        let mut pool = SwapPool {
            manager: hex0([3; 20]),
            pool_id: String::new(),
            currency0: hex0([0; 20]),
            currency1: GH0ST.into(),
            fee: 3000,
            tick_spacing: 60,
            hook: hex0([4; 20]),
        };
        pool.pool_id = pool_id(&pool).unwrap();
        c.swap_sources = Some(vec![pool]);
        c
    }
    fn swap(c: &Config) -> VerifiedSwap {
        let p = &c.swap_sources.as_ref().unwrap()[0];
        VerifiedSwap {
            source: SwapSource {
                manager: p.manager.clone(),
                pool_id: p.pool_id.clone(),
                transaction_hash: hex0(hash("test swap")),
                log_index: 7,
            },
            sender: hex0([5; 20]),
            amount0: "-7".into(),
            amount1: "9".into(),
            sqrt_price_x96: "123".into(),
            liquidity: "456".into(),
            tick: "7".into(),
            fee: 3000,
            block_number: 100,
            block_hash: hex0(hash("block")),
        }
    }
    fn job() -> (Config, Job) {
        let c = config();
        let s = swap(&c);
        let (r, v) = create_request(&c, &s, 1000, &VoiceState::default()).unwrap();
        let mut j = Job::new(r);
        j.source = Some(s.source);
        j.voice = Some(v);
        j.answer = "i loaned my shadow to the drain. it came back with a mortgage.".into();
        j.input_tokens = 280;
        j.output_tokens = 17;
        j.model_cycles = 500_000_000_000;
        j.phase = Phase::Complete;
        (c, j)
    }
    fn delivered(c: &Config, j: &Job) -> Value {
        let data = ethabi::encode(&[
            Token::String(j.answer.clone()),
            Token::Uint(j.input_tokens.into()),
            Token::Uint(j.output_tokens.into()),
            Token::Uint(j.model_cycles.into()),
        ]);
        serde_json::json!({"status":"0x1","transactionHash":hex0(hash("callback")),"blockNumber":"0x78","blockHash":hex0(hash("callback block")),"logs":[{"address":c.gateway,"logIndex":"0x2","removed":false,"topics":[hex0(hash(FULFILLED_EVENT)),j.request.id,hex0(hash(j.answer.as_bytes()))],"data":hex0(data)}]})
    }
    #[test]
    fn profile_and_seeds_are_bounded_and_source_driven() {
        validate_profile().unwrap();
        let (c, j) = job();
        let id = j.request.id;
        let a = seed(&id, 1, 0, &profile_hash()).unwrap();
        assert_eq!(a, seed(&id, 1, 0, &profile_hash()).unwrap());
        assert_ne!(a, seed(&id, 2, 0, &profile_hash()).unwrap());
        assert_ne!(a, seed(&id, 1, 4, &profile_hash()).unwrap());
        assert_ne!(
            a,
            seed(
                &source_id(c.chain_id + 1, &swap(&c).source).unwrap(),
                1,
                0,
                &profile_hash()
            )
            .unwrap()
        );
        assert_ne!(a, u32::MAX);
    }
    #[test]
    fn direction_uses_gh0st_slot_and_verified_delta_sign() {
        let mut c = config();
        let mut s = swap(&c);
        assert_eq!(direction(&c, &s).unwrap(), "buy");
        s.amount1 = "-9".into();
        assert_eq!(direction(&c, &s).unwrap(), "sell");
        let p = &mut c.swap_sources.as_mut().unwrap()[0];
        p.currency0 = GH0ST.into();
        p.currency1 = hex0([0xff; 20]);
        p.pool_id = pool_id(p).unwrap();
        s.source.pool_id = p.pool_id.clone();
        s.amount0 = "8".into();
        assert_eq!(direction(&c, &s).unwrap(), "buy");
        s.amount0 = "-8".into();
        assert_eq!(direction(&c, &s).unwrap(), "sell");
        s.amount0 = "0".into();
        assert_eq!(direction(&c, &s).unwrap(), "neutral");
    }
    #[test]
    fn prompt_is_grounded_but_does_not_parrot_raw_wallet_or_amounts() {
        let c = config();
        let s = swap(&c);
        let (p, h) = build_prompt(&c, &s, &VoiceState::default()).unwrap();
        assert!(p.contains("GH0ST left the pool"));
        assert!(!p.contains(&s.sender));
        assert!(!p.contains("currency1 9"));
        assert!(p.len() < 4096);
        assert_eq!(h.len(), 66);
        let mut m = VoiceState::default();
        m.memories.push(ThoughtMemory {
            request_id: hex0(hash("older")),
            text: "i put a halo in the drain. the drain started charging rent.".into(),
            callback_tx_hash: hex0(hash("tx")),
            callback_log_index: 2,
            pool_id: s.source.pool_id.clone(),
            manager: Some(s.source.manager.clone()),
            source_block: 99,
            direction: "sell".into(),
        });
        let (next, nh) = build_prompt(&c, &s, &m).unwrap();
        assert!(next.contains("direction reversed"));
        assert!(!next.contains("drain started charging rent"));
        assert!(!next.contains(&m.memories[0].text));
        assert!(!next.contains("Style examples"));
        assert!(next.contains("Continuity cue:"));
        for example in profile().examples { assert!(!next.contains(&example)); }
        assert_ne!(h, nh);
        m.memories[0].manager = Some(hex0([0xee; 20]));
        let (other, _) = build_prompt(&c, &s, &m).unwrap();
        assert!(!other.contains("direction reversed"));
    }
    #[test]
    fn gates_format_boilerplate_and_exact_copies_but_allows_distinct_variants() {
        let good = "i loaned my shadow to the drain. it came back with a mortgage.";
        assert_eq!(validate_thought(good, &[]).unwrap(), good);
        assert!(validate_thought("As an AI, I am a machine in this liquidity pool.", &[]).is_err());
        assert!(validate_thought("my drain has a website: https://example.com.", &[]).is_err());
        assert!(validate_thought("my shadow heard a new voice @someone today.", &[]).is_err());
        assert!(validate_thought("my shadow invented a moon and #GH0ST today.", &[]).is_err());
        assert!(validate_thought("my shadow asked for rent\nand the drain paid it.", &[]).is_err());
        assert!(validate_thought("my shadow asked for rent — the drain paid it.", &[]).is_err());
        assert!(validate_thought("too short.", &[]).is_err());
        assert!(validate_thought(&"x".repeat(181), &[]).is_err());
        assert!(
            validate_thought("my shadow asked for rent but the drain refused to", &[]).is_err()
        );
        assert!(
            validate_thought("you should buy GH0ST now because the price will rise.", &[]).is_err()
        );
        assert!(validate_thought(&profile().examples[0], &[]).is_err());
        assert!(validate_thought(good, &[good.to_string()]).is_err());
        assert!(validate_thought(
            "i loaned my shadow to a drain. it came back with a mortgage!",
            &[good.to_string()]
        )
        .is_ok());
        assert!(validate_thought(
            "the drain has elected a new pope. i suspect the plumbing lobby.",
            &[good.to_string()]
        )
        .is_ok());
    }
    #[test]
    fn completed_bad_output_can_repair_once_without_resetting_spend_or_chunks() {
        let (_, mut j) = job();
        j.model_cycles_before = 900_000_000_000;
        j.model_cycles = 300_000_000_000;
        j.chunks = 21;
        let old_hash = j.request.prompt_hash.clone();
        prepare_repair(&mut j, "thought repeats an example or recent output").unwrap();
        assert_eq!(j.phase, Phase::Verified);
        assert_eq!(j.voice.as_ref().unwrap().attempt, 2);
        assert_eq!(j.model_cycles_before, 900_000_000_000);
        assert_eq!(j.model_cycles, 300_000_000_000);
        assert_eq!(j.chunks, 21);
        assert_eq!(j.output_tokens, 0);
        assert_ne!(old_hash, j.request.prompt_hash);
        assert_eq!(j.voice.as_ref().unwrap().previous_output_tokens, 17);
        assert_eq!(max_chunks(&j), 96);
        let mut manual = j.clone();
        manual.voice = None;
        assert_eq!(max_chunks(&manual), 48);
        assert!(prepare_repair(&mut j, "again")
            .unwrap_err()
            .contains("exhausted"));
    }
    #[test]
    fn repeated_openings_and_punchlines_are_allowed_but_roles_and_domains_are_rejected() {
        for (a,b) in [
            ("the vending machine hums with borrowed teeth.","the vending machine hums beneath my unpaid warranty."),
            ("i sold my shadow so it could pay the rent.","a spoon appeared in the pool to pay the rent."),
            ("i have swallowed the receipt and now the ink sings.","i have swallowed the moon and now the tide owes me rent."),
        ] {
            assert!(validate_thought(a, &[b.to_string()]).is_ok());
            assert!(validate_thought(a, &[a.to_string()]).is_err());
        }
        for text in [
            "Assistant: my shadow finally learned to pay the rent.",
            "system: i borrowed a chair from the oracle yesterday.",
            "Answer: the vending machine has swallowed my warranty.",
            "my receipts have escaped to ghost.example for the winter.",
        ] {
            assert!(validate_thought(text, &[]).is_err());
        }
        let (_, mut j) = job();
        j.answer.clear();
        j.output_tokens = 0;
        let reason = validate_thought(&j.answer, &[]).unwrap_err();
        prepare_repair(&mut j, &reason).unwrap();
        assert_eq!(j.voice.unwrap().attempt, 2);
    }
    #[test]
    fn repair_keeps_diagnostics_out_of_positive_generation_prompt() {
        let (_, mut j) = job();
        let reason = "thought exactly repeats an example or recent output";
        prepare_repair(&mut j, reason).unwrap();
        assert_eq!(j.voice.as_ref().unwrap().quality_error, reason);
        assert!(!j.request.prompt.contains("hums with"));
        assert!(!j.request.prompt.contains("previous candidate was rejected"));
        assert!(j.request.prompt.contains("A different angle for this attempt: Scene cue:"));
        assert_eq!(j.request.prompt.matches("Scene cue:").count(), 1);
        assert!(!j.request.prompt.contains("one petty administrative action"));
        assert!(!j.request.prompt.contains("Use a new opening and action"));
        assert!(j
            .request
            .prompt
            .contains("Finish one sentence in 30-180 plain keyboard characters."));
        assert!(j.request.prompt.len() <= 4096);
        assert_eq!(
            j.request.prompt_hash,
            hex0(hash(j.request.prompt.as_bytes()))
        );
        assert_eq!(j.voice.as_ref().unwrap().attempt, 2);
    }
    #[test]
    fn finished_dialogue_and_parentheticals_keep_their_terminal_closer() {
        let dialogue="i've borrowed a chair to sit on, but it's always shifting, like a ghost in a dream. the floor whispers, 'you're not real.'";
        assert_eq!(validate_thought(dialogue, &[]).unwrap(), dialogue);
        let parenthetical = "my chair has asked for a warranty (the warranty has declined.)";
        assert_eq!(validate_thought(parenthetical, &[]).unwrap(), parenthetical);
        assert!(validate_thought("my chair is now calling itself 'the landlord'", &[]).is_err());
        assert!(validate_thought(
            "my chair has asked for a warranty (the warranty is missing)",
            &[]
        )
        .is_err());
        assert!(validate_thought(
            "\"my chair has asked for a warranty and the warranty declined.\"",
            &[]
        )
        .is_err());
    }
    #[test]
    fn shared_stock_phrases_no_longer_count_as_duplicates() {
        let recent = vec!["the vending machine hums with borrowed teeth.".to_string()];
        assert!(validate_thought("my rented chair hums with bureaucratic regret.", &recent).is_ok());
        assert!(validate_thought(
            "the vending machine has applied for custody of my spare change.",
            &recent
        )
        .is_ok());
    }
    #[test]
    fn duplicate_policy_is_exact_not_case_punctuation_word_order_or_overlap() {
        let original = "the quiet bell rings because nobody remembered to leave.";
        for distinct in [
            "The quiet bell rings because nobody remembered to leave.",
            "the quiet bell rings because nobody remembered to leave!",
            "because nobody remembered to leave, the quiet bell rings.",
            "the quiet bell rings because someone forgot to leave.",
        ] {
            assert!(validate_thought(distinct, &[original.to_string()]).is_ok(), "{distinct}");
        }
        assert!(validate_thought(original, &[original.to_string()]).unwrap_err().contains("exactly repeats"));
        // Whitespace is removed from the published answer before equality.
        assert!(validate_thought(&format!("  {original}  "), &[original.to_string()]).is_err());
        for phrase in ["hums with", "whispers of", "echoes of"] {
            let recent = format!("the old wall {phrase} electricity and hidden debts.");
            let fresh = format!("my little clock {phrase} a holiday nobody approved.");
            assert!(validate_thought(&fresh, &[recent]).is_ok());
        }
    }
    #[test]
    fn retention_fix_preserves_deployed_output_bounds() {
        assert!(validate_thought("hi.", &[]).is_err());
        let valid = "The cupboard has elected another mayor and nobody has asked the spoons.";
        assert_eq!(validate_thought(valid, &[]).unwrap(), valid);
        let long = format!("{}.", "the cupboard has elected another mayor and nobody has asked the spoons. ".repeat(4));
        assert!(validate_thought(&long, &[]).is_err());
    }
    #[test]
    fn retention_fix_preserves_deployed_new_and_retry_prompts() {
        let (_, mut j) = job();
        assert!(j.request.prompt.contains("8-24"));
        assert!(j.request.prompt.contains("80-140"));
        prepare_repair(&mut j, "rejected output").unwrap();
        assert!(j.request.prompt.contains("30-180"));
        assert!(j.request.prompt.contains("Finish one sentence"));
        assert_eq!(profile().sampling.max_output_tokens, 80);
        assert_eq!(j.request.max_tokens, 80);
        assert_eq!(j.voice.as_ref().unwrap().profile_hash, profile_hash());
    }
    #[test]
    fn composed_scenes_are_source_deterministic_varied_and_attempt_specific() {
        let mut scenes = std::collections::BTreeSet::new();
        for n in 0..64 {
            let id = hex0(hash(format!("scene-source-{n}")));
            let first = scene_instruction(&id, &candid::Nat::from(1u8)).unwrap();
            assert_eq!(first, scene_instruction(&id, &candid::Nat::from(1u8)).unwrap());
            assert_ne!(first, scene_instruction(&id, &candid::Nat::from(2u8)).unwrap());
            assert!(!first.contains("Image seed:"));
            scenes.insert(first);
        }
        assert!(scenes.len() >= 60);
    }
    #[test]
    fn new_prompt_hashes_history_without_replaying_its_words() {
        let c = config(); let s = swap(&c);
        let mut memory = VoiceState::default();
        let text = "i have swallowed the receipt and the printer wants custody.";
        memory.memories.push(ThoughtMemory { request_id:hex0(hash("memory-source")), text:text.into(),
            callback_tx_hash:hex0(hash("callback")), callback_log_index:1, pool_id:s.source.pool_id.clone(),
            manager:Some(s.source.manager.clone()), source_block:99, direction:"buy".into() });
        let (prompt, commitment) = build_prompt(&c, &s, &memory).unwrap();
        assert!(!prompt.contains(text));
        assert!(!prompt.contains("i have swallowed"));
        assert_eq!(commitment, hex0(hash(format!("- {text}"))));
        assert_eq!(build_prompt(&c, &s, &memory).unwrap(), (prompt.clone(), commitment));
        assert!(prompt.contains("Scene cue:"));
        assert!(prompt.len() < 4096);
    }
    #[test]
    fn only_exact_fulfillment_can_become_memory_and_capacity_is_bounded() {
        let (c, j) = job();
        let r = delivered(&c, &j);
        let tx = hex0(hash("callback"));
        let proof = parse_delivered(&r, &c, &j, &tx, 2).unwrap();
        let mut bad = r.clone();
        bad["logs"][0]["topics"][2] = Value::String(hex0(hash("other")));
        assert!(parse_delivered(&bad, &c, &j, &tx, 2).is_err());
        let mut bad = r.clone();
        bad["logs"][0]["address"] = Value::String(hex0([7; 20]));
        assert!(parse_delivered(&bad, &c, &j, &tx, 2).is_err());
        let mut bad = r.clone();
        bad["status"] = Value::String("0x0".into());
        assert!(parse_delivered(&bad, &c, &j, &tx, 2).is_err());
        let mut bad = r.clone();
        bad["logs"][0]["data"] = Value::String(hex0(ethabi::encode(&[
            Token::String("an altered thought appeared in the water.".into()),
            Token::Uint(j.input_tokens.into()),
            Token::Uint(j.output_tokens.into()),
            Token::Uint(U256::from(j.model_cycles)),
        ])));
        assert!(parse_delivered(&bad, &c, &j, &tx, 2).is_err());
        let mut memory = VoiceState::default();
        for n in 0..10 {
            let mut next = j.clone();
            next.request.id = hex0(hash(format!("job-{n}")));
            append_memory(&mut memory, &next, &proof).unwrap();
            record_output(&mut memory, &format!("output-{n}"));
        }
        assert_eq!(memory.memories.len(), 2);
        assert_eq!(memory.recent_outputs.len(), 8);
        assert_eq!(memory.revision, 10);
        let encoded = candid::encode_args((memory.clone(),)).unwrap();
        let (decoded,): (VoiceState,) = candid::decode_args(&encoded).unwrap();
        assert_eq!(decoded.memories[1].text, j.answer);
        assert_eq!(decoded.revision, memory.revision);
    }
    #[test]
    fn memory_ack_is_idempotent_and_voice_metadata_survives_stable_state() {
        let (c, j) = job();
        let tx = hex0(hash("callback"));
        let proof = parse_delivered(&delivered(&c, &j), &c, &j, &tx, 2).unwrap();
        let mut state = State::default();
        state.jobs.insert(j.request.id.clone(), j.clone());
        assert_eq!(
            remember_verified(&mut state, &j.request.id, &proof)
                .unwrap()
                .revision,
            1
        );
        assert_eq!(
            remember_verified(&mut state, &j.request.id, &proof)
                .unwrap()
                .revision,
            1
        );
        let encoded = candid::encode_args((state,)).unwrap();
        let (decoded,): (State,) = candid::decode_args(&encoded).unwrap();
        assert!(
            decoded.jobs[&j.request.id]
                .voice
                .as_ref()
                .unwrap()
                .remembered
        );
        assert_eq!(
            decoded.jobs[&j.request.id]
                .voice
                .as_ref()
                .unwrap()
                .profile_hash,
            profile_hash()
        );
        assert_eq!(decoded.voice.unwrap().memories.len(), 1);
    }
    #[test]
    fn older_state_without_voice_field_decodes_with_empty_memory() {
        #[derive(candid::CandidType, serde::Deserialize)]
        struct LegacyState {
            owner: Option<candid::Principal>,
            config: Option<Config>,
            jobs: std::collections::BTreeMap<String, Job>,
            active: Option<String>,
            verifying: bool,
            paused: bool,
        }
        let legacy = LegacyState {
            owner: None,
            config: None,
            jobs: Default::default(),
            active: None,
            verifying: false,
            paused: false,
        };
        let data = candid::encode_args((legacy,)).unwrap();
        let (decoded,): (State,) = candid::decode_args(&data).unwrap();
        assert!(decoded.voice.is_none());
    }
    #[test]
    fn unlimited_quality_generation_crosses_u8_without_seed_or_cache_collision() {
        let c=config();let swap=swap(&c);let (request,voice)=create_request(&c,&swap,100,&VoiceState::default()).unwrap();
        let mut j=Job::new(request);j.voice=Some(voice);j.source=Some(swap.source);
        for n in 2u16..=300 {
            prepare_repair_with_policy(&mut j,"rejected candidate",true).unwrap();
            let v=j.voice.as_ref().unwrap();assert_eq!(generation(v),candid::Nat::from(n));
            if n<=255 {assert_eq!(generation_seed(&j.request.id,v,0).unwrap(),seed(&j.request.id,n as u8,0,&v.profile_hash).unwrap());}
            else {assert!(generation_cache_tag(v).starts_with('g'));}
        }
        assert_eq!(j.voice.as_ref().unwrap().attempt,255);
        let first=generation_cache_tag(j.voice.as_ref().unwrap());
        prepare_repair_with_policy(&mut j,"another rejected candidate",true).unwrap();
        assert_ne!(first,generation_cache_tag(j.voice.as_ref().unwrap()));
    }

}
