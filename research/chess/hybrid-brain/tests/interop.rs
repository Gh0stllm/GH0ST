//! Independent ethers/Solidity fixtures and hostile canonical-state checks.
//! These are local encoding/validation tests, not mainnet inference or funded-game proof.
use candid::Principal;
use gh0st_chess_hybrid_brain::*;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde_json::Value;

fn bytes<const N: usize>(s: &str) -> [u8; N] {
    unhex(s).unwrap().try_into().unwrap()
}
fn config() -> Config {
    Config {
        engine_canister: Principal::self_authenticating(b"synthetic engine fixture"),
        relay_canister: Principal::self_authenticating(b"synthetic relay fixture"),
        engine_module_hash: [3; 32],
        game_contract: [0x11; 20],
        game_runtime_hash: [4; 32],
        rpc_url: "https://rpc.mainnet.chain.robinhood.com".into(),
        confirmations: 12,
        key_name: "dfx_test_key".into(),
        reviewed_release: false,
    }
}
#[test]
fn relay_binding_is_nonanonymous_distinct_and_preserved_by_one_time_sealing() {
    let c = config();
    assert!(c.validate().is_ok());
    for relay in [
        Principal::anonymous(),
        Principal::management_canister(),
        c.engine_canister,
    ] {
        let mut invalid = c.clone();
        invalid.relay_canister = relay;
        assert!(invalid.validate().is_err());
    }
    let mut unbound = c.clone();
    unbound.game_contract = [0; 20];
    unbound.game_runtime_hash = [0; 32];
    let sealed = unbound
        .seal(&DeploymentBinding {
            game_contract: [7; 20],
            game_runtime_hash: [8; 32],
        })
        .unwrap();
    assert_eq!(sealed.relay_canister, c.relay_canister);
    assert_eq!(sealed.engine_hash(), c.engine_hash());
}
fn e4() -> Vec<String> {
    vec!["e2e4".into()]
}
fn valid_game() -> Game {
    let (_, transcript_hash, position_hash, castling, en_passant) = replay(&e4()).unwrap();
    // Board emitted by the independent Solidity/ethers vector's integer nibble construction.
    let board = bytes("0xcabedbac99999999000000000000000000010000000000001110111142365324");
    Game {
        player: bytes("0x70997970c51812dc3a010c7d01b50e0d17dc79c8"),
        nonce: word(7),
        opened_at: 1_000,
        turn_deadline: 4_600,
        result: 0,
        ply: 1,
        position_hash,
        transcript_hash,
        board,
        castling,
        en_passant,
        halfmove_clock: 0,
        black_to_move: true,
    }
}

#[test]
fn e4_replay_matches_independent_evm_position_and_transcript() {
    let v: Value =
        serde_json::from_str(include_str!("../../evm/hybrid-botmove-vector.json")).unwrap();
    let (_, transcript, position, castling, ep) = replay(&e4()).unwrap();
    assert_eq!(hex(&position), v["message"]["positionHash"]);
    assert_eq!(hex(&transcript), v["message"]["transcriptHash"]);
    assert_eq!((castling, ep), (15, 20));
    assert_eq!(encode_move("e7e5").unwrap(), 3364);
}

#[test]
fn eip712_digest_and_signature_recover_match_ethers_vector() {
    let v: Value =
        serde_json::from_str(include_str!("../../evm/hybrid-botmove-vector.json")).unwrap();
    let m = &v["message"];
    let receipt = BotMove {
        game_id: bytes(m["gameId"].as_str().unwrap()),
        player: bytes(m["player"].as_str().unwrap()),
        ply: m["ply"].as_u64().unwrap() as u32,
        position_hash: bytes(m["positionHash"].as_str().unwrap()),
        transcript_hash: bytes(m["transcriptHash"].as_str().unwrap()),
        encoded_move: m["encodedMove"].as_u64().unwrap() as u16,
        engine_config_hash: bytes(m["engineConfigHash"].as_str().unwrap()),
        valid_until: m["validUntil"].as_u64().unwrap(),
    };
    let contract = bytes(v["domain"]["verifyingContract"].as_str().unwrap());
    let digest = receipt.digest(contract);
    assert_eq!(hex(&digest), v["digest"]);
    let raw = unhex(v["signature"].as_str().unwrap()).unwrap();
    let sig = Signature::from_slice(&raw[..64]).unwrap();
    let rec = RecoveryId::from_byte(raw[64] - 27).unwrap();
    let key = VerifyingKey::recover_from_prehash(&digest, &sig, rec).unwrap();
    let encoded = key.to_encoded_point(true);
    assert_eq!(
        hex(&ethereum_address(encoded.as_bytes()).unwrap()).to_lowercase(),
        v["signer"].as_str().unwrap().to_lowercase()
    );
    assert_eq!(
        ethereum_signature(digest, &raw[..64], encoded.as_bytes()).unwrap(),
        raw
    );
    // Domain, engine policy, and every signed position component affect authorization.
    assert_ne!(receipt.digest([0x22; 20]), digest);
    let mut altered = receipt.clone();
    altered.ply += 1;
    assert_ne!(altered.digest(contract), digest);
    altered = receipt.clone();
    altered.engine_config_hash[0] ^= 1;
    assert_ne!(altered.digest(contract), digest);
    altered = receipt.clone();
    altered.encoded_move ^= 1;
    assert_ne!(altered.digest(contract), digest);
}

#[test]
fn canonical_board_is_verified_with_raw_uncapturable_ep() {
    let c = config();
    let game = valid_game();
    assert_eq!(game.en_passant, 20); // e3 even though Black has no en-passant capture.
    assert!(verify_game(&c, game.id(c.game_contract), &game, &e4(), 1_010).is_ok());
    let mut changed = game.clone();
    changed.en_passant = 64;
    assert!(verify_game(&c, changed.id(c.game_contract), &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.board[0] ^= 1;
    assert!(verify_game(&c, changed.id(c.game_contract), &changed, &e4(), 1_010).is_err());
}

#[test]
fn canonical_history_cannot_change_player_nonce_turn_clock_or_result() {
    let c = config();
    let game = valid_game();
    let id = game.id(c.game_contract);
    let mut changed = game.clone();
    changed.player[0] ^= 1;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.nonce[31] ^= 1;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.halfmove_clock = 1;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.result = 1;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.black_to_move = false;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    changed = game.clone();
    changed.transcript_hash[31] ^= 1;
    assert!(verify_game(&c, id, &changed, &e4(), 1_010).is_err());
    assert!(verify_game(&c, id, &game, &["d2d4".into()], 1_010).is_err());
    assert!(verify_game(&c, id, &game, &e4(), game.turn_deadline).is_err());
    assert!(verify_game(&c, id, &game, &e4(), game.opened_at - 1).is_err());
}

#[test]
fn static_getgame_abi_roundtrip_matches_solidity_fields() {
    let g = valid_game();
    let encoded = [
        aword(g.player),
        g.nonce,
        word(g.opened_at),
        word(g.turn_deadline),
        word(g.result as u64),
        word(g.ply as u64),
        g.position_hash,
        g.transcript_hash,
        g.board,
        word(g.castling as u64),
        word(g.en_passant as u64),
        word(g.halfmove_clock as u64),
        word(g.black_to_move as u64),
    ]
    .concat();
    assert_eq!(Game::decode(&encoded).unwrap(), g);
    let mut overflow = encoded.clone();
    overflow[4 * 32 + 30] = 1; // Result uint8 overflow.
    assert!(Game::decode(&overflow).is_err());
    overflow = encoded.clone();
    overflow[5 * 32 + 27] = 1; // Ply uint32 overflow.
    assert!(Game::decode(&overflow).is_err());
    overflow = encoded;
    overflow[0] = 1; // Address nonzero upper padding.
    assert!(Game::decode(&overflow).is_err());
}

#[test]
fn pinned_policy_hash_and_job_are_not_client_strength_choices() {
    let c = config();
    assert!(c.validate().is_ok());
    assert_eq!((NODES, HASH_MB), (24_000_000, 128));
    let game = valid_game();
    let mut request = Request {
        game_id: game.id(c.game_contract),
        expected_ply: 1,
        expected_position_hash: game.position_hash,
        request_id: [1; 32],
        moves: e4(),
    };
    let a = Job::new(&c, &request, 1_010);
    request.request_id = [2; 32];
    let b = Job::new(&c, &request, 1_020);
    assert_eq!(a.job_id, b.job_id); // Retrying a canonical turn cannot buy another search.
    request.expected_ply = 3;
    assert_ne!(a.job_id, Job::new(&c, &request, 1_020).job_id);
    let mut c2 = c.clone();
    c2.engine_canister = Principal::self_authenticating(b"different engine fixture");
    assert_ne!(c.engine_hash(), c2.engine_hash());
    assert_ne!(a.job_id, Job::new(&c2, &request, 1_020).job_id);
    c2.rpc_url = "https://attacker.invalid".into();
    assert!(c2.validate().is_err());
    c2 = c.clone();
    c2.confirmations = 0;
    assert!(c2.validate().is_err());
}

#[test]
fn bootstrap_binding_is_one_time_and_does_not_change_engine_or_key_policy() {
    let mut bootstrap = config();
    bootstrap.game_contract = [0; 20];
    bootstrap.game_runtime_hash = [0; 32];
    assert!(bootstrap.validate().is_ok());
    let binding = DeploymentBinding {
        game_contract: [0x11; 20],
        game_runtime_hash: [4; 32],
    };
    let sealed = bootstrap.seal(&binding).unwrap();
    assert!(sealed.reviewed_release);
    assert_eq!(sealed.game_contract, binding.game_contract);
    assert_eq!(sealed.game_runtime_hash, binding.game_runtime_hash);
    assert_eq!(bootstrap.engine_hash(), sealed.engine_hash());
    assert_eq!(bootstrap.key_name, sealed.key_name);
    assert_eq!(bootstrap.engine_module_hash, sealed.engine_module_hash);
    assert_eq!(bootstrap.rpc_url, sealed.rpc_url);
    assert!(sealed.seal(&binding).is_err());
    assert!(
        bootstrap
            .seal(&DeploymentBinding {
                game_contract: [0; 20],
                game_runtime_hash: [4; 32]
            })
            .is_err()
    );
    let mut invalid = bootstrap.clone();
    invalid.reviewed_release = true;
    assert!(invalid.validate().is_err());
    invalid = bootstrap.clone();
    invalid.game_contract = [0x11; 20];
    assert!(invalid.validate().is_err());
    assert!(config().seal(&binding).is_err());
}

#[test]
fn completed_genuine_search_survives_transient_signing_verification_errors() {
    let c = config();
    let g = valid_game();
    let r = Request {
        game_id: g.id(c.game_contract),
        expected_ply: 1,
        expected_position_hash: g.position_hash,
        request_id: [1; 32],
        moves: e4(),
    };
    let genuine: Value = serde_json::from_str(include_str!("../evidence/end-to-end.json")).unwrap();
    let mut j = Job::new(&c, &r, 1_010);
    j.phase = "Signing".into();
    j.actual_nodes = genuine["search"]["actual_nodes"].as_u64().unwrap();
    j.depth = genuine["search"]["depth"].as_u64().unwrap() as u32;
    j.bestmove = genuine["search"]["bestmove"].as_str().unwrap().into();
    j.stop_reason = "node_budget".into();
    j.step = 240;
    j.engine_job_id = vec![7; 32];
    for message in [
        "fewerthan9 valid Robinhood head responses",
        "quorum head outcall unavailable",
        "canonical RPC outcall failed",
        "canonical block changed; retry verification",
        "signature request failed",
        "signature decode failed",
    ] {
        let before = j.clone();
        j.record_failure(message.into());
        assert_eq!(j.phase, "Signing");
        assert_eq!(j.actual_nodes, before.actual_nodes);
        assert_eq!(j.bestmove, before.bestmove);
        assert_eq!(j.step, before.step);
        assert_eq!(j.engine_job_id, before.engine_job_id);
        assert!(j.signed_move.is_none());
    }
    j.record_failure("engine module hash mismatch; no search permitted".into());
    assert_eq!(j.phase, "Faulted");
}

#[test]
fn an_under_budget_or_unbound_search_cannot_enter_signing_retry() {
    let c = config();
    let g = valid_game();
    let r = Request {
        game_id: g.id(c.game_contract),
        expected_ply: 1,
        expected_position_hash: g.position_hash,
        request_id: [1; 32],
        moves: e4(),
    };
    let mut j = Job::new(&c, &r, 1_010);
    j.phase = "Signing".into();
    j.actual_nodes = 100;
    j.record_failure("fewerthan9 valid Robinhood head responses".into());
    assert_eq!(j.phase, "Faulted");
    j.phase = "Searching".into();
    j.record_failure("engine response uncertain; reconcile durable journal".into());
    assert_eq!(j.phase, "RecoverEngine");
}
