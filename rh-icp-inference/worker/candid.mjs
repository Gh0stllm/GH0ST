import {retentionStatusType, jobPageType} from "./job-history.mjs";

export const idlFactory = ({ IDL }) => {
  const SwapPool = IDL.Record({
    manager: IDL.Text,
    pool_id: IDL.Text,
    currency0: IDL.Text,
    currency1: IDL.Text,
    fee: IDL.Nat32,
    tick_spacing: IDL.Int32,
    hook: IDL.Text,
  });
  const SwapSource = IDL.Record({
    manager: IDL.Text,
    pool_id: IDL.Text,
    transaction_hash: IDL.Text,
    log_index: IDL.Nat64,
  });
  const VoiceJob = IDL.Record({
    profile_version: IDL.Text,
    profile_hash: IDL.Text,
    seed: IDL.Nat32,
    attempt: IDL.Nat8,
    generation: IDL.Opt(IDL.Nat),
    base_prompt: IDL.Text,
    memory_hash: IDL.Text,
    previous_input_tokens: IDL.Nat64,
    previous_output_tokens: IDL.Nat64,
    quality_error: IDL.Text,
    remembered: IDL.Bool,
    direction: IDL.Text,
  });
  const ThoughtMemory = IDL.Record({
    request_id: IDL.Text,
    text: IDL.Text,
    callback_tx_hash: IDL.Text,
    callback_log_index: IDL.Nat64,
    pool_id: IDL.Text,
    source_block: IDL.Nat64,
    direction: IDL.Text,
    manager: IDL.Opt(IDL.Text),
  });
  const VoiceState = IDL.Record({
    revision: IDL.Nat64,
    memories: IDL.Vec(ThoughtMemory),
    recent_outputs: IDL.Vec(IDL.Text),
    remembering: IDL.Opt(IDL.Text),
  });
  const Config = IDL.Record({
    worker: IDL.Principal,
    model_canister: IDL.Principal,
    model_id: IDL.Text,
    artifact_hash: IDL.Text,
    model_wasm_hash: IDL.Text,
    chain_id: IDL.Nat64,
    gateway: IDL.Text,
    rpc_urls: IDL.Vec(IDL.Text),
    confirmations: IDL.Nat64,
    model_cycle_budget: IDL.Nat,
    ecdsa_key_name: IDL.Text,
    swap_sources: IDL.Opt(IDL.Vec(SwapPool)),
  });
  const Request = IDL.Record({
    id: IDL.Text,
    requester: IDL.Text,
    model_id: IDL.Text,
    prompt_hash: IDL.Text,
    prompt: IDL.Text,
    max_tokens: IDL.Nat32,
    deadline: IDL.Nat64,
    tx_hash: IDL.Text,
    log_index: IDL.Nat64,
    block_number: IDL.Nat64,
    block_hash: IDL.Text,
  });
  const RecoveryInfo = IDL.Record({
    total_budget: IDL.Nat, grants: IDL.Nat32, carry_cycles: IDL.Nat,
    segment_baseline: IDL.Opt(IDL.Nat), rebuilding: IDL.Bool,
    replay_target: IDL.Text, replay_target_tokens: IDL.Nat64,
    replay_output: IDL.Text, replay_tokens: IDL.Nat64, replay_prompt_ingested: IDL.Bool,
    parked: IDL.Bool, requires_owner: IDL.Bool, last_error: IDL.Text,
    chunks_at_recovery: IDL.Nat32, max_chunks: IDL.Nat32,
    retry_after: IDL.Nat64, safe_retry_count: IDL.Nat32, resume_deadline: IDL.Nat64,
    accounting_uncertain: IDL.Bool,
    cache_evidence_hash: IDL.Opt(IDL.Text),
  });
  const Job = IDL.Record({
    request: Request,
    phase: IDL.Variant({
      Verified: IDL.Null,
      Running: IDL.Null,
      ReadyToSign: IDL.Null,
      Complete: IDL.Null,
      Failed: IDL.Null,
    }),
    busy: IDL.Bool,
    answer: IDL.Text,
    input_tokens: IDL.Nat64,
    output_tokens: IDL.Nat64,
    model_cycles_before: IDL.Nat,
    model_cycles: IDL.Nat,
    chunks: IDL.Nat32,
    prompt_ingested: IDL.Bool,
    signature: IDL.Vec(IDL.Nat8),
    digest: IDL.Text,
    signer: IDL.Text,
    error: IDL.Text,
    source: IDL.Opt(SwapSource),
    voice: IDL.Opt(VoiceJob),
    recovery: IDL.Opt(RecoveryInfo),
  });
  const DeferredSwap = IDL.Record({id:IDL.Text,model_cycles:IDL.Nat,reason:IDL.Text,deferred_at:IDL.Nat64});
  const Result = (t) => IDL.Variant({ Ok: t, Err: IDL.Text });
  return IDL.Service({
    get_config: IDL.Func([], [Config], ["query"]),
    get_voice_state: IDL.Func([], [VoiceState], ["query"]),
    get_job: IDL.Func([IDL.Text], [IDL.Opt(Job)], ["query"]),
    list_jobs: IDL.Func([], [IDL.Vec(Job)], ["query"]),
    retention_status: IDL.Func([], [retentionStatusType(IDL)], ["query"]),
    list_jobs_page: IDL.Func([IDL.Opt(IDL.Text), IDL.Nat32], [jobPageType(IDL, Job)], ["query"]),
    submit_request: IDL.Func([IDL.Text, IDL.Nat64], [Result(Job)], []),
    submit_swap: IDL.Func([IDL.Text, IDL.Nat64], [Result(Job)], []),
    remember_delivered: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Nat64],
      [Result(VoiceState)],
      [],
    ),
    advance: IDL.Func([IDL.Text], [Result(Job)], []),
    abort: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    cleanup: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    signer_address: IDL.Func([], [Result(IDL.Text)], []),
    bind_gateway: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    rebind_gateway: IDL.Func([IDL.Text, IDL.Text, IDL.Text, IDL.Text], [Result(IDL.Null)], []),
    recover_job: IDL.Func([IDL.Text, IDL.Nat], [Result(Job)], []),
    resume_job: IDL.Func([IDL.Text], [Result(Job)], []),
    enable_unlimited_swaps: IDL.Func([IDL.Nat], [Result(IDL.Null)], []),
    defer_failed_swap: IDL.Func([IDL.Text,IDL.Nat,IDL.Text], [Result(IDL.Null)], []),
    get_deferred_swaps: IDL.Func([], [IDL.Vec(DeferredSwap)], ["query"]),
    resume_retained_job: IDL.Func([IDL.Text,IDL.Nat,IDL.Nat32,IDL.Text], [Result(Job)], []),
    set_paused: IDL.Func([IDL.Bool], [Result(IDL.Null)], []),
  });
};
