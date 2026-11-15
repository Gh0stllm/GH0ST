use candid::Principal;
use gh0st_chess_hybrid_relay::*;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("transaction-vector.json")).unwrap()
}
fn b<const N: usize>(s: &str) -> [u8; N] {
    unhex(s).unwrap().try_into().unwrap()
}
fn signed(v: &Value) -> SignedMove {
    let m = &v["signedMove"]["move"];
    SignedMove {
        r#move: BotMove {
            game_id: b(m["game_id"].as_str().unwrap()),
            player: b(m["player"].as_str().unwrap()),
            ply: m["ply"].as_u64().unwrap() as u32,
            position_hash: b(m["position_hash"].as_str().unwrap()),
            transcript_hash: b(m["transcript_hash"].as_str().unwrap()),
            encoded_move: m["encoded_move"].as_u64().unwrap() as u16,
            engine_config_hash: b(m["engine_config_hash"].as_str().unwrap()),
            valid_until: m["valid_until"].as_u64().unwrap(),
        },
        signature: unhex(v["signedMove"]["signature"].as_str().unwrap()).unwrap(),
    }
}
fn cfg(v: &Value) -> Config {
    Config {
        coordinator: Principal::self_authenticating(b"relay-test-coordinator"),
        coordinator_module_hash: [3; 32],
        engine_config_hash: signed(v).r#move.engine_config_hash,
        game_contract: b(v["contract"].as_str().unwrap()),
        game_runtime_hash: [4; 32],
        bot_attestor: b(v["botAttestor"].as_str().unwrap()),
        rpc_url: "https://rpc.mainnet.chain.robinhood.com".into(),
        key_name: "key_1".into(),
        confirmations: 12,
        idle_poll_seconds: 15,
        max_gas_limit: 8_000_000,
        max_fee_per_gas_wei: 100_000_000,
        max_tx_cost_wei: 200_000_000_000_000,
        lifetime_gas_budget_wei: 2_500_000_000_000_000,
    }
}
fn tx(v: &Value) -> Transaction {
    Transaction {
        nonce: 17,
        max_priority_fee_per_gas: 0,
        max_fee_per_gas: 40_000_000,
        gas_limit: 2_000_000,
        to: b(v["contract"].as_str().unwrap()),
        data: calldata(&signed(v)).unwrap(),
    }
}
fn intent(v: &Value) -> Intent {
    let signed = signed(v);
    Intent {
        game_id: signed.r#move.game_id,
        ply: signed.r#move.ply,
        signed_move: signed,
        transaction: tx(v),
        raw: vec![],
        hash: [0; 32],
        phase: "Unsigned".into(),
        created_at: 1,
        broadcast_at: 0,
        broadcasts: 0,
    }
}

#[test]
fn calldata_matches_independent_ethers() {
    let v = fixture();
    assert_eq!(
        hex(&calldata(&signed(&v)).unwrap()),
        v["calldata"].as_str().unwrap()
    );
    assert_eq!(calldata(&signed(&v)).unwrap().len(), 420);
}
#[test]
fn type2_unsigned_rlp_and_digest_match_ethers() {
    let v = fixture();
    let t = tx(&v);
    assert_eq!(
        hex(&t.signing_payload()),
        v["unsignedPayload"].as_str().unwrap()
    );
    assert_eq!(hex(&t.digest()), v["signingHash"].as_str().unwrap());
}
#[test]
fn signed_rlp_hash_and_sender_match_ethers() {
    let v = fixture();
    let t = tx(&v);
    let sig = unhex(v["signature"].as_str().unwrap()).unwrap();
    let raw = t.signed(&sig).unwrap();
    assert_eq!(hex(&raw), v["serialized"].as_str().unwrap());
    assert_eq!(hex(&keccak(&raw)), v["hash"].as_str().unwrap());
    assert_eq!(
        hex(&signature_address(t.digest(), &sig).unwrap()),
        v["from"].as_str().unwrap().to_ascii_lowercase()
    );
}
#[test]
fn genuine_bot_signature_recovers_pinned_attestor() {
    let v = fixture();
    let s = signed(&v);
    assert_eq!(
        signature_address(s.r#move.digest(cfg(&v).game_contract), &s.signature).unwrap(),
        cfg(&v).bot_attestor
    );
    let mut m = s.r#move;
    m.ply += 2;
    assert_ne!(
        signature_address(m.digest(cfg(&v).game_contract), &s.signature).unwrap(),
        cfg(&v).bot_attestor
    );
}
#[test]
fn fixed_target_and_fee_budget_cannot_be_widened() {
    let v = fixture();
    let c = cfg(&v);
    c.validate().unwrap();
    let mut t = tx(&v);
    t.validate(&c, &signed(&v)).unwrap();
    t.to = [8; 20];
    assert!(t.validate(&c, &signed(&v)).is_err());
    let mut t = tx(&v);
    t.data[0] ^= 1;
    assert!(t.validate(&c, &signed(&v)).is_err());
    let mut t = tx(&v);
    t.gas_limit = 10_000_000;
    assert!(t.validate(&c, &signed(&v)).is_err());
    let mut c = c;
    c.rpc_url = "https://arbitrary.invalid".into();
    assert!(c.validate().is_err());
}
#[test]
fn durable_intent_prevents_second_nonce_and_accounts_exact_receipt() {
    let v = fixture();
    let c = cfg(&v);
    let mut s = State {
        gas_balance_wei: 1_000_000_000_000_000,
        ..State::default()
    };
    s.reserve(&c, intent(&v)).unwrap();
    assert_eq!(s.reserved_gas_wei, 80_000_000_000_000);
    assert!(s.reserve(&c, intent(&v)).is_err());
    let snap = candid::encode_one(&s).unwrap();
    let mut restored: State = candid::decode_one(&snap).unwrap();
    assert_eq!(restored.pending.as_ref().unwrap().transaction.nonce, 17);
    restored.settle(100_000, 20_000_000, true).unwrap();
    assert!(restored.pending.is_none());
    assert_eq!(restored.spent_gas_wei, 2_000_000_000_000);
    assert_eq!(restored.reserved_gas_wei, 0);
    assert_eq!(restored.completed_transactions, 1);
}
#[test]
fn reverted_or_over_limit_receipt_never_creates_replacement() {
    let v = fixture();
    let c = cfg(&v);
    let mut s = State {
        gas_balance_wei: 1_000_000_000_000_000,
        ..State::default()
    };
    s.reserve(&c, intent(&v)).unwrap();
    assert!(s.settle(2_000_001, 20_000_000, true).is_err());
    assert!(s.pending.is_some());
    s.settle(100_000, 20_000_000, false).unwrap();
    assert!(s.halted);
    assert!(!s.enabled);
    assert_eq!(s.pending.as_ref().unwrap().phase, "Reverted");
    assert!(s.reserve(&c, intent(&v)).is_err());
}
#[test]
fn lifetime_budget_and_wallet_balance_both_required() {
    let v = fixture();
    let c = cfg(&v);
    let mut s = State {
        gas_balance_wei: 1,
        ..State::default()
    };
    assert!(s.reserve(&c, intent(&v)).is_err());
    s.gas_balance_wei = u128::MAX;
    s.spent_gas_wei = c.lifetime_gas_budget_wei - 1;
    assert!(s.reserve(&c, intent(&v)).is_err());
}

#[test]
fn unchanged_concurrent_driver_replies_cannot_exhaust_turn_progress() {
    let v = fixture();
    let m = signed(&v).r#move;
    let mut turn = Turn {
        game_id: m.game_id,
        ply: m.ply,
        position_hash: m.position_hash,
        moves: vec!["e2e4".into()],
        job: None,
        uncertain: false,
        updates: 0,
    };
    let mut job = Job {
        job_id: [7; 32],
        game_id: m.game_id,
        ply: m.ply,
        position_hash: m.position_hash,
        step: 1,
        phase: "Searching".into(),
        error: None,
        actual_nodes: 0,
        requested_nodes: NODE_BUDGET,
        depth: 0,
        instructions: 0,
        stop_reason: "pending".into(),
        bestmove: String::new(),
        signed_move: None,
        engine_job_id: vec![8; 32],
        moves: turn.moves.clone(),
        game: None,
        in_flight: true,
        created_at: 1,
        updated_at: 1,
    };
    for _ in 0..500 {
        turn.record_job(&job).unwrap();
    }
    assert_eq!(turn.updates, 1);
    job.step = 2;
    job.in_flight = false;
    turn.record_job(&job).unwrap();
    assert_eq!(turn.updates, 2);
    job.step = 1;
    assert!(turn.record_job(&job).is_err());
    assert_eq!(turn.job.as_ref().unwrap().step, 2);
}
