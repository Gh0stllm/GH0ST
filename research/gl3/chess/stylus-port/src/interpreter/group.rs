//! Run the same Stockfish guest from authenticated state for one transaction.
//! Chain glue supplies a committed program, game, and checkpoint. It publishes
//! the returned root and page changes atomically or reverts on any failure.

use alloc::vec::Vec;

use crate::checkpoint_tree::{Digest, Keccak};
use crate::compact_resume::{CompactError, CompactResume, Replacement};
use crate::memory::{MemoryError, PageBackend, PagedMemory};
use crate::resume::{Checkpoint, Globals, ResumeBackend, ResumeError, WitnessPage};
use crate::rom::CodeHost;
use crate::search::{self, GroupError, Step};

use super::guest::{GuestError, Stockfish};
use super::rom_code::{ProgramError, RomCode};
use super::{Limits, Machine};

pub struct GroupRequest<'a> {
    /// Selected by the game contract from its stored job state.
    pub trusted_checkpoint: Digest,
    pub prior: Checkpoint,
    pub expected_start: u32,
    /// Provided by the contract's authoritative game history for group one.
    pub opening_history: Option<&'a [u8]>,
    pub max_witness_pages: usize,
    pub interpreter_limits: Limits,
    pub instruction_budget: u64,
}

pub struct GroupOutcome {
    pub checkpoint: Checkpoint,
    pub step: Step,
    pub instructions: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub enum ReplayError<E, B = ResumeError> {
    Checkpoint(B),
    Program(ProgramError<E>),
    Paging(MemoryError<B>),
    Search(GroupError<GuestError<ProgramError<E>, MemoryError<B>>>),
}

struct Executed {
    step: Step,
    memory_bytes: u32,
    instructions: u64,
    globals: Globals,
}

pub fn run_authenticated_group<
    H: CodeHost,
    const ROM_RESIDENT: usize,
    const LINK_CACHE: usize,
    const RAM_RESIDENT: usize,
>(
    code: RomCode<'_, H, ROM_RESIDENT, LINK_CACHE>,
    hash: &mut impl Keccak,
    request: GroupRequest<'_>,
    pages: &mut [WitnessPage<'_>],
    siblings: &[Digest],
) -> Result<GroupOutcome, ReplayError<H::Error>> {
    let prior = request.prior;
    let mut backend = ResumeBackend::new(
        hash,
        request.trusted_checkpoint,
        prior,
        pages,
        siblings,
        request.max_witness_pages,
    )
    .map_err(ReplayError::Checkpoint)?;
    let result =
        execute::<_, _, ROM_RESIDENT, LINK_CACHE, RAM_RESIDENT>(code, &request, &mut backend)?;
    let checkpoint = backend
        .finish(
            hash,
            result.step.cursor,
            result.globals,
            result.memory_bytes,
            result.step.decision.is_some(),
        )
        .map_err(ReplayError::Checkpoint)?;
    Ok(GroupOutcome {
        checkpoint,
        step: result.step,
        instructions: result.instructions,
    })
}

pub fn run_compact_group<
    H: CodeHost,
    const ROM_RESIDENT: usize,
    const LINK_CACHE: usize,
    const RAM_RESIDENT: usize,
>(
    code: RomCode<'_, H, ROM_RESIDENT, LINK_CACHE>,
    hash: &mut impl Keccak,
    request: GroupRequest<'_>,
    packet: &[u8],
    witness_allowance: usize,
    overlay_limit: usize,
) -> Result<(GroupOutcome, Vec<Replacement>), ReplayError<H::Error, CompactError>> {
    let mut backend = CompactResume::open(
        hash,
        request.trusted_checkpoint,
        request.prior,
        packet,
        witness_allowance,
        request.max_witness_pages,
        overlay_limit,
    )
    .map_err(ReplayError::Checkpoint)?;
    let result =
        execute::<_, _, ROM_RESIDENT, LINK_CACHE, RAM_RESIDENT>(code, &request, &mut backend)?;
    let commit = backend
        .finish(
            hash,
            result.step.cursor,
            result.globals,
            result.memory_bytes,
            result.step.decision.is_some(),
        )
        .map_err(ReplayError::Checkpoint)?;
    Ok((
        GroupOutcome {
            checkpoint: commit.checkpoint,
            step: result.step,
            instructions: result.instructions,
        },
        commit.replacements,
    ))
}

fn execute<
    H: CodeHost,
    B: PageBackend,
    const ROM_RESIDENT: usize,
    const LINK_CACHE: usize,
    const RAM_RESIDENT: usize,
>(
    mut code: RomCode<'_, H, ROM_RESIDENT, LINK_CACHE>,
    request: &GroupRequest<'_>,
    backend: &mut B,
) -> Result<Executed, ReplayError<H::Error, B::Error>> {
    let prior = request.prior;
    let mut globals = code
        .globals(Some(prior.globals))
        .map_err(ReplayError::Program)?;
    let (step, memory_bytes, instructions) = {
        let memory = PagedMemory::<_, RAM_RESIDENT>::new(backend, u64::from(prior.memory_bytes))
            .map_err(ReplayError::Paging)?;
        let machine = Machine::new(code, memory, &mut globals, request.interpreter_limits);
        let mut guest = Stockfish::new(machine, request.instruction_budget);
        let step = search::run_group(
            &mut guest,
            prior.cursor,
            request.expected_start,
            request.opening_history,
        )
        .map_err(ReplayError::Search)?;
        guest.memory().flush().map_err(ReplayError::Paging)?;
        (
            step,
            guest.memory().len() as u32,
            request.instruction_budget - guest.fuel_left(),
        )
    };
    let globals = RomCode::<H, ROM_RESIDENT, LINK_CACHE>::retained_globals(&globals)
        .map_err(ReplayError::Program)?;
    Ok(Executed {
        step,
        memory_bytes,
        instructions,
        globals,
    })
}
