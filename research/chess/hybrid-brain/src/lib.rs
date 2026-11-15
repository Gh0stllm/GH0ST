//! RH is game authority. ICP verifies a canonical position, searches it, and signs only a Black move.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sha3::Keccak256;
use shakmaty::{Chess, Color, EnPassantMode, Position, Role, fen::Fen, uci::UciMove};

#[cfg(feature = "canister")]
mod canister;
#[cfg(feature = "canister")]
pub use canister::candid_service;
pub type Hash = [u8; 32];
pub type Address = [u8; 20];
pub type R<T> = Result<T, String>;
pub const STOCKFISH_COMMIT: &str = "edb0d9db6731067ec50ce619ff372b463bc4dd5d";
pub const NNUE_SHA256: &str = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2";
pub const INITIAL_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
pub const NODES: u64 = 24_000_000;
pub const HASH_MB: u32 = 128;
pub const MAX_PLIES: usize = 1024;
pub const MAX_JOBS: u64 = 512;
pub const TOKEN: &str = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
pub const BOT_MOVE_TYPE: &str = "BotMove(bytes32 gameId,address player,uint32 ply,bytes32 positionHash,bytes32 transcriptHash,uint16 encodedMove,bytes32 engineConfigHash,uint64 validUntil)";

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Config {
    pub engine_canister: Principal,
    pub engine_module_hash: Hash,
    pub game_contract: Address,
    pub game_runtime_hash: Hash,
    pub rpc_url: String,
    pub confirmations: u64,
    pub key_name: String,
    pub reviewed_release: bool,
}
impl Config {
    pub fn validate(&self) -> R<()> {
        let unbound = self.game_contract == [0; 20] && self.game_runtime_hash == [0; 32];
        let partially_bound =
            (self.game_contract == [0; 20]) != (self.game_runtime_hash == [0; 32]);
        if self.engine_canister == Principal::anonymous()
            || self.engine_canister == Principal::management_canister()
            || self.engine_module_hash == [0; 32]
            || partially_bound
            || (unbound && self.reviewed_release)
            || self.rpc_url != "https://rpc.mainnet.chain.robinhood.com"
            || self.confirmations < 12
            || self.confirmations > 1000
            || !["key_1", "test_key_1", "dfx_test_key"].contains(&self.key_name.as_str())
        {
            return Err("invalid immutable configuration".into());
        }
        Ok(())
    }
    /// Bootstrap can derive a canister-owned signer before the EVM constructor is mined.
    /// The only subsequent configuration transition binds that reviewed deployment once.
    pub fn seal(&self, binding: &DeploymentBinding) -> R<Self> {
        if self.reviewed_release
            || self.game_contract != [0; 20]
            || self.game_runtime_hash != [0; 32]
        {
            return Err("deployment is already bound; rebinding is forbidden".into());
        }
        if binding.game_contract == [0; 20] || binding.game_runtime_hash == [0; 32] {
            return Err("deployment binding must be nonzero".into());
        }
        let mut sealed = self.clone();
        sealed.game_contract = binding.game_contract;
        sealed.game_runtime_hash = binding.game_runtime_hash;
        sealed.reviewed_release = true;
        sealed.validate()?;
        Ok(sealed)
    }
    pub fn engine_hash(&self) -> Hash {
        let mut b = b"GH0ST_ENGINE_CONFIG_V2_RETAINED\0".to_vec();
        field(&mut b, self.engine_canister.as_slice());
        field(&mut b, STOCKFISH_COMMIT.as_bytes());
        field(&mut b, NNUE_SHA256.as_bytes());
        b.extend(NODES.to_be_bytes());
        b.extend(HASH_MB.to_be_bytes());
        // Threads=1, skill=20, strength limiting=false, MultiPV=1, retained within game=true.
        b.extend([1, 20, 0, 1, 1]);
        Sha256::digest(b).into()
    }
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct DeploymentBinding {
    pub game_contract: Address,
    pub game_runtime_hash: Hash,
}
fn field(b: &mut Vec<u8>, v: &[u8]) {
    b.extend((v.len() as u32).to_be_bytes());
    b.extend(v);
}
pub fn keccak(v: &[u8]) -> Hash {
    Keccak256::digest(v).into()
}
pub fn word(v: u64) -> Hash {
    let mut w = [0; 32];
    w[24..].copy_from_slice(&v.to_be_bytes());
    w
}
pub fn aword(a: Address) -> Hash {
    let mut w = [0; 32];
    w[12..].copy_from_slice(&a);
    w
}
pub fn hex(v: &[u8]) -> String {
    let mut s = String::from("0x");
    for b in v {
        use std::fmt::Write;
        write!(s, "{b:02x}").unwrap();
    }
    s
}
pub fn unhex(s: &str) -> R<Vec<u8>> {
    let s = s.strip_prefix("0x").ok_or("missing hex prefix")?;
    if s.len() % 2 != 0 || s.len() > 131072 {
        return Err("invalid hex size".into());
    }
    s.as_bytes()
        .chunks_exact(2)
        .map(|c| {
            let a = (c[0] as char).to_digit(16).ok_or("invalid hex")?;
            let b = (c[1] as char).to_digit(16).ok_or("invalid hex")?;
            Ok((a * 16 + b) as u8)
        })
        .collect()
}
fn fixed<const N: usize>(v: &[u8]) -> R<[u8; N]> {
    v.try_into().map_err(|_| "invalid fixed bytes".into())
}
fn uint(w: &[u8]) -> R<u64> {
    if w.len() != 32 || w[..24].iter().any(|&b| b != 0) {
        return Err("integer overflow".into());
    }
    Ok(u64::from_be_bytes(fixed(&w[24..])?))
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq)]
pub struct Game {
    pub player: Address,
    pub nonce: Hash,
    pub opened_at: u64,
    pub turn_deadline: u64,
    pub result: u8,
    pub ply: u32,
    pub position_hash: Hash,
    pub transcript_hash: Hash,
    pub board: Hash,
    pub castling: u8,
    pub en_passant: u8,
    pub halfmove_clock: u16,
    pub black_to_move: bool,
}
impl Game {
    pub fn decode(data: &[u8]) -> R<Self> {
        if data.len() != 13 * 32 {
            return Err("unexpected game ABI length".into());
        }
        let w: Vec<&[u8]> = data.chunks_exact(32).collect();
        if w[0][..12].iter().any(|&x| x != 0) {
            return Err("invalid ABI address".into());
        }
        Ok(Self {
            player: fixed(&w[0][12..])?,
            nonce: fixed(w[1])?,
            opened_at: uint(w[2])?,
            turn_deadline: uint(w[3])?,
            result: uint(w[4])?.try_into().map_err(|_| "result overflow")?,
            ply: uint(w[5])?.try_into().map_err(|_| "ply overflow")?,
            position_hash: fixed(w[6])?,
            transcript_hash: fixed(w[7])?,
            board: fixed(w[8])?,
            castling: uint(w[9])?.try_into().map_err(|_| "castling overflow")?,
            en_passant: uint(w[10])?.try_into().map_err(|_| "EP overflow")?,
            halfmove_clock: uint(w[11])?.try_into().map_err(|_| "clock overflow")?,
            black_to_move: match uint(w[12])? {
                0 => false,
                1 => true,
                _ => return Err("invalid bool".into()),
            },
        })
    }
    pub fn id(&self, contract: Address) -> Hash {
        keccak(&[word(4663), aword(contract), aword(self.player), self.nonce].concat())
    }
}

/// Independently replay every move; compare the exact RH board, raw EP field and commitment.
pub fn replay(moves: &[String]) -> R<(Chess, Hash, Hash, u8, u8)> {
    if moves.len() > MAX_PLIES {
        return Err("history bound exceeded".into());
    }
    let mut chess = Chess::default();
    let mut transcript = keccak(b"GH0ST_CHESS_INITIAL_V1");
    for text in moves {
        let u: UciMove = text.parse().map_err(|_| "invalid UCI move")?;
        if u.to_string() != *text {
            return Err("noncanonical UCI".into());
        }
        let m = u.to_move(&chess).map_err(|_| "illegal history move")?;
        let encoded = encode_move(text)?;
        transcript = keccak(&[transcript, word(u64::from(encoded))].concat());
        chess.play_unchecked(m);
    }
    let mut board = [0u8; 32];
    for (sq, piece) in chess.board().iter() {
        let r = match piece.role {
            Role::Pawn => 1,
            Role::Knight => 2,
            Role::Bishop => 3,
            Role::Rook => 4,
            Role::Queen => 5,
            Role::King => 6,
        };
        let n = r + if piece.color == Color::Black { 8 } else { 0 };
        let sq = usize::from(sq);
        board[31 - sq / 2] |= n << ((sq % 2) * 4);
    }
    let fen = Fen::from_position(&chess, EnPassantMode::Always).to_string();
    let f: Vec<_> = fen.split(' ').collect();
    let castling = (f[2].contains('K') as u8)
        | ((f[2].contains('Q') as u8) << 1)
        | ((f[2].contains('k') as u8) << 2)
        | ((f[2].contains('q') as u8) << 3);
    let ep = if f[3] == "-" {
        64
    } else {
        square(f[3].as_bytes())?
    };
    let position = keccak(
        &[
            board,
            word(castling as u64),
            word(ep as u64),
            word((chess.turn() == Color::Black) as u64),
        ]
        .concat(),
    );
    Ok((chess, transcript, position, castling, ep))
}
fn square(b: &[u8]) -> R<u8> {
    if b.len() != 2 || !(b'a'..=b'h').contains(&b[0]) || !(b'1'..=b'8').contains(&b[1]) {
        Err("invalid square".into())
    } else {
        Ok(b[0] - b'a' + 8 * (b[1] - b'1'))
    }
}
pub fn encode_move(s: &str) -> R<u16> {
    let b = s.as_bytes();
    if b.len() != 4 && b.len() != 5 {
        return Err("invalid UCI size".into());
    }
    let promotion = if b.len() == 5 {
        match b[4] {
            b'n' => 2,
            b'b' => 3,
            b'r' => 4,
            b'q' => 5,
            _ => return Err("invalid promotion".into()),
        }
    } else {
        0
    };
    Ok((u16::from(square(&b[..2])?) << 6) | u16::from(square(&b[2..4])?) | (promotion << 12))
}
pub fn verify_game(cfg: &Config, id: Hash, game: &Game, moves: &[String], now: u64) -> R<()> {
    if game.id(cfg.game_contract) != id
        || game.player == [0; 20]
        || game.result != 0
        || !game.black_to_move
        || game.ply as usize != moves.len()
        || game.ply % 2 != 1
        || now >= game.turn_deadline
        || game.opened_at > now
    {
        return Err("game not a current paid Black turn".into());
    }
    let (chess, transcript, position, castling, ep) = replay(moves)?;
    if transcript != game.transcript_hash
        || position != game.position_hash
        || castling != game.castling
        || ep != game.en_passant
        || chess.halfmoves() != u32::from(game.halfmove_clock)
        || chess.turn() != Color::Black
        || chess.is_game_over()
    {
        return Err("canonical history/board mismatch".into());
    }
    // Position hash from canonical raw board must also equal the independently replayed hash.
    if keccak(
        &[
            game.board,
            word(game.castling as u64),
            word(game.en_passant as u64),
            word(1),
        ]
        .concat(),
    ) != position
    {
        return Err("board ABI mismatch".into());
    }
    Ok(())
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq)]
pub struct BotMove {
    pub game_id: Hash,
    pub player: Address,
    pub ply: u32,
    pub position_hash: Hash,
    pub transcript_hash: Hash,
    pub encoded_move: u16,
    pub engine_config_hash: Hash,
    pub valid_until: u64,
}
impl BotMove {
    pub fn digest(&self, contract: Address) -> Hash {
        let domain=keccak(&[keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak(b"GH0ST Hybrid Chess"),keccak(b"1"),word(4663),aword(contract)].concat());
        let body = keccak(
            &[
                keccak(BOT_MOVE_TYPE.as_bytes()),
                self.game_id,
                aword(self.player),
                word(self.ply as u64),
                self.position_hash,
                self.transcript_hash,
                word(self.encoded_move as u64),
                self.engine_config_hash,
                word(self.valid_until),
            ]
            .concat(),
        );
        keccak(&[&[0x19, 0x01][..], &domain, &body].concat())
    }
}
pub fn ethereum_address(key: &[u8]) -> R<Address> {
    let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(key).map_err(|_| "invalid public key")?;
    fixed(&keccak(&key.to_encoded_point(false).as_bytes()[1..])[12..])
}
pub fn ethereum_signature(hash: Hash, raw: &[u8], key: &[u8]) -> R<Vec<u8>> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let sig = Signature::from_slice(raw).map_err(|_| "invalid ECDSA signature")?;
    let sig = sig.normalize_s().unwrap_or(sig);
    let expected = VerifyingKey::from_sec1_bytes(key).map_err(|_| "invalid public key")?;
    for v in 0..2 {
        let rec = RecoveryId::from_byte(v).unwrap();
        if VerifyingKey::recover_from_prehash(&hash, &sig, rec)
            .ok()
            .as_ref()
            == Some(&expected)
        {
            let mut b = sig.to_bytes().to_vec();
            b.push(v + 27);
            return Ok(b);
        }
    }
    Err("ECDSA signature cannot recover pinned signer".into())
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Request {
    pub game_id: Hash,
    pub expected_ply: u32,
    pub expected_position_hash: Hash,
    pub request_id: Hash,
    pub moves: Vec<String>,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Advance {
    pub job_id: Hash,
    pub expected_step: u32,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct SignedMove {
    pub r#move: BotMove,
    pub signature: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Job {
    pub job_id: Hash,
    pub game_id: Hash,
    pub ply: u32,
    pub position_hash: Hash,
    pub step: u32,
    pub phase: String,
    pub error: Option<String>,
    pub actual_nodes: u64,
    pub requested_nodes: u64,
    pub depth: u32,
    pub instructions: u64,
    pub stop_reason: String,
    pub bestmove: String,
    pub signed_move: Option<SignedMove>,
    pub engine_job_id: Vec<u8>,
    pub moves: Vec<String>,
    pub game: Option<Game>,
    pub in_flight: bool,
    pub created_at: u64,
    pub updated_at: u64,
}
impl Job {
    pub fn new(cfg: &Config, r: &Request, now: u64) -> Self {
        let id = Sha256::digest(
            [
                b"GH0ST_HYBRID_JOB_V1".as_slice(),
                &r.game_id,
                &r.expected_ply.to_be_bytes(),
                &r.expected_position_hash,
                &cfg.engine_hash(),
            ]
            .concat(),
        )
        .into();
        Self {
            job_id: id,
            game_id: r.game_id,
            ply: r.expected_ply,
            position_hash: r.expected_position_hash,
            step: 0,
            phase: "Verifying".into(),
            error: None,
            actual_nodes: 0,
            requested_nodes: NODES,
            depth: 0,
            instructions: 0,
            stop_reason: String::new(),
            bestmove: String::new(),
            signed_move: None,
            engine_job_id: vec![],
            moves: r.moves.clone(),
            game: None,
            in_flight: false,
            created_at: now,
            updated_at: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn moves(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_owned).collect()
    }
    #[test]
    fn encoding() {
        assert_eq!(encode_move("e2e4").unwrap(), 796);
        assert_eq!(encode_move("a7a8n").unwrap(), (48 << 6) | 56 | (2 << 12));
        assert!(encode_move("a7a8k").is_err());
        assert!(encode_move("i2e4").is_err());
    }
    #[test]
    fn illegal_history() {
        assert!(replay(&moves("e2e5")).is_err());
        assert!(replay(&moves("e2e4 e7e5 e1e3")).is_err());
    }
    #[test]
    fn ep_and_castle() {
        let (p, _, _, rights, ep) = replay(&moves("e2e4")).unwrap();
        assert_eq!(ep, 20);
        assert_eq!(rights, 15);
        assert_eq!(p.turn(), Color::Black);
        let (_, _, _, r, _) = replay(&moves("e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1")).unwrap();
        assert_eq!(r, 12);
    }
    #[test]
    fn legal_en_passant() {
        assert!(replay(&moves("e2e4 a7a6 e4e5 d7d5 e5d6")).is_ok());
    }
    #[test]
    fn transcript_commits_history() {
        let (_, a, pa, _, _) = replay(&moves("g1f3 g8f6 f3g1 f6g8")).unwrap();
        let (_, b, pb, _, _) = replay(&[]).unwrap();
        assert_eq!(pa, pb);
        assert_ne!(a, b);
    }
    #[test]
    fn mate() {
        let (p, _, _, _, _) = replay(&moves("f2f3 e7e5 g2g4 d8h4")).unwrap();
        assert!(p.is_checkmate());
    }
    #[test]
    fn signature() {
        use k256::ecdsa::SigningKey;
        let k = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
        let h = keccak(b"test");
        let (s, _) = k.sign_prehash_recoverable(&h).unwrap();
        let p = k.verifying_key().to_encoded_point(true);
        let b = ethereum_signature(h, &s.to_bytes(), p.as_bytes()).unwrap();
        assert_eq!(b.len(), 65);
        assert!([27, 28].contains(&b[64]));
        assert!(ethereum_signature(keccak(b"other"), &s.to_bytes(), p.as_bytes()).is_err());
    }
    #[test]
    fn game_decode_bounds() {
        assert!(Game::decode(&[0; 12 * 32]).is_err());
        let mut b = vec![0; 13 * 32];
        b[12 * 32 + 31] = 2;
        assert!(Game::decode(&b).is_err());
    }
    #[test]
    fn hex_bounds() {
        assert_eq!(unhex("0x0011ff").unwrap(), vec![0, 17, 255]);
        assert!(unhex("0x0").is_err());
        assert!(unhex("0xzz").is_err());
    }
}
