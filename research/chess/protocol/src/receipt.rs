//! EIP-712 digest construction only. No key, signing, relay, or chain execution exists here.
use super::*;

pub const RESULT_TYPE: &str = "GameResult(bytes32 gameId,address player,bytes32 principalHash,uint256 nonce,bytes32 finalPositionHash,bytes32 transcriptHash,uint8 result,bytes32 engineConfigHash,uint64 completedAt,uint64 issuedAt,uint64 validUntil)";
const DOMAIN_TYPE: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct ResultReceipt {
    pub material: ResultMaterial,
    pub issued_at: u64,
    pub valid_until: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize, Serialize)]
pub struct ReceiptDomain {
    pub chain_id: u64,
    pub verifying_contract: Address,
}

impl Game {
    /// Adds the signing window only after verifying the exact bound entry deadlines.
    /// The caller must still verify ICP evidence before signing this material.
    pub fn unsigned_receipt(
        &self,
        issued_at: u64,
        valid_until: u64,
        now: u64,
    ) -> Result<ResultReceipt, Error> {
        let material = self.result_material().ok_or(Error::WrongPhase)?;
        if material.completed_at < self.entry.opened_at
            || material.completed_at > self.entry.game_deadline
            || issued_at < material.completed_at
            || issued_at > now
            || now > valid_until
            || valid_until > self.entry.reconciliation_deadline
        {
            return Err(Error::Expired);
        }
        Ok(ResultReceipt {
            material,
            issued_at,
            valid_until,
        })
    }
}

impl ReceiptDomain {
    pub fn separator(&self) -> Hash {
        let mut bytes = Vec::with_capacity(160);
        bytes.extend(keccak(DOMAIN_TYPE.as_bytes()));
        bytes.extend(keccak(b"GH0ST RH Chess Challenge"));
        bytes.extend(keccak(b"1"));
        bytes.extend(word(self.chain_id));
        bytes.extend(address_word(self.verifying_contract));
        keccak(&bytes)
    }
}

impl ResultReceipt {
    pub fn struct_hash(&self) -> Hash {
        let m = &self.material;
        let mut bytes = Vec::with_capacity(384);
        bytes.extend(keccak(RESULT_TYPE.as_bytes()));
        bytes.extend(m.game_id);
        bytes.extend(address_word(m.player));
        bytes.extend(m.principal_hash);
        bytes.extend(m.nonce);
        bytes.extend(m.final_position_hash);
        bytes.extend(m.transcript_hash);
        bytes.extend(word(m.result as u64));
        bytes.extend(m.engine_config_hash);
        bytes.extend(word(m.completed_at));
        bytes.extend(word(self.issued_at));
        bytes.extend(word(self.valid_until));
        keccak(&bytes)
    }

    pub fn digest(&self, domain: &ReceiptDomain) -> Hash {
        let mut bytes = vec![0x19, 0x01];
        bytes.extend(domain.separator());
        bytes.extend(self.struct_hash());
        keccak(&bytes)
    }
}

fn word(value: u64) -> Hash {
    let mut out = [0; 32];
    out[24..].copy_from_slice(&value.to_be_bytes());
    out
}
fn address_word(value: Address) -> Hash {
    let mut out = [0; 32];
    out[12..].copy_from_slice(&value);
    out
}
pub fn keccak(bytes: &[u8]) -> Hash {
    Keccak256::digest(bytes).into()
}
