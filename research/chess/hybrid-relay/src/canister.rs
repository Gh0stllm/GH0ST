use super::*;
use gh0st_chess_hybrid_brain::rpc_consensus as quorum;
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_management_canister_types::*;
use ic_stable_structures::{
    DefaultMemoryImpl, StableCell,
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Duration};
type Memory = VirtualMemory<DefaultMemoryImpl>;
thread_local! {
 static MM:RefCell<MemoryManager<DefaultMemoryImpl>>=RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
 static CONFIG:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(0))),vec![]));
 static JOURNAL:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MM.with(|m|m.borrow().get(MemoryId::new(1))),vec![]));
 static TIMER:RefCell<Option<ic_cdk_timers::TimerId>>=const{RefCell::new(None)};
}
fn config() -> Config {
    CONFIG.with(|s| candid::decode_one(s.borrow().get()).expect("relay config missing"))
}
fn state() -> State {
    JOURNAL.with(|s| {
        if s.borrow().get().is_empty() {
            State::default()
        } else {
            candid::decode_one(s.borrow().get()).expect("relay state schema")
        }
    })
}
fn save(s: State) {
    let bytes = candid::encode_one(s).unwrap();
    assert!(bytes.len() < 2_000_000, "relay journal bound");
    JOURNAL.with(|s| s.borrow_mut().set(bytes));
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000_000
}
fn controller() -> R<()> {
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        Err("controller required".into())
    } else {
        Ok(())
    }
}
fn key(c: &Config) -> EcdsaKeyId {
    EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: c.key_name.clone(),
    }
}
fn key_path() -> Vec<Vec<u8>> {
    vec![b"GH0ST_CHESS_RELAY_V1".to_vec()]
}
fn management(m: &str) -> Call<'_, '_> {
    Call::bounded_wait(Principal::management_canister(), m)
}
fn arm(delay: u64) {
    TIMER.with(|slot| {
        if let Some(t) = slot.borrow_mut().take() {
            ic_cdk_timers::clear_timer(t)
        }
    });
    let mut s = state();
    if !s.enabled || s.halted {
        s.next_tick_at = 0;
        save(s);
        return;
    }
    s.next_tick_at = now().saturating_add(delay);
    save(s);
    let id = ic_cdk_timers::set_timer(Duration::from_secs(delay), async {
        let _ = crank_internal().await;
    });
    TIMER.with(|slot| *slot.borrow_mut() = Some(id));
}
#[init]
fn init(c: Config) {
    c.validate().expect("relay config invalid");
    CONFIG.with(|s| {
        assert!(s.borrow().get().is_empty());
        s.borrow_mut().set(candid::encode_one(c).unwrap());
    });
    save(State::default());
}
#[post_upgrade]
fn upgraded() {
    let mut s = state();
    s.in_flight = false;
    s.generation = s.generation.saturating_add(1);
    if let Some(t) = &mut s.turn {
        t.uncertain = true;
    }
    save(s);
    arm(1);
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct Status {
    ready: bool,
    enabled: bool,
    blockers: Vec<String>,
    chain_id: u64,
    game_contract: String,
    coordinator: Principal,
    coordinator_module_hash: Hash,
    bot_attestor_address: String,
    relayer_address: String,
    gas_balance_wei: candid::Nat,
    last_checked_at: u64,
    advisory_last_checked_at: u64,
    cycles: candid::Nat,
    pending: bool,
    in_flight: bool,
    remaining_gas_budget_wei: candid::Nat,
    next_tick_at: u64,
    completed_transactions: u64,
    last_error: Option<String>,
    pending_hash: String,
    rpc_cycles_booked_today: candid::Nat,
    rpc_cycle_limit_per_day: candid::Nat,
    last_http_reserve_cycles: candid::Nat,
    last_http_prepayment_cycles: candid::Nat,
    last_http_booked_cycles: candid::Nat,
    last_flexible_reserve_cycles: candid::Nat,
    last_flexible_booked_cycles: candid::Nat,
}
#[query]
fn get_status() -> Status {
    let c = config();
    let s = state();
    let mut blockers = vec![];
    if !s.enabled {
        blockers.push("relay is disabled".into())
    }
    if s.halted {
        blockers.push("relay is halted with an unresolved transaction".into())
    }
    if s.public_key.is_empty() {
        blockers.push("relay signer has not been derived".into())
    }
    if s.last_checked_at == 0 || now() > s.last_checked_at.saturating_add(360) {
        blockers.push("relay chain readiness is stale".into())
    }
    if ic_cdk::api::subnet_self_node_count() != 13 {
        blockers.push("relay requires a 13-node application subnet".into())
    }
    if s.head_observation
        .as_ref()
        .is_some_and(|h| now() > h.changed_at.saturating_add(600))
    {
        blockers.push("relay head has not advanced for ten minutes".into())
    }
    if s.gas_balance_wei < c.max_tx_cost_wei {
        blockers.push("relay ETH reserve is low".into())
    }
    if s.advisory_gas_balance_wei
        .is_some_and(|b| b < c.max_tx_cost_wei)
    {
        blockers.push("latest advisory observes a low ETH reserve; confirm funding".into())
    }
    if s.remaining(&c) < c.max_tx_cost_wei {
        blockers.push("approved lifetime gas budget is exhausted".into())
    }
    let cycles = ic_cdk::api::canister_cycle_balance();
    if cycles < MIN_CYCLES {
        blockers.push("relay cycle reserve is low".into())
    }
    if s.pending.is_some() {
        blockers.push("relay transaction is awaiting canonical reconciliation".into())
    }
    if let Some(e) = &s.error {
        blockers.push(e.clone())
    }
    Status {
        ready: blockers.is_empty(),
        enabled: s.enabled,
        blockers,
        chain_id: CHAIN_ID,
        game_contract: hex(&c.game_contract),
        coordinator: c.coordinator,
        coordinator_module_hash: c.coordinator_module_hash,
        bot_attestor_address: hex(&c.bot_attestor),
        relayer_address: ethereum_address(&s.public_key)
            .map(|a| hex(&a))
            .unwrap_or_default(),
        gas_balance_wei: s.gas_balance_wei.into(),
        last_checked_at: s.last_checked_at,
        advisory_last_checked_at: s.advisory_checked_at.unwrap_or(0),
        cycles: cycles.into(),
        pending: s.pending.is_some(),
        in_flight: s.in_flight,
        remaining_gas_budget_wei: s.remaining(&c).into(),
        next_tick_at: s.next_tick_at,
        completed_transactions: s.completed_transactions,
        last_error: s.error,
        pending_hash: s
            .pending
            .as_ref()
            .filter(|i| i.hash != [0; 32])
            .map(|i| hex(&i.hash))
            .unwrap_or_default(),
        rpc_cycles_booked_today: if s.rpc_day == now() / 86400 {
            s.rpc_spent
        } else {
            0
        }
        .into(),
        rpc_cycle_limit_per_day: MAX_RPC_DAY.into(),
        last_http_prepayment_cycles: s.rpc_last_reserved.unwrap_or(0).into(),
        last_http_reserve_cycles: s
            .rpc_accounting
            .as_ref()
            .map(|x| x.reserve)
            .unwrap_or(0)
            .into(),
        last_http_booked_cycles: s.rpc_accounting.as_ref().map(|x| x.net).unwrap_or(0).into(),
        last_flexible_reserve_cycles: s
            .rpc_flexible_accounting
            .as_ref()
            .map(|x| x.reserve)
            .unwrap_or(0)
            .into(),
        last_flexible_booked_cycles: s
            .rpc_flexible_accounting
            .as_ref()
            .map(|x| x.net)
            .unwrap_or(0)
            .into(),
    }
}
#[query]
fn get_pending() -> Option<Intent> {
    state().pending
}
#[update]
async fn prepare_signer() -> R<String> {
    controller()?;
    if !state().public_key.is_empty() {
        return ethereum_address(&state().public_key).map(|a| hex(&a));
    }
    let c = config();
    let r = management("ecdsa_public_key")
        .with_arg(EcdsaPublicKeyArgs {
            canister_id: None,
            derivation_path: key_path(),
            key_id: key(&c),
        })
        .await
        .map_err(|_| "relay key derivation failed")?
        .candid::<EcdsaPublicKeyResult>()
        .map_err(|_| "relay key decode failed")?;
    let a = ethereum_address(&r.public_key)?;
    let mut s = state();
    s.public_key = r.public_key;
    save(s);
    Ok(hex(&a))
}
#[update]
async fn set_enabled(enabled: bool) -> R<Status> {
    controller()?;
    let c = config();
    if !enabled {
        let mut s = state();
        s.enabled = false;
        s.generation = s.generation.saturating_add(1);
        s.in_flight = false;
        save(s);
        arm(0);
        return Ok(get_status());
    }
    if ic_cdk::api::subnet_self_node_count() != 13 {
        return Err("relay requires a 13-node application subnet".into());
    }
    if state().in_flight || state().halted {
        return Err("relay busy or halted; no reset/replacement bypass".into());
    }
    if state().public_key.is_empty() {
        return Err("derive relay signer before enabling".into());
    }
    if ic_cdk::api::canister_cycle_balance() < MIN_CYCLES {
        return Err("relay cycle reserve is low".into());
    }
    let mut s = state();
    s.in_flight = true;
    s.generation = s
        .generation
        .checked_add(1)
        .ok_or("relay generation exhausted")?;
    let generation = s.generation;
    save(s);
    let checks: R<()> = async {
        verify_coordinator(&c).await?;
        let p = poll(&c).await?;
        let snap = snapshot(&c, p.active, p.head).await?;
        recheck(&c, &snap).await?;
        Ok(())
    }
    .await;
    let mut s = state();
    if s.generation != generation {
        return Err("enable was superseded by a controller action".into());
    }
    s.in_flight = false;
    if let Err(e) = checks {
        s.error = Some(e.clone());
        save(s);
        return Err(e);
    }
    if s.gas_balance_wei < c.max_tx_cost_wei || s.remaining(&c) < c.max_tx_cost_wei {
        save(s);
        return Err("fund the dedicated relay ETH reserve before enabling".into());
    }
    s.enabled = true;
    s.error = None;
    save(s);
    arm(1);
    Ok(get_status())
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct BrainStatus {
    production_ready: bool,
    engine_config_hash: Hash,
    game_contract: String,
    attestor_address: String,
    nodes: u64,
    chain_id: u64,
    cache_policy: String,
}
async fn verify_coordinator(c: &Config) -> R<()> {
    let info = management("canister_info")
        .with_arg(CanisterInfoArgs {
            canister_id: c.coordinator,
            num_requested_changes: None,
        })
        .await
        .map_err(|_| "coordinator identity read failed")?
        .candid::<CanisterInfoResult>()
        .map_err(|_| "coordinator identity decode failed")?;
    if info.module_hash.as_deref() != Some(c.coordinator_module_hash.as_slice()) {
        return Err("coordinator module hash mismatch".into());
    }
    let r = Call::bounded_wait(c.coordinator, "refresh_status")
        .await
        .map_err(|_| "coordinator readiness unavailable")?
        .candid::<Result<BrainStatus, String>>()
        .map_err(|_| "coordinator readiness decode failed")??;
    if !r.production_ready
        || r.engine_config_hash != c.engine_config_hash
        || r.game_contract.to_ascii_lowercase() != hex(&c.game_contract)
        || r.attestor_address.to_ascii_lowercase() != hex(&c.bot_attestor)
        || r.nodes != NODE_BUDGET
        || r.chain_id != CHAIN_ID
        || r.cache_policy != "retained-per-game"
    {
        return Err("coordinator policy/deployment mismatch".into());
    }
    Ok(())
}

#[query]
fn transform(args: TransformArgs) -> HttpRequestResult {
    let response = args.response;
    let mut body = serde_json::from_slice::<Value>(&response.body).unwrap_or(Value::Null);
    if args.context == b"receipt-v1" {
        body = crate::rpc_policy::receipt_batch(&body).unwrap_or(Value::Null);
    }
    if args.context.len() == 32 {
        let expected = hex(&args.context);
        let known = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .map(|s| {
                let s = s.to_ascii_lowercase();
                s.contains("already known")
                    || s.starts_with("known transaction")
                    || s.contains("already imported")
            })
            .unwrap_or(false);
        if body.get("result").and_then(Value::as_str) == Some(expected.as_str()) || known {
            body = json!({"jsonrpc":"2.0","id":1,"result":expected});
        }
    }
    HttpRequestResult {
        status: response.status,
        headers: vec![],
        body: serde_json::to_vec(&quorum::normalize_batch(body))
            .unwrap_or_else(|_| b"null".to_vec()),
    }
}
async fn rpc(c: &Config, request: Value, max: u64, context: Vec<u8>) -> R<Value> {
    let body = serde_json::to_vec(&request).unwrap();
    let cost = ic_cdk::api::cost_http_request((body.len() + c.rpc_url.len() + 256) as u64, max);
    let debit = cost + cost / 10;
    let day = reserve_rpc(debit)?;
    let result = management("http_request")
        .with_arg(HttpRequestArgs {
            url: c.rpc_url.clone(),
            max_response_bytes: Some(max),
            method: HttpMethod::POST,
            headers: vec![HttpHeader {
                name: "Content-Type".into(),
                value: "application/json".into(),
            }],
            body: Some(body),
            transform: Some(TransformContext {
                function: TransformFunc(candid::Func {
                    principal: ic_cdk::api::canister_self(),
                    method: "transform".into(),
                }),
                context,
            }),
        })
        .with_cycles(debit)
        .await;
    finish_rpc(day, debit, "replicated");
    let r = result
        .map_err(|_| "relay RPC outcome unavailable")?
        .candid::<HttpRequestResult>()
        .map_err(|_| "relay RPC decode failed")?;
    if r.status != 200u16 {
        return Err("relay RPC HTTP failure".into());
    }
    serde_json::from_slice(&r.body).map_err(|_| "relay RPC JSON invalid".into())
}
fn reserve_rpc(debit: u128) -> R<u64> {
    if ic_cdk::api::canister_cycle_balance() < MIN_CYCLES + debit {
        return Err("relay cycle reserve is low".into());
    }
    let mut s = state();
    let day = now() / 86400;
    if s.rpc_day != day {
        s.rpc_day = day;
        s.rpc_spent = 0;
    }
    if s.rpc_spent.saturating_add(debit) > MAX_RPC_DAY {
        return Err("relay daily HTTP budget exhausted".into());
    }
    s.rpc_spent += debit;
    s.rpc_last_reserved = Some(debit);
    save(s);
    Ok(day)
}
fn finish_rpc(day: u64, reserve: u128, kind: &str) {
    let refund = ic_cdk::api::msg_cycles_refunded().min(reserve);
    let mut s = state();
    if s.rpc_day == day {
        s.rpc_spent = s.rpc_spent.saturating_sub(refund);
    }
    let account = RpcAccounting {
        kind: kind.into(),
        reserve,
        refund,
        net: reserve - refund,
    };
    if kind == "flexible" {
        s.rpc_flexible_accounting = Some(account.clone());
    }
    s.rpc_accounting = Some(account);
    save(s);
}
async fn flexible(c: &Config, request: Value, max: u64) -> R<Vec<quorum::Response>> {
    if ic_cdk::api::subnet_self_node_count() != 13 {
        return Err("relay flexible quorum requires a 13-node subnet".into());
    }
    let body = serde_json::to_vec(&request).unwrap();
    let params = quorum::CostParams::flexible((body.len() + c.rpc_url.len() + 256) as u64, max);
    let cost = ic_cdk::api::cost_http_request_v2(&candid::encode_one(params).unwrap());
    let debit = cost + cost / 10;
    let day = reserve_rpc(debit)?;
    let result = management("flexible_http_request")
        .with_arg(quorum::FlexibleArgs {
            url: c.rpc_url.clone(),
            max_response_bytes: Some(max),
            method: quorum::Method::Post,
            headers: vec![quorum::Header {
                name: "Content-Type".into(),
                value: "application/json".into(),
            }],
            body: Some(body),
            transform: None,
            replication: Some(quorum::Replication::default()),
        })
        .with_cycles(debit)
        .await;
    finish_rpc(day, debit, "flexible");
    match result
        .map_err(|_| "relay flexible HTTP outcome unavailable")?
        .candid::<quorum::FlexibleResponse>()
        .map_err(|_| "relay flexible HTTP decode failed")?
    {
        quorum::FlexibleResponse::Ok(r) => Ok(r),
        quorum::FlexibleResponse::Err(_) => {
            Err("relay flexible committee could not meet replication".into())
        }
    }
}
async fn agreed_head(c: &Config) -> R<u64> {
    let r=flexible(c,json!([{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}]),4096).await?;
    let head = quorum::head_median(&r)?;
    let mut s = state();
    if s.head_observation.as_ref().is_none_or(|h| h.height != head) {
        s.head_observation = Some(HeadObservation {
            height: head,
            changed_at: now(),
        });
        save(s);
    }
    Ok(head)
}
fn row(v: &Value, id: u64) -> R<&Value> {
    quorum::result(v, id)
}
fn number(v: &Value) -> R<u64> {
    u64::from_str_radix(
        v.as_str()
            .ok_or("invalid hex number")?
            .strip_prefix("0x")
            .ok_or("hex prefix missing")?,
        16,
    )
    .map_err(|_| "hex integer overflow".into())
}
fn amount(v: &Value) -> R<u128> {
    u128::from_str_radix(
        v.as_str()
            .ok_or("invalid amount")?
            .strip_prefix("0x")
            .ok_or("hex prefix missing")?,
        16,
    )
    .map_err(|_| "amount overflow".into())
}
fn bytes(v: &Value) -> R<Vec<u8>> {
    unhex(v.as_str().ok_or("missing RPC hex")?)
}
fn fixed<const N: usize>(b: &[u8]) -> R<[u8; N]> {
    b.try_into().map_err(|_| "fixed ABI length mismatch".into())
}
fn data(method: &str, arg: Option<Hash>) -> String {
    let mut d = keccak(method.as_bytes())[..4].to_vec();
    if let Some(a) = arg {
        d.extend(a)
    }
    hex(&d)
}
struct Poll {
    active: Hash,
    head: u64,
    watched: Option<Game>,
}
async fn poll(c: &Config) -> R<Poll> {
    let relay = ethereum_address(&state().public_key)?;
    let head = agreed_head(c).await?;
    let confirmed = head.checked_sub(c.confirmations).ok_or("chain too short")?;
    let tag = format!("0x{confirmed:x}");
    let watched_id = state().watched_game;
    let mut q = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}),
        json!({"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data("activeGameId()",None)},tag]}),
        json!({"jsonrpc":"2.0","id":4,"method":"eth_getBalance","params":[hex(&relay),tag]}),
    ];
    if watched_id != [0; 32] {
        q.push(json!({"jsonrpc":"2.0","id":5,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data("getGame(bytes32)",Some(watched_id))},tag]}));
    }
    let r = rpc(
        c,
        Value::Array(q),
        if watched_id == [0; 32] { 2048 } else { 4096 },
        vec![],
    )
    .await?;
    if number(row(&r, 1)?)? != CHAIN_ID {
        return Err("relay RPC is not Robinhood chain4663".into());
    }
    let active = fixed(&bytes(row(&r, 3)?)?)?;
    let mut s = state();
    s.gas_balance_wei = amount(row(&r, 4)?)?;
    s.advisory_gas_balance_wei = Some(s.gas_balance_wei);
    s.last_checked_at = now();
    save(s);
    let watched = if watched_id != [0; 32] {
        Some(Game::decode(&bytes(row(&r, 5)?)?)?)
    } else {
        None
    };
    Ok(Poll {
        active,
        head,
        watched,
    })
}
// Cheap advisory discovery is never an authorization snapshot. During a rare
// latest-state race the normal replicated call either reaches exact consensus or
// fails closed. Every suggested new Black turn still enters poll()+snapshot()
// at a freshly agreed, confirmed numeric block before any inference or signing.
struct Advisory {
    active: Hash,
    watched: Option<Game>,
}
async fn advisory(c: &Config) -> R<Advisory> {
    let s = state();
    let watched_id = s.watched_game;
    let relay = ethereum_address(&s.public_key)?;
    let mut q = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}),
        json!({"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data("activeGameId()",None)},"latest"]}),
        json!({"jsonrpc":"2.0","id":4,"method":"eth_getBalance","params":[hex(&relay),"latest"]}),
    ];
    if watched_id != [0; 32] {
        q.push(json!({"jsonrpc":"2.0","id":5,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data("getGame(bytes32)",Some(watched_id))},"latest"]}));
    }
    let r = rpc(
        c,
        Value::Array(q),
        if watched_id == [0; 32] { 2048 } else { 4096 },
        vec![],
    )
    .await?;
    if number(row(&r, 1)?)? != CHAIN_ID {
        return Err("advisory is not Robinhood chain4663".into());
    }
    let active: Hash = fixed(&bytes(row(&r, 3)?)?)?;
    let watched = if watched_id != [0; 32] {
        Some(Game::decode(&bytes(row(&r, 5)?)?)?)
    } else {
        None
    };
    let mut current = state();
    current.advisory_checked_at = Some(now());
    current.advisory_gas_balance_wei = Some(amount(row(&r, 4)?)?);
    save(current);
    Ok(Advisory { active, watched })
}
async fn idle_poll(c: &Config) -> R<Option<Poll>> {
    if now() >= state().last_checked_at.saturating_add(300) {
        return poll(c).await.map(Some);
    }
    let s = state();
    let a = advisory(c).await?;
    let suggests_work = crate::rpc_policy::advisory_suggests_work(
        a.active,
        s.watched_game,
        a.watched.as_ref(),
        s.last_relayed_game,
        s.last_relayed_ply,
    );
    if suggests_work {
        poll(c).await.map(Some)
    } else {
        Ok(None)
    }
}
// While a previously verified search is running, latest values can only hint that
// cancellation may be needed. A conflicting hint never discards the paid turn:
// first require a fresh confirmed poll. No signature or inference is authorized here.
async fn search_still_current(c: &Config, t: &Turn) -> R<bool> {
    let confirmed = if now() >= state().last_checked_at.saturating_add(300) {
        Some(poll(c).await?)
    } else {
        let a = advisory(c).await?;
        let unchanged = a.active == t.game_id
            && a.watched.as_ref().is_some_and(|g| {
                g.result == 0
                    && g.black_to_move
                    && g.ply == t.ply
                    && g.position_hash == t.position_hash
            });
        if unchanged {
            None
        } else {
            Some(poll(c).await?)
        }
    };
    if let Some(p) = confirmed {
        let unchanged = p.active == t.game_id
            && p.watched.as_ref().is_some_and(|g| {
                g.result == 0
                    && g.black_to_move
                    && g.ply == t.ply
                    && g.position_hash == t.position_hash
            });
        if !unchanged {
            let mut s = state();
            s.turn = None;
            save(s);
            return Ok(false);
        }
    }
    Ok(true)
}
struct Snapshot {
    game: Option<Game>,
    moves: Vec<String>,
    block: u64,
    block_hash: Hash,
}
async fn snapshot(c: &Config, id: Hash, head: u64) -> R<Snapshot> {
    let n = head.checked_sub(c.confirmations).ok_or("chain too short")?;
    let block = format!("0x{n:x}");
    let mut q = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[block,false]}),
        json!({"jsonrpc":"2.0","id":2,"method":"eth_getCode","params":[hex(&c.game_contract),block]}),
    ];
    for (i, method) in [
        "engineConfigHash()",
        "attestor()",
        "paymentToken()",
        "activeGameId()",
    ]
    .iter()
    .enumerate()
    {
        q.push(json!({"jsonrpc":"2.0","id":10+i,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data(method,None)},block]}));
    }
    if id != [0; 32] {
        for (i, m) in ["getGame(bytes32)", "getMoves(bytes32)"].iter().enumerate() {
            q.push(json!({"jsonrpc":"2.0","id":20+i,"method":"eth_call","params":[{"to":hex(&c.game_contract),"data":data(m,Some(id))},block]}));
        }
    }
    let r = rpc(
        c,
        Value::Array(q),
        if id == [0; 32] { 49152 } else { 131072 },
        vec![],
    )
    .await?;
    if keccak(&bytes(row(&r, 2)?)?) != c.game_runtime_hash
        || bytes(row(&r, 10)?)? != c.engine_config_hash
        || bytes(row(&r, 11)?)? != aword(c.bot_attestor)
        || fixed::<32>(&bytes(row(&r, 12)?)?)? != aword(fixed(&unhex(TOKEN)?)?)
    {
        return Err("relay native code/token/signer/policy mismatch".into());
    }
    let b = row(&r, 1)?;
    let timestamp = number(&b["timestamp"])?;
    if number(&b["number"])? != n || timestamp > now() + 30 || now().saturating_sub(timestamp) > 600
    {
        return Err("relay canonical block stale".into());
    }
    let hash = fixed(&bytes(&b["hash"])?)?;
    let game = if id != [0; 32] {
        let game = Game::decode(&bytes(row(&r, 20)?)?)?;
        if fixed::<32>(&bytes(row(&r, 13)?)?)? != id && game.result == 0 {
            return Err("paid game not yet confirmed; retry later".into());
        }
        Some(game)
    } else {
        None
    };
    let moves = if game.is_some() {
        decode_history(&bytes(row(&r, 21)?)?)?
    } else {
        vec![]
    };
    Ok(Snapshot {
        game,
        moves,
        block: n,
        block_hash: hash,
    })
}
async fn recheck(c: &Config, s: &Snapshot) -> R<()> {
    let r=rpc(c,json!({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[format!("0x{:x}",s.block),false]}),2048,vec![]).await?;
    if fixed::<32>(&bytes(&row(&r, 1)?["hash"])?)? != s.block_hash {
        return Err("relay canonical block changed".into());
    }
    Ok(())
}
fn verify_game(c: &Config, g: &Game, id: Hash, moves: &[String]) -> R<()> {
    let b = gh0st_chess_hybrid_brain::Config {
        engine_canister: c.coordinator,
        engine_module_hash: [1; 32],
        game_contract: c.game_contract,
        game_runtime_hash: c.game_runtime_hash,
        rpc_url: c.rpc_url.clone(),
        confirmations: c.confirmations,
        key_name: c.key_name.clone(),
        reviewed_release: true,
    };
    gh0st_chess_hybrid_brain::verify_game(&b, id, g, moves, now())
}
async fn fetch_turn(c: &Config, p: Poll) -> R<()> {
    if p.active == [0; 32] {
        let mut s = state();
        s.turn = None;
        s.watched_game = [0; 32];
        save(s);
        return Ok(());
    }
    if p.active == state().watched_game {
        if let Some(g) = &p.watched {
            if g.result != 0 || !g.black_to_move {
                let mut s = state();
                s.turn = None;
                save(s);
                return Ok(());
            }
        }
    }
    let snapshot = snapshot(c, p.active, p.head).await?;
    let g = snapshot.game.as_ref().ok_or("missing game")?;
    let mut s = state();
    s.watched_game = p.active;
    save(s);
    if g.result != 0 || !g.black_to_move {
        let mut s = state();
        s.turn = None;
        save(s);
        return Ok(());
    }
    if state().last_relayed_game == p.active && state().last_relayed_ply == g.ply {
        return Ok(());
    }
    verify_game(c, g, p.active, &snapshot.moves)?;
    recheck(c, &snapshot).await?;
    verify_coordinator(c).await?;
    let mut s = state();
    if s.gas_balance_wei < c.max_tx_cost_wei || s.remaining(c) < c.max_tx_cost_wei {
        return Err("relay gas is low; do not start new inference".into());
    }
    s.turn = Some(Turn {
        game_id: p.active,
        ply: g.ply,
        position_hash: g.position_hash,
        moves: snapshot.moves,
        job: None,
        uncertain: false,
        updates: 0,
    });
    save(s);
    Ok(())
}

async fn progress(c: &Config) -> R<()> {
    let mut turn = state().turn.ok_or("no active relay turn")?;
    if turn.updates >= 300 {
        return Err("relay per-turn action bound reached; no weaker search".into());
    }
    let job = if turn.uncertain || turn.job.is_none() {
        let req = Request {
            game_id: turn.game_id,
            expected_ply: turn.ply,
            expected_position_hash: turn.position_hash,
            request_id: keccak(&[turn.game_id, word(turn.ply as u64)].concat()),
            moves: turn.moves.clone(),
        };
        Call::bounded_wait(c.coordinator, "request_bot")
            .with_arg(req)
            .await
            .map_err(|_| "coordinator request outcome uncertain")?
            .candid::<R<Job>>()
            .map_err(|_| "coordinator request decode uncertain")??
    } else {
        let j = turn.job.as_ref().unwrap();
        Call::bounded_wait(c.coordinator, "advance_job")
            .with_arg(Advance {
                job_id: j.job_id,
                expected_step: j.step,
            })
            .await
            .map_err(|_| "coordinator advance outcome uncertain")?
            .candid::<R<Job>>()
            .map_err(|_| "coordinator advance decode uncertain")??
    };
    if job.game_id != turn.game_id
        || job.ply != turn.ply
        || job.position_hash != turn.position_hash
        || job.requested_nodes != NODE_BUDGET
    {
        return Err("coordinator job binding mismatch".into());
    }
    turn.record_job(&job)?;
    let mut s = state();
    s.turn = Some(turn);
    save(s);
    if job.phase == "Completed" {
        prepare_transaction(c, job).await?
    } else if job.phase == "Faulted" {
        return Err("engine fault; native bot-timeout refund remains available".into());
    } else if let Some(e) = job.error {
        return Err(format!("coordinator reports {e}"));
    }
    Ok(())
}
async fn prepare_transaction(c: &Config, job: Job) -> R<()> {
    let p = poll(c).await?;
    if p.active != job.game_id {
        return Err("native game ended before relay preparation".into());
    }
    let snap = snapshot(c, p.active, p.head).await?;
    let game = snap.game.as_ref().ok_or("missing native game")?;
    verify_game(c, game, job.game_id, &snap.moves)?;
    let signed = validate_signed(c, game, &job, now())?;
    recheck(c, &snap).await?;
    let relay = ethereum_address(&state().public_key)?;
    let payload = hex(&calldata(&signed)?);
    let dynamic=flexible(c,json!([
  {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":[hex(&relay),"latest"]},
  {"jsonrpc":"2.0","id":2,"method":"eth_getTransactionCount","params":[hex(&relay),"pending"]},
  {"jsonrpc":"2.0","id":3,"method":"eth_gasPrice","params":[]}
 ]),4096).await?;
    let tag = format!("0x{:x}", snap.block);
    let r=rpc(c,json!([
      {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":[hex(&relay),tag]},
      {"jsonrpc":"2.0","id":4,"method":"eth_estimateGas","params":[{"from":hex(&relay),"to":hex(&c.game_contract),"value":"0x0","data":payload},tag]}
    ]),4096,vec![]).await?;
    let nonce = crate::rpc_policy::fresh_nonce(
        number(row(&r, 1)?)?,
        quorum::max_quantity(&dynamic, 1)?,
        quorum::max_quantity(&dynamic, 2)?,
    )?;
    let price = quorum::median_quantity(&dynamic, 3)?
        .checked_mul(2)
        .ok_or("gas price overflow")?;
    let gas = number(row(&r, 4)?)?
        .checked_mul(125)
        .ok_or("gas estimate overflow")?
        .checked_add(99)
        .ok_or("gas estimate overflow")?
        / 100;
    let tx = Transaction {
        nonce,
        max_priority_fee_per_gas: 0,
        max_fee_per_gas: price,
        gas_limit: gas,
        to: c.game_contract,
        data: calldata(&signed)?,
    };
    tx.validate(c, &signed)?;
    let intent = Intent {
        game_id: job.game_id,
        ply: job.ply,
        signed_move: signed,
        transaction: tx,
        raw: vec![],
        hash: [0; 32],
        phase: "Unsigned".into(),
        created_at: now(),
        broadcast_at: 0,
        broadcasts: 0,
    };
    let mut s = state();
    s.reserve(c, intent)?;
    save(s);
    Ok(())
}

async fn handle_pending(c: &Config) -> R<()> {
    let i = state().pending.ok_or("no pending transaction")?;
    match i.phase.as_str() {
        "Unsigned" => {
            if now() >= i.signed_move.r#move.valid_until {
                return Err(
                    "unsigned move expired; intent retained for explicit reconciliation".into(),
                );
            }
            let digest = i.transaction.digest();
            let cost = ic_cdk::api::cost_sign_with_ecdsa(&c.key_name, 0)
                .map_err(|_| "relay signing key unavailable")?;
            let r = management("sign_with_ecdsa")
                .with_arg(SignWithEcdsaArgs {
                    message_hash: digest.to_vec(),
                    derivation_path: key_path(),
                    key_id: key(c),
                })
                .with_cycles(cost)
                .await
                .map_err(|_| "relay signature outcome unavailable")?
                .candid::<SignWithEcdsaResult>()
                .map_err(|_| "relay signature decode failed")?;
            let sig = ethereum_signature(digest, &r.signature, &state().public_key)?;
            let mut s = state();
            if s.pending.as_ref().map(|p| p.transaction.digest()) != Some(digest) {
                return Err("pending transaction changed".into());
            }
            s.record_signature(&sig)?;
            save(s);
            Ok(())
        }
        "Signed" => broadcast(c).await,
        "Submitted" => reconcile(c, true).await,
        _ => Err("relay halted with non-retryable transaction".into()),
    }
}
async fn broadcast(c: &Config) -> R<()> {
    let mut s = state();
    let i = s.pending.as_mut().ok_or("no intent")?;
    if i.raw.is_empty() || keccak(&i.raw) != i.hash {
        return Err("durable raw transaction/hash mismatch".into());
    }
    if i.broadcasts >= 3 {
        return Err("exact raw transaction retry bound reached; reconcile only".into());
    }
    let raw = i.raw.clone();
    let hash = i.hash;
    i.phase = "Submitted".into();
    i.broadcast_at = now();
    i.broadcasts += 1;
    save(s);
    let r = rpc(
        c,
        json!({"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":[hex(&raw)]}),
        4096,
        hash.to_vec(),
    )
    .await?;
    if bytes(row(&r, 1)?)? != hash {
        return Err("broadcast response did not match durable transaction hash".into());
    }
    Ok(())
}
fn verify_transaction(c: &Config, i: &Intent, t: &Value, relay: Address) -> R<()> {
    if bytes(&t["hash"])? != i.hash
        || bytes(&t["from"])? != relay
        || bytes(&t["to"])? != c.game_contract
        || number(&t["nonce"])? != i.transaction.nonce
        || amount(&t["value"])? != 0
        || bytes(&t["input"])? != i.transaction.data
    {
        return Err("canonical transaction differs from durable signed intent".into());
    }
    Ok(())
}
async fn reconcile(c: &Config, allow_rebroadcast: bool) -> R<()> {
    let i = state().pending.ok_or("no transaction intent")?;
    let relay = ethereum_address(&state().public_key)?;
    let head = agreed_head(c).await?;
    let r = rpc(
        c,
        json!([
         {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":[hex(&i.hash)]},
         {"jsonrpc":"2.0","id":2,"method":"eth_getTransactionByHash","params":[hex(&i.hash)]}
        ]),
        8192,
        b"receipt-v1".to_vec(),
    )
    .await?;
    let receipt = row(&r, 1)?;
    let tx = row(&r, 2)?;
    if receipt.is_null() {
        if !tx.is_null() {
            verify_transaction(c, &i, tx, relay)?;
            return Ok(());
        }
        let dynamic=flexible(c,json!([
          {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":[hex(&relay),"latest"]},
          {"jsonrpc":"2.0","id":2,"method":"eth_getTransactionCount","params":[hex(&relay),"pending"]}
        ]),4096).await?;
        let latest = quorum::max_quantity(&dynamic, 1)?;
        let pending = quorum::max_quantity(&dynamic, 2)?;
        let confirmed = head.checked_sub(c.confirmations).ok_or("chain too short")?;
        let r=rpc(c,json!({"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":[hex(&relay),format!("0x{confirmed:x}")]}),2048,vec![]).await?;
        if latest != i.transaction.nonce
            || pending != latest
            || number(row(&r, 1)?)? != i.transaction.nonce
        {
            return Err("unresolved relay nonce conflict; no replacement or new intent".into());
        }
        if allow_rebroadcast && now() > i.broadcast_at.saturating_add(30) && i.broadcasts < 3 {
            let mut s = state();
            s.pending.as_mut().unwrap().phase = "Signed".into();
            save(s)
        }
        return Ok(());
    }
    verify_transaction(c, &i, tx, relay)?;
    if bytes(&receipt["transactionHash"])? != i.hash
        || bytes(&receipt["from"])? != relay
        || bytes(&receipt["to"])? != c.game_contract
    {
        return Err("receipt identity mismatch".into());
    }
    let block = number(&receipt["blockNumber"])?;
    if head < block.saturating_add(c.confirmations) {
        return Ok(());
    }
    let b=rpc(c,json!({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[format!("0x{block:x}"),false]}),2048,vec![]).await?;
    if bytes(&row(&b, 1)?["hash"])? != bytes(&receipt["blockHash"])? {
        return Err("receipt block reorged; preserve intent for reconciliation".into());
    }
    let status = number(&receipt["status"])?;
    if status > 1 {
        return Err("invalid receipt status".into());
    }
    let gas = number(&receipt["gasUsed"])?;
    let price = number(&receipt["effectiveGasPrice"])?;
    // A valid Black move is permissionless: another relayer may apply it first. The
    // identical recorded transaction can then revert while consuming this wallet's nonce.
    // A canonical transcript containing precisely that move distinguishes this from an
    // unexplained revert. It never authorizes a replacement transaction.
    let externally_applied = if status == 0 {
        let snap = snapshot(c, i.game_id, head).await?;
        let g = snap
            .game
            .as_ref()
            .ok_or("missing game after reverted relay")?;
        let exact = snap.moves.get(i.ply as usize).map(String::as_str)
            == Some(decode_move(i.signed_move.r#move.encoded_move)?.as_str());
        if exact && g.id(c.game_contract) == i.game_id && g.ply > i.ply {
            recheck(c, &snap).await?;
            true
        } else {
            false
        }
    } else {
        false
    };
    let mut s = state();
    s.settle(gas, price, status == 1 || externally_applied)?;
    if externally_applied {
        s.completed_transactions = s.completed_transactions.saturating_sub(1);
    }
    save(s);
    Ok(())
}

/// Receipt-only recovery of an existing intent. It never signs, broadcasts, changes a
/// transaction, increments a nonce or re-enables an operator-disabled relay.
#[update]
async fn reconcile_pending() -> R<Status> {
    let c = config();
    let mut s = state();
    let Some(intent) = s.pending.as_ref() else {
        return Ok(get_status());
    };
    if intent.hash == [0; 32] || intent.raw.is_empty() {
        return Err("unsigned intent has no transaction receipt to reconcile".into());
    }
    if intent.phase == "Reverted" {
        return Ok(get_status());
    }
    if s.in_flight {
        return Ok(get_status());
    }
    if now() < s.last_attempt.saturating_add(3) {
        return Ok(get_status());
    }
    s.in_flight = true;
    s.generation = s
        .generation
        .checked_add(1)
        .ok_or("relay generation exhausted")?;
    let generation = s.generation;
    s.last_attempt = now();
    save(s);
    let result = reconcile(&c, false).await;
    let mut s = state();
    if s.generation != generation {
        return Err("reconciliation superseded by controller action".into());
    }
    s.in_flight = false;
    match result {
        Ok(()) => {
            if s.pending.is_none() {
                s.error = None
            }
        }
        Err(e) => s.error = Some(e),
    }
    let resume = s.enabled && !s.halted;
    save(s);
    if resume {
        arm(1);
    }
    Ok(get_status())
}

#[update]
async fn crank() -> R<Status> {
    crank_internal().await
}
async fn crank_internal() -> R<Status> {
    let c = config();
    let mut s = state();
    if !s.enabled || s.halted {
        return Ok(get_status());
    }
    if s.in_flight {
        return Ok(get_status());
    }
    // A public caller may wake a timer, never accelerate idle polling beyond its fixed interval.
    let active = s.pending.is_some() || s.turn.is_some();
    let interval = if active { 1 } else { c.idle_poll_seconds };
    if now() < s.last_attempt.saturating_add(interval) {
        arm(interval);
        return Ok(get_status());
    }
    if ic_cdk::api::canister_cycle_balance() < MIN_CYCLES {
        s.error = Some("relay cycle reserve is low".into());
        save(s);
        arm(60);
        return Ok(get_status());
    }
    s.in_flight = true;
    s.generation = s
        .generation
        .checked_add(1)
        .ok_or("relay generation exhausted")?;
    let generation = s.generation;
    s.last_attempt = now();
    save(s);
    let result = async {
        if state().pending.is_some() {
            handle_pending(&c).await
        } else if state().turn.is_some() {
            let turn = state().turn.unwrap();
            let last_advisory = state()
                .advisory_checked_at
                .unwrap_or(state().last_checked_at);
            if (turn.updates > 0 && turn.updates % 8 == 0)
                || now() > last_advisory.saturating_add(60)
                || now() >= state().last_checked_at.saturating_add(300)
            {
                if !search_still_current(&c, &turn).await? {
                    return Ok(());
                }
            }
            progress(&c).await
        } else {
            if let Some(p) = idle_poll(&c).await? {
                fetch_turn(&c, p).await?;
            }
            Ok(())
        }
    }
    .await;
    let mut s = state();
    if s.generation != generation {
        return Err("relay action generation changed; reconcile current state".into());
    }
    s.in_flight = false;
    match result {
        Ok(()) => s.error = None,
        Err(e) => {
            if e.contains("uncertain") {
                if let Some(t) = &mut s.turn {
                    t.uncertain = true;
                }
            }
            if e.contains("nonce conflict")
                || e.contains("receipt identity")
                || e.contains("differs from durable")
                || e.contains("raw transaction/hash")
            {
                s.halted = true;
                s.enabled = false;
            }
            s.error = Some(e);
        }
    }
    let delay = if s.error.is_some() {
        15
    } else if s.pending.is_some() {
        3
    } else if s.turn.is_some() {
        1
    } else {
        c.idle_poll_seconds
    };
    save(s);
    arm(delay);
    Ok(get_status())
}
ic_cdk::export_candid!();
pub fn candid_service() -> String {
    __export_service()
}
