//! Authenticate and read encoded pages without materializing the full input
//! image. Keep evicted writes in a bounded compressed overlay.

use alloc::vec::Vec;

use crate::checkpoint_tree::{self, Digest, Keccak, LeafChange, DEPTH};
use crate::memory::{Page, PageBackend, PAGE_SIZE};
use crate::resume::{Checkpoint, Globals, ResumeError};
use crate::search::Cursor;
use crate::witness_wire::{self, CompactProof, Mode, WireError, WirePage};

#[derive(Debug, Eq, PartialEq)]
pub enum CompactError {
    Resume(ResumeError),
    Wire(WireError),
    OverlayCapacity,
}

impl From<ResumeError> for CompactError {
    fn from(value: ResumeError) -> Self {
        Self::Resume(value)
    }
}

impl From<WireError> for CompactError {
    fn from(value: WireError) -> Self {
        Self::Wire(value)
    }
}

#[derive(Debug)]
pub struct Replacement {
    pub index: u32,
    pub mode: Mode,
    pub bytes: Vec<u8>,
}

struct Encoded<'a> {
    wire: WirePage<'a>,
    old: Digest,
    new: Digest,
    overlay: Option<Replacement>,
}

impl LeafChange for Encoded<'_> {
    fn index(&self) -> u32 {
        self.wire.index
    }
    fn digests(&self, _: &mut impl Keccak) -> (Digest, Digest) {
        (self.old, self.new)
    }
}

pub struct CompactResume<'a> {
    prior: Checkpoint,
    pages: Vec<Encoded<'a>>,
    proof: &'a [u8],
    zeros: [Digest; DEPTH as usize + 1],
    overlay_limit: usize,
    overlay_capacity: usize,
    fault: bool,
}

#[derive(Debug)]
pub struct CommittedPages {
    pub checkpoint: Checkpoint,
    pub replacements: Vec<Replacement>,
}

impl<'a> CompactResume<'a> {
    pub fn open(
        hash: &mut impl Keccak,
        trusted: Digest,
        prior: Checkpoint,
        packet: &'a [u8],
        witness_allowance: usize,
        page_limit: usize,
        overlay_limit: usize,
    ) -> Result<Self, CompactError> {
        if !prior.valid() || prior.complete {
            return Err(ResumeError::InvalidCheckpoint.into());
        }
        if prior.commitment(hash) != trusted {
            return Err(ResumeError::WrongCheckpointIdentity.into());
        }
        let (wire, proof) = witness_wire::split_packet(packet, witness_allowance)?;
        if wire.len() > page_limit {
            return Err(ResumeError::WitnessCapacity.into());
        }
        let zeros = witness_wire::zero_subtrees(hash);
        let mut pages = Vec::new();
        pages
            .try_reserve_exact(wire.len())
            .map_err(|_| WireError::Allocation)?;
        let mut scratch = [0; PAGE_SIZE];
        for entry in wire {
            let old = if entry.mode == Mode::Zero && entry.bytes.is_empty() {
                zeros[0]
            } else {
                witness_wire::decode_page(entry.mode, entry.bytes, &mut scratch)?;
                let past_length = entry.index as usize >= prior.memory_bytes as usize / PAGE_SIZE;
                if past_length && scratch.iter().any(|&byte| byte != 0) {
                    return Err(ResumeError::NonzeroUninitializedPage(entry.index).into());
                }
                checkpoint_tree::leaf(hash, &scratch)
            };
            pages.push(Encoded {
                wire: entry,
                old,
                new: old,
                overlay: None,
            });
        }
        let backend = Self {
            prior,
            pages,
            proof,
            zeros,
            overlay_limit,
            overlay_capacity: 0,
            fault: false,
        };
        backend.root(hash)?;
        Ok(backend)
    }

    fn root(&self, hash: &mut impl Keccak) -> Result<Digest, CompactError> {
        checkpoint_tree::replace_with(
            hash,
            self.prior.memory_root,
            &self.pages,
            &mut CompactProof {
                remaining: self.proof,
                zero: &self.zeros,
            },
        )
        .map_err(|error| ResumeError::Proof(error).into())
    }

    fn find(&mut self, index: u32) -> Result<usize, CompactError> {
        if self.fault {
            return Err(ResumeError::Faulted.into());
        }
        self.pages
            .binary_search_by_key(&index, |entry| entry.wire.index)
            .map_err(|_| {
                self.fault = true;
                ResumeError::MissingWitnessPage(index).into()
            })
    }

    pub fn finish(
        mut self,
        hash: &mut impl Keccak,
        cursor: Cursor,
        globals: Globals,
        memory_bytes: u32,
        complete: bool,
    ) -> Result<CommittedPages, CompactError> {
        if self.fault {
            return Err(ResumeError::Faulted.into());
        }
        let count = self
            .prior
            .check_transition(cursor, memory_bytes, complete)?;
        let mut scratch = [0; PAGE_SIZE];
        for entry in &mut self.pages {
            if let Some(page) = &entry.overlay {
                if page.index as usize >= count {
                    return Err(ResumeError::InvalidMemoryLength.into());
                }
                entry.new = if page.mode == Mode::Zero {
                    self.zeros[0]
                } else {
                    witness_wire::decode_page(page.mode, &page.bytes, &mut scratch)?;
                    checkpoint_tree::leaf(hash, &scratch)
                };
            }
        }
        let memory_root = self.root(hash)?;
        let mut replacements = Vec::new();
        for entry in self.pages {
            if entry.old != entry.new {
                let page = entry.overlay.ok_or(ResumeError::Faulted)?;
                replacements
                    .try_reserve(1)
                    .map_err(|_| WireError::Allocation)?;
                replacements.push(page);
            }
        }
        let checkpoint = Checkpoint {
            memory_root,
            cursor,
            globals,
            memory_bytes,
            complete,
            ..self.prior
        };
        Ok(CommittedPages {
            checkpoint,
            replacements,
        })
    }
}

impl PageBackend for CompactResume<'_> {
    type Error = CompactError;

    fn read_page(&mut self, index: u32, out: &mut Page) -> Result<bool, CompactError> {
        let position = self.find(index)?;
        let record = &self.pages[position];
        let (mode, bytes) = record
            .overlay
            .as_ref()
            .map_or((record.wire.mode, record.wire.bytes), |page| {
                (page.mode, page.bytes.as_slice())
            });
        if let Err(error) = witness_wire::decode_page(mode, bytes, out) {
            self.fault = true;
            return Err(error.into());
        }
        Ok(true)
    }

    fn write_page(&mut self, index: u32, page: &Page) -> Result<(), CompactError> {
        let position = self.find(index)?;
        let record = &mut self.pages[position];
        if !record.wire.writable {
            self.fault = true;
            return Err(ResumeError::ReadOnlyPage(index).into());
        }
        let mut scratch = [0; PAGE_SIZE];
        let (mode, len) = witness_wire::encode_page(page, &mut scratch);
        let existing = record
            .overlay
            .as_ref()
            .map_or(0, |old| old.bytes.capacity());
        if len > existing && len > self.overlay_limit.saturating_sub(self.overlay_capacity) {
            self.fault = true;
            return Err(CompactError::OverlayCapacity);
        }
        let patch = record.overlay.get_or_insert_with(|| Replacement {
            index,
            mode,
            bytes: Vec::new(),
        });
        if len > existing {
            if patch
                .bytes
                .try_reserve_exact(len - patch.bytes.len())
                .is_err()
            {
                self.fault = true;
                return Err(WireError::Allocation.into());
            }
            self.overlay_capacity += patch.bytes.capacity() - existing;
            if self.overlay_capacity > self.overlay_limit {
                self.fault = true;
                return Err(CompactError::OverlayCapacity);
            }
        }
        patch.mode = mode;
        patch.bytes.clear();
        patch.bytes.extend_from_slice(&scratch[..len]);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::PagedMemory;
    use crate::witness_wire::{InputPage, TRANSACTION_BYTES};

    struct FixtureHash;

    impl Keccak for FixtureHash {
        fn digest(&mut self, bytes: &[u8]) -> Digest {
            let mut value = [0u8; 32];
            for (i, byte) in bytes.iter().enumerate() {
                value[i % 32] = value[i % 32].wrapping_mul(7).wrapping_add(*byte);
            }
            value
        }
    }

    fn prior(memory_root: Digest) -> Checkpoint {
        Checkpoint {
            engine_identity: [1; 32],
            job_identity: [2; 32],
            memory_root,
            cursor: Cursor::default(),
            globals: [0; 3],
            memory_bytes: 768 * 1024 * 1024,
            complete: false,
        }
    }

    fn siblings(indices: &[u32], level: u32, zero: &[Digest], out: &mut Vec<(u32, Digest)>) {
        if indices.is_empty() {
            out.push((level, zero[level as usize]));
        } else if level > 0 {
            let bit = 1 << (level - 1);
            let split = indices.partition_point(|index| index & bit == 0);
            siblings(&indices[..split], level - 1, zero, out);
            siblings(&indices[split..], level - 1, zero, out);
        }
    }

    #[test]
    fn synthetic_1919_zero_pages_fit_without_full_images() {
        let mut hash = FixtureHash;
        let zero = witness_wire::zero_subtrees(&mut hash);
        let page = [0; PAGE_SIZE];
        let indices: Vec<u32> = (0..1919).map(|i| i * 97).collect();
        let pages: Vec<_> = indices
            .iter()
            .map(|&index| InputPage {
                index,
                writable: true,
                page: &page,
            })
            .collect();
        let mut proof = Vec::new();
        siblings(&indices, DEPTH, &zero, &mut proof);
        let packet =
            witness_wire::encode(&mut hash, &pages, &proof, TRANSACTION_BYTES - 1).unwrap();
        let checkpoint = prior(zero[DEPTH as usize]);
        let key = checkpoint.commitment(&mut hash);
        let mut backend =
            CompactResume::open(&mut hash, key, checkpoint, &packet, 94_000, 1919, 4096).unwrap();
        {
            let mut memory =
                PagedMemory::<_, 1>::new(&mut backend, checkpoint.memory_bytes.into()).unwrap();
            let address = indices[1] * PAGE_SIZE as u32;
            memory.store_u8(0, 0x15).unwrap();
            memory.store_u8(address + 9, 0x82).unwrap();
            assert_eq!(memory.load_u8(0), Ok(0x15));
            assert_eq!(memory.load_u8(address + 9), Ok(0x82));
            memory.flush().unwrap();
        }
        let cursor = Cursor {
            quanta: 40,
            observed_nodes: 81_920,
        };
        let output = backend
            .finish(&mut hash, cursor, [1, 2, 3], checkpoint.memory_bytes, false)
            .unwrap();
        assert_ne!(output.checkpoint.memory_root, checkpoint.memory_root);
        assert_eq!(output.replacements.len(), 2);
        assert_eq!(output.replacements[1].index, indices[1]);
        let mut restored = page;
        let replacement = &output.replacements[1];
        witness_wire::decode_page(replacement.mode, &replacement.bytes, &mut restored).unwrap();
        assert_eq!(restored[9], 0x82);
        std::println!(
            "1919 synthetic zero pages: {} packet bytes, {} proof nodes",
            packet.len(),
            proof.len()
        );
    }

    #[test]
    fn rejects_wrong_proof_and_refuses_over_budget_or_missing_data() {
        let mut hash = FixtureHash;
        let zero = witness_wire::zero_subtrees(&mut hash);
        let page = [0; PAGE_SIZE];
        let checkpoint = prior(zero[DEPTH as usize]);
        let key = checkpoint.commitment(&mut hash);
        let mut proof = Vec::new();
        siblings(&[0], DEPTH, &zero, &mut proof);
        let packet = witness_wire::encode(
            &mut hash,
            &[InputPage {
                index: 0,
                writable: true,
                page: &page,
            }],
            &proof,
            95_000,
        )
        .unwrap();

        assert!(matches!(
            CompactResume::open(
                &mut hash,
                key,
                checkpoint,
                &packet,
                packet.len() - 1,
                1,
                100
            ),
            Err(CompactError::Wire(WireError::OverBudget))
        ));
        let mut corrupted = packet.clone();
        *corrupted.last_mut().unwrap() = 14;
        assert!(matches!(
            CompactResume::open(&mut hash, key, checkpoint, &corrupted, 95_000, 1, 100),
            Err(CompactError::Resume(ResumeError::Proof(_)))
        ));

        let mut backend =
            CompactResume::open(&mut hash, key, checkpoint, &packet, 95_000, 1, 100).unwrap();
        assert_eq!(
            backend.write_page(0, &[9; PAGE_SIZE]),
            Err(CompactError::OverlayCapacity)
        );
        assert_eq!(
            backend.read_page(0, &mut [0; PAGE_SIZE]),
            Err(CompactError::Resume(ResumeError::Faulted))
        );
        let mut backend =
            CompactResume::open(&mut hash, key, checkpoint, &packet, 95_000, 1, 4096).unwrap();
        assert_eq!(
            backend.read_page(1, &mut [0; PAGE_SIZE]),
            Err(CompactError::Resume(ResumeError::MissingWitnessPage(1)))
        );

        let dense = [9; PAGE_SIZE];
        let pages: Vec<_> = (0..24)
            .map(|index| InputPage {
                index,
                writable: true,
                page: &dense,
            })
            .collect();
        assert_eq!(
            witness_wire::encode(&mut hash, &pages, &[], 95_000),
            Err(WireError::OverBudget)
        );
    }

    #[test]
    fn zero_run_and_raw_encodings_round_trip() {
        let mut sparse = [0; PAGE_SIZE];
        for index in [0, 130, 500, 5, 4095] {
            sparse[index] = index as u8 | 1;
        }
        for (input, expected_mode) in [
            ([0; PAGE_SIZE], Mode::Zero),
            (sparse, Mode::Runs),
            ([5; PAGE_SIZE], Mode::Raw),
        ] {
            let mut encoded = [0; PAGE_SIZE];
            let (mode, length) = witness_wire::encode_page(&input, &mut encoded);
            assert_eq!(mode, expected_mode);
            let mut output = [0x12; PAGE_SIZE];
            witness_wire::decode_page(mode, &encoded[..length], &mut output).unwrap();
            assert_eq!(input, output);
        }
        assert_eq!(
            witness_wire::decode_page(Mode::Runs, &[255; 33], &mut [0; PAGE_SIZE]),
            Err(WireError::BadPage)
        );
    }
}
