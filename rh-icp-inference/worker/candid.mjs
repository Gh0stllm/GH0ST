export const idlFactory = ({ IDL }) => {
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
  });
  const Result = (t) => IDL.Variant({ Ok: t, Err: IDL.Text });
  return IDL.Service({
    get_config: IDL.Func([], [Config], ["query"]),
    get_job: IDL.Func([IDL.Text], [IDL.Opt(Job)], ["query"]),
    list_jobs: IDL.Func([], [IDL.Vec(Job)], ["query"]),
    submit_request: IDL.Func([IDL.Text, IDL.Nat64], [Result(Job)], []),
    advance: IDL.Func([IDL.Text], [Result(Job)], []),
    abort: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    cleanup: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    signer_address: IDL.Func([], [Result(IDL.Text)], []),
    bind_gateway: IDL.Func([IDL.Text], [Result(IDL.Null)], []),
    set_paused: IDL.Func([IDL.Bool], [Result(IDL.Null)], []),
  });
};
