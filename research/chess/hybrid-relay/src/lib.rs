//! Fixed-target autonomous liveness relay. The operator funds gas; the player cannot withhold a Black move.
use candid::{CandidType, Principal};
pub use gh0st_chess_hybrid_brain::{
    Address, Advance, BotMove, Game, Hash, Job, R, Request, SignedMove, aword, ethereum_address,
    ethereum_signature, hex, keccak, unhex, word,
};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use rlp::RlpStream;
use serde::{Deserialize, Serialize};

#[cfg(feature = "canister")]
mod canister;
#[cfg(feature = "canister")]
pub use canister::candid_service;
pub const CHAIN_ID: u64 = 4663;
pub const NODE_BUDGET: u64 = 24_000_000;
pub const MAX_RPC_DAY: u128 = 1_000_000_000_000;
pub const MIN_CYCLES: u128 = 2_000_000_000_000;
pub const TOKEN: &str = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
pub const BOT_MOVE_CALL: &str =
    "playBotMove((bytes32,address,uint32,bytes32,bytes32,uint16,bytes32,uint64),bytes)";

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Config {
    pub coordinator: Principal,
    pub coordinator_module_hash: Hash,
    pub engine_config_hash: Hash,
    pub game_contract: Address,
    pub game_runtime_hash: Hash,
    pub bot_attestor: Address,
    pub rpc_url: String,
    pub key_name: String,
    pub confirmations: u64,
    pub idle_poll_seconds: u64,
    pub max_gas_limit: u64,
    pub max_fee_per_gas_wei: u64,
    pub max_tx_cost_wei: u128,
    pub lifetime_gas_budget_wei: u128,
}
impl Config {
    pub fn validate(&self) -> R<()> {
        if self.coordinator == Principal::anonymous()
            || self.coordinator == Principal::management_canister()
            || self.coordinator_module_hash == [0; 32]
            || self.engine_config_hash == [0; 32]
            || self.game_contract == [0; 20]
            || self.game_runtime_hash == [0; 32]
            || self.bot_attestor == [0; 20]
            || self.rpc_url != "https://rpc.mainnet.chain.robinhood.com"
            || self.key_name != "key_1"
            || !(12..=1000).contains(&self.confirmations)
            || !(15..=120).contains(&self.idle_poll_seconds)
            || !(100_000..=32_000_000).contains(&self.max_gas_limit)
            || self.max_fee_per_gas_wei == 0
            || self.max_fee_per_gas_wei > 100_000_000
            || self.max_tx_cost_wei == 0
            || self.max_tx_cost_wei > 200_000_000_000_000
            || self.lifetime_gas_budget_wei < self.max_tx_cost_wei
            || self.lifetime_gas_budget_wei > 2_500_000_000_000_000
        {
            return Err("invalid immutable relay configuration".into());
        }
        Ok(())
    }
}

pub fn uint(data: &[u8]) -> R<u64> {
    if data.len() != 32 || data[..24].iter().any(|&b| b != 0) {
        return Err("ABI integer overflow".into());
    }
    Ok(u64::from_be_bytes(data[24..].try_into().unwrap()))
}
pub fn decode_move(m: u16) -> R<String> {
    if m >= 32768 {
        return Err("invalid move bits".into());
    }
    let from = (m >> 6) & 63;
    let to = m & 63;
    if from == to {
        return Err("zero move".into());
    }
    let mut s = String::new();
    for sq in [from, to] {
        s.push(char::from(b'a' + (sq % 8) as u8));
        s.push(char::from(b'1' + (sq / 8) as u8));
    }
    match m >> 12 {
        0 => {}
        2 => s.push('n'),
        3 => s.push('b'),
        4 => s.push('r'),
        5 => s.push('q'),
        _ => return Err("invalid promotion bits".into()),
    }
    Ok(s)
}
pub fn decode_history(data: &[u8]) -> R<Vec<String>> {
    if data.len() < 64 || uint(&data[..32])? != 32 {
        return Err("invalid history ABI offset".into());
    }
    let n = uint(&data[32..64])? as usize;
    if n > 1024 || data.len() != 64 + n * 32 {
        return Err("invalid history ABI length".into());
    }
    data[64..]
        .chunks_exact(32)
        .map(|w| {
            let n = uint(w)?;
            if n > u16::MAX as u64 {
                return Err("move overflow".into());
            }
            decode_move(n as u16)
        })
        .collect()
}
pub fn calldata(s: &SignedMove) -> R<Vec<u8>> {
    if s.signature.len() != 65 {
        return Err("invalid bot signature size".into());
    }
    let m = &s.r#move;
    let mut b = keccak(BOT_MOVE_CALL.as_bytes())[..4].to_vec();
    for w in [
        m.game_id,
        aword(m.player),
        word(m.ply as u64),
        m.position_hash,
        m.transcript_hash,
        word(m.encoded_move as u64),
        m.engine_config_hash,
        word(m.valid_until),
        word(9 * 32),
        word(65),
    ] {
        b.extend(w)
    }
    b.extend(&s.signature);
    b.resize(4 + 9 * 32 + 32 + 96, 0);
    Ok(b)
}
pub fn signature_address(hash: Hash, raw: &[u8]) -> R<Address> {
    if raw.len() != 65 {
        return Err("invalid signature size".into());
    }
    let sig = Signature::from_slice(&raw[..64]).map_err(|_| "invalid signature scalar")?;
    if sig.normalize_s().is_some() {
        return Err("noncanonical high-s signature".into());
    }
    let v = match raw[64] {
        0 | 1 => raw[64],
        27 | 28 => raw[64] - 27,
        _ => return Err("invalid signature parity".into()),
    };
    let k = VerifyingKey::recover_from_prehash(&hash, &sig, RecoveryId::from_byte(v).unwrap())
        .map_err(|_| "signature recovery failed")?;
    ethereum_address(k.to_encoded_point(true).as_bytes())
}
pub fn validate_signed(c: &Config, g: &Game, job: &Job, now: u64) -> R<SignedMove> {
    let s = job
        .signed_move
        .clone()
        .ok_or("coordinator has not signed")?;
    let m = &s.r#move;
    if job.phase != "Completed"
        || job.requested_nodes != NODE_BUDGET
        || (job.actual_nodes < NODE_BUDGET && !(job.depth >= 245 && job.stop_reason == "max_depth"))
        || job.game_id != m.game_id
        || job.ply != m.ply
        || job.position_hash != m.position_hash
        || g.result != 0
        || !g.black_to_move
        || g.id(c.game_contract) != m.game_id
        || g.ply != m.ply
        || g.player != m.player
        || g.position_hash != m.position_hash
        || g.transcript_hash != m.transcript_hash
        || m.engine_config_hash != c.engine_config_hash
        || m.valid_until > g.turn_deadline
        || now >= m.valid_until
        || job.moves.len() != g.ply as usize
        || gh0st_chess_hybrid_brain::encode_move(&job.bestmove)? != m.encoded_move
    {
        return Err("signed move is not the exact current full-budget Black turn".into());
    }
    if signature_address(m.digest(c.game_contract), &s.signature)? != c.bot_attestor {
        return Err("untrusted bot signature".into());
    }
    Ok(s)
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq)]
pub struct Transaction {
    pub nonce: u64,
    pub max_priority_fee_per_gas: u64,
    pub max_fee_per_gas: u64,
    pub gas_limit: u64,
    pub to: Address,
    pub data: Vec<u8>,
}
impl Transaction {
    fn fields(&self, s: &mut RlpStream) {
        s.append(&CHAIN_ID);
        s.append(&self.nonce);
        s.append(&self.max_priority_fee_per_gas);
        s.append(&self.max_fee_per_gas);
        s.append(&self.gas_limit);
        s.append(&self.to.as_slice());
        s.append(&0u8);
        s.append(&self.data.as_slice());
        s.begin_list(0);
    }
    pub fn signing_payload(&self) -> Vec<u8> {
        let mut s = RlpStream::new_list(9);
        self.fields(&mut s);
        let mut b = vec![2];
        b.extend(s.out());
        b
    }
    pub fn digest(&self) -> Hash {
        keccak(&self.signing_payload())
    }
    pub fn signed(&self, signature: &[u8]) -> R<Vec<u8>> {
        if signature.len() != 65 || ![27, 28].contains(&signature[64]) {
            return Err("invalid transaction signature".into());
        }
        Signature::from_slice(&signature[..64])
            .map_err(|_| "invalid transaction signature scalar")?;
        let mut s = RlpStream::new_list(12);
        self.fields(&mut s);
        s.append(&(signature[64] - 27));
        for bytes in [&signature[..32], &signature[32..64]] {
            let p = bytes
                .iter()
                .position(|&b| b != 0)
                .ok_or("zero signature scalar")?;
            s.append(&&bytes[p..]);
        }
        let mut b = vec![2];
        b.extend(s.out());
        Ok(b)
    }
    pub fn max_cost(&self) -> u128 {
        u128::from(self.gas_limit) * u128::from(self.max_fee_per_gas)
    }
    pub fn validate(&self, c: &Config, signed: &SignedMove) -> R<()> {
        if self.to != c.game_contract
            || self.data != calldata(signed)?
            || self.max_priority_fee_per_gas != 0
            || self.gas_limit < 21_000
            || self.gas_limit > c.max_gas_limit
            || self.max_fee_per_gas == 0
            || self.max_fee_per_gas > c.max_fee_per_gas_wei
            || self.max_cost() > c.max_tx_cost_wei
        {
            return Err("transaction violates fixed game/gas policy".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Turn {
    pub game_id: Hash,
    pub ply: u32,
    pub position_hash: Hash,
    pub moves: Vec<String>,
    pub job: Option<Job>,
    pub uncertain: bool,
    pub updates: u32,
}
impl Turn {
    pub fn record_job(&mut self, job: &Job) -> R<()> {
        if job.game_id != self.game_id
            || job.ply != self.ply
            || job.position_hash != self.position_hash
            || job.requested_nodes != NODE_BUDGET
            || job.moves != self.moves
        {
            return Err("coordinator job binding mismatch".into());
        }
        let progressed = if let Some(old) = &self.job {
            if job.job_id != old.job_id || job.step < old.step {
                return Err("coordinator job identity or step moved backwards".into());
            }
            job.step > old.step || job.phase != old.phase
        } else {
            true
        };
        if progressed {
            self.updates = self
                .updates
                .checked_add(1)
                .ok_or("relay progress counter exhausted")?;
            if self.updates > 300 {
                return Err("relay per-turn progress bound reached".into());
            }
        }
        self.uncertain = false;
        self.job = Some(job.clone());
        Ok(())
    }
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Intent {
    pub game_id: Hash,
    pub ply: u32,
    pub signed_move: SignedMove,
    pub transaction: Transaction,
    pub raw: Vec<u8>,
    pub hash: Hash,
    pub phase: String,
    pub created_at: u64,
    pub broadcast_at: u64,
    pub broadcasts: u32,
}
#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
pub struct State {
    pub enabled: bool,
    pub public_key: Vec<u8>,
    pub in_flight: bool,
    pub generation: u64,
    pub last_attempt: u64,
    pub last_checked_at: u64,
    pub next_tick_at: u64,
    pub gas_balance_wei: u128,
    pub spent_gas_wei: u128,
    pub reserved_gas_wei: u128,
    pub error: Option<String>,
    pub turn: Option<Turn>,
    pub pending: Option<Intent>,
    pub completed_transactions: u64,
    pub last_relayed_game: Hash,
    pub last_relayed_ply: u32,
    pub rpc_day: u64,
    pub rpc_spent: u128,
    pub halted: bool,
    pub watched_game: Hash,
}
impl State {
    pub fn remaining(&self, c: &Config) -> u128 {
        c.lifetime_gas_budget_wei
            .saturating_sub(self.spent_gas_wei)
            .saturating_sub(self.reserved_gas_wei)
    }
    pub fn reserve(&mut self, c: &Config, intent: Intent) -> R<()> {
        if self.pending.is_some() || self.halted {
            return Err("a transaction is unresolved or relay halted".into());
        }
        intent.transaction.validate(c, &intent.signed_move)?;
        let cost = intent.transaction.max_cost();
        if self.remaining(c) < cost || self.gas_balance_wei < cost {
            return Err("relay gas budget or wallet balance too low".into());
        }
        self.reserved_gas_wei = cost;
        self.pending = Some(intent);
        Ok(())
    }
    pub fn record_signature(&mut self, signature: &[u8]) -> R<()> {
        let i = self.pending.as_mut().ok_or("no transaction intent")?;
        if i.phase != "Unsigned" || !i.raw.is_empty() {
            return Err("signed intent is immutable".into());
        }
        if signature_address(i.transaction.digest(), signature)?
            != ethereum_address(&self.public_key)?
        {
            return Err("transaction signer mismatch".into());
        }
        i.raw = i.transaction.signed(signature)?;
        i.hash = keccak(&i.raw);
        i.phase = "Signed".into();
        Ok(())
    }
    pub fn settle(&mut self, gas_used: u64, effective_price: u64, success: bool) -> R<()> {
        let i = self.pending.as_ref().ok_or("no transaction intent")?;
        if gas_used > i.transaction.gas_limit || effective_price > i.transaction.max_fee_per_gas {
            return Err("receipt gas exceeds signed limit".into());
        }
        let cost = u128::from(gas_used) * u128::from(effective_price);
        if cost > self.reserved_gas_wei {
            return Err("receipt gas exceeds reserved budget".into());
        }
        self.spent_gas_wei = self
            .spent_gas_wei
            .checked_add(cost)
            .ok_or("gas accounting overflow")?;
        self.gas_balance_wei = self.gas_balance_wei.saturating_sub(cost);
        self.reserved_gas_wei = 0;
        if success {
            self.last_relayed_game = i.game_id;
            self.last_relayed_ply = i.ply;
            self.completed_transactions += 1;
            self.pending = None;
            self.turn = None;
            self.halted = false;
        } else {
            self.halted = true;
            self.enabled = false;
            self.pending.as_mut().unwrap().phase = "Reverted".into();
            self.error =
                Some("relay transaction reverted; no automatic replacement or new nonce".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoding() {
        assert_eq!(decode_move(796).unwrap(), "e2e4");
        assert_eq!(decode_move((48 << 6) | 56 | (2 << 12)).unwrap(), "a7a8n");
        assert!(decode_move(32768).is_err());
        let mut h = word(32).to_vec();
        h.extend(word(1));
        h.extend(word(796));
        assert_eq!(decode_history(&h).unwrap(), vec!["e2e4"]);
        h.push(0);
        assert!(decode_history(&h).is_err());
    }
    #[test]
    fn typed_transaction_is_not_legacy() {
        let t = Transaction {
            nonce: 0,
            max_priority_fee_per_gas: 0,
            max_fee_per_gas: 40_000_000,
            gas_limit: 250_000,
            to: [0x11; 20],
            data: vec![1, 2, 3],
        };
        let b = t.signing_payload();
        assert_eq!(b[0], 2);
        let r = rlp::Rlp::new(&b[1..]);
        assert_eq!(r.item_count().unwrap(), 9);
        assert_eq!(r.val_at::<u64>(0).unwrap(), 4663);
        assert_eq!(r.val_at::<u64>(6).unwrap(), 0);
        assert_eq!(r.val_at::<Vec<u8>>(7).unwrap(), vec![1, 2, 3]);
        assert_eq!(r.at(8).unwrap().item_count().unwrap(), 0);
    }
}
