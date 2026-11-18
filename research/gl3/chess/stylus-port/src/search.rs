//! Transaction boundaries for the exact Stockfish continuation.
//!
//! A contract must bind `Guest` to reviewed executable code and a checkpoint
//! rooted in its own state. It must revert if this driver or the eventual
//! checkpoint commit fails. No caller-provided step outcome is used here.

pub const NODES_PER_MOVE: u64 = 24_000_000;
pub const NODES_PER_QUANTUM: u32 = 2_048;
pub const QUANTA_PER_TRANSACTION: u32 = 40;
const PROVEN_TERMINAL_DEPTH: u32 = 245;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Cursor {
    pub quanta: u32,
    pub observed_nodes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Decision {
    pub best_move: [u8; 5],
    pub actual_nodes: u64,
    pub depth: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Step {
    pub cursor: Cursor,
    pub decision: Option<Decision>,
}

pub trait Guest {
    type Error;

    /// Begin with the authoritative on-chain game history. Returns quantum 1.
    fn begin(&mut self, history: &[u8]) -> Result<Step, Self::Error>;

    /// Resume the exact recursion and return the next completed quantum.
    fn advance(&mut self) -> Result<Step, Self::Error>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GroupError<E> {
    BadStart,
    CursorOverflow,
    InvalidProgress,
    IncompleteDecision,
    Guest(E),
}

/// Execute one group. A pending search runs all 40 quanta. A terminal search
/// stops at the exact quantum where the original engine returns a decision.
/// The caller commits the updated checkpoint once, after this returns.
pub fn run_group<G: Guest>(
    guest: &mut G,
    prior: Cursor,
    expected_start: u32,
    opening_history: Option<&[u8]>,
) -> Result<Step, GroupError<G::Error>> {
    if prior.quanta != expected_start
        || (prior.quanta == 0) != opening_history.is_some()
        || (prior.quanta == 0 && prior.observed_nodes != 0)
    {
        return Err(GroupError::BadStart);
    }
    let limit = prior
        .quanta
        .checked_add(QUANTA_PER_TRANSACTION)
        .ok_or(GroupError::CursorOverflow)?;
    let mut cursor = prior;
    while cursor.quanta < limit {
        let step = if cursor.quanta == 0 {
            guest.begin(opening_history.ok_or(GroupError::BadStart)?)
        } else {
            guest.advance()
        }
        .map_err(GroupError::Guest)?;
        if step.cursor.quanta != cursor.quanta + 1
            || step.cursor.observed_nodes < cursor.observed_nodes
        {
            return Err(GroupError::InvalidProgress);
        }
        if let Some(decision) = step.decision {
            // Match the pinned guest's completed-search condition, including
            // its proven-terminal depth sentinel for games that end early.
            if decision.depth == 0
                || (decision.actual_nodes < NODES_PER_MOVE
                    && decision.depth != PROVEN_TERMINAL_DEPTH)
            {
                return Err(GroupError::IncompleteDecision);
            }
            return Ok(step);
        }
        cursor = step.cursor;
    }
    Ok(Step {
        cursor,
        decision: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        steps: u32,
        finish_at: u32,
        final_nodes: u64,
    }

    impl Guest for Fixture {
        type Error = ();

        fn begin(&mut self, _: &[u8]) -> Result<Step, Self::Error> {
            self.advance()
        }

        fn advance(&mut self) -> Result<Step, Self::Error> {
            self.steps += 1;
            let cursor = Cursor {
                quanta: self.steps,
                observed_nodes: u64::from(self.steps),
            };
            Ok(Step {
                cursor,
                decision: (self.steps == self.finish_at).then_some(Decision {
                    best_move: *b"e7e5\0",
                    actual_nodes: self.final_nodes,
                    depth: 38,
                }),
            })
        }
    }

    #[test]
    fn opens_and_resumes_with_a_final_partial_group() {
        let mut guest = Fixture {
            steps: 0,
            finish_at: 43,
            final_nodes: 24_000_033,
        };
        let first = run_group(&mut guest, Cursor::default(), 0, Some(b"e2e4")).unwrap();
        assert_eq!(first.cursor.quanta, 40);
        assert!(first.decision.is_none());
        let last = run_group(&mut guest, first.cursor, 40, None).unwrap();
        assert_eq!(last.cursor.quanta, 43);
        assert_eq!(last.decision.unwrap().actual_nodes, 24_000_033);
        assert_eq!(guest.steps, 43);
    }

    #[test]
    fn rejects_stale_requests_and_under_budget_results() {
        let mut guest = Fixture {
            steps: 0,
            finish_at: 1,
            final_nodes: NODES_PER_MOVE - 1,
        };
        assert_eq!(
            run_group(&mut guest, Cursor::default(), 1, Some(b"e2e4")),
            Err(GroupError::BadStart),
        );
        assert_eq!(guest.steps, 0);
        assert_eq!(
            run_group(&mut guest, Cursor::default(), 0, Some(b"e2e4")),
            Err(GroupError::IncompleteDecision),
        );
    }
}
