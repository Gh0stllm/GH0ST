//! Lossless checkpoint witnesses. All decoded bytes are used only after they
//! reconstruct the authoritative page root. The producer supplies state bytes,
//! never a move or a precomputed transition.

use alloc::vec::Vec;

use crate::checkpoint_tree::{
    self, CheckpointError, Digest, Keccak, SiblingProof, DEPTH, MAX_PAGES,
};
use crate::memory::{Page, PAGE_SIZE};

pub const TRANSACTION_BYTES: usize = 95_000;
const MAGIC: &[u8; 4] = b"GW01";
const HEADER_BYTES: usize = 6;
const PAGE_HEADER_BYTES: usize = 6;
const WRITABLE: u8 = 0x80;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Mode {
    Zero = 0,
    Runs = 1,
    Raw = 2,
}

impl Mode {
    pub(crate) fn from_byte(value: u8) -> Result<Self, WireError> {
        match value {
            0 => Ok(Self::Zero),
            1 => Ok(Self::Runs),
            2 => Ok(Self::Raw),
            _ => Err(WireError::BadPage),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum WireError {
    OverBudget,
    BadHeader,
    BadPage,
    PageOrder,
    Truncated,
    Allocation,
}

/// Runs use one command byte. High bit means zero fill, and low seven bits
/// plus one give the output length. Otherwise literal bytes follow.
pub fn encode_page(page: &Page, out: &mut Page) -> (Mode, usize) {
    if page.iter().all(|&byte| byte == 0) {
        return (Mode::Zero, 0);
    }
    let mut cursor = 0;
    let mut used = 0;
    while cursor < PAGE_SIZE {
        let limit = (cursor + 128).min(PAGE_SIZE);
        let zero = page[cursor] == 0;
        let end = if zero {
            cursor
                + page[cursor..limit]
                    .iter()
                    .take_while(|&&byte| byte == 0)
                    .count()
        } else {
            (cursor + 1..limit)
                .find(|&at| page[at..].starts_with(&[0, 0, 0]))
                .unwrap_or(limit)
        };
        let count = end - cursor;
        let literal = if zero { 0 } else { count };
        if used + 1 + literal >= PAGE_SIZE {
            out.copy_from_slice(page);
            return (Mode::Raw, PAGE_SIZE);
        }
        out[used] = ((count - 1) as u8) | if zero { 0x80 } else { 0 };
        used += 1;
        if !zero {
            out[used..used + literal].copy_from_slice(&page[cursor..end]);
            used += literal;
        }
        cursor = end;
    }
    (Mode::Runs, used)
}

pub fn decode_page(mode: Mode, mut data: &[u8], out: &mut Page) -> Result<(), WireError> {
    match mode {
        Mode::Zero if data.is_empty() => out.fill(0),
        Mode::Raw if data.len() == PAGE_SIZE => out.copy_from_slice(data),
        Mode::Runs if !data.is_empty() && data.len() < PAGE_SIZE => {
            let mut offset = 0;
            while let Some((&tag, remaining)) = data.split_first() {
                data = remaining;
                let count = usize::from(tag & 0x7f) + 1;
                let dst = out
                    .get_mut(offset..offset + count)
                    .ok_or(WireError::BadPage)?;
                if tag & 0x80 == 0 {
                    let (literal, remaining) =
                        data.split_at_checked(count).ok_or(WireError::Truncated)?;
                    dst.copy_from_slice(literal);
                    data = remaining;
                } else {
                    dst.fill(0);
                }
                offset += count;
            }
            if offset != PAGE_SIZE {
                return Err(WireError::Truncated);
            }
        }
        _ => return Err(WireError::BadPage),
    }
    Ok(())
}

pub(crate) struct WirePage<'a> {
    pub(crate) index: u32,
    pub(crate) writable: bool,
    pub(crate) mode: Mode,
    pub(crate) bytes: &'a [u8],
}

pub(crate) fn split_packet(
    packet: &[u8],
    allowance: usize,
) -> Result<(Vec<WirePage<'_>>, &[u8]), WireError> {
    if packet.len() > allowance || packet.len() >= TRANSACTION_BYTES {
        return Err(WireError::OverBudget);
    }
    let header = packet.get(..HEADER_BYTES).ok_or(WireError::Truncated)?;
    if &header[..4] != MAGIC {
        return Err(WireError::BadHeader);
    }
    let count = usize::from(u16::from_be_bytes([header[4], header[5]]));
    let mut remaining = &packet[HEADER_BYTES..];
    if count > remaining.len() / PAGE_HEADER_BYTES {
        return Err(WireError::Truncated);
    }

    let mut pages: Vec<WirePage<'_>> = Vec::new();
    pages
        .try_reserve_exact(count)
        .map_err(|_| WireError::Allocation)?;
    for _ in 0..count {
        let (header, rest) = remaining
            .split_at_checked(PAGE_HEADER_BYTES)
            .ok_or(WireError::Truncated)?;
        let index = u32::from_be_bytes([0, header[0], header[1], header[2]]);
        if index as usize >= MAX_PAGES || pages.last().is_some_and(|page| index <= page.index) {
            return Err(WireError::PageOrder);
        }
        let mode = Mode::from_byte(header[3] & !WRITABLE)?;
        let length = usize::from(u16::from_be_bytes([header[4], header[5]]));
        let (bytes, rest) = rest.split_at_checked(length).ok_or(WireError::Truncated)?;
        pages.push(WirePage {
            index,
            writable: header[3] & WRITABLE != 0,
            mode,
            bytes,
        });
        remaining = rest;
    }
    Ok((pages, remaining))
}

pub fn zero_subtrees(hash: &mut impl Keccak) -> [Digest; DEPTH as usize + 1] {
    let mut zeros = [[0; 32]; DEPTH as usize + 1];
    zeros[0] = checkpoint_tree::leaf(hash, &[0; PAGE_SIZE]);
    for level in 1..zeros.len() {
        zeros[level] = checkpoint_tree::parent(hash, zeros[level - 1], zeros[level - 1]);
    }
    zeros
}

pub(crate) struct CompactProof<'a> {
    pub(crate) remaining: &'a [u8],
    pub(crate) zero: &'a [Digest; DEPTH as usize + 1],
}

impl SiblingProof for CompactProof<'_> {
    fn node(&mut self, level: u32) -> Result<Digest, CheckpointError> {
        let (tag, rest) = self
            .remaining
            .split_first()
            .ok_or(CheckpointError::MissingSibling)?;
        self.remaining = rest;
        match tag {
            0 => Ok(self.zero[level as usize]),
            1 => {
                let (digest, rest) = self
                    .remaining
                    .split_at_checked(32)
                    .ok_or(CheckpointError::MissingSibling)?;
                self.remaining = rest;
                Ok(digest.try_into().unwrap())
            }
            _ => Err(CheckpointError::InvalidSibling),
        }
    }

    fn is_empty(&self) -> bool {
        self.remaining.is_empty()
    }
}

pub struct InputPage<'a> {
    pub index: u32,
    pub writable: bool,
    pub page: &'a Page,
}

/// Serialize a sorted page set and the existing traversal-ordered multiproof.
/// `siblings` contains each sibling digest and its level (zero is a leaf).
pub fn encode(
    hash: &mut impl Keccak,
    pages: &[InputPage<'_>],
    siblings: &[(u32, Digest)],
    allowance: usize,
) -> Result<Vec<u8>, WireError> {
    let max = allowance.min(TRANSACTION_BYTES - 1);
    if max < HEADER_BYTES || pages.len() > (max - HEADER_BYTES) / PAGE_HEADER_BYTES {
        return Err(WireError::OverBudget);
    }
    let mut output = Vec::new();
    output
        .try_reserve_exact(max)
        .map_err(|_| WireError::Allocation)?;
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(pages.len() as u16).to_be_bytes());
    let mut scratch = [0; PAGE_SIZE];
    let mut previous = None;
    for page in pages {
        if page.index as usize >= MAX_PAGES || previous.is_some_and(|index| page.index <= index) {
            return Err(WireError::PageOrder);
        }
        previous = Some(page.index);
        let (mode, len) = encode_page(page.page, &mut scratch);
        if output.len() + PAGE_HEADER_BYTES + len > max {
            return Err(WireError::OverBudget);
        }
        output.extend_from_slice(&page.index.to_be_bytes()[1..]);
        output.push(mode as u8 | if page.writable { WRITABLE } else { 0 });
        output.extend_from_slice(&(len as u16).to_be_bytes());
        output.extend_from_slice(&scratch[..len]);
    }
    let zeros = zero_subtrees(hash);
    for (level, sibling) in siblings {
        let zero = zeros.get(*level as usize).ok_or(WireError::BadHeader)?;
        let omit = sibling == zero;
        let bytes = if omit { 1 } else { 33 };
        if output.len() + bytes > max {
            return Err(WireError::OverBudget);
        }
        output.push(u8::from(!omit));
        if !omit {
            output.extend_from_slice(sibling);
        }
    }
    Ok(output)
}
