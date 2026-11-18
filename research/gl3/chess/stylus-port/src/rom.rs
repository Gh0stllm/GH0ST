//! Bounded reader for the pinned guest's immutable on-chain bytecode data.

use core::cmp::min;

pub const MAX_CODE_BYTES: usize = 24_576;
pub const PAYLOAD_BYTES: usize = MAX_CODE_BYTES - 1;
pub const FIRST_DEFINED_FUNCTION: u32 = 13;
pub const DEFINED_FUNCTIONS: usize = 1_249;
pub const FUNCTION_INDEX_BYTES: u32 = (DEFINED_FUNCTIONS * 6) as u32;
pub type Address = [u8; 20];
pub type CodeHash = [u8; 32];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Shard {
    pub address: Address,
    /// Ethereum Keccak-256 of the complete runtime code, including STOP.
    pub code_hash: CodeHash,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GuestFunction {
    pub offset: u32,
    pub len: u16,
    pub type_index: u8,
}

pub trait CodeHost {
    type Error;

    fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error>;
    /// Copy runtime code starting at byte zero and return the actual count.
    fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RomError<E> {
    InvalidManifest,
    OutOfBounds,
    InvalidShard,
    Host(E),
}

struct ResidentShard {
    index: Option<usize>,
    bytes: [u8; MAX_CODE_BYTES],
}

impl ResidentShard {
    const EMPTY: Self = Self {
        index: None,
        bytes: [0; MAX_CODE_BYTES],
    };
}

/// Reads a byte stream held in `STOP || payload` code shards.
/// The caller binds the ordered manifest and length to the engine revision
/// in its own state. The transaction sender must not choose this manifest.
pub struct BytecodeRom<'a, H: CodeHost, const RESIDENT: usize> {
    host: H,
    shards: &'a [Shard],
    len: u32,
    cache: [ResidentShard; RESIDENT],
}

impl<'a, H: CodeHost, const RESIDENT: usize> BytecodeRom<'a, H, RESIDENT> {
    pub fn new(host: H, shards: &'a [Shard], len: u32) -> Result<Self, RomError<H::Error>> {
        if RESIDENT == 0 || len == 0 || shards.len() != (len as usize).div_ceil(PAYLOAD_BYTES) {
            return Err(RomError::InvalidManifest);
        }
        Ok(Self {
            host,
            shards,
            len,
            cache: [ResidentShard::EMPTY; RESIDENT],
        })
    }

    fn shard(&mut self, index: usize) -> Result<&[u8], RomError<H::Error>> {
        let resident = &mut self.cache[index % RESIDENT];
        let payload_len = min(PAYLOAD_BYTES, self.len as usize - index * PAYLOAD_BYTES);
        let code = &mut resident.bytes[..payload_len + 1];
        if resident.index != Some(index) {
            // A failed copy may already have overwritten the old buffer.
            resident.index = None;
            let shard = &self.shards[index];
            if self
                .host
                .code_hash(&shard.address)
                .map_err(RomError::Host)?
                != shard.code_hash
            {
                return Err(RomError::InvalidShard);
            }
            if self
                .host
                .copy_code(&shard.address, code)
                .map_err(RomError::Host)?
                != code.len()
                || code[0] != 0
            {
                return Err(RomError::InvalidShard);
            }
            resident.index = Some(index);
        }
        Ok(&code[1..])
    }

    pub fn read(&mut self, start: u32, mut output: &mut [u8]) -> Result<(), RomError<H::Error>> {
        let mut cursor = start as usize;
        if cursor > self.len as usize || output.len() > self.len as usize - cursor {
            return Err(RomError::OutOfBounds);
        }
        while !output.is_empty() {
            let shard = self.shard(cursor / PAYLOAD_BYTES)?;
            let start = cursor % PAYLOAD_BYTES;
            let count = min(output.len(), shard.len() - start);
            let (head, tail) = output.split_at_mut(count);
            head.copy_from_slice(&shard[start..start + count]);
            output = tail;
            cursor += count;
        }
        Ok(())
    }

    /// Decode a lookup record from the pinned function directory. Offsets
    /// are absolute within the separate code ROM, including its preamble.
    pub fn function(
        &mut self,
        number: u32,
        code_bytes: u32,
    ) -> Result<GuestFunction, RomError<H::Error>> {
        if self.len != FUNCTION_INDEX_BYTES {
            return Err(RomError::InvalidManifest);
        }
        let ordinal = number
            .checked_sub(FIRST_DEFINED_FUNCTION)
            .filter(|ordinal| (*ordinal as usize) < DEFINED_FUNCTIONS)
            .ok_or(RomError::OutOfBounds)?;
        let mut record = [0; 6];
        self.read(6 * ordinal, &mut record)?;
        let offset = u32::from_be_bytes([0, record[0], record[1], record[2]]);
        let len = u16::from_be_bytes([record[3], record[4]]);
        if len == 0 || offset < 8 || offset + u32::from(len) > code_bytes {
            return Err(RomError::InvalidManifest);
        }
        Ok(GuestFunction {
            offset,
            len,
            type_index: record[5],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAIL_BYTES: usize = 5;
    const LENGTH: u32 = (PAYLOAD_BYTES + TAIL_BYTES) as u32;
    const SHARDS: [Shard; 2] = [
        Shard {
            address: [1; 20],
            code_hash: [0x11; 32],
        },
        Shard {
            address: [2; 20],
            code_hash: [0x22; 32],
        },
    ];

    #[derive(Default)]
    struct Host {
        reads: usize,
        hashes: usize,
        wrong_hash: bool,
        short_copy: bool,
    }

    impl CodeHost for Host {
        type Error = ();

        fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error> {
            self.hashes += 1;
            let value = if self.wrong_hash {
                0xff
            } else {
                address[0] * 0x11
            };
            Ok([value; 32])
        }

        fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error> {
            self.reads += 1;
            out.fill(address[0]);
            out[0] = 0;
            Ok(out.len() - usize::from(self.short_copy))
        }
    }

    #[test]
    fn reads_across_shards_and_reuses_verified_cache() {
        let mut rom = BytecodeRom::<_, 2>::new(Host::default(), &SHARDS, LENGTH).unwrap();
        let mut out = [0; 7];
        rom.read(PAYLOAD_BYTES as u32 - 2, &mut out).unwrap();
        assert_eq!(out, [1, 1, 2, 2, 2, 2, 2]);
        rom.read(LENGTH - 1, &mut out[..1]).unwrap();
        rom.read(0, &mut out[..1]).unwrap();
        assert_eq!((rom.host.hashes, rom.host.reads), (2, 2));
    }

    #[test]
    fn invalid_lengths_fail_before_any_copy() {
        assert!(matches!(
            BytecodeRom::<_, 1>::new(Host::default(), &SHARDS, 1),
            Err(RomError::InvalidManifest)
        ));
        let mut rom = BytecodeRom::<_, 1>::new(Host::default(), &SHARDS, LENGTH).unwrap();
        assert_eq!(rom.read(LENGTH, &mut []), Ok(()));
        let mut out = [42; 2];
        assert_eq!(rom.read(LENGTH - 1, &mut out), Err(RomError::OutOfBounds));
        assert_eq!(rom.host.reads, 0);
        assert_eq!(out, [42; 2]);
    }

    #[test]
    fn rejects_wrong_code_and_never_reuses_partly_overwritten_cache() {
        let mut rom = BytecodeRom::<_, 1>::new(Host::default(), &SHARDS, LENGTH).unwrap();
        let mut out = [0];
        rom.host.wrong_hash = true;
        assert_eq!(rom.read(0, &mut out), Err(RomError::InvalidShard));
        assert_eq!(rom.host.reads, 0);
        rom.host.wrong_hash = false;
        rom.read(0, &mut out).unwrap();
        rom.host.short_copy = true;
        assert_eq!(rom.read(LENGTH - 1, &mut out), Err(RomError::InvalidShard));
        rom.host.short_copy = false;
        rom.read(0, &mut out).unwrap();
        assert_eq!(out, [1]);
        assert_eq!(rom.host.reads, 3);
    }

    #[test]
    fn directory_bounds_and_big_endian_fields_match_the_packed_format() {
        let mut rom =
            BytecodeRom::<_, 1>::new(Host::default(), &SHARDS[..1], FUNCTION_INDEX_BYTES).unwrap();
        // This host fills the payload with 0x01. That encodes offset 0x010101,
        // length 0x0101 and type index 1 in every directory record.
        assert_eq!(
            rom.function(13, 70_000),
            Ok(GuestFunction {
                offset: 65_793,
                len: 257,
                type_index: 1
            })
        );
        assert_eq!(rom.function(13, 66_049), Err(RomError::InvalidManifest));
        assert_eq!(rom.function(12, 70_000), Err(RomError::OutOfBounds));
        assert_eq!(rom.function(1262, 70_000), Err(RomError::OutOfBounds));
    }
}
