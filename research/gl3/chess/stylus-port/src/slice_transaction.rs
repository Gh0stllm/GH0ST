//! Mode 5 of the one-move contract. The stored head commits the exact
//! interpreter state, so neither its stack nor its intermediate results
//! may be supplied by a caller without matching the previous transaction.

use crate::checkpoint_tree::{Digest, Keccak};
use crate::interpreter::slice_group::{Continuation, SliceHead};
use crate::interpreter::sliced_guest::DRIVER_STATE_BYTES;
use crate::transaction::{
    authenticate_config, decode_checkpoint, encode_header, Config, InputError, CHECKPOINT_BYTES,
};
use crate::witness_wire::TRANSACTION_BYTES;

pub const ADVANCE_SLICE: u8 = 5;
pub const SLICE_HEAD_BYTES: usize = CHECKPOINT_BYTES + 8 + 32;
pub const MAX_SLICE_BUDGET: u64 = 1_000_000;
pub const MAX_MACHINE_BYTES: usize = u16::MAX as usize;

const EMPTY: Digest = [0; 32];
const BUDGET_AND_LENGTH_BYTES: usize = 6;

pub struct SliceAdvance<'a> {
    pub config: Config<'a>,
    pub prior: SliceHead,
    pub continuation: Option<Continuation<'a>>,
    pub witness: &'a [u8],
    pub instruction_budget: u64,
    pub trusted_head: Digest,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SliceInputError {
    Length,
    Opcode,
    Budget,
    Input(InputError),
    WrongHead,
    WrongContinuation,
}

/// Mode, u16 config length, config, slice head, u32 instruction budget,
/// u16 snapshot length, optional 44-byte driver and snapshot, inline witness.
/// All integer fields are big endian.
pub fn decode_slice<'a>(
    hash: &mut impl Keccak,
    raw: &'a [u8],
    stored_config: Digest,
    stored_checkpoint: Digest,
) -> Result<SliceAdvance<'a>, SliceInputError> {
    if raw.len() >= TRANSACTION_BYTES || raw.len() < 3 + SLICE_HEAD_BYTES + BUDGET_AND_LENGTH_BYTES
    {
        return Err(SliceInputError::Length);
    }
    if raw[0] != ADVANCE_SLICE {
        return Err(SliceInputError::Opcode);
    }
    let config_len = u16::from_be_bytes(raw[1..3].try_into().unwrap()) as usize;
    let (config, remaining) = raw[3..]
        .split_at_checked(config_len)
        .ok_or(SliceInputError::Length)?;
    let (head, remaining) = remaining
        .split_at_checked(SLICE_HEAD_BYTES)
        .ok_or(SliceInputError::Length)?;
    let (sizing, remaining) = remaining
        .split_at_checked(BUDGET_AND_LENGTH_BYTES)
        .ok_or(SliceInputError::Length)?;
    let instruction_budget = u64::from(u32::from_be_bytes(sizing[..4].try_into().unwrap()));
    if !(1..=MAX_SLICE_BUDGET).contains(&instruction_budget) {
        return Err(SliceInputError::Budget);
    }
    let machine_len = u16::from_be_bytes(sizing[4..].try_into().unwrap()) as usize;
    let config =
        authenticate_config(hash, config, stored_config).map_err(SliceInputError::Input)?;
    let prior = SliceHead {
        checkpoint: decode_checkpoint(&head[..CHECKPOINT_BYTES], stored_config, config.job)
            .map_err(SliceInputError::Input)?,
        instructions: u64::from_be_bytes(
            head[CHECKPOINT_BYTES..CHECKPOINT_BYTES + 8]
                .try_into()
                .unwrap(),
        ),
        continuation: head[CHECKPOINT_BYTES + 8..].try_into().unwrap(),
    };
    let trusted_head = prior.commitment(hash);
    // The first slice may consume the existing constructor's quiescent head.
    // A successful slice switches the slot permanently to the slice domain.
    if stored_checkpoint == EMPTY
        || (trusted_head != stored_checkpoint
            && !(prior == SliceHead::initial(prior.checkpoint)
                && prior.checkpoint.cursor.quanta == 0
                && prior.checkpoint.commitment(hash) == stored_checkpoint))
    {
        return Err(SliceInputError::WrongHead);
    }

    let (continuation, witness) = if machine_len == 0 {
        if prior.continuation != EMPTY {
            return Err(SliceInputError::WrongContinuation);
        }
        (None, remaining)
    } else {
        let (data, witness) = remaining
            .split_at_checked(DRIVER_STATE_BYTES + machine_len)
            .ok_or(SliceInputError::Length)?;
        let continuation = Continuation {
            driver: data[..DRIVER_STATE_BYTES].try_into().unwrap(),
            machine: &data[DRIVER_STATE_BYTES..],
        };
        if prior.continuation == EMPTY || continuation.commitment(hash) != prior.continuation {
            return Err(SliceInputError::WrongContinuation);
        }
        (Some(continuation), witness)
    };
    Ok(SliceAdvance {
        config,
        prior,
        continuation,
        witness,
        instruction_budget,
        trusted_head,
    })
}

pub fn encode_slice_head(head: &SliceHead) -> [u8; SLICE_HEAD_BYTES] {
    let mut bytes = [0; SLICE_HEAD_BYTES];
    bytes[..CHECKPOINT_BYTES].copy_from_slice(&encode_header(&head.checkpoint));
    bytes[CHECKPOINT_BYTES..CHECKPOINT_BYTES + 8].copy_from_slice(&head.instructions.to_be_bytes());
    bytes[CHECKPOINT_BYTES + 8..].copy_from_slice(&head.continuation);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    use alloc::{vec, vec::Vec};
    use tiny_keccak::Hasher;

    use crate::resume::Checkpoint;
    use crate::rom::SHARD_RECORD_BYTES;
    use crate::search::Cursor;
    use crate::transaction::{CONFIG_HEADER_BYTES, CORE_SHARDS};

    struct TestKeccak;

    impl Keccak for TestKeccak {
        fn digest(&mut self, bytes: &[u8]) -> Digest {
            let mut hasher = tiny_keccak::Keccak::v256();
            let mut out = [0; 32];
            hasher.update(bytes);
            hasher.finalize(&mut out);
            out
        }
    }

    fn fixture() -> (Vec<u8>, SliceHead) {
        let mut config = vec![0; CONFIG_HEADER_BYTES + (CORE_SHARDS + 1) * SHARD_RECORD_BYTES];
        config[..4].copy_from_slice(b"GSC1");
        config[4..36].copy_from_slice(&[1; 32]);
        config[36..40].copy_from_slice(&1u32.to_be_bytes());
        config[40..42].copy_from_slice(&4u16.to_be_bytes());
        config.extend_from_slice(b"e2e4");
        let head = SliceHead::initial(Checkpoint {
            engine_identity: TestKeccak.digest(&config),
            job_identity: [1; 32],
            memory_root: [2; 32],
            cursor: Cursor::default(),
            globals: [0; 3],
            memory_bytes: 65_536,
            complete: false,
        });
        (config, head)
    }

    fn packet(
        config: &[u8],
        head: &SliceHead,
        budget: u32,
        continuation: Option<Continuation<'_>>,
    ) -> Vec<u8> {
        let mut packet = vec![ADVANCE_SLICE];
        packet.extend_from_slice(&(config.len() as u16).to_be_bytes());
        packet.extend_from_slice(config);
        packet.extend_from_slice(&encode_slice_head(head));
        packet.extend_from_slice(&budget.to_be_bytes());
        let machine_len = continuation.map_or(0, |state| state.machine.len() as u16);
        packet.extend_from_slice(&machine_len.to_be_bytes());
        if let Some(state) = continuation {
            packet.extend_from_slice(state.driver);
            packet.extend_from_slice(state.machine);
        }
        packet.extend_from_slice(b"GW0100");
        packet
    }

    #[test]
    fn first_slice_can_bind_the_existing_constructor_checkpoint() {
        let (config, head) = fixture();
        let stored = head.checkpoint.commitment(&mut TestKeccak);
        let config_hash = head.checkpoint.engine_identity;
        let wire = packet(&config, &head, 10_000, None);
        let decoded = decode_slice(&mut TestKeccak, &wire, config_hash, stored).unwrap();
        assert_eq!(decoded.prior, head);
        assert_eq!(decoded.config.history, b"e2e4");
        assert_eq!(decoded.witness, b"GW0100");
        assert_eq!(decoded.instruction_budget, 10_000);
        assert_ne!(decoded.trusted_head, stored);
        let invalid_budget = packet(&config, &head, MAX_SLICE_BUDGET as u32 + 1, None);
        assert_eq!(
            decode_slice(&mut TestKeccak, &invalid_budget, config_hash, stored).err(),
            Some(SliceInputError::Budget)
        );
    }

    #[test]
    fn resumed_slice_requires_both_the_latest_head_and_exact_frames() {
        let (config, mut head) = fixture();
        let config_hash = head.checkpoint.engine_identity;
        let old_constructor_head = head.checkpoint.commitment(&mut TestKeccak);
        let driver = [3; DRIVER_STATE_BYTES];
        let machine = [4; 24];
        let context = Continuation {
            driver: &driver,
            machine: &machine,
        };
        head.instructions = 10_000;
        head.continuation = context.commitment(&mut TestKeccak);
        let stored = head.commitment(&mut TestKeccak);
        let wire = packet(&config, &head, 5_000, Some(context));
        let decoded = decode_slice(&mut TestKeccak, &wire, config_hash, stored).unwrap();
        let frame = decoded.continuation.unwrap();
        assert_eq!(frame.driver, &driver);
        assert_eq!(frame.machine, machine);
        assert_eq!(
            decode_slice(&mut TestKeccak, &wire, config_hash, old_constructor_head).err(),
            Some(SliceInputError::WrongHead)
        );
        let mut corrupted = wire;
        let index = corrupted.len() - b"GW0100".len() - 1;
        corrupted[index] ^= 1;
        assert_eq!(
            decode_slice(&mut TestKeccak, &corrupted, config_hash, stored).err(),
            Some(SliceInputError::WrongContinuation)
        );
    }
}
