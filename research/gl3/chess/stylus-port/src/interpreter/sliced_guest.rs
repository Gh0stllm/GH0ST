//! Cooperative invocation sequence for a single pinned Stockfish quantum.
//!
//! The wrapper must authenticate the driver bytes and machine snapshot together
//! with the guest memory root, mutable globals, program and game history.

use crate::search::{Cursor, Decision, Step, NODES_PER_MOVE};

use super::{Executable, GuestMemory, InvocationProgress, Machine, Trap, Value};

const FREE: u32 = 419;
const ALLOC: u32 = 420;
const BEGIN: u32 = 435;
const ADVANCE: u32 = 437;
const OBSERVED: u32 = 438;
const ACTUAL: u32 = 439;
const STEPS: u32 = 440;
const DEPTH: u32 = 441;
const BEST: u32 = 442;
const PROVEN_TERMINAL_DEPTH: u32 = 245;

pub const DRIVER_STATE_BYTES: usize = 44;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Allocate,
    Begin(u32),
    Free {
        pointer: u32,
        pending: bool,
    },
    Advance,
    Steps(bool),
    Observed(bool),
    Best(u64),
    Actual {
        observed: u64,
        best_move: [u8; 5],
    },
    Depth {
        observed: u64,
        best_move: [u8; 5],
        actual: u64,
    },
    Finished,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Driver {
    prior: Cursor,
    phase: Phase,
    in_flight: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub enum DriverError<C, M> {
    Vm(Trap<C, M>),
    Memory(M),
    InvalidHistory,
    InvalidExportResult,
    InvalidProgress,
    IncompleteDecision,
    InconsistentMachine,
    Finished,
}

#[derive(Debug, Eq, PartialEq)]
pub struct DriverStateError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DriverProgress {
    Pending,
    Quantum(Step),
}

type ResultFor<T, C, M> =
    Result<T, DriverError<<C as Executable>::Error, <M as GuestMemory>::Error>>;

impl Driver {
    /// The caller must first supply a reviewed, initialized guest image.
    pub fn new(prior: Cursor) -> Result<Self, DriverStateError> {
        if prior.quanta == 0 && prior.observed_nodes != 0 {
            return Err(DriverStateError);
        }
        Ok(Self {
            prior,
            phase: if prior.quanta == 0 {
                Phase::Allocate
            } else {
                Phase::Advance
            },
            in_flight: false,
        })
    }

    pub fn cursor(&self) -> Cursor {
        self.prior
    }

    pub fn is_finished(&self) -> bool {
        self.phase == Phase::Finished
    }

    pub fn in_flight(&self) -> bool {
        self.in_flight
    }

    /// Execute at most the supplied number of guest instructions. The caller
    /// must discard all uncommitted writes after an error. Pending preserves
    /// the driver and machine together, including an export's active call stack.
    pub fn run<C: Executable, M: GuestMemory>(
        &mut self,
        machine: &mut Machine<'_, C, M>,
        opening_history: Option<&[u8]>,
        fuel: &mut u64,
    ) -> ResultFor<DriverProgress, C, M> {
        if self.is_finished() {
            return Err(DriverError::Finished);
        }
        if machine.is_active() != self.in_flight {
            return Err(DriverError::InconsistentMachine);
        }
        let history = match (self.prior.quanta, opening_history) {
            (0, Some(history)) if !history.is_empty() && history.len() <= 8192 => history,
            (0, _) | (_, Some(_)) => return Err(DriverError::InvalidHistory),
            (_, None) => &[],
        };
        let next_quanta = self
            .prior
            .quanta
            .checked_add(1)
            .ok_or(DriverError::InvalidProgress)?;

        while *fuel != 0 {
            if !self.in_flight {
                let mut args: [Value; 2] = [0; 2];
                let (function, length) = match self.phase {
                    Phase::Allocate => {
                        args[0] = history.len() as Value;
                        (ALLOC, 1)
                    }
                    Phase::Begin(pointer) => {
                        args = [pointer.into(), history.len() as Value];
                        (BEGIN, 2)
                    }
                    Phase::Free { pointer, .. } => {
                        args[0] = pointer.into();
                        (FREE, 1)
                    }
                    Phase::Advance => (ADVANCE, 0),
                    Phase::Steps(_) => (STEPS, 0),
                    Phase::Observed(_) => (OBSERVED, 0),
                    Phase::Best(_) => (BEST, 0),
                    Phase::Actual { .. } => (ACTUAL, 0),
                    Phase::Depth { .. } => (DEPTH, 0),
                    Phase::Finished => return Err(DriverError::Finished),
                };
                machine
                    .start(function, &args[..length])
                    .map_err(DriverError::Vm)?;
                self.in_flight = true;
            }

            let returned = match machine.run_for(fuel).map_err(DriverError::Vm)? {
                InvocationProgress::Pending => return Ok(DriverProgress::Pending),
                InvocationProgress::Returned(values) => match (self.phase, values) {
                    (Phase::Free { .. }, []) => 0,
                    (Phase::Free { .. }, _) => return Err(DriverError::InvalidExportResult),
                    (_, &[value]) => {
                        u64::try_from(value).map_err(|_| DriverError::InvalidExportResult)?
                    }
                    _ => return Err(DriverError::InvalidExportResult),
                },
            };
            self.in_flight = false;
            self.phase = match self.phase {
                Phase::Allocate => {
                    let pointer =
                        u32::try_from(returned).map_err(|_| DriverError::InvalidExportResult)?;
                    if pointer == 0 {
                        return Err(DriverError::InvalidExportResult);
                    }
                    machine
                        .memory()
                        .write(pointer, history)
                        .map_err(DriverError::Memory)?;
                    Phase::Begin(pointer)
                }
                Phase::Begin(pointer) => Phase::Free {
                    pointer,
                    pending: flag(returned)?,
                },
                Phase::Free { pending, .. } => Phase::Steps(pending),
                Phase::Advance => Phase::Steps(flag(returned)?),
                Phase::Steps(pending) => {
                    if returned != u64::from(next_quanta) {
                        return Err(DriverError::InvalidProgress);
                    }
                    Phase::Observed(pending)
                }
                Phase::Observed(pending) => {
                    if returned < self.prior.observed_nodes {
                        return Err(DriverError::InvalidProgress);
                    }
                    if pending {
                        self.prior = Cursor {
                            quanta: next_quanta,
                            observed_nodes: returned,
                        };
                        self.phase = Phase::Advance;
                        return Ok(DriverProgress::Quantum(Step {
                            cursor: self.prior,
                            decision: None,
                        }));
                    }
                    Phase::Best(returned)
                }
                Phase::Best(observed) => {
                    let pointer =
                        u32::try_from(returned).map_err(|_| DriverError::InvalidExportResult)?;
                    let mut bytes = [0; 6];
                    machine
                        .memory()
                        .read(pointer, &mut bytes)
                        .map_err(DriverError::Memory)?;
                    let best_move = bytes[..5].try_into().unwrap();
                    if !valid_move(&best_move) || (best_move[4] != 0 && bytes[5] != 0) {
                        return Err(DriverError::InvalidExportResult);
                    }
                    Phase::Actual {
                        observed,
                        best_move,
                    }
                }
                Phase::Actual {
                    observed,
                    best_move,
                } => Phase::Depth {
                    observed,
                    best_move,
                    actual: returned,
                },
                Phase::Depth {
                    observed,
                    best_move,
                    actual,
                } => {
                    let depth =
                        u32::try_from(returned).map_err(|_| DriverError::InvalidExportResult)?;
                    if depth == 0 || (actual < NODES_PER_MOVE && depth != PROVEN_TERMINAL_DEPTH) {
                        return Err(DriverError::IncompleteDecision);
                    }
                    self.prior = Cursor {
                        quanta: next_quanta,
                        observed_nodes: observed,
                    };
                    self.phase = Phase::Finished;
                    return Ok(DriverProgress::Quantum(Step {
                        cursor: self.prior,
                        decision: Some(Decision {
                            best_move,
                            actual_nodes: actual,
                            depth,
                        }),
                    }));
                }
                Phase::Finished => return Err(DriverError::Finished),
            };
        }
        Ok(DriverProgress::Pending)
    }

    /// GSD1, phase, in-flight, pending, allocation pointer, completed cursor,
    /// terminal observed/actual nodes, and terminal move. Integers are BE.
    /// Unused fields are zero, so each state has one representation.
    pub fn encode(&self) -> [u8; DRIVER_STATE_BYTES] {
        let mut out = [0; DRIVER_STATE_BYTES];
        out[..4].copy_from_slice(b"GSD1");
        out[5] = u8::from(self.in_flight);
        out[11..15].copy_from_slice(&self.prior.quanta.to_be_bytes());
        out[15..23].copy_from_slice(&self.prior.observed_nodes.to_be_bytes());
        let (tag, pending, pointer, observed, actual, best_move) = match self.phase {
            Phase::Allocate => (0, false, 0, 0, 0, [0; 5]),
            Phase::Begin(pointer) => (1, false, pointer, 0, 0, [0; 5]),
            Phase::Free { pointer, pending } => (2, pending, pointer, 0, 0, [0; 5]),
            Phase::Advance => (3, false, 0, 0, 0, [0; 5]),
            Phase::Steps(pending) => (4, pending, 0, 0, 0, [0; 5]),
            Phase::Observed(pending) => (5, pending, 0, 0, 0, [0; 5]),
            Phase::Best(observed) => (6, false, 0, observed, 0, [0; 5]),
            Phase::Actual {
                observed,
                best_move,
            } => (7, false, 0, observed, 0, best_move),
            Phase::Depth {
                observed,
                best_move,
                actual,
            } => (8, false, 0, observed, actual, best_move),
            Phase::Finished => (9, false, 0, 0, 0, [0; 5]),
        };
        out[4] = tag;
        out[6] = u8::from(pending);
        out[7..11].copy_from_slice(&pointer.to_be_bytes());
        out[23..31].copy_from_slice(&observed.to_be_bytes());
        out[31..39].copy_from_slice(&actual.to_be_bytes());
        out[39..44].copy_from_slice(&best_move);
        out
    }

    /// Decode only after authenticating the complete continuation commitment.
    pub fn decode(input: &[u8]) -> Result<Self, DriverStateError> {
        if input.len() != DRIVER_STATE_BYTES
            || &input[..4] != b"GSD1"
            || input[5] > 1
            || input[6] > 1
        {
            return Err(DriverStateError);
        }
        let pointer = u32::from_be_bytes(input[7..11].try_into().unwrap());
        let prior = Cursor {
            quanta: u32::from_be_bytes(input[11..15].try_into().unwrap()),
            observed_nodes: u64::from_be_bytes(input[15..23].try_into().unwrap()),
        };
        let observed = u64::from_be_bytes(input[23..31].try_into().unwrap());
        let actual = u64::from_be_bytes(input[31..39].try_into().unwrap());
        let best_move = input[39..44].try_into().unwrap();
        let pending = input[6] == 1;
        let in_flight = input[5] == 1;
        let phase = match input[4] {
            0 if prior.quanta == 0 => Phase::Allocate,
            1 if prior.quanta == 0 && pointer != 0 => Phase::Begin(pointer),
            2 if prior.quanta == 0 && pointer != 0 => Phase::Free { pointer, pending },
            3 if prior.quanta != 0 => Phase::Advance,
            4 => Phase::Steps(pending),
            5 => Phase::Observed(pending),
            6 if observed >= prior.observed_nodes => Phase::Best(observed),
            7 if observed >= prior.observed_nodes && valid_move(&best_move) => Phase::Actual {
                observed,
                best_move,
            },
            8 if observed >= prior.observed_nodes && valid_move(&best_move) => Phase::Depth {
                observed,
                best_move,
                actual,
            },
            9 if prior.quanta != 0 && !in_flight => Phase::Finished,
            _ => return Err(DriverStateError),
        };
        let driver = Self {
            prior,
            phase,
            in_flight,
        };
        if (prior.quanta == 0 && prior.observed_nodes != 0) || driver.encode() != input {
            return Err(DriverStateError);
        }
        Ok(driver)
    }
}

fn flag<C, M>(result: u64) -> Result<bool, DriverError<C, M>> {
    match result {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(DriverError::InvalidExportResult),
    }
}

fn valid_move(best_move: &[u8; 5]) -> bool {
    best_move[..4]
        .chunks_exact(2)
        .all(|square| matches!(square, [b'a'..=b'h', b'1'..=b'8']))
        && matches!(best_move[4], 0 | b'q' | b'r' | b'b' | b'n')
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::interpreter::{guest::Stockfish, ControlLink, Function, Limits, Signature};
    use crate::search::Guest;

    const BODIES: [&[u8]; 9] = [
        &[0x41, 4, 0x0b],                                  // ALLOC returns address 4.
        &[0x23, 0, 0x41, 1, 0x6a, 0x24, 0, 0x41, 1, 0x0b], // BEGIN advances and yields.
        &[0x0b],                                           // FREE returns no value.
        &[0x23, 0, 0x41, 1, 0x6a, 0x24, 0, 0x41, 0, 0x0b], // ADVANCE finishes.
        &[0x23, 0, 0x0b],                                  // STEPS returns global 0.
        &[0x41, 42, 0x0b],
        &[0x41, 20, 0x0b],
        &[0x42, 0xa1, 0xec, 0xb8, 0x0b, 0x0b], // 24,000,033 + end.
        &[0x41, 38, 0x0b],
    ];

    pub(in crate::interpreter) struct FixtureCode;

    impl Executable for FixtureCode {
        type Error = ();

        fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), ()> {
            let slot = (offset / 16) as usize;
            let start = (offset % 16) as usize;
            let body = BODIES.get(slot).ok_or(())?;
            output.copy_from_slice(body.get(start..start + output.len()).ok_or(())?);
            Ok(())
        }

        fn function(&mut self, index: u32) -> Result<Option<Function>, ()> {
            let (slot, params, results) = match index {
                ALLOC => (0, 1, 1),
                BEGIN => (1, 2, 1),
                FREE => (2, 1, 0),
                ADVANCE => (3, 0, 1),
                STEPS => (4, 0, 1),
                OBSERVED => (5, 0, 1),
                BEST => (6, 0, 1),
                ACTUAL => (7, 0, 1),
                DEPTH => (8, 0, 1),
                _ => return Ok(None),
            };
            Ok(Some(Function {
                entry: (slot * 16) as u32,
                end: (slot * 16 + BODIES[slot].len() - 1) as u32,
                extra_locals: 0,
                signature: Signature {
                    params,
                    results,
                    type_id: slot as u32,
                },
            }))
        }

        fn signature(&mut self, index: u32) -> Result<Signature, ()> {
            self.function(index)?.map(|f| f.signature).ok_or(())
        }
        fn control(&mut self, _: u32) -> Result<ControlLink, ()> {
            Err(())
        }
        fn indirect(&mut self, _: u32) -> Result<Option<u32>, ()> {
            Err(())
        }
    }

    struct Memory([u8; 32]);

    impl GuestMemory for Memory {
        type Error = ();

        fn read(&mut self, address: u32, output: &mut [u8]) -> Result<(), ()> {
            let start = address as usize;
            output.copy_from_slice(self.0.get(start..start + output.len()).ok_or(())?);
            Ok(())
        }

        fn write(&mut self, address: u32, input: &[u8]) -> Result<(), ()> {
            let start = address as usize;
            self.0
                .get_mut(start..start + input.len())
                .ok_or(())?
                .copy_from_slice(input);
            Ok(())
        }

        fn size(&self) -> u32 {
            self.0.len() as u32
        }
        fn grow(&mut self, _: u32) -> Option<u32> {
            None
        }
        fn copy(&mut self, _: u32, _: u32, _: u32) -> Result<(), ()> {
            Err(())
        }
        fn fill(&mut self, _: u32, _: u8, _: u32) -> Result<(), ()> {
            Err(())
        }
    }

    fn machine(globals: &mut [Value]) -> Machine<'_, FixtureCode, Memory> {
        let mut bytes = [0; 32];
        bytes[20..26].copy_from_slice(b"e7e5\0\0");
        Machine::new(
            FixtureCode,
            Memory(bytes),
            globals,
            Limits {
                values: 32,
                locals: 32,
                calls: 8,
                blocks: 8,
            },
        )
    }

    #[test]
    fn splits_begin_and_terminal_advance_at_single_instruction_boundaries() {
        let mut legacy_globals = [0];
        let mut legacy = Stockfish::new(machine(&mut legacy_globals), 100);
        let expected = [legacy.begin(b"e2e4").unwrap(), legacy.advance().unwrap()];

        let mut globals = [0];
        let mut vm = machine(&mut globals);
        let mut driver = Driver::new(Cursor::default()).unwrap();
        for (index, step) in expected.into_iter().enumerate() {
            let history = (index == 0).then_some(b"e2e4".as_slice());
            let mut actual = None;
            for _ in 0..100 {
                let mut fuel = 1;
                let progress = driver.run(&mut vm, history, &mut fuel).unwrap();
                assert_eq!(fuel, 0);
                if let DriverProgress::Quantum(step) = progress {
                    actual = Some(step);
                    break;
                }
                driver = Driver::decode(&driver.encode()).unwrap();
                let snapshot = vm.snapshot().unwrap();
                vm.restore(&snapshot).unwrap();
            }
            assert_eq!(actual, Some(step));
        }
        assert!(driver.is_finished());
        assert_eq!(driver.cursor(), expected[1].cursor);
        assert_eq!(vm.memory().0[4..8], *b"e2e4");
        assert_eq!(vm.memory().0, legacy.memory().0);
    }

    #[test]
    fn canonical_driver_snapshot_rejects_unused_bytes() {
        let initial = Driver::new(Cursor::default()).unwrap();
        let mut bytes = initial.encode();
        assert_eq!(Driver::decode(&bytes), Ok(initial));
        bytes[10] = 1;
        assert_eq!(Driver::decode(&bytes), Err(DriverStateError));
    }
}
