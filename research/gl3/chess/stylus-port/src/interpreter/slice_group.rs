//! A bounded, authenticated Stockfish continuation between guest instructions.
//! The caller must supply the contract's stored slice head and pinned game
//! history, then publish the next head and the recoverable inputs atomically.

use alloc::vec::Vec;

use crate::checkpoint_tree::{Digest, Keccak};
use crate::compact_resume::{CompactError, CompactResume, Replacement};
use crate::memory::{MemoryError, PagedMemory};
use crate::resume::{Checkpoint, Globals};
use crate::rom::CodeHost;
use crate::search::Step;
use crate::witness_wire::Archive;

use super::rom_code::{ProgramError, RomCode};
use super::sliced_guest::{Driver, DriverError, DriverProgress, DRIVER_STATE_BYTES};
use super::suspend::SnapshotError;
use super::{Executable, GuestMemory, Limits, Machine};

const HEAD_DOMAIN: &[u8] = b"GL3_STYLUS_CHECKPOINT_SLICE_V1";
const CONTEXT_DOMAIN: &[u8] = b"GL3_STYLUS_SLICE_CONTEXT_V1";
const EMPTY: Digest = [0; 32];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SliceHead {
    pub checkpoint: Checkpoint,
    pub instructions: u64,
    /// Zero at a quantum boundary, otherwise commits the suspended driver and stack.
    pub continuation: Digest,
}

impl SliceHead {
    pub fn initial(checkpoint: Checkpoint) -> Self {
        Self {
            checkpoint,
            instructions: 0,
            continuation: EMPTY,
        }
    }

    pub fn commitment(&self, hash: &mut impl Keccak) -> Digest {
        self.commitment_with_checkpoint(self.checkpoint.commitment(hash), hash)
    }

    fn commitment_with_checkpoint(&self, checkpoint: Digest, hash: &mut impl Keccak) -> Digest {
        let mut bytes = [0u8; HEAD_DOMAIN.len() + 72];
        let (domain, data) = bytes.split_at_mut(HEAD_DOMAIN.len());
        domain.copy_from_slice(HEAD_DOMAIN);
        data[..32].copy_from_slice(&checkpoint);
        data[32..40].copy_from_slice(&self.instructions.to_be_bytes());
        data[40..].copy_from_slice(&self.continuation);
        hash.digest(&bytes)
    }
}

#[derive(Clone, Copy)]
pub struct Continuation<'a> {
    pub driver: &'a [u8; DRIVER_STATE_BYTES],
    pub machine: &'a [u8],
}

impl Continuation<'_> {
    pub fn commitment(&self, hash: &mut impl Keccak) -> Digest {
        let mut bytes = [0u8; CONTEXT_DOMAIN.len() + DRIVER_STATE_BYTES + 32];
        let (domain, data) = bytes.split_at_mut(CONTEXT_DOMAIN.len());
        domain.copy_from_slice(CONTEXT_DOMAIN);
        data[..DRIVER_STATE_BYTES].copy_from_slice(self.driver);
        data[DRIVER_STATE_BYTES..].copy_from_slice(&hash.digest(self.machine));
        hash.digest(&bytes)
    }
}

#[derive(Debug)]
pub struct SavedContinuation {
    pub driver: [u8; DRIVER_STATE_BYTES],
    pub machine: Vec<u8>,
}

impl SavedContinuation {
    pub fn as_ref(&self) -> Continuation<'_> {
        Continuation {
            driver: &self.driver,
            machine: &self.machine,
        }
    }
}

pub struct SliceRequest<'a> {
    pub trusted_head: Digest,
    pub prior: SliceHead,
    pub continuation: Option<Continuation<'a>>,
    pub opening_history: Option<&'a [u8]>,
    pub max_witness_pages: usize,
    pub interpreter_limits: Limits,
    pub instruction_budget: u64,
}

#[derive(Debug)]
pub struct SliceOutcome {
    pub head: SliceHead,
    pub step: Option<Step>,
    pub continuation: Option<SavedContinuation>,
    pub instructions: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub enum HeadError {
    WrongHead,
    WrongContinuation,
    InvalidDriver,
    InvalidProgress,
}

#[derive(Debug, Eq, PartialEq)]
pub enum SliceError<E> {
    Head(HeadError),
    Snapshot(SnapshotError),
    Witness(CompactError),
    Program(ProgramError<E>),
    Paging(MemoryError<CompactError>),
    Driver(DriverError<ProgramError<E>, MemoryError<CompactError>>),
}

fn authenticated_driver(
    hash: &mut impl Keccak,
    request: &SliceRequest<'_>,
) -> Result<(Driver, Digest), HeadError> {
    let prior = request.prior;
    let checkpoint = prior.checkpoint.commitment(hash);
    if !prior.checkpoint.valid()
        || prior.checkpoint.complete
        || request.trusted_head == EMPTY
        || prior.commitment_with_checkpoint(checkpoint, hash) != request.trusted_head
    {
        return Err(HeadError::WrongHead);
    }
    if request.instruction_budget == 0 {
        return Err(HeadError::InvalidProgress);
    }
    let driver = match request.continuation {
        None if prior.continuation == EMPTY => Driver::new(prior.checkpoint.cursor),
        Some(state)
            if prior.continuation != EMPTY && state.commitment(hash) == prior.continuation =>
        {
            Driver::decode(state.driver)
        }
        _ => return Err(HeadError::WrongContinuation),
    }
    .map_err(|_| HeadError::InvalidDriver)?;
    if driver.cursor() != prior.checkpoint.cursor || driver.is_finished() {
        return Err(HeadError::InvalidDriver);
    }
    Ok((driver, checkpoint))
}

struct Executed {
    step: Option<Step>,
    continuation: Option<SavedContinuation>,
    instructions: u64,
}

#[derive(Debug)]
enum RunError<C, M> {
    Driver(DriverError<C, M>),
    Snapshot(SnapshotError),
    NoProgress,
}

fn drive<C: Executable, M: GuestMemory>(
    machine: &mut Machine<'_, C, M>,
    mut driver: Driver,
    request: &SliceRequest<'_>,
) -> Result<Executed, RunError<C::Error, M::Error>> {
    if let Some(prior) = request.continuation {
        machine.restore(prior.machine).map_err(RunError::Snapshot)?;
    }
    let mut fuel = request.instruction_budget;
    let progress = driver
        .run(machine, request.opening_history, &mut fuel)
        .map_err(RunError::Driver)?;
    let instructions = request.instruction_budget - fuel;
    if instructions == 0
        || request
            .prior
            .instructions
            .checked_add(instructions)
            .is_none()
    {
        return Err(RunError::NoProgress);
    }
    let (step, continuation) = match progress {
        DriverProgress::Pending => (
            None,
            Some(SavedContinuation {
                driver: driver.encode(),
                machine: machine.snapshot().map_err(RunError::Snapshot)?,
            }),
        ),
        DriverProgress::Quantum(step) => (Some(step), None),
    };
    Ok(Executed {
        step,
        continuation,
        instructions,
    })
}

/// Execute at most one quantum according to a bounded instruction budget.
/// A quantum boundary can end the slice early. Otherwise the next transaction
/// must resume the exact interpreter and driver stacks from this slice.
pub fn run_archived_slice<
    H: CodeHost,
    A: Archive,
    const ROM_RESIDENT: usize,
    const LINK_CACHE: usize,
    const RAM_RESIDENT: usize,
>(
    mut code: RomCode<'_, H, ROM_RESIDENT, LINK_CACHE>,
    hash: &mut impl Keccak,
    request: SliceRequest<'_>,
    packet: &[u8],
    witness_allowance: usize,
    overlay_limit: usize,
    archive: A,
) -> Result<(SliceOutcome, Vec<Replacement>), SliceError<H::Error>> {
    let (driver, checkpoint_digest) =
        authenticated_driver(hash, &request).map_err(SliceError::Head)?;
    let prior = request.prior.checkpoint;
    let mut backend = CompactResume::open_archived(
        hash,
        checkpoint_digest,
        prior,
        packet,
        witness_allowance,
        request.max_witness_pages,
        overlay_limit,
        archive,
    )
    .map_err(SliceError::Witness)?;
    let mut globals = code
        .globals(Some(prior.globals))
        .map_err(SliceError::Program)?;
    let (result, memory_bytes) = {
        let memory =
            PagedMemory::<_, RAM_RESIDENT>::new(&mut backend, u64::from(prior.memory_bytes))
                .map_err(SliceError::Paging)?;
        let mut machine = Machine::new(code, memory, &mut globals, request.interpreter_limits);
        let result = drive(&mut machine, driver, &request).map_err(|error| match error {
            RunError::Driver(error) => SliceError::Driver(error),
            RunError::Snapshot(error) => SliceError::Snapshot(error),
            RunError::NoProgress => SliceError::Head(HeadError::InvalidProgress),
        })?;
        machine.memory().flush().map_err(SliceError::Paging)?;
        (result, machine.memory().len() as u32)
    };
    let globals = RomCode::<H, ROM_RESIDENT, LINK_CACHE>::retained_globals(&globals)
        .map_err(SliceError::Program)?;
    seal(backend, hash, request.prior, result, globals, memory_bytes).map_err(SliceError::Witness)
}

fn seal<A: Archive>(
    backend: CompactResume<'_, A>,
    hash: &mut impl Keccak,
    prior: SliceHead,
    result: Executed,
    globals: Globals,
    memory_bytes: u32,
) -> Result<(SliceOutcome, Vec<Replacement>), CompactError> {
    let cursor = result
        .step
        .map_or(prior.checkpoint.cursor, |step| step.cursor);
    let complete = result.step.and_then(|step| step.decision).is_some();
    let committed = backend.finish_slice(
        hash,
        cursor,
        globals,
        memory_bytes,
        complete,
        result.instructions,
    )?;
    let continuation = result
        .continuation
        .as_ref()
        .map_or(EMPTY, |context| context.as_ref().commitment(hash));
    let head = SliceHead {
        checkpoint: committed.checkpoint,
        instructions: prior.instructions + result.instructions,
        continuation,
    };
    Ok((
        SliceOutcome {
            head,
            step: result.step,
            continuation: result.continuation,
            instructions: result.instructions,
        },
        committed.replacements,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint_tree::DEPTH;
    use crate::memory::{Page, PAGE_SIZE};
    use crate::search::Cursor;
    use crate::witness_wire::{self, NodeInput, PageInput};

    use super::super::sliced_guest::tests::FixtureCode;

    struct TestKeccak;

    impl Keccak for TestKeccak {
        fn digest(&mut self, bytes: &[u8]) -> Digest {
            use tiny_keccak::Hasher;
            let mut hash = tiny_keccak::Keccak::v256();
            let mut out = [0; 32];
            hash.update(bytes);
            hash.finalize(&mut out);
            out
        }
    }

    fn request<'a>(
        hash: &mut TestKeccak,
        prior: SliceHead,
        continuation: Option<Continuation<'a>>,
        instruction_budget: u64,
    ) -> SliceRequest<'a> {
        SliceRequest {
            trusted_head: prior.commitment(hash),
            prior,
            continuation,
            opening_history: Some(b"e2e4"),
            max_witness_pages: 1,
            interpreter_limits: Limits {
                values: 32,
                locals: 32,
                calls: 8,
                blocks: 8,
            },
            instruction_budget,
        }
    }

    fn fixture_slice(
        hash: &mut TestKeccak,
        request: SliceRequest<'_>,
        page: &Page,
    ) -> (SliceOutcome, Vec<Replacement>) {
        let (driver, checkpoint) = authenticated_driver(hash, &request).unwrap();
        let prior = request.prior.checkpoint;
        let zeros = witness_wire::zero_subtrees(hash);
        let siblings: Vec<_> = (0..DEPTH)
            .map(|level| NodeInput::Digest(level, zeros[level as usize]))
            .collect();
        let packet = witness_wire::encode_archived(
            hash,
            &[(0, true, PageInput::Inline(page))],
            &siblings,
            95_000,
        )
        .unwrap();
        let mut backend = CompactResume::open(
            hash,
            checkpoint,
            prior,
            &packet,
            packet.len(),
            1,
            PAGE_SIZE * 2,
        )
        .unwrap();
        let mut globals = [prior.globals[0] as u128];
        let (result, memory_bytes) = {
            let memory =
                PagedMemory::<_, 1>::new(&mut backend, u64::from(prior.memory_bytes)).unwrap();
            let mut vm = Machine::new(
                FixtureCode,
                memory,
                &mut globals,
                request.interpreter_limits,
            );
            let result = drive(&mut vm, driver, &request).unwrap();
            vm.memory().flush().unwrap();
            (result, vm.memory().len() as u32)
        };
        seal(
            backend,
            hash,
            request.prior,
            result,
            [globals[0] as u64, 0, 0],
            memory_bytes,
        )
        .unwrap()
    }

    #[test]
    fn cold_micro_slice_authenticates_partial_stack_and_matches_direct_quantum() {
        let mut hash = TestKeccak;
        let initial = SliceHead::initial(Checkpoint {
            engine_identity: [1; 32],
            job_identity: [2; 32],
            memory_root: witness_wire::zero_subtrees(&mut hash)[DEPTH as usize],
            cursor: Cursor::default(),
            globals: [0; 3],
            memory_bytes: 65_536,
            complete: false,
        });
        let zero = [0; PAGE_SIZE];
        let start = request(&mut hash, initial, None, 4);
        let (first, pages) = fixture_slice(&mut hash, start, &zero);
        assert!(first.step.is_none());
        assert_eq!(first.head.checkpoint.cursor, initial.checkpoint.cursor);
        assert_ne!(
            first.head.checkpoint.memory_root,
            initial.checkpoint.memory_root
        );
        assert_eq!(first.head.instructions, 4);
        let context = first.continuation.as_ref().unwrap();
        assert!(Driver::decode(&context.driver).unwrap().in_flight());
        assert_eq!(pages.len(), 1);
        let mut page = [0; PAGE_SIZE];
        witness_wire::decode_page(pages[0].mode, &pages[0].bytes, &mut page).unwrap();
        assert_eq!(&page[4..8], b"e2e4");

        let mut forged = context.machine.clone();
        forged[0] ^= 1;
        let forged_request = request(
            &mut hash,
            first.head,
            Some(Continuation {
                driver: &context.driver,
                machine: &forged,
            }),
            100,
        );
        assert_eq!(
            authenticated_driver(&mut hash, &forged_request).err(),
            Some(HeadError::WrongContinuation)
        );
        let mut stale_request = request(&mut hash, first.head, Some(context.as_ref()), 100);
        stale_request.prior.instructions += 1;
        assert_eq!(
            authenticated_driver(&mut hash, &stale_request).err(),
            Some(HeadError::WrongHead)
        );

        let cold = request(&mut hash, first.head, Some(context.as_ref()), 100);
        let (second, _) = fixture_slice(&mut hash, cold, &page);
        let direct = request(&mut hash, initial, None, 100);
        let (expected, _) = fixture_slice(&mut hash, direct, &zero);
        assert_eq!(second.step, expected.step);
        assert_eq!(second.head, expected.head);
        assert!(second.continuation.is_none());
        assert_eq!(second.head.checkpoint.cursor.quanta, 1);
    }
}
