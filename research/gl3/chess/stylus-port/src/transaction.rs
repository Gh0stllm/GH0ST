//! Inputs for the isolated one-move Stylus contract. The stored configuration
//! binds the executable, initialized archive and game history before a caller's
//! checkpoint or page proof is interpreted.

use crate::checkpoint_tree::{Digest, Keccak};
use crate::resume::Checkpoint;
use crate::rom::{Shard, PAYLOAD_BYTES, SHARD_RECORD_BYTES};
use crate::search::{Cursor, QUANTA_PER_TRANSACTION};
use crate::witness_wire::{CODE_WITNESS_BYTES, TRANSACTION_BYTES};

pub const CONFIG_SLOT: Digest = [0x6c; 32];
pub const CHECKPOINT_SLOT: Digest = [0x6d; 32];
pub const CORE_SHARDS: usize = 51;
pub const CONFIG_HEADER_BYTES: usize = 42;
pub const CHECKPOINT_BYTES: usize = 72;
const ADVANCE: u8 = 1;
const ADVANCE_FROM_CODE: u8 = 2;
const ADVANCE_SHORT: u8 = 3;
const ADVANCE_SHORT_FROM_CODE: u8 = 4;

pub struct Config<'a> {
    pub job: Digest,
    pub archive_bytes: u32,
    pub history: &'a [u8],
    pub core: &'a [u8],
    pub archive_directory: &'a [u8],
    pub archive_directory_bytes: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InputError {
    Length,
    Opcode,
    GroupSize,
    BadConfig,
    UnauthorizedConfig,
    BadCheckpoint,
    StaleCheckpoint,
}

pub struct Advance<'a> {
    pub config: Config<'a>,
    pub prior: Checkpoint,
    pub witness: AdvanceWitness<'a>,
    pub quanta: u32,
}

pub enum AdvanceWitness<'a> {
    Inline(&'a [u8]),
    Code { bytes: u32, manifest: &'a [u8] },
}

pub fn decode_advance<'a>(
    hash: &mut impl Keccak,
    raw: &'a [u8],
    stored_config: Digest,
    stored_checkpoint: Digest,
) -> Result<Advance<'a>, InputError> {
    if raw.len() >= TRANSACTION_BYTES || raw.len() < 3 + CONFIG_HEADER_BYTES + CHECKPOINT_BYTES {
        return Err(InputError::Length);
    }
    let (prefix_bytes, quanta) = match raw[0] {
        ADVANCE | ADVANCE_FROM_CODE => (1, QUANTA_PER_TRANSACTION),
        ADVANCE_SHORT | ADVANCE_SHORT_FROM_CODE => (2, u32::from(raw[1])),
        _ => return Err(InputError::Opcode),
    };
    if !(1..=QUANTA_PER_TRANSACTION).contains(&quanta) {
        return Err(InputError::GroupSize);
    }
    let config_size_end = prefix_bytes + 2;
    let config_bytes = usize::from(u16::from_be_bytes(
        raw[prefix_bytes..config_size_end].try_into().unwrap(),
    ));
    let (config, remaining) = raw[config_size_end..]
        .split_at_checked(config_bytes)
        .ok_or(InputError::Length)?;
    let (checkpoint, witness) = remaining
        .split_at_checked(CHECKPOINT_BYTES)
        .ok_or(InputError::Length)?;
    let config = authenticate_config(hash, config, stored_config)?;
    let prior = decode_checkpoint(checkpoint, stored_config, config.job)?;
    if stored_checkpoint == [0; 32] || prior.commitment(hash) != stored_checkpoint {
        return Err(InputError::StaleCheckpoint);
    }
    let witness = if matches!(raw[0], ADVANCE | ADVANCE_SHORT) {
        AdvanceWitness::Inline(witness)
    } else {
        let (size, manifest) = witness.split_at_checked(4).ok_or(InputError::Length)?;
        let bytes = u32::from_be_bytes(size.try_into().unwrap());
        let length = bytes as usize;
        if !(6..=CODE_WITNESS_BYTES).contains(&length)
            || manifest.len() != length.div_ceil(PAYLOAD_BYTES) * SHARD_RECORD_BYTES
        {
            return Err(InputError::Length);
        }
        AdvanceWitness::Code { bytes, manifest }
    };
    Ok(Advance {
        config,
        prior,
        witness,
        quanta,
    })
}

pub(crate) fn authenticate_config<'a>(
    hash: &mut impl Keccak,
    config: &'a [u8],
    stored_config: Digest,
) -> Result<Config<'a>, InputError> {
    if stored_config == [0; 32] || hash.digest(config) != stored_config {
        return Err(InputError::UnauthorizedConfig);
    }
    Config::parse(config)
}

pub(crate) fn decode_checkpoint(
    checkpoint: &[u8],
    engine: Digest,
    job: Digest,
) -> Result<Checkpoint, InputError> {
    if checkpoint.len() != CHECKPOINT_BYTES {
        return Err(InputError::Length);
    }
    let prior = Checkpoint {
        engine_identity: engine,
        job_identity: job,
        memory_root: checkpoint[..32].try_into().unwrap(),
        cursor: Cursor {
            quanta: u32::from_be_bytes(checkpoint[32..36].try_into().unwrap()),
            observed_nodes: u64::from_be_bytes(checkpoint[36..44].try_into().unwrap()),
        },
        globals: core::array::from_fn(|i| {
            let start = 44 + i * 8;
            u64::from_be_bytes(checkpoint[start..start + 8].try_into().unwrap())
        }),
        memory_bytes: u32::from_be_bytes(checkpoint[68..72].try_into().unwrap()),
        complete: false,
    };
    if !prior.valid() {
        return Err(InputError::BadCheckpoint);
    }
    Ok(prior)
}

impl<'a> Config<'a> {
    fn parse(raw: &'a [u8]) -> Result<Self, InputError> {
        let (header, data) = raw
            .split_at_checked(CONFIG_HEADER_BYTES)
            .ok_or(InputError::BadConfig)?;
        if &header[..4] != b"GSC1" {
            return Err(InputError::BadConfig);
        }
        let job = header[4..36].try_into().unwrap();
        let archive_bytes = u32::from_be_bytes(header[36..40].try_into().unwrap());
        let history_bytes = usize::from(u16::from_be_bytes(header[40..42].try_into().unwrap()));
        if job == [0; 32] || archive_bytes == 0 || !(1..=8192).contains(&history_bytes) {
            return Err(InputError::BadConfig);
        }
        let directory_bytes = (archive_bytes as usize).div_ceil(PAYLOAD_BYTES) * SHARD_RECORD_BYTES;
        let directory_shards = directory_bytes.div_ceil(PAYLOAD_BYTES);
        let (core, data) = data
            .split_at_checked(CORE_SHARDS * SHARD_RECORD_BYTES)
            .ok_or(InputError::BadConfig)?;
        let (archive_directory, history) = data
            .split_at_checked(directory_shards * SHARD_RECORD_BYTES)
            .ok_or(InputError::BadConfig)?;
        if history.len() != history_bytes {
            return Err(InputError::BadConfig);
        }
        Ok(Self {
            job,
            archive_bytes,
            history,
            core,
            archive_directory,
            archive_directory_bytes: directory_bytes as u32,
        })
    }

    pub fn core_shards(&self) -> [Shard; CORE_SHARDS] {
        core::array::from_fn(|i| {
            let start = i * SHARD_RECORD_BYTES;
            Shard::parse(
                self.core[start..start + SHARD_RECORD_BYTES]
                    .try_into()
                    .unwrap(),
            )
        })
    }

    pub fn directory_shards(&self) -> impl ExactSizeIterator<Item = Shard> + '_ {
        self.archive_directory
            .chunks_exact(SHARD_RECORD_BYTES)
            .map(|row| Shard::parse(row.try_into().unwrap()))
    }
}

/// Checkpoint header communicated in the next call. The stored commitment
/// authenticates it with the deployment's pinned engine and game identity.
pub fn encode_header(checkpoint: &Checkpoint) -> [u8; CHECKPOINT_BYTES] {
    let mut out = [0; CHECKPOINT_BYTES];
    out[..32].copy_from_slice(&checkpoint.memory_root);
    out[32..36].copy_from_slice(&checkpoint.cursor.quanta.to_be_bytes());
    out[36..44].copy_from_slice(&checkpoint.cursor.observed_nodes.to_be_bytes());
    for (i, value) in checkpoint.globals.iter().enumerate() {
        let start = 44 + 8 * i;
        out[start..start + 8].copy_from_slice(&value.to_be_bytes());
    }
    out[68..72].copy_from_slice(&checkpoint.memory_bytes.to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    use tiny_keccak::Hasher;

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

    #[test]
    fn short_wire_modes_preserve_config_and_checkpoint_authentication() {
        let mut config = vec![0; CONFIG_HEADER_BYTES + (CORE_SHARDS + 1) * SHARD_RECORD_BYTES];
        config[..4].copy_from_slice(b"GSC1");
        config[4..36].copy_from_slice(&[1; 32]);
        config[36..40].copy_from_slice(&1u32.to_be_bytes());
        config[40..42].copy_from_slice(&4u16.to_be_bytes());
        config.extend_from_slice(b"e2e4");
        let mut hash = TestKeccak;
        let engine = hash.digest(&config);
        let prior = Checkpoint {
            engine_identity: engine,
            job_identity: [1; 32],
            memory_root: [2; 32],
            cursor: Cursor::default(),
            globals: [0; 3],
            memory_bytes: 65_536,
            complete: false,
        };
        let head = prior.commitment(&mut hash);
        for opcode in [
            ADVANCE,
            ADVANCE_FROM_CODE,
            ADVANCE_SHORT,
            ADVANCE_SHORT_FROM_CODE,
        ] {
            let short = matches!(opcode, ADVANCE_SHORT | ADVANCE_SHORT_FROM_CODE);
            let code = matches!(opcode, ADVANCE_FROM_CODE | ADVANCE_SHORT_FROM_CODE);
            let mut input = vec![opcode];
            if short {
                input.push(1);
            }
            input.extend_from_slice(&(config.len() as u16).to_be_bytes());
            input.extend_from_slice(&config);
            input.extend_from_slice(&encode_header(&prior));
            if code {
                input.extend_from_slice(&6u32.to_be_bytes());
                input.extend_from_slice(&[0; SHARD_RECORD_BYTES]);
            } else {
                input.extend_from_slice(b"GW01xx");
            }
            let decoded = decode_advance(&mut hash, &input, engine, head).unwrap();
            assert_eq!(
                decoded.quanta,
                if short { 1 } else { QUANTA_PER_TRANSACTION }
            );
            assert_eq!(matches!(decoded.witness, AdvanceWitness::Code { .. }), code);
            assert_eq!(
                decode_advance(&mut hash, &input, engine, [0; 32]).err(),
                Some(InputError::StaleCheckpoint)
            );
            if short {
                for out_of_range in [0, 41] {
                    input[1] = out_of_range;
                    assert_eq!(
                        decode_advance(&mut hash, &input, engine, head).err(),
                        Some(InputError::GroupSize)
                    );
                }
            }
        }
    }
}
