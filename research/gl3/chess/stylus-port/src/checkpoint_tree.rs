//! Authenticate a sorted batch of pages against one checkpoint root and
//! derive the next root using the same Merkle proof. The contract must
//! compute each `after` page and bind the root to its cursor and memory length.

use crate::memory::{Page, PAGE_SIZE};

pub const MAX_MEMORY: usize = 768 * 1024 * 1024;
pub const MAX_PAGES: usize = MAX_MEMORY / PAGE_SIZE;
const DEPTH: u32 = (MAX_PAGES - 1).ilog2() + 1;
pub type Digest = [u8; 32];

pub trait Keccak {
    /// Keccak-256 as provided by the Stylus host. The engine owns this choice.
    fn digest(&mut self, bytes: &[u8]) -> Digest;
}

pub struct PageChange<'a> {
    pub index: u32,
    pub before: &'a Page,
    pub after: &'a Page,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CheckpointError {
    InvalidPageOrder,
    MissingSibling,
    UnusedSibling,
    WrongPriorRoot,
}

fn leaf(hash: &mut impl Keccak, page: &Page) -> Digest {
    let mut message = [0; PAGE_SIZE + 1];
    message[1..].copy_from_slice(page);
    hash.digest(&message)
}

fn parent(hash: &mut impl Keccak, left: Digest, right: Digest) -> Digest {
    let mut message = [1; 65];
    message[1..33].copy_from_slice(&left);
    message[33..].copy_from_slice(&right);
    hash.digest(&message)
}

fn branch(
    hash: &mut impl Keccak,
    changes: &[PageChange<'_>],
    siblings: &mut core::slice::Iter<'_, Digest>,
    levels: u32,
) -> Result<(Digest, Digest), CheckpointError> {
    if changes.is_empty() {
        let sibling = *siblings.next().ok_or(CheckpointError::MissingSibling)?;
        return Ok((sibling, sibling));
    }
    if levels == 0 {
        let change = &changes[0];
        let before = leaf(hash, change.before);
        let after = if change.before == change.after {
            before
        } else {
            leaf(hash, change.after)
        };
        return Ok((before, after));
    }
    let bit = 1 << (levels - 1);
    let split = changes.partition_point(|page| page.index & bit == 0);
    let (left_before, left_after) = branch(hash, &changes[..split], siblings, levels - 1)?;
    let (right_before, right_after) = branch(hash, &changes[split..], siblings, levels - 1)?;
    let before = parent(hash, left_before, right_before);
    let after = if left_before == left_after && right_before == right_after {
        before
    } else {
        parent(hash, left_after, right_after)
    };
    Ok((before, after))
}

/// The witness lists untouched subtree digests in left-to-right visited
/// order. A proof may open read-only pages by passing the same page twice.
/// Missing or excess witness bytes and reordered page indices are rejected.
/// The caller must never use the returned root unless the search actually
/// computed these changes and all reads were authenticated before execution.
pub fn replace_pages(
    hash: &mut impl Keccak,
    prior_root: Digest,
    changes: &[PageChange<'_>],
    siblings: &[Digest],
) -> Result<Digest, CheckpointError> {
    if changes.is_empty() {
        if siblings.is_empty() {
            return Ok(prior_root);
        }
        return Err(CheckpointError::UnusedSibling);
    }
    if changes[changes.len() - 1].index as usize >= MAX_PAGES
        || changes
            .windows(2)
            .any(|pair| pair[0].index >= pair[1].index)
    {
        return Err(CheckpointError::InvalidPageOrder);
    }
    let mut proof = siblings.iter();
    let (before, after) = branch(hash, changes, &mut proof, DEPTH)?;
    if proof.next().is_some() {
        return Err(CheckpointError::UnusedSibling);
    }
    if before != prior_root {
        return Err(CheckpointError::WrongPriorRoot);
    }
    Ok(after)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A deliberately simple fixture digest. Tests cover tree geometry and
    // rejection paths. Deployed code needs the real pinned Keccak host.
    struct Fixture;

    impl Keccak for Fixture {
        fn digest(&mut self, bytes: &[u8]) -> Digest {
            let mut output = [0u8; 32];
            for (index, byte) in bytes.iter().enumerate() {
                output[index % 32] = output[index % 32].wrapping_mul(7).wrapping_add(*byte);
            }
            output
        }
    }

    fn zero_path() -> ([Digest; DEPTH as usize], Digest) {
        let mut hash = Fixture;
        let mut siblings = [[0; 32]; DEPTH as usize];
        let mut node = leaf(&mut hash, &[0; PAGE_SIZE]);
        for sibling in &mut siblings {
            *sibling = node;
            node = parent(&mut hash, node, node);
        }
        (siblings, node)
    }

    #[test]
    fn adjacent_updates_share_all_ancestor_proofs() {
        let mut hash = Fixture;
        let (zero, prior_root) = zero_path();
        let before = [0; PAGE_SIZE];
        let after_left = [5; PAGE_SIZE];
        let after_right = [23; PAGE_SIZE];
        let changes = [
            PageChange {
                index: 0,
                before: &before,
                after: &after_left,
            },
            PageChange {
                index: 1,
                before: &before,
                after: &after_right,
            },
        ];
        let left = leaf(&mut hash, &after_left);
        let right = leaf(&mut hash, &after_right);
        let mut expected = parent(&mut hash, left, right);
        for sibling in &zero[1..] {
            expected = parent(&mut hash, expected, *sibling);
        }
        assert_eq!(
            replace_pages(&mut hash, prior_root, &changes, &zero[1..]),
            Ok(expected)
        );
        assert_eq!(
            replace_pages(&mut hash, prior_root, &changes, &zero),
            Err(CheckpointError::UnusedSibling)
        );
        assert_eq!(
            replace_pages(&mut hash, prior_root, &changes, &zero[2..]),
            Err(CheckpointError::MissingSibling)
        );
    }

    #[test]
    fn rejects_wrong_original_page_and_duplicate_indices() {
        let (proof, root) = zero_path();
        let zero = [0; PAGE_SIZE];
        let mut bad = zero;
        bad[7] = 1;
        let wrong = PageChange {
            index: 0,
            before: &bad,
            after: &zero,
        };
        assert_eq!(
            replace_pages(&mut Fixture, root, &[wrong], &proof),
            Err(CheckpointError::WrongPriorRoot)
        );
        let read = || PageChange {
            index: 0,
            before: &zero,
            after: &zero,
        };
        assert_eq!(
            replace_pages(&mut Fixture, root, &[read(), read()], &proof),
            Err(CheckpointError::InvalidPageOrder)
        );
        assert_eq!(
            replace_pages(&mut Fixture, root, &[read()], &proof),
            Ok(root)
        );
    }
}
