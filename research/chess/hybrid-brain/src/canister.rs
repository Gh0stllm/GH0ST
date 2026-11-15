use super::*;
use crate::rpc_consensus as quorum;
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_management_canister_types::*;
use ic_stable_structures::{
    DefaultMemoryImpl, StableBTreeMap, StableCell,
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
};
use serde_json::{Value, json};
use std::cell::RefCell;
type Memory = VirtualMemory<DefaultMemoryImpl>;
thread_local! {
 static MM:RefCell<MemoryManager<DefaultMemoryImpl>>=RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
 static CONFIG:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(0))),vec![]));
 static JOBS:RefCell<StableBTreeMap<Hash,Vec<u8>,Memory>>=RefCell::new(StableBTreeMap::init(MM.with(|m|m.borrow().get(MemoryId::new(1)))));
 static META:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(2))),vec![]));
 static TERMINAL_RELEASE:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(3))),vec![]));
 static CLOSED_GAMES:RefCell<StableBTreeMap<Hash,u8,Memory>>=RefCell::new(StableBTreeMap::init(MM.with(|m|m.borrow().get(MemoryId::new(4)))));
 static RELAY_RPC:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(5))),vec![]));
}
#[derive(Clone, Debug, Default, CandidType, Deserialize)]
struct RelayRpc {
    last_at: u64,
    lease_until: u64,
    generation: u64,
    day: u64,
    spent: u128,
}
fn relay_rpc() -> RelayRpc {
    RELAY_RPC.with(|s| {
        if s.borrow().get().is_empty() {
            RelayRpc::default()
        } else {
            candid::decode_one(s.borrow().get()).expect("relay RPC accounting")
        }
    })
}
fn put_relay_rpc(s: RelayRpc) {
    RELAY_RPC.with(|v| v.borrow_mut().set(candid::encode_one(s).unwrap()));
}
const MAX_CLOSED_GAMES: u64 = 4096;
fn pending_release() -> Option<Hash> {
    TERMINAL_RELEASE.with(|s| {
        let b = s.borrow();
        (!b.get().is_empty()).then(|| fixed(b.get()).expect("terminal release schema"))
    })
}
fn set_pending_release(game: Option<Hash>) {
    TERMINAL_RELEASE.with(|s| {
        s.borrow_mut()
            .set(game.map_or_else(Vec::new, |g| g.to_vec()))
    });
}
fn terminal_job(game: Hash) -> bool {
    pending_release() == Some(game) || CLOSED_GAMES.with(|s| s.borrow().contains_key(&game))
}
#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct Meta {
    public_key: Vec<u8>,
    last_rpc_at: u64,
    rpc_lease_until: u64,
    rpc_generation: u64,
    rpc_day: u64,
    rpc_spent: u128,
    signing_rpc_day: u64,
    signing_rpc_spent: u128,
    ready_at: u64,
    paused: bool,
    active_game: Hash,
    free_pool: Vec<u8>,
}
fn cfg() -> Config {
    CONFIG.with(|c| candid::decode_one(c.borrow().get()).expect("config"))
}
fn meta() -> Meta {
    META.with(|m| {
        if m.borrow().get().is_empty() {
            Meta::default()
        } else {
            candid::decode_one(m.borrow().get()).expect("meta")
        }
    })
}
fn put_meta(m: Meta) {
    META.with(|s| s.borrow_mut().set(candid::encode_one(m).unwrap()));
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000_000
}
fn put(j: &Job) {
    // A callback from an old advance can arrive after canonical terminal cleanup.
    // It must never resurrect a pruned job or a discarded retained continuation.
    if terminal_job(j.game_id) {
        return;
    }
    JOBS.with(|s| {
        s.borrow_mut()
            .insert(j.job_id, candid::encode_one(j).unwrap())
    });
}
fn get(id: Hash) -> R<Job> {
    JOBS.with(|s| s.borrow().get(&id))
        .map(|v| candid::decode_one(&v).expect("job schema"))
        .ok_or("unknown job".into())
}
fn management(method: &str) -> Call<'_, '_> {
    Call::bounded_wait(Principal::management_canister(), method)
}
fn key(c: &Config) -> EcdsaKeyId {
    EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: c.key_name.clone(),
    }
}
fn path() -> Vec<Vec<u8>> {
    vec![b"GH0ST_HYBRID_CHESS_V1".to_vec()]
}

#[init]
fn init(c: Config) {
    c.validate().expect("invalid config");
    assert_ne!(
        c.relay_canister,
        ic_cdk::api::canister_self(),
        "relay must be a distinct canister"
    );
    assert!(
        !c.reviewed_release,
        "initial release must remain closed until reviewed sealing"
    );
    CONFIG.with(|s| {
        assert!(s.borrow().get().is_empty());
        s.borrow_mut().set(candid::encode_one(c).unwrap());
    });
}
#[post_upgrade]
fn upgraded() {
    // A lost async callback cannot authorize a weaker replacement search. Recovery only reads
    // the durable engine journal. The engine itself faults an active continuation on upgrade.
    let jobs: Vec<Job> = JOBS.with(|s| {
        s.borrow()
            .iter()
            .map(|e| candid::decode_one(&e.value()).unwrap())
            .collect()
    });
    for mut j in jobs {
        if j.in_flight {
            j.in_flight = false;
            j.phase = "RecoverEngine".into();
            j.error = Some("coordinator upgraded during call; reconcile engine journal".into());
            put(&j)
        }
    }
    let mut m = meta();
    m.ready_at = 0;
    m.rpc_lease_until = 0;
    put_meta(m);
    let mut relay = relay_rpc();
    relay.lease_until = 0;
    put_relay_rpc(relay);
}

#[derive(Debug, CandidType, Deserialize)]
struct Status {
    relay_canister: Principal,
    production_ready: bool,
    paid_entries_enabled: bool,
    blockers: Vec<String>,
    engine_config_hash: Hash,
    engine_canister: Principal,
    stockfish_commit: String,
    nnue_sha256: String,
    nodes: u64,
    hash_mb: u32,
    cache_policy: String,
    attestor_address: String,
    chain_id: u64,
    game_contract: String,
}
#[query]
fn get_status() -> Status {
    let c = cfg();
    let m = meta();
    let mut blockers = vec![];
    if !c.reviewed_release {
        blockers.push("reviewed deployment and strength gates are not approved".into())
    }
    if m.public_key.is_empty() {
        blockers.push("threshold signer has not been derived and verified".into())
    }
    if m.ready_at == 0 || now() > m.ready_at + 120 {
        blockers.push("canonical deployment readiness needs refresh_status".into())
    }
    if pending_release().is_some() {
        blockers.push("canonical terminal cleanup requires refresh_status".into())
    }
    let ready = blockers.is_empty();
    let prize =
        unhex("0x00000000000000000000000000000000000000000000d3c21bcecceda1000000").unwrap();
    let funded = m.free_pool.len() == 32 && m.free_pool >= prize;
    Status {
        relay_canister: c.relay_canister,
        production_ready: ready,
        paid_entries_enabled: ready && !m.paused && funded && m.active_game == [0; 32],
        blockers,
        engine_config_hash: c.engine_hash(),
        engine_canister: c.engine_canister,
        stockfish_commit: STOCKFISH_COMMIT.into(),
        nnue_sha256: NNUE_SHA256.into(),
        nodes: NODES,
        hash_mb: HASH_MB,
        cache_policy: "retained-per-game".into(),
        attestor_address: ethereum_address(&m.public_key)
            .map(|v| hex(&v))
            .unwrap_or_default(),
        chain_id: 4663,
        game_contract: hex(&c.game_contract),
    }
}
#[query]
fn get_job(game_id: Hash, ply: u32) -> Option<Job> {
    JOBS.with(|s| {
        s.borrow()
            .iter()
            .map(|e| candid::decode_one::<Job>(&e.value()).unwrap())
            .find(|j| j.game_id == game_id && j.ply == ply)
    })
}

#[update]
async fn prepare_signer() -> R<String> {
    if !meta().public_key.is_empty() {
        return ethereum_address(&meta().public_key).map(|x| hex(&x));
    }
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("controller required for one-time signer preparation".into());
    }
    let c = cfg();
    let r = management("ecdsa_public_key")
        .with_arg(EcdsaPublicKeyArgs {
            canister_id: None,
            derivation_path: path(),
            key_id: key(&c),
        })
        .await
        .map_err(|_| "public-key request failed")?
        .candid::<EcdsaPublicKeyResult>()
        .map_err(|_| "public-key decode failed")?;
    let a = ethereum_address(&r.public_key)?;
    let mut m = meta();
    m.public_key = r.public_key;
    put_meta(m);
    Ok(hex(&a))
}

/// One-time controller action after signer derivation and a paused native-game deployment.
/// No key, engine, strength, RPC or existing bound deployment can be changed by this method.
#[update]
async fn seal_release(binding: DeploymentBinding) -> R<Status> {
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("controller required for one-time deployment sealing".into());
    }
    let initial = cfg();
    let candidate = initial.seal(&binding)?;
    if meta().public_key.is_empty() {
        return Err("derive and review the threshold signer before sealing".into());
    }
    let lease = rpc_lease(RpcLane::Public)?;
    let result = async {
        let info = engine_info(&candidate).await?;
        if info.faulted || !info.reserved_game.is_empty() || !info.active_job.is_empty() {
            return Err("engine must be healthy and idle before first deployment sealing".into());
        }
        if info.cycle_balance < candid::Nat::from(3_500_000_000_000u64) {
            return Err("engine lacks fixed-budget operating reserve".into());
        }
        let snapshot = canonical(&candidate, None).await?;
        recheck_block(&candidate, &snapshot).await?;
        if !snapshot.paused || snapshot.active != [0; 32] {
            return Err(
                "native game must be paused with no active paid game before sealing".into(),
            );
        }
        // An overlapping controller request cannot overwrite the first successful binding.
        cfg().seal(&binding)?;
        CONFIG.with(|s| s.borrow_mut().set(candid::encode_one(&candidate).unwrap()));
        let mut m = meta();
        m.ready_at = now();
        m.paused = snapshot.paused;
        m.active_game = snapshot.active;
        m.free_pool = snapshot.free_pool;
        put_meta(m);
        Ok(get_status())
    }
    .await;
    unlock_rpc(lease, RpcLane::Public);
    result
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct EngineError {
    code: String,
    message: String,
    refundable: bool,
}
#[derive(Clone, Debug, CandidType, Deserialize)]
struct EngineInfo {
    coordinator: Principal,
    reserved_game: Vec<u8>,
    active_job: Vec<u8>,
    config_hash: Vec<u8>,
    faulted: bool,
    fault_reason: String,
    capacity: u32,
    retained_jobs: u32,
    max_jobs: u32,
    nodes: u64,
    hash_mb: u32,
    quantum: u32,
    yield_policy: String,
    instruction_target: u64,
    engine_commit: String,
    nnue_sha256: String,
    cycle_balance: candid::Nat,
}
#[derive(Clone, Debug, CandidType, Deserialize)]
struct EngineProgress {
    game_id: Vec<u8>,
    job_id: Vec<u8>,
    position_hash: Vec<u8>,
    config_hash: Vec<u8>,
    ply: u32,
    step: u32,
    phase: String,
    bestmove: String,
    actual_nodes: u64,
    observed_nodes: u64,
    depth: u32,
    stop_reason: String,
    instructions: u64,
    instructions_total: u64,
    engine_commit: String,
    nnue_sha256: String,
}
#[derive(Clone, Debug, CandidType, Deserialize)]
struct EngineJob {
    game_id: Vec<u8>,
    position_hash: Vec<u8>,
    ply: u32,
    initial_fen: String,
    moves: Vec<String>,
}
async fn engine_info(c: &Config) -> R<EngineInfo> {
    let info = management("canister_info")
        .with_arg(CanisterInfoArgs {
            canister_id: c.engine_canister,
            num_requested_changes: None,
        })
        .await
        .map_err(|_| "engine module read failed")?
        .candid::<CanisterInfoResult>()
        .map_err(|_| "engine module decode failed")?;
    if info.module_hash.as_deref() != Some(c.engine_module_hash.as_slice()) {
        return Err("engine module hash mismatch; no search permitted".into());
    }
    let r = Call::bounded_wait(c.engine_canister, "get_info")
        .await
        .map_err(|_| "engine info failed")?
        .candid::<Result<EngineInfo, EngineError>>()
        .map_err(|_| "engine info decode failed")?
        .map_err(|e| e.message)?;
    if r.coordinator != ic_cdk::api::canister_self()
        || r.config_hash != c.engine_hash()
        || r.nodes != NODES
        || r.hash_mb != HASH_MB
        || r.capacity != 1
        || r.quantum != 0
        || r.yield_policy != "instruction-budget"
        || r.instruction_target != 28_000_000_000
        || r.engine_commit != STOCKFISH_COMMIT
        || r.nnue_sha256 != NNUE_SHA256
    {
        return Err("engine identity/policy mismatch".into());
    }
    Ok(r)
}

/// Strips dynamic HTTP headers and normalizes JSON object ordering for subnet consensus.
#[query]
fn transform(args: TransformArgs) -> HttpRequestResult {
    let response = args.response;
    let body = serde_json::from_slice::<Value>(&response.body)
        .map(quorum::normalize_batch)
        .and_then(|v| serde_json::to_vec(&v))
        .unwrap_or_else(|_| b"null".to_vec());
    HttpRequestResult {
        status: response.status,
        headers: vec![],
        body,
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum RpcLane {
    Public,
    Relay,
    Signing,
}
fn caller_lane(c: &Config) -> RpcLane {
    if ic_cdk::api::msg_caller() == c.relay_canister {
        RpcLane::Relay
    } else {
        RpcLane::Public
    }
}
const PUBLIC_RPC_DAILY_CAP: u128 = 1_000_000_000_000;
const RELAY_RPC_DAILY_CAP: u128 = 1_000_000_000_000;
const SIGNING_RPC_DAILY_CAP: u128 = 2_000_000_000_000;
fn charge_rpc_budget(debit: u128, lane: RpcLane) -> R<()> {
    if ic_cdk::api::canister_cycle_balance() < 2_000_000_000_000 + debit {
        return Err("RPC operating reserve is low".into());
    }
    if lane == RpcLane::Relay {
        let mut r = relay_rpc();
        let day = now() / 86400;
        if r.day != day {
            r.day = day;
            r.spent = 0;
        }
        if r.spent.saturating_add(debit) > RELAY_RPC_DAILY_CAP {
            return Err("daily protected relay verification budget reached".into());
        }
        r.spent += debit;
        put_relay_rpc(r);
        return Ok(());
    }
    let mut m = meta();
    let day = now() / 86400;
    let (epoch, spent, cap) = match lane {
        RpcLane::Public => (&mut m.rpc_day, &mut m.rpc_spent, PUBLIC_RPC_DAILY_CAP),
        RpcLane::Signing => (
            &mut m.signing_rpc_day,
            &mut m.signing_rpc_spent,
            SIGNING_RPC_DAILY_CAP,
        ),
        RpcLane::Relay => unreachable!(),
    };
    if *epoch != day {
        *epoch = day;
        *spent = 0;
    }
    if spent.saturating_add(debit) > cap {
        return Err(match lane {
            RpcLane::Public => "daily public canonical verification budget reached",
            RpcLane::Signing => "daily protected signing verification budget reached",
            RpcLane::Relay => unreachable!(),
        }
        .into());
    }
    *spent += debit;
    put_meta(m);
    Ok(())
}
async fn rpc_for(c: &Config, body: Value, lane: RpcLane) -> R<Value> {
    let b = serde_json::to_vec(&body).unwrap();
    let max = 65_536;
    let args = HttpRequestArgs {
        url: c.rpc_url.clone(),
        max_response_bytes: Some(max),
        method: HttpMethod::POST,
        headers: vec![HttpHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body: Some(b.clone()),
        transform: Some(TransformContext {
            function: TransformFunc(candid::Func {
                principal: ic_cdk::api::canister_self(),
                method: "transform".into(),
            }),
            context: vec![],
        }),
    };
    let cost = ic_cdk::api::cost_http_request((b.len() + c.rpc_url.len() + 256) as u64, max);
    let debit = cost + cost / 10;
    charge_rpc_budget(debit, lane)?;
    let response = management("http_request")
        .with_arg(args)
        .with_cycles(cost + cost / 10)
        .await
        .map_err(|_| "canonical RPC outcall failed")?
        .candid::<HttpRequestResult>()
        .map_err(|_| "canonical RPC response decode failed")?;
    if response.status != 200u16 {
        return Err("canonical RPC HTTP status failed".into());
    }
    serde_json::from_slice(&response.body).map_err(|_| "invalid canonical RPC JSON".into())
}
async fn quorum_head(c: &Config, lane: RpcLane) -> R<u64> {
    // A committee of13 is safe only on the reviewed13-node execution subnet.
    quorum::ensure_reviewed_subnet(ic_cdk::api::subnet_self_node_count())?;
    let body = serde_json::to_vec(&json!([
        {"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},
        {"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}
    ]))
    .unwrap();
    let max = 4096;
    let args = quorum::FlexibleArgs {
        url: c.rpc_url.clone(),
        max_response_bytes: Some(max),
        method: quorum::Method::Post,
        headers: vec![quorum::Header {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body: Some(body.clone()),
        transform: None,
        replication: Some(quorum::Replication::default()),
    };
    let cost_args = candid::encode_one(quorum::CostParams::flexible(
        (body.len() + c.rpc_url.len() + 256) as u64,
        max,
    ))
    .map_err(|_| "flexible cost encoding failed")?;
    let cost = ic_cdk::api::cost_http_request_v2(&cost_args);
    let debit = cost + cost / 10;
    charge_rpc_budget(debit, lane)?;
    let response = management("flexible_http_request")
        .with_arg(args)
        .with_cycles(debit)
        .await
        .map_err(|_| "quorum head outcall unavailable")?
        .candid::<quorum::FlexibleResponse>()
        .map_err(|_| "quorum head response decoding failed")?;
    match response {
        quorum::FlexibleResponse::Ok(responses) => quorum::head_median(&responses),
        quorum::FlexibleResponse::Err(_) => {
            Err("quorum head outcall did not reach its committee bounds".into())
        }
    }
}
fn call_data(s: &str, arg: Option<Hash>) -> String {
    let mut b = keccak(s.as_bytes())[..4].to_vec();
    if let Some(a) = arg {
        b.extend(a)
    }
    hex(&b)
}
fn result(v: &Value, id: u64) -> R<&Value> {
    quorum::result(v, id)
}
fn number(v: &Value) -> R<u64> {
    quorum::quantity(v)
}
fn bytes(v: &Value) -> R<Vec<u8>> {
    unhex(v.as_str().ok_or("missing hex bytes")?)
}

struct Snapshot {
    game: Option<Game>,
    active: Hash,
    paused: bool,
    block: u64,
    block_hash: Hash,
    free_pool: Vec<u8>,
}
async fn canonical(c: &Config, id: Option<Hash>) -> R<Snapshot> {
    canonical_for(c, id, RpcLane::Public).await
}
async fn canonical_for(c: &Config, id: Option<Hash>, lane: RpcLane) -> R<Snapshot> {
    // One immutable official RPC. This is provider/subnet-consensus trust, not an EVM state proof.
    let n = quorum_head(c, lane)
        .await?
        .checked_sub(c.confirmations)
        .ok_or("chain too short")?;
    let block = format!("0x{n:x}");
    let mut req = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}),
        json!({"jsonrpc":"2.0","id":2,"method":"eth_getBlockByNumber","params":[block,false]}),
        json!({"jsonrpc":"2.0","id":3,"method":"eth_getCode","params":[hex(&c.game_contract),block]}),
    ];
    let calls = [
        "activeGameId()",
        "paused()",
        "engineConfigHash()",
        "attestor()",
        "paymentToken()",
        "freePool()",
    ];
    for (i, method) in calls.iter().enumerate() {
        req.push(json!({"jsonrpc":"2.0","id":10+i,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":call_data(method,None)},block]}));
    }
    if let Some(g) = id {
        req.push(json!({"jsonrpc":"2.0","id":30,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":call_data("getGame(bytes32)",Some(g))},block]}));
    }
    let v = rpc_for(c, Value::Array(req), lane).await?;
    if number(result(&v, 1)?)? != 4663 || keccak(&bytes(result(&v, 3)?)?) != c.game_runtime_hash {
        return Err("chain/runtime identity mismatch".into());
    }
    let b = result(&v, 2)?;
    let hash: Hash = fixed(&bytes(&b["hash"])?)?;
    let timestamp = number(&b["timestamp"])?;
    if number(&b["number"])? != n || timestamp > now() + 30 || now().saturating_sub(timestamp) > 600
    {
        return Err("canonical block is stale or inconsistent".into());
    }
    let ec = fixed::<32>(&bytes(result(&v, 12)?)?)?;
    let a = bytes(result(&v, 13)?)?;
    let t = bytes(result(&v, 14)?)?;
    if ec != c.engine_hash()
        || a.len() != 32
        || t.len() != 32
        || a != aword(ethereum_address(&meta().public_key)?)
        || hex(&t[12..]) != TOKEN
    {
        return Err("deployed engine/signer/token binding mismatch".into());
    }
    let active = fixed(&bytes(result(&v, 10)?)?)?;
    let paused = match uint(&bytes(result(&v, 11)?)?)? {
        0 => false,
        1 => true,
        _ => return Err("bad pause value".into()),
    };
    let free_pool = bytes(result(&v, 15)?)?;
    if free_pool.len() != 32 {
        return Err("bad pool ABI".into());
    }
    Ok(Snapshot {
        game: if id.is_some() {
            Some(Game::decode(&bytes(result(&v, 30)?)?)?)
        } else {
            None
        },
        active,
        paused,
        block: n,
        block_hash: hash,
        free_pool,
    })
}
async fn recheck_block(c: &Config, s: &Snapshot) -> R<()> {
    recheck_block_for(c, s, RpcLane::Public).await
}
async fn recheck_block_for(c: &Config, s: &Snapshot, lane: RpcLane) -> R<()> {
    let v=rpc_for(c,json!({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[format!("0x{:x}",s.block),false]}),lane).await?;
    if bytes(&result(&v, 1)?["hash"])? != s.block_hash {
        return Err("canonical block changed; retry verification".into());
    }
    Ok(())
}
fn rpc_lease(lane: RpcLane) -> R<u64> {
    if lane == RpcLane::Relay {
        let mut r = relay_rpc();
        if now() < r.lease_until || now() < r.last_at.saturating_add(30) {
            return Err("protected relay verification busy; retry later".into());
        }
        r.last_at = now();
        r.lease_until = now() + 120;
        r.generation = r
            .generation
            .checked_add(1)
            .ok_or("relay verification generation exhausted")?;
        let generation = r.generation;
        put_relay_rpc(r);
        return Ok(generation);
    }
    let mut m = meta();
    if now() < m.rpc_lease_until || now() < m.last_rpc_at.saturating_add(30) {
        return Err("canonical verification busy; query existing job and retry later".into());
    }
    m.last_rpc_at = now();
    m.rpc_lease_until = now() + 120;
    m.rpc_generation = m
        .rpc_generation
        .checked_add(1)
        .ok_or("verification generation exhausted")?;
    let generation = m.rpc_generation;
    put_meta(m);
    Ok(generation)
}
fn unlock_rpc(generation: u64, lane: RpcLane) {
    if lane == RpcLane::Relay {
        let mut r = relay_rpc();
        if r.generation == generation {
            r.lease_until = 0;
        }
        put_relay_rpc(r);
        return;
    }
    let mut m = meta();
    if m.rpc_generation == generation {
        m.rpc_lease_until = 0;
    }
    put_meta(m)
}
fn prune_game(old: Hash) {
    let old_ids: Vec<Hash> = JOBS.with(|s| {
        s.borrow()
            .iter()
            .filter_map(|e| {
                let j: Job = candid::decode_one(&e.value()).unwrap();
                (j.game_id == old).then_some(*e.key())
            })
            .collect()
    });
    JOBS.with(|s| {
        let mut s = s.borrow_mut();
        for id in old_ids {
            s.remove(&id);
        }
    });
}
async fn release_terminal(
    c: &Config,
    info: EngineInfo,
    active: Hash,
    lane: RpcLane,
) -> R<EngineInfo> {
    if pending_release().is_none()
        && (info.reserved_game.is_empty() || info.reserved_game == active)
    {
        return Ok(info);
    }
    let old = match pending_release() {
        Some(old) => old,
        None => fixed(&info.reserved_game)?,
    };
    let s = canonical_for(c, Some(old), lane).await?;
    let game = s.game.as_ref().ok_or("missing prior game")?;
    if game.result == 0 || game.id(c.game_contract) != old || s.active == old {
        return Err("another retained game is still active".into());
    }
    recheck_block_for(c, &s, lane).await?;
    if CLOSED_GAMES.with(|s| s.borrow().contains_key(&old)) {
        return engine_info(c).await;
    }
    if let Some(pending) = pending_release() {
        if pending != old {
            return Err("another terminal cleanup is pending".into());
        }
    } else {
        if CLOSED_GAMES.with(|s| s.borrow().len()) >= MAX_CLOSED_GAMES {
            return Err("terminal game archive capacity reached".into());
        }
        // Persist before the release await. A committed release with a lost/error
        // response can then be recovered from its now-empty reservation.
        set_pending_release(Some(old));
    }
    let current = engine_info(c).await?;
    let released = if current.reserved_game.is_empty() {
        current
    } else if current.reserved_game == old {
        Call::bounded_wait(c.engine_canister, "release_game")
            .with_arg(old)
            .await
            .map_err(|_| "prior reservation release uncertain; retry terminal cleanup")?
            .candid::<Result<EngineInfo, EngineError>>()
            .map_err(|_| "release decode; retry terminal cleanup")?
            .map_err(|e| e.message)?;
        engine_info(c).await?
    } else {
        return Err("terminal cleanup reservation changed; no pruning permitted".into());
    };
    if !released.reserved_game.is_empty() || pending_release() != Some(old) {
        return Err("terminal release is not acknowledged; no pruning permitted".into());
    }
    // Tombstone precedes pruning in the same atomic message. Late callbacks and
    // replayed old requests cannot recreate jobs after a successful cleanup.
    CLOSED_GAMES.with(|s| s.borrow_mut().insert(old, 1));
    prune_game(old);
    set_pending_release(None);
    Ok(released)
}
#[update]
async fn refresh_status() -> R<Status> {
    let c = cfg();
    let lane = caller_lane(&c);
    if !c.reviewed_release {
        return Err("reviewed release gate closed".into());
    }
    let lease = rpc_lease(lane)?;
    let r = async {
        let info = engine_info(&c).await?;
        if info.cycle_balance < candid::Nat::from(3_500_000_000_000u64) {
            return Err("engine lacks fixed-budget operating reserve".into());
        }
        let s = canonical_for(&c, None, lane).await?;
        recheck_block_for(&c, &s, lane).await?;
        let info = release_terminal(&c, info, s.active, lane).await?;
        if info.faulted && !info.reserved_game.is_empty() {
            return Err("active engine fault requires native bot-timeout refund".into());
        }
        let mut m = meta();
        m.ready_at = now();
        m.paused = s.paused;
        m.active_game = s.active;
        m.free_pool = s.free_pool;
        put_meta(m);
        Ok(get_status())
    }
    .await;
    unlock_rpc(lease, lane);
    r
}

#[update]
async fn request_bot(r: Request) -> R<Job> {
    let c = cfg();
    let lane = caller_lane(&c);
    if !c.reviewed_release {
        return Err("reviewed release gate closed".into());
    }
    if terminal_job(r.game_id) || pending_release().is_some() {
        return Err("terminal cleanup pending or game already closed; refresh readiness".into());
    }
    if r.request_id == [0; 32] || r.expected_ply as usize != r.moves.len() {
        return Err("invalid request".into());
    }
    let (_, _, position, _, _) = replay(&r.moves)?;
    if position != r.expected_position_hash {
        return Err("history/expected position mismatch".into());
    }
    if let Some(j) = get_job(r.game_id, r.expected_ply) {
        if j.position_hash != r.expected_position_hash || j.moves != r.moves {
            return Err("conflicting request for existing canonical turn".into());
        }
        return Ok(j);
    }
    let lease = rpc_lease(lane)?;
    let result = async {
        let info = engine_info(&c).await?;
        if info.cycle_balance < candid::Nat::from(3_500_000_000_000u64) {
            return Err("engine lacks fixed-budget operating reserve".into());
        }
        let s = canonical_for(&c, Some(r.game_id), lane).await?;
        if s.active != r.game_id {
            return Err("not the active canonical game".into());
        }
        let g = s.game.clone().ok_or("missing game")?;
        verify_game(&c, r.game_id, &g, &r.moves, now())?;
        recheck_block_for(&c, &s, lane).await?;
        if info.reserved_game != r.game_id && g.ply != 1 {
            return Err("retained game state is missing; refund on native bot timeout".into());
        }
        let info = release_terminal(&c, info, s.active, lane).await?;
        if pending_release().is_some() || terminal_job(r.game_id) {
            return Err("terminal cleanup pending or requested game closed".into());
        }
        if info.faulted && !info.reserved_game.is_empty() {
            return Err("active engine fault requires native bot-timeout refund".into());
        }
        let reserve = Call::bounded_wait(c.engine_canister, "reserve_game")
            .with_arg(r.game_id)
            .await
            .map_err(|_| "engine reservation uncertain; retry reads same reservation")?
            .candid::<Result<EngineInfo, EngineError>>()
            .map_err(|_| "reserve decode")?
            .map_err(|e| e.message)?;
        if reserve.reserved_game != r.game_id {
            return Err("reservation mismatch".into());
        }
        // A delayed verifier cannot overwrite a job that another message already advanced.
        if let Some(existing) = get_job(r.game_id, r.expected_ply) {
            return Ok(existing);
        }
        if JOBS.with(|s| s.borrow().len()) >= MAX_JOBS {
            return Err("journal capacity reached; no reset or weaker fallback".into());
        }
        let mut j = Job::new(&c, &r, now());
        j.game = Some(g);
        j.phase = "BeginEngine".into();
        put(&j);
        Ok(j)
    }
    .await;
    unlock_rpc(lease, lane);
    result
}

fn absorb(c: &Config, j: &mut Job, p: EngineProgress) -> R<()> {
    if p.job_id.len() != 32
        || p.game_id != j.game_id
        || p.position_hash != j.position_hash
        || p.ply != j.ply
        || p.config_hash != c.engine_hash()
        || p.engine_commit != STOCKFISH_COMMIT
        || p.nnue_sha256 != NNUE_SHA256
    {
        return Err("engine response binding mismatch".into());
    }
    if !j.engine_job_id.is_empty() && j.engine_job_id != p.job_id {
        return Err("engine job changed".into());
    }
    j.engine_job_id = p.job_id;
    j.step = p.step;
    j.actual_nodes = p.actual_nodes;
    j.depth = p.depth;
    j.instructions = p.instructions_total;
    j.stop_reason = p.stop_reason;
    j.bestmove = p.bestmove;
    match p.phase.as_str() {
        "Pending" => j.phase = "Searching".into(),
        "Completed" => {
            if p.actual_nodes < NODES && !(p.depth >= 245 && j.stop_reason == "max_depth") {
                return Err("engine stopped below the fixed node budget".into());
            }
            let (chess, _, _, _, _) = replay(&j.moves)?;
            let u: UciMove = j.bestmove.parse().map_err(|_| "invalid bot move")?;
            u.to_move(&chess).map_err(|_| "illegal bot move")?;
            j.phase = "Signing".into();
        }
        "Faulted" => return Err("engine continuation fault; use native bot-timeout refund".into()),
        _ => return Err("unknown engine phase".into()),
    }
    Ok(())
}

#[update]
async fn advance_job(a: Advance) -> R<Job> {
    let c = cfg();
    let mut j = get(a.job_id)?;
    if terminal_job(j.game_id) {
        return Err("terminal game cleanup has closed this job".into());
    }
    if j.phase == "Completed" || j.phase == "Faulted" {
        return Ok(j);
    }
    if j.in_flight {
        return Ok(j);
    }
    if a.expected_step != j.step {
        return Ok(j);
    }
    if now()
        >= j.game
            .as_ref()
            .ok_or("missing canonical game")?
            .turn_deadline
    {
        j.phase = "Faulted".into();
        j.error = Some("bot deadline passed; claim native entry refund".into());
        put(&j);
        return Ok(j);
    }
    if ic_cdk::api::canister_cycle_balance() < 2_000_000_000_000 {
        return Err("coordinator cycle reserve is low; no reduced-strength fallback".into());
    }
    j.in_flight = true;
    j.updated_at = now();
    put(&j);
    let r = async {
        if engine_info(&c).await?.faulted {
            return Err("engine continuation fault; use native bot-timeout refund".into());
        }
        if j.phase == "Signing" {
            // The durable per-job lock serializes signing without sharing the public
            // readiness/admission lease, which unrelated callers can occupy.
            let s: R<Snapshot> = async {
                // Only a durable, paid, completed full-budget job reaches this lane.
                // Anonymous readiness spam cannot consume this verification allowance.
                let s = canonical_for(&c, Some(j.game_id), RpcLane::Signing).await?;
                recheck_block_for(&c, &s, RpcLane::Signing).await?;
                Ok(s)
            }
            .await;
            let s = s?;
            let g = s.game.as_ref().ok_or("missing canonical game")?;
            verify_game(&c, j.game_id, g, &j.moves, now())?;
            if s.active != j.game_id || g.ply != j.ply || g.position_hash != j.position_hash {
                return Err("canonical turn changed before signing".into());
            }
            let m = BotMove {
                game_id: j.game_id,
                player: g.player,
                ply: j.ply,
                position_hash: j.position_hash,
                transcript_hash: g.transcript_hash,
                encoded_move: encode_move(&j.bestmove)?,
                engine_config_hash: c.engine_hash(),
                valid_until: g.turn_deadline,
            };
            let digest = m.digest(c.game_contract);
            let cost = ic_cdk::api::cost_sign_with_ecdsa(&c.key_name, 0)
                .map_err(|_| "signing key unavailable")?;
            let sig = management("sign_with_ecdsa")
                .with_arg(SignWithEcdsaArgs {
                    message_hash: digest.to_vec(),
                    derivation_path: path(),
                    key_id: key(&c),
                })
                .with_cycles(cost)
                .await
                .map_err(|_| "signature request failed")?
                .candid::<SignWithEcdsaResult>()
                .map_err(|_| "signature decode failed")?;
            j.signed_move = Some(SignedMove {
                r#move: m,
                signature: ethereum_signature(digest, &sig.signature, &meta().public_key)?,
            });
            j.phase = "Completed".into();
            return Ok(());
        }
        let call = match j.phase.as_str() {
            "BeginEngine" => Call::bounded_wait(c.engine_canister, "begin").with_arg(EngineJob {
                game_id: j.game_id.to_vec(),
                position_hash: j.position_hash.to_vec(),
                ply: j.ply,
                initial_fen: INITIAL_FEN.into(),
                moves: j.moves.clone(),
            }),
            "RecoverEngine" => {
                if j.engine_job_id.is_empty() {
                    j.phase = "BeginEngine".into();
                    return Ok(());
                }
                Call::bounded_wait(c.engine_canister, "read_progress")
                    .with_arg(j.engine_job_id.clone())
            }
            "Searching" => Call::bounded_wait(c.engine_canister, "advance")
                .with_args(&(j.engine_job_id.clone(), j.step)),
            _ => return Err("invalid job phase".into()),
        };
        let p = call
            .await
            .map_err(|_| "engine response uncertain; reconcile durable journal")?
            .candid::<Result<EngineProgress, EngineError>>()
            .map_err(|_| "engine response decode failed")?
            .map_err(|e| e.message)?;
        absorb(&c, &mut j, p)
    }
    .await;
    j.in_flight = false;
    j.updated_at = now();
    if terminal_job(j.game_id) {
        j.phase = "Faulted".into();
        j.error = Some("canonical terminal cleanup discarded this late callback".into());
        return Ok(j);
    }
    match r {
        Ok(()) => j.error = None,
        Err(e) => j.record_failure(e),
    }
    put(&j);
    Ok(j)
}
ic_cdk::export_candid!();
pub fn candid_service() -> String {
    __export_service()
}

#[cfg(test)]
mod terminal_tests {
    use super::*;
    fn job(game_id: Hash, ply: u32) -> Job {
        let c = Config {
            engine_canister: Principal::from_slice(&[1]),
            relay_canister: Principal::from_slice(&[2]),
            engine_module_hash: [1; 32],
            game_contract: [2; 20],
            game_runtime_hash: [3; 32],
            rpc_url: "https://rpc.mainnet.chain.robinhood.com".into(),
            confirmations: 12,
            key_name: "key_1".into(),
            reviewed_release: true,
        };
        Job::new(
            &c,
            &Request {
                game_id,
                expected_ply: ply,
                expected_position_hash: [4; 32],
                request_id: [5; 32],
                moves: vec![],
            },
            0,
        )
    }
    #[test]
    fn pending_and_closed_terminal_games_cannot_receive_late_callback_writes() {
        let j = job([101; 32], 1);
        put(&j);
        assert!(get(j.job_id).is_ok());
        set_pending_release(Some(j.game_id));
        prune_game(j.game_id);
        put(&j);
        assert!(get(j.job_id).is_err());
        CLOSED_GAMES.with(|s| s.borrow_mut().insert(j.game_id, 1));
        set_pending_release(None);
        put(&j);
        assert!(get(j.job_id).is_err());
    }
    #[test]
    fn twenty_sequential_eighty_decision_games_do_not_consume_lifetime_job_capacity() {
        for n in 0..20u8 {
            let game = [n + 1; 32];
            for p in 0..80 {
                put(&job(game, p * 2 + 1));
            }
            assert_eq!(JOBS.with(|s| s.borrow().len()), 80);
            set_pending_release(Some(game));
            CLOSED_GAMES.with(|s| s.borrow_mut().insert(game, 1));
            prune_game(game);
            set_pending_release(None);
            assert_eq!(JOBS.with(|s| s.borrow().len()), 0);
            put(&job(game, 1));
            assert_eq!(JOBS.with(|s| s.borrow().len()), 0);
        }
        assert_eq!(CLOSED_GAMES.with(|s| s.borrow().len()), 20);
    }
}
