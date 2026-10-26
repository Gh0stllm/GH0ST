use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, CandidType, Deserialize, Serialize)]
pub struct Config {
    pub worker: Principal,
    pub model_canister: Principal,
    pub model_id: String,
    pub artifact_hash: String,
    pub model_wasm_hash: String,
    pub chain_id: u64,
    pub gateway: String,
    pub rpc_urls: Vec<String>,
    pub confirmations: u64,
    pub model_cycle_budget: u128,
    pub ecdsa_key_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct Request {
    pub id: String,
    pub requester: String,
    pub model_id: String,
    pub prompt_hash: String,
    pub prompt: String,
    pub max_tokens: u32,
    pub deadline: u64,
    pub tx_hash: String,
    pub log_index: u64,
    pub block_number: u64,
    pub block_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub enum Phase {
    Verified,
    Running,
    ReadyToSign,
    Complete,
    Failed,
}

#[derive(Clone, CandidType, Deserialize, Serialize)]
pub struct Job {
    pub request: Request,
    pub phase: Phase,
    pub busy: bool,
    pub answer: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model_cycles_before: u128,
    pub model_cycles: u128,
    pub chunks: u32,
    pub prompt_ingested: bool,
    pub signature: Vec<u8>,
    pub digest: String,
    pub signer: String,
    pub error: String,
}

impl Job {
    pub fn new(request: Request) -> Self {
        Self {
            request,
            phase: Phase::Verified,
            busy: false,
            answer: String::new(),
            input_tokens: 0,
            output_tokens: 0,
            model_cycles_before: 0,
            model_cycles: 0,
            chunks: 0,
            prompt_ingested: false,
            signature: vec![],
            digest: String::new(),
            signer: String::new(),
            error: String::new(),
        }
    }
}

#[derive(Clone, Default, CandidType, Deserialize, Serialize)]
pub struct State {
    pub owner: Option<Principal>,
    pub config: Option<Config>,
    pub jobs: BTreeMap<String, Job>,
    pub active: Option<String>,
    pub verifying: bool,
    pub paused: bool,
}

#[derive(CandidType, Deserialize)]
pub struct ModelInput {
    pub args: Vec<String>,
}

// Subset of the pinned upstream Candid record: extra upstream fields are ignored.
#[derive(CandidType, Deserialize)]
pub struct ModelOutput {
    pub status_code: u16,
    pub output: String,
    pub error: String,
    pub prompt_remaining: String,
    pub generated_eog: bool,
    pub n_prompt_tokens: Option<u64>,
    pub n_tokens_generated: Option<u64>,
    pub n_prompt_tokens_remaining: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub enum ModelResult {
    Ok(ModelOutput),
    Err(ModelOutput),
}
