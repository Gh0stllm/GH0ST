//! Bind the exact SIMD guest's audited exports to the existing group driver.

use crate::search::{Cursor, Decision, Guest, Step};

use super::{Executable, GuestMemory, Machine, Trap, Value};

const INIT: u32 = 14;
const FREE: u32 = 419;
const ALLOC: u32 = 420;
const INIT_ENGINE: u32 = 426;
const BEGIN: u32 = 435;
const ADVANCE: u32 = 437;
const OBSERVED: u32 = 438;
const ACTUAL: u32 = 439;
const STEPS: u32 = 440;
const DEPTH: u32 = 441;
const BEST: u32 = 442;

#[derive(Debug, Eq, PartialEq)]
pub enum GuestError<C, M> {
    Vm(Trap<C, M>),
    Memory(M),
    InvalidHistory,
    InvalidExportResult,
}

type ResultFor<T, C, M> =
    Result<T, GuestError<<C as Executable>::Error, <M as GuestMemory>::Error>>;

pub struct Stockfish<'a, C: Executable, M: GuestMemory> {
    machine: Machine<'a, C, M>,
    fuel: u64,
}

impl<'a, C: Executable, M: GuestMemory> Stockfish<'a, C, M> {
    pub fn new(machine: Machine<'a, C, M>, fuel: u64) -> Self {
        Self { machine, fuel }
    }

    pub fn memory(&mut self) -> &mut M {
        self.machine.memory()
    }

    pub fn fuel_left(&self) -> u64 {
        self.fuel
    }

    /// Use only for an authoritative new seed image. A resumed game uses
    /// the saved initialized guest and must never call this again.
    pub fn initialize(&mut self) -> ResultFor<(), C, M> {
        self.call_void(INIT, &[])?;
        if self.call(INIT_ENGINE, &[])? != 1 {
            return Err(GuestError::InvalidExportResult);
        }
        Ok(())
    }

    fn call_void(&mut self, index: u32, values: &[Value]) -> ResultFor<(), C, M> {
        if !self
            .machine
            .invoke(index, values, &mut self.fuel)
            .map_err(GuestError::Vm)?
            .is_empty()
        {
            return Err(GuestError::InvalidExportResult);
        }
        Ok(())
    }

    fn call(&mut self, index: u32, values: &[Value]) -> ResultFor<u64, C, M> {
        match self
            .machine
            .invoke(index, values, &mut self.fuel)
            .map_err(GuestError::Vm)?
        {
            &[value] => u64::try_from(value).map_err(|_| GuestError::InvalidExportResult),
            _ => Err(GuestError::InvalidExportResult),
        }
    }

    fn word(&mut self, index: u32) -> ResultFor<u32, C, M> {
        u32::try_from(self.call(index, &[])?).map_err(|_| GuestError::InvalidExportResult)
    }

    fn progress(&mut self, pending: u64) -> ResultFor<Step, C, M> {
        if pending > 1 {
            return Err(GuestError::InvalidExportResult);
        }
        let cursor = Cursor {
            quanta: self.word(STEPS)?,
            observed_nodes: self.call(OBSERVED, &[])?,
        };
        let decision = if pending == 1 {
            None
        } else {
            let pointer = self.word(BEST)?;
            let mut output = [0; 6];
            self.memory()
                .read(pointer, &mut output)
                .map_err(GuestError::Memory)?;
            let (mv, suffix) = output.split_at(4);
            if !mv
                .chunks_exact(2)
                .all(|square| matches!(square, [b'a'..=b'h', b'1'..=b'8']))
                || !matches!(suffix, [0, _] | [b'q' | b'r' | b'b' | b'n', 0])
            {
                return Err(GuestError::InvalidExportResult);
            }
            Some(Decision {
                best_move: output[..5].try_into().unwrap(),
                actual_nodes: self.call(ACTUAL, &[])?,
                depth: self.word(DEPTH)?,
            })
        };
        Ok(Step { cursor, decision })
    }
}

impl<C: Executable, M: GuestMemory> Guest for Stockfish<'_, C, M> {
    type Error = GuestError<C::Error, M::Error>;

    fn begin(&mut self, history: &[u8]) -> Result<Step, Self::Error> {
        if history.is_empty() || history.len() > 8192 {
            return Err(GuestError::InvalidHistory);
        }
        let len = history.len() as Value;
        let pointer = u32::try_from(self.call(ALLOC, &[len])?)
            .map_err(|_| GuestError::InvalidExportResult)?;
        if pointer == 0 {
            return Err(GuestError::InvalidExportResult);
        }
        self.memory()
            .write(pointer, history)
            .map_err(GuestError::Memory)?;
        let pending = self.call(BEGIN, &[pointer.into(), len])?;
        self.call_void(FREE, &[pointer.into()])?;
        self.progress(pending)
    }

    fn advance(&mut self) -> Result<Step, Self::Error> {
        let pending = self.call(ADVANCE, &[])?;
        self.progress(pending)
    }
}
