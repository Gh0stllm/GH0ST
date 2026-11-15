//! Rust authority canister. A separate pinned Stockfish canister owns C++ execution.
//! No client-selected FEN, search response, payout signature, or admin config mutation endpoint.
use super::*;
use ic_cdk::{init, query, update};
use ic_stable_structures::{
    DefaultMemoryImpl, StableBTreeMap, StableCell,
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;
thread_local! {
    static MEMORY: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static CONFIG: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(
        MEMORY.with(|m| m.borrow().get(MemoryId::new(0))), vec![]));
    static GAMES: RefCell<StableBTreeMap<Hash, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(
        MEMORY.with(|m| m.borrow().get(MemoryId::new(1)))));
    // Region 2 is reserved for canonical (RH txHash, logIndex)->gameId replay protection.
    // No entries are accepted by this build; the verifier must implement this before launch.
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct Status {
    schema_version: u32,
    production_ready: bool,
    paid_entries_enabled: bool,
    engine_config: EngineConfig,
    engine_config_hash: Hash,
    blockers: Vec<String>,
}

fn config() -> Config {
    CONFIG.with(|c| {
        candid::decode_one(c.borrow().get()).expect("configuration missing or schema mismatch")
    })
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000_000
}
fn caller() -> Principal {
    ic_cdk::api::msg_caller()
}

#[init]
fn init(config: Config) {
    let validated = State::new(config).expect("invalid immutable launch configuration");
    CONFIG.with(|c| {
        if !c.borrow().get().is_empty() {
            ic_cdk::trap("configuration already initialized");
        }
        c.borrow_mut()
            .set(candid::encode_one(validated.config).expect("config encode"));
    });
}

/// A transaction touches one game record. Stable maps survive upgrades without heap serialization.
fn transact<T>(game_id: Hash, f: impl FnOnce(&mut State) -> Result<T, Error>) -> Result<T, Error> {
    let game: Game = GAMES
        .with(|g| g.borrow().get(&game_id))
        .ok_or(Error::UnknownGame)
        .map(|b| candid::decode_one(&b).expect("stable game schema mismatch"))?;
    let mut state = State {
        schema_version: SCHEMA_VERSION,
        config: config(),
        games: BTreeMap::from([(game_id, game)]),
        used_entries: BTreeMap::new(),
    };
    let result = f(&mut state)?;
    let encoded =
        candid::encode_one(state.games.get(&game_id).expect("game retained")).expect("game encode");
    // Hard storage/input bounds protect memory and update-message size.
    if encoded.len() > 1_500_000 {
        return Err(Error::Capacity);
    }
    GAMES.with(|g| g.borrow_mut().insert(game_id, encoded));
    Ok(result)
}

#[query]
fn get_status() -> Status {
    let config = config();
    Status { schema_version: SCHEMA_VERSION, production_ready: PRODUCTION_READY, paid_entries_enabled: false,
        engine_config_hash: config.engine.hash(), engine_config: config.engine,
        blockers: vec![
            "Canonical RH EntryAccepted log verifier and replay-index persistence are not implemented".into(),
            "Stockfish on-ICP search budget/strength/cycles and public canister code hashes require verification".into(),
            "EIP-712 result attestor signing/relay is not implemented in this canister".into(),
            "Controller/upgrade policy and end-to-end entry/result receipts require public review".into(),
        ] }
}

#[query]
fn get_game(game_id: Hash) -> Option<Game> {
    GAMES
        .with(|g| g.borrow().get(&game_id))
        .map(|b| candid::decode_one(&b).expect("stable game decode"))
}

#[query]
fn legal_moves(game_id: Hash) -> Result<Vec<String>, Error> {
    get_game(game_id)
        .map(|game| game.legal_moves())
        .ok_or(Error::UnknownGame)
}

#[query]
fn result_material(game_id: Hash) -> Result<Option<ResultMaterial>, Error> {
    get_game(game_id)
        .map(|game| game.result_material())
        .ok_or(Error::UnknownGame)
}

#[update]
fn accept_entry(_entry: VerifiedEntry) -> Result<Game, Error> {
    if caller() != config().entry_attestor {
        return Err(Error::Unauthorized);
    }
    // Deliberate, non-configurable fail-closed gate. No mock receipt or controller flag can open it.
    Err(Error::ChallengeInactive)
}

#[update]
fn submit_move(request: MoveRequest) -> Result<Game, Error> {
    let game_id = request.game_id;
    transact(game_id, |state| state.submit_move(caller(), request, now()))
}

/// Permissionless bounded crank. Human move has already committed in a separate update.
/// It never accepts a bestmove supplied by the browser and never calls an off-chain LLM.
#[update]
async fn run_bot(game_id: Hash) -> Result<Game, Error> {
    let request = transact(game_id, |state| state.begin_search(game_id, now()))?;
    let config = config();
    let job_id = request.job_id;
    let reply = ic_cdk::call::Call::bounded_wait(config.engine.engine_canister, "search")
        .with_arg(request)
        .with_cycles(config.engine.cycles_per_search as u128)
        .await;
    match reply {
        Ok(response) => match response.candid::<Result<SearchResponse, String>>() {
            Ok(Ok(search)) => transact(game_id, |state| {
                state.complete_search(game_id, search, now())
            }),
            _ => transact(game_id, |state| state.engine_failed(game_id, job_id, now())),
        },
        Err(_) => transact(game_id, |state| state.engine_failed(game_id, job_id, now())),
    }
}

#[update]
fn resign(game_id: Hash) -> Result<Game, Error> {
    transact(game_id, |state| state.resign(caller(), game_id, now()))
}

#[update]
fn claim_draw(game_id: Hash, intended_uci: Option<String>) -> Result<Game, Error> {
    transact(game_id, |state| {
        state.claim_draw(caller(), game_id, intended_uci, now())
    })
}

#[update]
fn expire(game_id: Hash) -> Result<Game, Error> {
    transact(game_id, |state| state.expire(game_id, now()))
}

/// Recovery for a callback lost during an upgrade or a trapped callee. Refund-only result.
#[update]
fn fault_stuck_search(game_id: Hash) -> Result<Game, Error> {
    if caller() != config().entry_attestor {
        return Err(Error::Unauthorized);
    }
    transact(game_id, |state| {
        let pending = state
            .games
            .get(&game_id)
            .and_then(|g| g.pending.as_ref())
            .ok_or(Error::WrongPhase)?;
        if now() < pending.requested_at.saturating_add(600) {
            return Err(Error::WrongPhase);
        }
        state.engine_failed(game_id, pending.job_id, now())
    })
}

ic_cdk::export_candid!();
pub fn candid_service() -> String {
    __export_service()
}
