//! Run the same Stockfish guest from authenticated state for one transaction.
//! Chain glue supplies a committed program, game, and checkpoint. It publishes
//! the returned root and page changes atomically or reverts on any failure.

use crate::checkpoint_tree::{Digest, Keccak};
use crate::memory::{MemoryError, PagedMemory};
use crate::resume::{Checkpoint, ResumeBackend, ResumeError, WitnessPage};
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
pub enum ReplayError<E> {
    Checkpoint(ResumeError),
    Program(ProgramError<E>),
    Paging(MemoryError<ResumeError>),
    Search(GroupError<GuestError<ProgramError<E>, MemoryError<ResumeError>>>),
}

pub fn run_authenticated_group<
    H: CodeHost,
    const ROM_RESIDENT: usize,
    const LINK_CACHE: usize,
    const RAM_RESIDENT: usize,
>(
    mut code: RomCode<'_, H, ROM_RESIDENT, LINK_CACHE>,
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
    let mut globals = code
        .globals(Some(prior.globals))
        .map_err(ReplayError::Program)?;
    let (step, memory_bytes, instructions) = {
        let memory =
            PagedMemory::<_, RAM_RESIDENT>::new(&mut backend, u64::from(prior.memory_bytes))
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
    let retained = RomCode::<H, ROM_RESIDENT, LINK_CACHE>::retained_globals(&globals)
        .map_err(ReplayError::Program)?;
    let checkpoint = backend
        .finish(
            hash,
            step.cursor,
            retained,
            memory_bytes,
            step.decision.is_some(),
        )
        .map_err(ReplayError::Checkpoint)?;
    Ok(GroupOutcome {
        checkpoint,
        step,
        instructions,
    })
}
