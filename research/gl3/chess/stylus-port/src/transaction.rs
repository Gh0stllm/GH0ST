//! Inputs for the isolated one-move Stylus contract. The stored configuration
//! binds the executable, initialized archive and game history before a caller's
//! checkpoint or page proof is interpreted.

use crate::checkpoint_tree::{Digest, Keccak};
use crate::resume::Checkpoint;
use crate::rom::{Shard, PAYLOAD_BYTES, SHARD_RECORD_BYTES};
use crate::search::Cursor;
use crate::witness_wire::{CODE_WITNESS_BYTES, TRANSACTION_BYTES};

pub const CONFIG_SLOT: Digest = [0x6c; 32];
pub const CHECKPOINT_SLOT: Digest = [0x6d; 32];
pub const CORE_SHARDS: usize = 51;
pub const CONFIG_HEADER_BYTES: usize = 42;
pub const CHECKPOINT_BYTES: usize = 72;
const ADVANCE: u8 = 1;
const ADVANCE_FROM_CODE: u8 = 2;

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
    BadConfig,
    UnauthorizedConfig,
    BadCheckpoint,
    StaleCheckpoint,
}

pub struct Advance<'a> {
    pub config: Config<'a>,
    pub prior: Checkpoint,
    pub witness: AdvanceWitness<'a>,
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
    if !matches!(raw[0], ADVANCE | ADVANCE_FROM_CODE) {
        return Err(InputError::Opcode);
    }
    let config_bytes = usize::from(u16::from_be_bytes([raw[1], raw[2]]));
    let (config, remaining) = raw[3..]
        .split_at_checked(config_bytes)
        .ok_or(InputError::Length)?;
    let (checkpoint, witness) = remaining
        .split_at_checked(CHECKPOINT_BYTES)
        .ok_or(InputError::Length)?;
    if stored_config == [0; 32] || hash.digest(config) != stored_config {
        return Err(InputError::UnauthorizedConfig);
    }
    let config = Config::parse(config)?;
    let prior = Checkpoint {
        engine_identity: stored_config,
        job_identity: config.job,
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
    if stored_checkpoint == [0; 32] || prior.commitment(hash) != stored_checkpoint {
        return Err(InputError::StaleCheckpoint);
    }
    let witness = if raw[0] == ADVANCE {
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
    })
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
