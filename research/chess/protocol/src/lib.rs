//! Source-only authoritative chess session core. No network verifier or signer is implied.
//! The production canister is deliberately entry-disabled until its launch gates are met.

use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sha3::Keccak256;
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Position, fen::Fen, uci::UciMove};
use std::collections::BTreeMap;

#[cfg(feature = "canister")]
mod canister;
#[cfg(feature = "canister")]
pub use canister::candid_service;
pub mod receipt;

pub type Hash = [u8; 32];
pub type Address = [u8; 20];
pub const RH_CHAIN_ID: u64 = 4663;
pub const INITIAL_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
pub const MAX_GAMES: usize = 5_000;
pub const MAX_PLIES: usize = 1_024;
pub const SCHEMA_VERSION: u32 = 1;
pub const PRODUCTION_READY: bool = false;
pub const STOCKFISH_COMMIT: &str = "edb0d9db6731067ec50ce619ff372b463bc4dd5d";
pub const NNUE_SHA256: &str = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2";
pub const MAX_CYCLES_PER_SEARCH: u64 = 1_000_000_000_000;

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct EngineConfig {
    pub engine_canister: Principal,
    pub stockfish_commit: String,
    pub nnue_sha256: String,
    pub nodes: u64,
    pub hash_mb: u32,
    pub cycles_per_search: u64,
}

impl EngineConfig {
    /// Canonical fixed-field binary encoding. Strength settings are constants, never client input.
    pub fn hash(&self) -> Hash {
        let mut bytes = b"GH0ST_ENGINE_CONFIG_V1\0".to_vec();
        field(&mut bytes, self.engine_canister.as_slice());
        field(&mut bytes, self.stockfish_commit.as_bytes());
        field(&mut bytes, self.nnue_sha256.as_bytes());
        bytes.extend(self.nodes.to_be_bytes());
        bytes.extend(self.hash_mb.to_be_bytes());
        bytes.extend(self.cycles_per_search.to_be_bytes());
        // Threads=1, Skill Level=20, UCI_LimitStrength=false, MultiPV=1, clear TT per move.
        bytes.extend([1, 20, 0, 1, 1]);
        sha256(&bytes)
    }

    pub fn validate(&self) -> Result<(), Error> {
        if self.engine_canister == Principal::anonymous()
            || self.engine_canister == Principal::management_canister()
            || self.stockfish_commit != STOCKFISH_COMMIT
            || self.nnue_sha256 != NNUE_SHA256
            || self.stockfish_commit.len() != 40
            || self.nnue_sha256.len() != 64
            || !self.stockfish_commit.bytes().all(|c| c.is_ascii_hexdigit())
            || !self.nnue_sha256.bytes().all(|c| c.is_ascii_hexdigit())
            || self.stockfish_commit != self.stockfish_commit.to_ascii_lowercase()
            || self.nnue_sha256 != self.nnue_sha256.to_ascii_lowercase()
            || self.nodes == 0
            || self.nodes > 10_000_000
            || self.hash_mb == 0
            || self.hash_mb > 256
            || self.cycles_per_search == 0
            || self.cycles_per_search > MAX_CYCLES_PER_SEARCH
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct Config {
    pub entry_attestor: Principal,
    pub engine: EngineConfig,
    pub rh_vault: Address,
}

/// This is an authenticated attestor assertion, NOT a cryptographic EVM receipt proof.
/// The canister review build refuses entry admission until a canonical verifier is implemented.
#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct VerifiedEntry {
    pub game_id: Hash,
    pub player: Address,
    pub player_principal: Principal,
    pub principal_hash: Hash,
    pub nonce: Hash, // uint256, big endian; exact wallet entry nonce
    pub engine_config_hash: Hash,
    pub chain_id: u64,
    pub vault: Address,
    pub transaction_hash: Hash,
    pub log_index: u32,
    pub opened_at: u64,
    pub game_deadline: u64,
    pub reconciliation_deadline: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub enum Phase {
    WaitingHuman,
    WaitingBot,
    Terminal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
#[repr(u8)]
pub enum GameResult {
    HumanCheckmate = 1,
    BotCheckmate = 2,
    Draw = 3,
    HumanResigned = 4,
    PlayerTimeout = 5,
    ServiceFault = 6,
    EngineAbort = 7,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct Terminal {
    pub result: GameResult,
    pub reason: String,
    pub completed_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct PendingSearch {
    pub job_id: Hash,
    pub position_hash: Hash,
    pub requested_at: u64,
    pub in_flight: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct SearchRequest {
    pub job_id: Hash,
    pub config_hash: Hash,
    pub initial_fen: String,
    pub moves: Vec<String>,
    pub nodes: u64,
    pub hash_mb: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct SearchResponse {
    pub job_id: Hash,
    pub config_hash: Hash,
    pub bestmove: String,
    pub actual_nodes: u64,
    pub depth: u32,
    pub instructions: u64,
    pub engine_commit: String,
    pub nnue_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct EngineAudit {
    pub job_id: Hash,
    pub requested_nodes: u64,
    pub actual_nodes: u64,
    pub depth: u32,
    pub instructions: u64,
    pub bestmove: String,
    pub engine_commit: String,
    pub nnue_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct MoveRecord {
    pub ply: u32,
    pub uci: String,
    pub position_hash: Hash,
    pub transcript_hash: Hash,
    pub engine: Option<EngineAudit>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct Game {
    pub entry: VerifiedEntry,
    pub engine: EngineConfig,
    pub fen: String,
    pub position_hash: Hash,
    pub phase: Phase,
    pub moves: Vec<MoveRecord>,
    pub repetition_keys: Vec<String>,
    pub transcript_hash: Hash,
    pub pending: Option<PendingSearch>,
    pub terminal: Option<Terminal>,
    pub requests: BTreeMap<Hash, Hash>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct MoveRequest {
    pub game_id: Hash,
    pub request_id: Hash,
    pub expected_ply: u32,
    pub expected_position_hash: Hash,
    pub uci: String,
}

/// Unsigned material for the EIP-712 attestor. Export alone cannot release RH funds.
#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct ResultMaterial {
    pub game_id: Hash,
    pub player: Address,
    pub principal_hash: Hash,
    pub nonce: Hash,
    pub final_position_hash: Hash,
    pub transcript_hash: Hash,
    pub result: u8,
    pub engine_config_hash: Hash,
    pub completed_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub enum Error {
    Unauthorized,
    Anonymous,
    InvalidConfiguration,
    InvalidEntry,
    EntryAlreadyUsed,
    UnknownGame,
    Capacity,
    WrongPhase,
    Expired,
    StalePosition,
    IllegalMove,
    RequestConflict,
    InvalidEngineResponse,
    NoDrawClaim,
    SearchAlreadyRunning,
    ChallengeInactive,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct State {
    pub schema_version: u32,
    pub config: Config,
    pub games: BTreeMap<Hash, Game>,
    pub used_entries: BTreeMap<(Hash, u32), Hash>,
}

impl State {
    pub fn new(config: Config) -> Result<Self, Error> {
        config.engine.validate()?;
        if config.entry_attestor == Principal::anonymous() || config.rh_vault == [0; 20] {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            schema_version: SCHEMA_VERSION,
            config,
            games: BTreeMap::new(),
            used_entries: BTreeMap::new(),
        })
    }

    /// Only invoke after the deployment-specific canonical RH verifier has authenticated the log.
    pub fn accept_attested_entry(
        &mut self,
        caller: Principal,
        entry: VerifiedEntry,
        now: u64,
    ) -> Result<Game, Error> {
        if caller != self.config.entry_attestor {
            return Err(Error::Unauthorized);
        }
        if entry.player_principal == Principal::anonymous() {
            return Err(Error::Anonymous);
        }
        if let Some(game) = self.games.get(&entry.game_id) {
            return if game.entry == entry {
                Ok(game.clone())
            } else {
                Err(Error::EntryAlreadyUsed)
            };
        }
        if self.games.len() >= MAX_GAMES {
            return Err(Error::Capacity);
        }
        if entry.principal_hash != principal_hash(entry.player_principal)
            || entry.chain_id != RH_CHAIN_ID
            || entry.vault != self.config.rh_vault
            || entry.player == [0; 20]
            || entry.transaction_hash == [0; 32]
            || entry.game_id != evm_game_id(entry.chain_id, entry.vault, entry.player, entry.nonce)
            || entry.engine_config_hash != self.config.engine.hash()
            || entry.opened_at > now
            || now >= entry.game_deadline
            || entry.game_deadline.checked_sub(entry.opened_at) != Some(86_400)
            || entry
                .reconciliation_deadline
                .checked_sub(entry.game_deadline)
                != Some(604_800)
        {
            return Err(Error::InvalidEntry);
        }
        let log = (entry.transaction_hash, entry.log_index);
        if self.used_entries.contains_key(&log) {
            return Err(Error::EntryAlreadyUsed);
        }
        let pos = Chess::default();
        let mut bytes = b"GH0ST_GAME_TRANSCRIPT_V1\0".to_vec();
        bytes.extend(entry.game_id);
        bytes.extend(entry.player);
        bytes.extend(entry.principal_hash);
        bytes.extend(entry.nonce);
        bytes.extend(entry.engine_config_hash);
        bytes.extend(position_hash(INITIAL_FEN));
        let game = Game {
            entry: entry.clone(),
            engine: self.config.engine.clone(),
            fen: INITIAL_FEN.into(),
            position_hash: position_hash(INITIAL_FEN),
            phase: Phase::WaitingHuman,
            moves: vec![],
            repetition_keys: vec![repetition_key(&pos)],
            transcript_hash: sha256(&bytes),
            pending: None,
            terminal: None,
            requests: BTreeMap::new(),
        };
        self.used_entries.insert(log, entry.game_id);
        self.games.insert(entry.game_id, game.clone());
        Ok(game)
    }

    pub fn submit_move(
        &mut self,
        caller: Principal,
        req: MoveRequest,
        now: u64,
    ) -> Result<Game, Error> {
        let game = self.games.get_mut(&req.game_id).ok_or(Error::UnknownGame)?;
        authenticate(game, caller)?;
        let request_hash = move_request_hash(&req);
        if let Some(previous) = game.requests.get(&req.request_id) {
            return if *previous == request_hash {
                Ok(game.clone())
            } else {
                Err(Error::RequestConflict)
            };
        }
        if now >= game.entry.game_deadline {
            return Err(Error::Expired);
        }
        if game.phase != Phase::WaitingHuman {
            return Err(Error::WrongPhase);
        }
        if req.expected_ply as usize != game.moves.len()
            || req.expected_position_hash != position_hash(&game.fen)
        {
            return Err(Error::StalePosition);
        }
        if game.moves.len() >= MAX_PLIES {
            return Err(Error::Capacity);
        }
        apply_move(game, &req.uci, None, now)?;
        game.requests.insert(req.request_id, request_hash);
        if game.phase != Phase::Terminal {
            // Bot always claims a valid current-position draw before spending cycles on a search.
            if claimable_draw(game) {
                finish(game, GameResult::Draw, "bot_claimed_draw", now);
            } else {
                queue_search(game, now);
            }
        }
        Ok(game.clone())
    }

    /// The wrapper commits this mutation BEFORE issuing the asynchronous engine call.
    pub fn begin_search(&mut self, game_id: Hash, now: u64) -> Result<SearchRequest, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        if game.phase != Phase::WaitingBot {
            return Err(Error::WrongPhase);
        }
        if now >= game.entry.game_deadline {
            return Err(Error::Expired);
        }
        let pending = game.pending.as_mut().ok_or(Error::WrongPhase)?;
        if pending.in_flight {
            return Err(Error::SearchAlreadyRunning);
        }
        pending.in_flight = true;
        Ok(SearchRequest {
            job_id: pending.job_id,
            config_hash: game.entry.engine_config_hash,
            initial_fen: INITIAL_FEN.into(),
            moves: game.moves.iter().map(|m| m.uci.clone()).collect(),
            nodes: game.engine.nodes,
            hash_mb: game.engine.hash_mb,
        })
    }

    /// This method is invoked by the wrapper only for a response from the pinned engine canister.
    pub fn complete_search(
        &mut self,
        game_id: Hash,
        response: SearchResponse,
        now: u64,
    ) -> Result<Game, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        // Duplicate deliveries from an already-completed job cannot advance the board twice.
        if let Some(audit) = game
            .moves
            .iter()
            .filter_map(|m| m.engine.as_ref())
            .find(|a| a.job_id == response.job_id)
        {
            return if audit.actual_nodes == response.actual_nodes
                && audit.depth == response.depth
                && audit.instructions == response.instructions
                && audit.bestmove == response.bestmove
                && audit.engine_commit == response.engine_commit
                && audit.nnue_sha256 == response.nnue_sha256
                && response.config_hash == game.entry.engine_config_hash
            {
                Ok(game.clone())
            } else {
                Err(Error::RequestConflict)
            };
        }
        if game.phase != Phase::WaitingBot {
            return Err(Error::WrongPhase);
        }
        let pending = game.pending.clone().ok_or(Error::WrongPhase)?;
        if response.job_id != pending.job_id
            || !pending.in_flight
            || pending.position_hash != position_hash(&game.fen)
        {
            return Err(Error::InvalidEngineResponse);
        }
        // A completed search must not silently use weaker parameters or a different binary/net.
        // Stockfish may overshoot a node limit slightly; actual work is preserved in the transcript.
        if response.config_hash != game.entry.engine_config_hash
            || response.engine_commit != game.engine.stockfish_commit
            || response.nnue_sha256 != game.engine.nnue_sha256
            || response.actual_nodes == 0
            || response.depth == 0
            || response.actual_nodes > game.engine.nodes.saturating_add(65_536)
        {
            finish(
                game,
                GameResult::EngineAbort,
                "engine_identity_or_budget_mismatch",
                now,
            );
            return Ok(game.clone());
        }
        if now >= game.entry.game_deadline {
            finish(
                game,
                GameResult::ServiceFault,
                "engine_response_after_game_deadline",
                now,
            );
            return Ok(game.clone());
        }
        let audit = EngineAudit {
            job_id: response.job_id,
            requested_nodes: game.engine.nodes,
            actual_nodes: response.actual_nodes,
            depth: response.depth,
            instructions: response.instructions,
            bestmove: response.bestmove.clone(),
            engine_commit: response.engine_commit,
            nnue_sha256: response.nnue_sha256,
        };
        if apply_move(game, &response.bestmove, Some(audit), now).is_err() {
            finish(
                game,
                GameResult::EngineAbort,
                "engine_returned_illegal_move",
                now,
            );
        } else if game.phase != Phase::Terminal {
            game.phase = Phase::WaitingHuman;
            game.pending = None;
        }
        Ok(game.clone())
    }

    pub fn engine_failed(&mut self, game_id: Hash, job_id: Hash, now: u64) -> Result<Game, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        if game.phase == Phase::Terminal {
            return Ok(game.clone());
        }
        if game.phase != Phase::WaitingBot
            || game.pending.as_ref().map(|p| p.job_id) != Some(job_id)
        {
            return Err(Error::InvalidEngineResponse);
        }
        finish(game, GameResult::ServiceFault, "engine_call_failed", now);
        Ok(game.clone())
    }

    pub fn resign(&mut self, caller: Principal, game_id: Hash, now: u64) -> Result<Game, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        authenticate(game, caller)?;
        if game.phase == Phase::Terminal {
            return Ok(game.clone());
        }
        if now >= game.entry.game_deadline {
            return Err(Error::Expired);
        }
        finish(game, GameResult::HumanResigned, "player_resigned", now);
        Ok(game.clone())
    }

    /// Human may claim a current or announced-move threefold/50-move draw on their turn.
    pub fn claim_draw(
        &mut self,
        caller: Principal,
        game_id: Hash,
        intended_uci: Option<String>,
        now: u64,
    ) -> Result<Game, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        authenticate(game, caller)?;
        if game.phase != Phase::WaitingHuman {
            return Err(Error::WrongPhase);
        }
        if now >= game.entry.game_deadline {
            return Err(Error::Expired);
        }
        let claim = if let Some(uci) = intended_uci {
            let mut copy = game.clone();
            apply_move(&mut copy, &uci, None, now)?;
            claimable_draw(&copy)
        } else {
            claimable_draw(game)
        };
        if !claim {
            return Err(Error::NoDrawClaim);
        }
        finish(game, GameResult::Draw, "human_claimed_draw", now);
        Ok(game.clone())
    }

    /// Anyone can adjudicate an expired game. Waiting bot is a service fault, never player forfeiture.
    pub fn expire(&mut self, game_id: Hash, now: u64) -> Result<Game, Error> {
        let game = self.games.get_mut(&game_id).ok_or(Error::UnknownGame)?;
        if game.phase == Phase::Terminal {
            return Ok(game.clone());
        }
        if now < game.entry.game_deadline {
            return Err(Error::WrongPhase);
        }
        match game.phase {
            Phase::WaitingHuman => finish(
                game,
                GameResult::PlayerTimeout,
                "player_abandoned_at_deadline",
                game.entry.game_deadline,
            ),
            Phase::WaitingBot => finish(
                game,
                GameResult::ServiceFault,
                "engine_unavailable_at_deadline",
                game.entry.game_deadline,
            ),
            Phase::Terminal => unreachable!(),
        }
        Ok(game.clone())
    }
}

impl Game {
    pub fn result_material(&self) -> Option<ResultMaterial> {
        let terminal = self.terminal.as_ref()?;
        Some(ResultMaterial {
            game_id: self.entry.game_id,
            player: self.entry.player,
            principal_hash: self.entry.principal_hash,
            nonce: self.entry.nonce,
            final_position_hash: position_hash(&self.fen),
            transcript_hash: self.transcript_hash,
            result: terminal.result as u8,
            engine_config_hash: self.entry.engine_config_hash,
            completed_at: terminal.completed_at,
        })
    }

    pub fn legal_moves(&self) -> Vec<String> {
        if self.phase == Phase::Terminal {
            return vec![];
        }
        let pos = parse_position(&self.fen).expect("stored position valid");
        pos.legal_moves()
            .iter()
            .map(|m| UciMove::from_move(*m, CastlingMode::Standard).to_string())
            .collect()
    }
}

fn authenticate(game: &Game, caller: Principal) -> Result<(), Error> {
    if caller == Principal::anonymous() {
        return Err(Error::Anonymous);
    }
    if caller != game.entry.player_principal || principal_hash(caller) != game.entry.principal_hash
    {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn apply_move(
    game: &mut Game,
    uci: &str,
    audit: Option<EngineAudit>,
    now: u64,
) -> Result<(), Error> {
    if uci.len() < 4 || uci.len() > 5 {
        return Err(Error::IllegalMove);
    }
    let mut pos = parse_position(&game.fen)?;
    let parsed: UciMove = uci.parse().map_err(|_| Error::IllegalMove)?;
    let mv = parsed.to_move(&pos).map_err(|_| Error::IllegalMove)?;
    let canonical = UciMove::from_move(mv, CastlingMode::Standard).to_string();
    if canonical != uci {
        return Err(Error::IllegalMove);
    }
    pos.play_unchecked(mv);
    let fen = Fen::from_position(&pos, EnPassantMode::Legal).to_string();
    let ply = (game.moves.len() + 1) as u32;
    let hash = position_hash(&fen);
    let mut bytes = b"GH0ST_PLY_TRANSCRIPT_V1\0".to_vec();
    bytes.extend(game.transcript_hash);
    bytes.extend(ply.to_be_bytes());
    field(&mut bytes, canonical.as_bytes());
    bytes.extend(hash);
    if let Some(a) = &audit {
        bytes.push(1);
        bytes.extend(a.job_id);
        bytes.extend(a.requested_nodes.to_be_bytes());
        bytes.extend(a.actual_nodes.to_be_bytes());
        bytes.extend(a.depth.to_be_bytes());
        bytes.extend(a.instructions.to_be_bytes());
        field(&mut bytes, a.engine_commit.as_bytes());
        field(&mut bytes, a.nnue_sha256.as_bytes());
    } else {
        bytes.push(0);
    }
    game.fen = fen;
    game.position_hash = hash;
    game.transcript_hash = sha256(&bytes);
    game.moves.push(MoveRecord {
        ply,
        uci: canonical,
        position_hash: hash,
        transcript_hash: game.transcript_hash,
        engine: audit,
    });
    game.repetition_keys.push(repetition_key(&pos));
    if pos.is_checkmate() {
        finish(
            game,
            if pos.turn() == Color::Black {
                GameResult::HumanCheckmate
            } else {
                GameResult::BotCheckmate
            },
            "checkmate",
            now,
        );
    } else if pos.is_stalemate() {
        finish(game, GameResult::Draw, "stalemate", now);
    } else if pos.is_insufficient_material() {
        finish(game, GameResult::Draw, "insufficient_material", now);
    } else if pos.halfmoves() >= 150 {
        finish(game, GameResult::Draw, "seventy_five_move_rule", now);
    } else if repetitions(game) >= 5 {
        finish(game, GameResult::Draw, "fivefold_repetition", now);
    } else if game.moves.len() >= MAX_PLIES {
        finish(game, GameResult::ServiceFault, "resource_ply_ceiling", now);
    }
    Ok(())
}

fn claimable_draw(game: &Game) -> bool {
    parse_position(&game.fen).is_ok_and(|p| p.halfmoves() >= 100) || repetitions(game) >= 3
}
fn repetitions(game: &Game) -> usize {
    let current = game.repetition_keys.last();
    game.repetition_keys
        .iter()
        .filter(|key| Some(*key) == current)
        .count()
}
fn queue_search(game: &mut Game, now: u64) {
    let mut bytes = b"GH0ST_SEARCH_JOB_V1\0".to_vec();
    bytes.extend(game.entry.game_id);
    bytes.extend(game.transcript_hash);
    bytes.extend(game.entry.engine_config_hash);
    let hash = position_hash(&game.fen);
    game.pending = Some(PendingSearch {
        job_id: sha256(&bytes),
        position_hash: hash,
        requested_at: now,
        in_flight: false,
    });
    game.phase = Phase::WaitingBot;
}
fn finish(game: &mut Game, result: GameResult, reason: &str, now: u64) {
    // Results signed for the vault must remain inside its accepted game-time interval.
    let completed_at = now.min(game.entry.game_deadline).max(game.entry.opened_at);
    let mut bytes = b"GH0ST_TERMINAL_TRANSCRIPT_V1\0".to_vec();
    bytes.extend(game.transcript_hash);
    bytes.push(result as u8);
    field(&mut bytes, reason.as_bytes());
    bytes.extend(completed_at.to_be_bytes());
    game.transcript_hash = sha256(&bytes);
    game.phase = Phase::Terminal;
    game.pending = None;
    game.terminal = Some(Terminal {
        result,
        reason: reason.into(),
        completed_at,
    });
}
fn parse_position(fen: &str) -> Result<Chess, Error> {
    fen.parse::<Fen>()
        .map_err(|_| Error::IllegalMove)?
        .into_position(CastlingMode::Standard)
        .map_err(|_| Error::IllegalMove)
}
fn repetition_key(pos: &Chess) -> String {
    // Legal en-passant availability is included; move counters do not affect repetition.
    Fen::from_position(pos, EnPassantMode::Legal)
        .to_string()
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}
fn field(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend((bytes.len() as u32).to_be_bytes());
    out.extend(bytes);
}
fn move_request_hash(request: &MoveRequest) -> Hash {
    let mut bytes = b"GH0ST_HUMAN_REQUEST_V1\0".to_vec();
    bytes.extend(request.game_id);
    bytes.extend(request.request_id);
    bytes.extend(request.expected_ply.to_be_bytes());
    bytes.extend(request.expected_position_hash);
    field(&mut bytes, request.uci.as_bytes());
    sha256(&bytes)
}
pub fn sha256(bytes: &[u8]) -> Hash {
    Sha256::digest(bytes).into()
}
pub fn principal_hash(principal: Principal) -> Hash {
    sha256(principal.as_slice())
}
pub fn position_hash(fen: &str) -> Hash {
    let mut bytes = b"GH0ST_POSITION_V1\0".to_vec();
    field(&mut bytes, fen.as_bytes());
    sha256(&bytes)
}
pub fn evm_game_id(chain_id: u64, vault: Address, player: Address, nonce: Hash) -> Hash {
    let mut bytes = vec![0; 32 * 4];
    bytes[24..32].copy_from_slice(&chain_id.to_be_bytes());
    bytes[44..64].copy_from_slice(&vault);
    bytes[76..96].copy_from_slice(&player);
    bytes[96..128].copy_from_slice(&nonce);
    Keccak256::digest(bytes).into()
}

/// Offline rule-oracle utility; never an update endpoint accepting client-selected game FEN.
pub fn perft(fen: &str, depth: u8) -> Result<u64, Error> {
    fn count(pos: &Chess, depth: u8) -> u64 {
        if depth == 0 {
            return 1;
        }
        pos.legal_moves()
            .iter()
            .map(|m| {
                let mut child = pos.clone();
                child.play_unchecked(*m);
                count(&child, depth - 1)
            })
            .sum()
    }
    if depth > 5 {
        return Err(Error::Capacity);
    }
    Ok(count(&parse_position(fen)?, depth))
}
