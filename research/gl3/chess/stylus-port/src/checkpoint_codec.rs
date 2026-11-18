//! Canonical overwrite records for one 4 KiB page, relative to its prior bytes.
//!
//! An empty record represents no change. Sparse records start with a 16-byte
//! bitmap. Bit `i % 8` of byte `i / 8` selects 32-byte word `i`; replacement
//! words follow in ascending index order. If all 128 words differ, the record
//! is the full replacement page. Length distinguishes the two formats.
//!
//! The caller authenticates the base page and binds the record to its page
//! index and checkpoint. Successful decoding establishes only encoding
//! validity relative to the provided base. It does not authenticate state.

use crate::memory::{Page, PAGE_SIZE};

pub const WORD_SIZE: usize = 32;
pub const WORD_COUNT: usize = PAGE_SIZE / WORD_SIZE;
pub const BITMAP_SIZE: usize = WORD_COUNT / 8;
pub const MAX_RECORD_LEN: usize = PAGE_SIZE;

#[derive(Debug, PartialEq, Eq)]
pub enum CodecError {
    OutputTooSmall { needed: usize },
    MalformedRecord,
    NonCanonicalRecord,
}

fn set_words(bitmap: &[u8]) -> impl Iterator<Item = usize> + '_ {
    (0..WORD_COUNT).filter(|&word| bitmap[word / 8] & (1 << (word % 8)) != 0)
}

/// Encodes a page change into caller-supplied space without allocation.
/// Only `out[..len]` is part of the record. On error, `out` is unchanged.
pub fn encode(previous: &Page, next: &Page, out: &mut [u8]) -> Result<usize, CodecError> {
    let mut bitmap = [0; BITMAP_SIZE];
    let mut changed = 0;
    for (word, (before, after)) in previous
        .chunks_exact(WORD_SIZE)
        .zip(next.chunks_exact(WORD_SIZE))
        .enumerate()
    {
        if before != after {
            bitmap[word / 8] |= 1 << (word % 8);
            changed += 1;
        }
    }

    let len = match changed {
        0 => return Ok(0),
        WORD_COUNT => PAGE_SIZE,
        _ => BITMAP_SIZE + changed * WORD_SIZE,
    };
    let record = out
        .get_mut(..len)
        .ok_or(CodecError::OutputTooSmall { needed: len })?;
    if changed == WORD_COUNT {
        record.copy_from_slice(next);
    } else {
        let (header, payload) = record.split_at_mut(BITMAP_SIZE);
        header.copy_from_slice(&bitmap);
        for (word, dest) in set_words(&bitmap).zip(payload.chunks_exact_mut(WORD_SIZE)) {
            let start = word * WORD_SIZE;
            dest.copy_from_slice(&next[start..start + WORD_SIZE]);
        }
    }
    Ok(len)
}

/// Applies a validated record in place without allocating or modifying the
/// page on error. All work is bounded by the contents of one page.
pub fn apply(page: &mut Page, record: &[u8]) -> Result<(), CodecError> {
    if record.is_empty() {
        return Ok(());
    }
    if record.len() == PAGE_SIZE {
        if page
            .chunks_exact(WORD_SIZE)
            .zip(record.chunks_exact(WORD_SIZE))
            .any(|(before, after)| before == after)
        {
            return Err(CodecError::NonCanonicalRecord);
        }
        page.copy_from_slice(record);
        return Ok(());
    }
    if !(BITMAP_SIZE..PAGE_SIZE).contains(&record.len()) {
        return Err(CodecError::MalformedRecord);
    }
    let (bitmap, payload) = record.split_at(BITMAP_SIZE);
    let changed: usize = bitmap.iter().map(|byte| byte.count_ones() as usize).sum();
    if changed == 0 || changed == WORD_COUNT {
        return Err(CodecError::NonCanonicalRecord);
    }
    if payload.len() != changed * WORD_SIZE {
        return Err(CodecError::MalformedRecord);
    }
    for (word, replacement) in set_words(bitmap).zip(payload.chunks_exact(WORD_SIZE)) {
        let start = word * WORD_SIZE;
        if &page[start..start + WORD_SIZE] == replacement {
            return Err(CodecError::NonCanonicalRecord);
        }
    }
    for (word, replacement) in set_words(bitmap).zip(payload.chunks_exact(WORD_SIZE)) {
        let start = word * WORD_SIZE;
        page[start..start + WORD_SIZE].copy_from_slice(replacement);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhaustive_changed_word_counts_round_trip() {
        let previous = [0x9a; PAGE_SIZE];
        let mut next = previous;
        for changed in 0..=WORD_COUNT {
            if changed > 0 {
                // 37 is coprime with 128, so this visits each word once.
                let word = (changed - 1) * 37 % WORD_COUNT;
                next[word * WORD_SIZE] ^= 1;
            }
            let mut output = [0x8e; MAX_RECORD_LEN];
            let mut round_trip = previous;
            let len = encode(&previous, &next, &mut output).unwrap();
            let expected = match changed {
                0 => 0,
                WORD_COUNT => PAGE_SIZE,
                _ => BITMAP_SIZE + WORD_SIZE * changed,
            };
            assert_eq!(len, expected);
            assert!(output[len..].iter().all(|&byte| byte == 0x8e));
            assert_eq!(apply(&mut round_trip, &output[..len]), Ok(()));
            assert_eq!(round_trip, next);
        }
    }

    #[test]
    fn bits_and_payload_have_stable_order_and_can_clear_words() {
        let mut previous = [0; PAGE_SIZE];
        previous[PAGE_SIZE - WORD_SIZE..].fill(91);
        let mut next = previous;
        for (word, byte) in [(0, 2), (7, 12), (8, 29), (127, 0)] {
            next[word * WORD_SIZE..(word + 1) * WORD_SIZE].fill(byte);
        }
        let mut output = [0; MAX_RECORD_LEN];
        let len = encode(&previous, &next, &mut output).unwrap();
        let mut header = [0; BITMAP_SIZE];
        header[0] = 0b1000_0001;
        header[1] = 0b0000_0001;
        header[15] = 0b1000_0000;
        assert_eq!(output[..BITMAP_SIZE], header);
        for (word, byte) in [2, 12, 29, 0].into_iter().enumerate() {
            assert_eq!(
                output[BITMAP_SIZE + word * WORD_SIZE..BITMAP_SIZE + (word + 1) * WORD_SIZE],
                [byte; WORD_SIZE]
            );
        }
        apply(&mut previous, &output[..len]).unwrap();
        assert_eq!(previous, next);
    }

    #[test]
    fn malformed_and_redundant_records_do_not_mutate_the_page() {
        let previous = [9; PAGE_SIZE];
        let mut next = previous;
        next[0] = 7;
        next[WORD_SIZE] = 8;
        let mut encoded = [0; MAX_RECORD_LEN];
        let len = encode(&previous, &next, &mut encoded).unwrap();

        let mut wrong_bitmap = encoded;
        wrong_bitmap[0] = 1;
        let mut redundant = encoded;
        redundant[BITMAP_SIZE + WORD_SIZE..len].fill(9);
        let mut raw_but_sparse = [4; PAGE_SIZE];
        raw_but_sparse[..WORD_SIZE].fill(9);
        let dense_sparse = [u8::MAX; BITMAP_SIZE + PAGE_SIZE];
        for (record, expected) in [
            (&encoded[..BITMAP_SIZE - 1], CodecError::MalformedRecord),
            (&encoded[..len - 1], CodecError::MalformedRecord),
            (&encoded[..len + 1], CodecError::MalformedRecord),
            (&wrong_bitmap[..len], CodecError::MalformedRecord),
            (&redundant[..len], CodecError::NonCanonicalRecord),
            (&[0; BITMAP_SIZE][..], CodecError::NonCanonicalRecord),
            (&raw_but_sparse[..], CodecError::NonCanonicalRecord),
            (&dense_sparse[..], CodecError::MalformedRecord),
        ] {
            let mut page = previous;
            assert_eq!(apply(&mut page, record), Err(expected));
            assert_eq!(page, previous);
        }
    }

    #[test]
    fn short_output_leaves_no_partial_record() {
        let previous = [0; PAGE_SIZE];
        let mut next = previous;
        next[0] = 1;
        let mut output = [0xb7; BITMAP_SIZE + WORD_SIZE - 1];
        assert_eq!(
            encode(&previous, &next, &mut output),
            Err(CodecError::OutputTooSmall {
                needed: BITMAP_SIZE + WORD_SIZE,
            })
        );
        assert!(output.iter().all(|&byte| byte == 0xb7));
    }

    #[test]
    fn checkpoint_records_preserve_other_words_and_require_an_authenticated_base() {
        let initial = [0; PAGE_SIZE];
        let mut restored = initial;
        let mut previous = initial;
        let mut stale = initial;
        stale[PAGE_SIZE - 1] = 55;
        let mut record = [0; MAX_RECORD_LEN];
        for value in [17, 3, 0] {
            let mut next = previous;
            next[0] = value;
            let len = encode(&previous, &next, &mut record).unwrap();
            apply(&mut restored, &record[..len]).unwrap();
            apply(&mut stale, &record[..len]).unwrap();
            assert_eq!(restored, next);
            assert_ne!(stale, next);
            previous = next;
        }
        assert_eq!(restored, initial);
    }
}
