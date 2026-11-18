//! Authenticated page inputs and an isolated write overlay for one transaction.
//!
//! The contract supplies the stored checkpoint identity and the real Keccak
//! implementation. Its job identity binds the game and history. The caller
//! executes the pinned guest, flushes its paged cache, and commits the derived
//! header and the changed pages atomically. Reverting the transaction drops
//! the overlay. Witness construction and transaction-size limits are separate.

use alloc::vec::Vec;

use crate::checkpoint_tree::{
    replace_pages, CheckpointError, Digest, Keccak, PageChange, MAX_MEMORY, MAX_PAGES,
};
use crate::memory::{Page, PageBackend, PAGE_SIZE};
use crate::search::{Cursor, QUANTA_PER_TRANSACTION};

const DOMAIN: &[u8] = b"GL3_STYLUS_CHECKPOINT_V1";
const WASM_PAGE_BYTES: u32 = 65_536;
const TREE_DEPTH: usize = (MAX_PAGES - 1).ilog2() as usize + 1;

/// The guest's three exported mutable globals, in module order 0, 98, 99.
pub type Globals = [u64; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    /// Digest of the reviewed executable, model and initialization manifest.
    pub engine_identity: Digest,
    /// Digest of the contract's game and exact input history for this move.
    pub job_identity: Digest,
    pub memory_root: Digest,
    pub cursor: Cursor,
    pub globals: Globals,
    pub memory_bytes: u32,
    pub complete: bool,
}

impl Checkpoint {
    /// Hash fixed-width fields in declaration order, with little-endian integers.
    pub fn commitment(&self, hash: &mut impl Keccak) -> Digest {
        let mut input = [0; DOMAIN.len() + 3 * 32 + 4 + 8 + 3 * 8 + 4 + 1];
        let mut offset = 0;
        for part in [
            DOMAIN,
            &self.engine_identity,
            &self.job_identity,
            &self.memory_root,
            &self.cursor.quanta.to_le_bytes(),
            &self.cursor.observed_nodes.to_le_bytes(),
            &self.globals[0].to_le_bytes(),
            &self.globals[1].to_le_bytes(),
            &self.globals[2].to_le_bytes(),
            &self.memory_bytes.to_le_bytes(),
            &[u8::from(self.complete)],
        ] {
            input[offset..offset + part.len()].copy_from_slice(part);
            offset += part.len();
        }
        hash.digest(&input)
    }

    fn valid(&self) -> bool {
        self.engine_identity != [0; 32]
            && self.job_identity != [0; 32]
            && valid_memory_length(self.memory_bytes)
            && (self.cursor.quanta != 0 || (self.cursor.observed_nodes == 0 && !self.complete))
    }
}

fn valid_memory_length(bytes: u32) -> bool {
    bytes != 0 && bytes as usize <= MAX_MEMORY && bytes % WASM_PAGE_BYTES == 0
}

/// Full prior page bytes and optional writable scratch space. Scratch is
/// never read until the engine has written a complete replacement page.
pub struct WitnessPage<'a> {
    index: u32,
    before: &'a Page,
    scratch: Option<&'a mut Page>,
    dirty: bool,
}

impl<'a> WitnessPage<'a> {
    pub fn read_only(index: u32, before: &'a Page) -> Self {
        Self {
            index,
            before,
            scratch: None,
            dirty: false,
        }
    }

    pub fn writable(index: u32, before: &'a Page, scratch: &'a mut Page) -> Self {
        Self {
            index,
            before,
            scratch: Some(scratch),
            dirty: false,
        }
    }

    pub fn index(&self) -> u32 {
        self.index
    }

    pub fn prior_bytes(&self) -> &Page {
        self.before
    }

    /// Publish this replacement only after successful transaction finalization.
    pub fn replacement(&self) -> Option<&Page> {
        let after = self.current_bytes();
        (after != self.before).then_some(after)
    }

    fn current_bytes(&self) -> &Page {
        self.scratch
            .as_deref()
            .filter(|_| self.dirty)
            .unwrap_or(self.before)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResumeError {
    InvalidCheckpoint,
    WrongCheckpointIdentity,
    WitnessCapacity,
    NonzeroUninitializedPage(u32),
    MissingWitnessPage(u32),
    ReadOnlyPage(u32),
    Faulted,
    InvalidProgress,
    InvalidMemoryLength,
    Proof(CheckpointError),
}

pub struct ResumeBackend<'a, 'page> {
    prior: Checkpoint,
    pages: &'a mut [WitnessPage<'page>],
    siblings: &'a [Digest],
    faulted: bool,
}

impl<'a, 'page> ResumeBackend<'a, 'page> {
    /// Open all read and write witnesses against the same immutable old root.
    /// No full-image buffer is used. `max_witness_pages` is a caller-owned
    /// admission limit. The only internal allocation is page-reference metadata.
    pub fn new(
        hash: &mut impl Keccak,
        trusted_checkpoint: Digest,
        prior: Checkpoint,
        pages: &'a mut [WitnessPage<'page>],
        siblings: &'a [Digest],
        max_witness_pages: usize,
    ) -> Result<Self, ResumeError> {
        if !prior.valid() || prior.complete {
            return Err(ResumeError::InvalidCheckpoint);
        }
        if prior.commitment(hash) != trusted_checkpoint {
            return Err(ResumeError::WrongCheckpointIdentity);
        }
        if max_witness_pages > MAX_PAGES
            || pages.len() > max_witness_pages
            || siblings.len() > pages.len() * TREE_DEPTH
        {
            return Err(ResumeError::WitnessCapacity);
        }
        let prior_page_count = prior.memory_bytes as usize / PAGE_SIZE;
        for page in &mut *pages {
            // The tree also covers addresses beyond the active Wasm length.
            // A growth read still needs a proof of the zero initial page.
            if page.index as usize >= prior_page_count && page.before.iter().any(|&byte| byte != 0)
            {
                return Err(ResumeError::NonzeroUninitializedPage(page.index));
            }
            page.dirty = false;
        }
        let backend = Self {
            prior,
            pages,
            siblings,
            faulted: false,
        };
        backend.updated_root(hash)?;
        Ok(backend)
    }

    fn updated_root(&self, hash: &mut impl Keccak) -> Result<Digest, ResumeError> {
        let mut changes = Vec::new();
        changes
            .try_reserve_exact(self.pages.len())
            .map_err(|_| ResumeError::WitnessCapacity)?;
        changes.extend(self.pages.iter().map(|page| PageChange {
            index: page.index,
            before: page.before,
            after: page.current_bytes(),
        }));
        replace_pages(hash, self.prior.memory_root, &changes, self.siblings)
            .map_err(ResumeError::Proof)
    }

    fn lookup(&mut self, index: u32) -> Result<usize, ResumeError> {
        if self.faulted {
            return Err(ResumeError::Faulted);
        }
        self.pages
            .binary_search_by_key(&index, |page| page.index)
            .map_err(|_| {
                self.faulted = true;
                ResumeError::MissingWitnessPage(index)
            })
    }

    /// Seal the next checkpoint after flushing a successful guest step group.
    /// Cursor, globals, length and completion must come from that execution.
    pub fn finish(
        self,
        hash: &mut impl Keccak,
        cursor: Cursor,
        globals: Globals,
        memory_bytes: u32,
        complete: bool,
    ) -> Result<Checkpoint, ResumeError> {
        if self.faulted {
            return Err(ResumeError::Faulted);
        }
        let steps = cursor.quanta.saturating_sub(self.prior.cursor.quanta);
        if steps == 0
            || steps > QUANTA_PER_TRANSACTION
            || (!complete && steps != QUANTA_PER_TRANSACTION)
            || cursor.observed_nodes < self.prior.cursor.observed_nodes
        {
            return Err(ResumeError::InvalidProgress);
        }
        if !valid_memory_length(memory_bytes) || memory_bytes < self.prior.memory_bytes {
            return Err(ResumeError::InvalidMemoryLength);
        }
        let pages = memory_bytes as usize / PAGE_SIZE;
        if self
            .pages
            .iter()
            .any(|page| page.dirty && page.index as usize >= pages)
        {
            return Err(ResumeError::InvalidMemoryLength);
        }
        Ok(Checkpoint {
            memory_root: self.updated_root(hash)?,
            cursor,
            globals,
            memory_bytes,
            complete,
            ..self.prior
        })
    }
}

impl PageBackend for ResumeBackend<'_, '_> {
    type Error = ResumeError;

    fn read_page(&mut self, index: u32, out: &mut Page) -> Result<bool, Self::Error> {
        let position = self.lookup(index)?;
        out.copy_from_slice(self.pages[position].current_bytes());
        Ok(true)
    }

    fn write_page(&mut self, index: u32, bytes: &Page) -> Result<(), Self::Error> {
        let position = self.lookup(index)?;
        let entry = &mut self.pages[position];
        let Some(scratch) = entry.scratch.as_deref_mut() else {
            self.faulted = true;
            return Err(ResumeError::ReadOnlyPage(index));
        };
        scratch.copy_from_slice(bytes);
        entry.dirty = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::{MemoryError, PagedMemory};

    // Deterministic fixture for tree geometry and field binding. The deployed
    // caller must use the real Keccak-256 host.
    struct Fixture;

    impl Keccak for Fixture {
        fn digest(&mut self, bytes: &[u8]) -> Digest {
            let mut result = [0u8; 32];
            for (index, value) in bytes.iter().enumerate() {
                let slot = &mut result[index % 32];
                *slot = slot.wrapping_mul(17).wrapping_add(*value);
            }
            result
        }
    }

    fn leaf(page: &Page) -> Digest {
        let mut input = [0; PAGE_SIZE + 1];
        input[1..].copy_from_slice(page);
        Fixture.digest(&input)
    }

    fn parent(left: Digest, right: Digest) -> Digest {
        let mut input = [1; 65];
        input[1..33].copy_from_slice(&left);
        input[33..].copy_from_slice(&right);
        Fixture.digest(&input)
    }

    fn fixture() -> (Checkpoint, [Digest; TREE_DEPTH]) {
        let mut zeroes = [[0; 32]; TREE_DEPTH];
        let mut root = leaf(&[0; PAGE_SIZE]);
        for zero in &mut zeroes {
            *zero = root;
            root = parent(root, root);
        }
        let checkpoint = Checkpoint {
            engine_identity: [1; 32],
            job_identity: [2; 32],
            memory_root: root,
            cursor: Cursor {
                quanta: 40,
                observed_nodes: 81_000,
            },
            globals: [32_000, 0, 80_000],
            memory_bytes: WASM_PAGE_BYTES,
            complete: false,
        };
        (checkpoint, zeroes)
    }

    fn next_cursor() -> Cursor {
        Cursor {
            quanta: 80,
            observed_nodes: 170_000,
        }
    }

    #[test]
    fn cold_resume_proves_old_bytes_and_commits_actual_paged_writes() {
        let (prior, zeroes) = fixture();
        let mut hash = Fixture;
        let id = prior.commitment(&mut hash);
        let old = [0; PAGE_SIZE];
        let mut scratch = [0xff; PAGE_SIZE];
        let mut witness = [
            WitnessPage::writable(0, &old, &mut scratch),
            WitnessPage::read_only(1, &old),
        ];
        let mut backend =
            ResumeBackend::new(&mut hash, id, prior, &mut witness, &zeroes[1..], 2).unwrap();
        {
            let mut memory =
                PagedMemory::<_, 1>::new(&mut backend, prior.memory_bytes.into()).unwrap();
            assert_eq!(memory.load_u8(17), Ok(0));
            memory.store_u8(17, 81).unwrap();
            assert_eq!(memory.load_u8(PAGE_SIZE as u32), Ok(0));
            assert_eq!(memory.load_u8(17), Ok(81));
            memory.flush().unwrap();
        }
        let next = backend
            .finish(
                &mut hash,
                next_cursor(),
                [32_100, 0, 80_000],
                prior.memory_bytes,
                false,
            )
            .unwrap();
        let mut changed = old;
        changed[17] = 81;
        let mut expected = parent(leaf(&changed), zeroes[0]);
        for sibling in &zeroes[1..] {
            expected = parent(expected, *sibling);
        }
        assert_eq!(next.memory_root, expected);
        assert_eq!(witness[0].prior_bytes(), &old);
        assert_eq!(witness[0].replacement(), Some(&changed));
        assert!(witness[1].replacement().is_none());

        let mut cold = [
            WitnessPage::read_only(0, &changed),
            WitnessPage::read_only(1, &old),
        ];
        let mut backend = ResumeBackend::new(
            &mut hash,
            next.commitment(&mut Fixture),
            next,
            &mut cold,
            &zeroes[1..],
            2,
        )
        .unwrap();
        let mut memory = PagedMemory::<_, 1>::new(&mut backend, next.memory_bytes.into()).unwrap();
        assert_eq!(memory.load_u8(17), Ok(81));
    }

    #[test]
    fn wrong_identity_wrong_bytes_duplicate_and_missing_proof_are_rejected() {
        let (prior, proof) = fixture();
        let id = prior.commitment(&mut Fixture);
        let old = [0; PAGE_SIZE];
        let mut corrupt = old;
        corrupt[7] = 19;

        for variant in [
            Checkpoint {
                engine_identity: [3; 32],
                ..prior
            },
            Checkpoint {
                job_identity: [5; 32],
                ..prior
            },
            Checkpoint {
                cursor: next_cursor(),
                ..prior
            },
            Checkpoint {
                globals: [0; 3],
                ..prior
            },
            Checkpoint {
                memory_bytes: 2 * WASM_PAGE_BYTES,
                ..prior
            },
        ] {
            assert!(matches!(
                ResumeBackend::new(&mut Fixture, id, variant, &mut [], &[], 0),
                Err(ResumeError::WrongCheckpointIdentity)
            ));
        }
        let mut duplicate = [
            WitnessPage::read_only(0, &old),
            WitnessPage::read_only(0, &old),
        ];
        assert!(matches!(
            ResumeBackend::new(&mut Fixture, id, prior, &mut duplicate, &proof, 2),
            Err(ResumeError::Proof(CheckpointError::InvalidPageOrder))
        ));
        let mut witness = [WitnessPage::read_only(0, &corrupt)];
        assert!(matches!(
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &proof, 1),
            Err(ResumeError::Proof(CheckpointError::WrongPriorRoot))
        ));
        let mut witness = [WitnessPage::read_only(0, &old)];
        assert!(matches!(
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &proof[1..], 1),
            Err(ResumeError::Proof(CheckpointError::MissingSibling))
        ));
        assert!(matches!(
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &proof, 0),
            Err(ResumeError::WitnessCapacity)
        ));
    }

    #[test]
    fn access_failure_blocks_checkpoint_finalization() {
        let (prior, proof) = fixture();
        let id = prior.commitment(&mut Fixture);
        let old = [0; PAGE_SIZE];
        let mut witness = [WitnessPage::read_only(0, &old)];
        let mut backend =
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &proof, 1).unwrap();
        {
            let mut memory =
                PagedMemory::<_, 1>::new(&mut backend, prior.memory_bytes.into()).unwrap();
            assert_eq!(
                memory.load_u8(PAGE_SIZE as u32),
                Err(MemoryError::Backend(ResumeError::MissingWitnessPage(1)))
            );
        }
        assert_eq!(
            backend.finish(
                &mut Fixture,
                next_cursor(),
                prior.globals,
                prior.memory_bytes,
                false
            ),
            Err(ResumeError::Faulted)
        );
        let mut backend =
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &proof, 1).unwrap();
        assert_eq!(
            backend.write_page(0, &[1; PAGE_SIZE]),
            Err(ResumeError::ReadOnlyPage(0))
        );
        assert_eq!(
            backend.finish(
                &mut Fixture,
                next_cursor(),
                prior.globals,
                prior.memory_bytes,
                false
            ),
            Err(ResumeError::Faulted)
        );
    }

    #[test]
    fn growth_and_cursor_rules_are_checked_before_commit() {
        let (prior, _) = fixture();
        let id = prior.commitment(&mut Fixture);
        let old = [1; PAGE_SIZE];
        let mut witness = [WitnessPage::read_only(
            prior.memory_bytes / PAGE_SIZE as u32,
            &old,
        )];
        assert!(matches!(
            ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &[], 1),
            Err(ResumeError::NonzeroUninitializedPage(_))
        ));
        let mut witness = [];
        let backend = ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &[], 0).unwrap();
        assert_eq!(
            backend.finish(
                &mut Fixture,
                prior.cursor,
                prior.globals,
                prior.memory_bytes,
                false
            ),
            Err(ResumeError::InvalidProgress)
        );
        let backend = ResumeBackend::new(&mut Fixture, id, prior, &mut witness, &[], 0).unwrap();
        assert_eq!(
            backend.finish(
                &mut Fixture,
                next_cursor(),
                prior.globals,
                prior.memory_bytes - 1,
                false
            ),
            Err(ResumeError::InvalidMemoryLength)
        );
        let terminal = Checkpoint {
            complete: true,
            ..prior
        };
        assert!(matches!(
            ResumeBackend::new(
                &mut Fixture,
                terminal.commitment(&mut Fixture),
                terminal,
                &mut witness,
                &[],
                0
            ),
            Err(ResumeError::InvalidCheckpoint)
        ));
    }
}
