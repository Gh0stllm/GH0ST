use candid::Principal;
use gh0st_chess_protocol::*;
use shakmaty::{CastlingMode, Chess, EnPassantMode, fen::Fen};

const NOW: u64 = 1_000;
fn principal(n: u8) -> Principal {
    Principal::from_slice(&[n])
}
fn setup() -> (State, VerifiedEntry) {
    // Explicit local fixture identity. These are not deployment addresses or live RH proofs.
    let config = Config {
        entry_attestor: principal(1),
        rh_vault: [2; 20],
        engine: EngineConfig {
            engine_canister: principal(3),
            stockfish_commit: "edb0d9db6731067ec50ce619ff372b463bc4dd5d".into(),
            nnue_sha256: "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2".into(),
            nodes: 1_000,
            hash_mb: 16,
            cycles_per_search: 1_000_000_000,
        },
    };
    let mut entry = VerifiedEntry {
        game_id: [0; 32],
        player: [4; 20],
        player_principal: principal(5),
        principal_hash: principal_hash(principal(5)),
        nonce: [6; 32],
        engine_config_hash: config.engine.hash(),
        chain_id: RH_CHAIN_ID,
        vault: config.rh_vault,
        transaction_hash: [7; 32],
        log_index: 0,
        opened_at: NOW,
        game_deadline: NOW + 86_400,
        reconciliation_deadline: NOW + 86_400 + 604_800,
    };
    entry.game_id = evm_game_id(entry.chain_id, entry.vault, entry.player, entry.nonce);
    let mut state = State::new(config).unwrap();
    state
        .accept_attested_entry(principal(1), entry.clone(), NOW)
        .unwrap();
    (state, entry)
}
fn request(state: &State, id: Hash, uci: &str) -> MoveRequest {
    let game = &state.games[&id];
    MoveRequest {
        game_id: id,
        request_id: sha256(format!("{}:{uci}", game.moves.len()).as_bytes()),
        expected_ply: game.moves.len() as u32,
        expected_position_hash: position_hash(&game.fen),
        uci: uci.into(),
    }
}
fn human(state: &mut State, id: Hash, uci: &str) -> Game {
    state
        .submit_move(principal(5), request(state, id, uci), NOW + 1)
        .unwrap()
}
fn response(state: &State, id: Hash, uci: &str) -> SearchResponse {
    let game = &state.games[&id];
    SearchResponse {
        job_id: game.pending.as_ref().unwrap().job_id,
        config_hash: game.entry.engine_config_hash,
        bestmove: uci.into(),
        actual_nodes: 1_000,
        depth: 10,
        instructions: 10_000,
        engine_commit: game.engine.stockfish_commit.clone(),
        nnue_sha256: game.engine.nnue_sha256.clone(),
    }
}
fn bot(state: &mut State, id: Hash, uci: &str) -> Game {
    state.begin_search(id, NOW + 2).unwrap();
    state
        .complete_search(id, response(state, id, uci), NOW + 3)
        .unwrap()
}
fn fixture_position(state: &mut State, id: Hash, fen: &str) {
    // Test-only mutation: the canister exposes no initial-FEN or state replacement endpoint.
    let pos: Chess = fen
        .parse::<Fen>()
        .unwrap()
        .into_position(CastlingMode::Standard)
        .unwrap();
    let game = state.games.get_mut(&id).unwrap();
    game.fen = Fen::from_position(&pos, EnPassantMode::Legal).to_string();
    game.position_hash = position_hash(&game.fen);
    game.repetition_keys = vec![
        game.fen
            .split_whitespace()
            .take(4)
            .collect::<Vec<_>>()
            .join(" "),
    ];
}

#[test]
fn legal_rule_oracle_start_kiwipete_and_ep_perft() {
    assert_eq!(perft(INITIAL_FEN, 4), Ok(197_281));
    assert_eq!(
        perft(
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            3
        ),
        Ok(97_862)
    );
    assert_eq!(
        perft("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4),
        Ok(43_238)
    );
}

#[test]
fn entry_is_authenticated_bound_and_one_use() {
    let (mut state, entry) = setup();
    assert_eq!(
        state.accept_attested_entry(principal(8), entry.clone(), NOW),
        Err(Error::Unauthorized)
    );
    assert!(
        state
            .accept_attested_entry(principal(1), entry.clone(), NOW)
            .is_ok()
    );
    assert_eq!(state.games.len(), 1);
    let mut replay = entry.clone();
    replay.nonce = [8; 32];
    replay.game_id = evm_game_id(replay.chain_id, replay.vault, replay.player, replay.nonce);
    assert_eq!(
        state.accept_attested_entry(principal(1), replay.clone(), NOW),
        Err(Error::EntryAlreadyUsed)
    );
    replay.transaction_hash = [9; 32];
    replay.principal_hash = [0; 32];
    assert_eq!(
        state.accept_attested_entry(principal(1), replay, NOW),
        Err(Error::InvalidEntry)
    );
}

#[test]
fn rejects_impersonation_illegal_move_stale_state_and_request_conflicts() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    let req = request(&state, id, "e2e4");
    assert_eq!(
        state.submit_move(principal(9), req.clone(), NOW + 1),
        Err(Error::Unauthorized)
    );
    assert_eq!(
        state.submit_move(Principal::anonymous(), req.clone(), NOW + 1),
        Err(Error::Anonymous)
    );
    let illegal = request(&state, id, "e2e5");
    assert_eq!(
        state.submit_move(principal(5), illegal, NOW + 1),
        Err(Error::IllegalMove)
    );
    let mut stale = req.clone();
    stale.expected_ply = 4;
    assert_eq!(
        state.submit_move(principal(5), stale, NOW + 1),
        Err(Error::StalePosition)
    );
    let moved = state
        .submit_move(principal(5), req.clone(), NOW + 1)
        .unwrap();
    assert_eq!(moved.phase, Phase::WaitingBot);
    assert_eq!(
        state.submit_move(principal(5), req.clone(), NOW + 2),
        Ok(moved)
    );
    let mut conflict = req;
    conflict.uci = "d2d4".into();
    assert_eq!(
        state.submit_move(principal(5), conflict, NOW + 2),
        Err(Error::RequestConflict)
    );
}

#[test]
fn only_human_checkmate_produces_code_one() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    human(&mut state, id, "e2e4");
    bot(&mut state, id, "e7e5");
    human(&mut state, id, "f1c4");
    bot(&mut state, id, "b8c6");
    human(&mut state, id, "d1h5");
    bot(&mut state, id, "g8f6");
    let game = human(&mut state, id, "h5f7");
    assert_eq!(game.phase, Phase::Terminal);
    assert_eq!(
        game.terminal.as_ref().unwrap().result,
        GameResult::HumanCheckmate
    );
    let material = game.result_material().unwrap();
    assert_eq!(material.result, 1);
    assert_eq!(material.player, entry.player);
    assert_eq!(material.principal_hash, entry.principal_hash);
    assert_eq!(material.nonce, entry.nonce);
    assert_eq!(material.engine_config_hash, entry.engine_config_hash);
    assert!(game.pending.is_none());
    assert!(game.legal_moves().is_empty());
}

#[test]
fn bot_checkmate_has_no_reward() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    human(&mut state, id, "f2f3");
    bot(&mut state, id, "e7e5");
    human(&mut state, id, "g2g4");
    let game = bot(&mut state, id, "d8h4");
    assert_eq!(game.result_material().unwrap().result, 2);
}

#[test]
fn search_is_durable_idempotent_and_never_rolls_back_human_move() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    let human_game = human(&mut state, id, "e2e4");
    let search = state.begin_search(id, NOW + 2).unwrap();
    assert_eq!(search.moves, ["e2e4"]);
    assert_eq!(search.initial_fen, INITIAL_FEN);
    assert_eq!(
        state.begin_search(id, NOW + 2),
        Err(Error::SearchAlreadyRunning)
    );
    let game = state.engine_failed(id, search.job_id, NOW + 3).unwrap();
    assert_eq!(game.fen, human_game.fen);
    assert_eq!(game.moves.len(), 1);
    assert_eq!(game.result_material().unwrap().result, 6);
    assert_eq!(state.engine_failed(id, search.job_id, NOW + 4), Ok(game));
}

#[test]
fn successful_search_cannot_be_replayed_or_replaced() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    human(&mut state, id, "e2e4");
    state.begin_search(id, NOW + 2).unwrap();
    let answer = response(&state, id, "e7e5");
    let game = state.complete_search(id, answer.clone(), NOW + 3).unwrap();
    assert_eq!(game.phase, Phase::WaitingHuman);
    assert_eq!(state.complete_search(id, answer.clone(), NOW + 4), Ok(game));
    let mut changed = answer;
    changed.bestmove = "d7d5".into();
    assert_eq!(
        state.complete_search(id, changed, NOW + 4),
        Err(Error::RequestConflict)
    );
}

#[test]
fn illegal_or_wrong_identity_engine_is_refundable_abort() {
    for wrong_identity in [false, true] {
        let (mut state, entry) = setup();
        let id = entry.game_id;
        human(&mut state, id, "e2e4");
        state.begin_search(id, NOW + 2).unwrap();
        let mut answer = response(&state, id, if wrong_identity { "e7e5" } else { "a1a8" });
        if wrong_identity {
            answer.nnue_sha256 = "0".repeat(64);
        }
        let game = state.complete_search(id, answer, NOW + 3).unwrap();
        assert_eq!(game.result_material().unwrap().result, 7);
        assert_eq!(game.moves.len(), 1);
    }
}

#[test]
fn castling_en_passant_and_underpromotion_are_legal() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    human(&mut state, id, "e1g1");
    assert!(state.games[&id].fen.starts_with("r3k2r/8/8/8/8/8/8/R4RK1"));
    bot(&mut state, id, "e8c8");
    assert!(state.games[&id].fen.starts_with("2kr3r"));
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/8/3pP3/8/8/8/K7 w - d6 0 1");
    let game = human(&mut state, id, "e5d6");
    assert!(game.fen.starts_with("7k/8/3P4/8"));
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/4P3/8/8/8/8/8/K7 w - - 0 1");
    let missing_promotion = request(&state, id, "e7e8");
    assert_eq!(
        state.submit_move(principal(5), missing_promotion, NOW + 1),
        Err(Error::IllegalMove)
    );
    let game = human(&mut state, id, "e7e8n");
    assert!(game.fen.starts_with("4N2k"));
    assert_eq!(game.result_material().unwrap().result, 3);
}

#[test]
fn pinned_en_passant_and_castling_through_check_are_rejected() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/8/r2pP2K/8/8/8/8 w - d6 0 1");
    assert!(!state.games[&id].legal_moves().contains(&"e5d6".into()));
    let req = request(&state, id, "e5d6");
    assert_eq!(
        state.submit_move(principal(5), req, NOW + 1),
        Err(Error::IllegalMove)
    );
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    assert!(!state.games[&id].legal_moves().contains(&"e1g1".into()));
}

#[test]
fn repetition_is_history_aware_and_bot_claims_threefold() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    human(&mut state, id, "g1f3");
    bot(&mut state, id, "g8f6");
    human(&mut state, id, "f3g1");
    bot(&mut state, id, "f6g8");
    human(&mut state, id, "g1f3");
    bot(&mut state, id, "g8f6");
    human(&mut state, id, "f3g1");
    bot(&mut state, id, "f6g8");
    let game = state.claim_draw(principal(5), id, None, NOW + 5).unwrap();
    assert_eq!(game.result_material().unwrap().result, 3);
    assert_eq!(game.terminal.unwrap().reason, "human_claimed_draw");
}

#[test]
fn fifty_and_seventy_five_move_draws_and_mate_precedence() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/8/8/8/8/R7/K7 w - - 99 51");
    let game = human(&mut state, id, "a2b2");
    assert_eq!(game.terminal.unwrap().reason, "bot_claimed_draw");
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/8/8/8/8/R7/K7 w - - 149 76");
    let game = human(&mut state, id, "a2b2");
    assert_eq!(game.terminal.unwrap().reason, "seventy_five_move_rule");
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/5KQ1/8/8/8/8/8 w - - 149 76");
    let game = human(&mut state, id, "g6g7");
    assert_eq!(game.result_material().unwrap().result, 1);
}

#[test]
fn stale_service_pending_is_refund_but_human_abandonment_is_not_prize() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    let game = state.expire(id, entry.game_deadline + 20).unwrap();
    assert_eq!(game.result_material().unwrap().result, 5);
    assert_eq!(game.terminal.unwrap().completed_at, entry.game_deadline);
    let (mut state, entry) = setup();
    let id = entry.game_id;
    human(&mut state, id, "e2e4");
    let game = state.expire(id, entry.game_deadline + 20).unwrap();
    assert_eq!(game.result_material().unwrap().result, 6);
}

#[test]
fn resignation_and_position_transcripts_bind_terminal_reason() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    let start = state.games[&id].transcript_hash;
    let game = state.resign(principal(5), id, NOW + 1).unwrap();
    assert_eq!(game.result_material().unwrap().result, 4);
    assert_ne!(game.transcript_hash, start);
    assert_eq!(state.resign(principal(5), id, NOW + 2), Ok(game));
}

#[test]
fn stalemate_and_intended_fifty_move_claim_are_draws_without_playing_announced_move() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/5KQ1/8/8/8/8/8 w - - 0 1");
    let game = human(&mut state, id, "g6f7");
    assert_eq!(game.terminal.as_ref().unwrap().reason, "stalemate");
    assert_eq!(game.result_material().unwrap().result, 3);
    let (mut state, entry) = setup();
    let id = entry.game_id;
    fixture_position(&mut state, id, "7k/8/8/8/8/8/R7/K7 w - - 99 51");
    let before = state.games[&id].moves.len();
    let game = state
        .claim_draw(principal(5), id, Some("a2b2".into()), NOW + 5)
        .unwrap();
    assert_eq!(game.moves.len(), before);
    assert_eq!(game.result_material().unwrap().result, 3);
}

#[test]
fn receipt_window_allows_late_issue_but_never_late_completion_or_expired_signing() {
    let (mut state, entry) = setup();
    let id = entry.game_id;
    let game = state.resign(principal(5), id, NOW + 1).unwrap();
    assert!(
        game.unsigned_receipt(
            entry.game_deadline + 1,
            entry.reconciliation_deadline,
            entry.game_deadline + 1
        )
        .is_ok()
    );
    assert!(
        game.unsigned_receipt(NOW, entry.reconciliation_deadline, NOW + 1)
            .is_err()
    );
    assert!(
        game.unsigned_receipt(NOW + 1, entry.reconciliation_deadline + 1, NOW + 1)
            .is_err()
    );
    assert!(game.unsigned_receipt(NOW + 1, NOW + 2, NOW + 3).is_err());
    assert!(
        game.unsigned_receipt(
            entry.reconciliation_deadline,
            entry.reconciliation_deadline,
            entry.reconciliation_deadline
        )
        .is_ok()
    );
}
