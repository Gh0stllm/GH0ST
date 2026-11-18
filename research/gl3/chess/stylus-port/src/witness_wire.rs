//! Lossless checkpoint witnesses. All decoded bytes are used only after they
//! reconstruct the authoritative page root. The producer supplies state bytes,
//! never a move or a precomputed transition.

use alloc::vec::Vec;

use crate::checkpoint_tree::{
    self, CheckpointError, Digest, Keccak, SiblingProof, DEPTH, MAX_PAGES,
};
use crate::memory::{Page, PAGE_SIZE};
use crate::rom::{BytecodeRom, CodeHost, IndexedArchive};

pub const TRANSACTION_BYTES: usize = 95_000;
/// Large witnesses are read from immutable on-chain bytecode only.
pub const CODE_WITNESS_BYTES: usize = 512 * 1024;
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
    Archive = 3,
}

impl Mode {
    pub(crate) fn from_byte(value: u8) -> Result<Self, WireError> {
        match value {
            0 => Ok(Self::Zero),
            1 => Ok(Self::Runs),
            2 => Ok(Self::Raw),
            3 => Ok(Self::Archive),
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
    ArchiveUnavailable,
}

/// Bytes must remain immutable for one complete group. The GL3 adapter uses
/// STOP-prefixed, code-hash-pinned contracts as the archive. The root proof
/// still authenticates each requested byte range against the game's state.
pub trait Archive {
    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), WireError>;
}

pub struct InlineArchive;

impl Archive for InlineArchive {
    fn read(&mut self, _: u32, _: &mut [u8]) -> Result<(), WireError> {
        Err(WireError::ArchiveUnavailable)
    }
}

impl<H: CodeHost, const RESIDENT: usize> Archive for BytecodeRom<'_, H, RESIDENT> {
    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), WireError> {
        self.read(offset, output)
            .map_err(|_| WireError::ArchiveUnavailable)
    }
}

impl<H: CodeHost, const RESIDENT: usize> Archive for IndexedArchive<'_, H, RESIDENT> {
    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), WireError> {
        self.read(offset, output)
            .map_err(|_| WireError::ArchiveUnavailable)
    }
}

pub(crate) fn decode_with_archive(
    mode: Mode,
    data: &[u8],
    out: &mut Page,
    archive: &mut impl Archive,
) -> Result<(), WireError> {
    if mode == Mode::Archive {
        let loc = u32::from_be_bytes(data.try_into().map_err(|_| WireError::BadPage)?);
        archive.read(loc, out)
    } else {
        decode_page(mode, data, out)
    }
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

pub(crate) struct PacketPages<'a> {
    pub(crate) count: usize,
    pub(crate) remaining: &'a [u8],
    previous: Option<u32>,
}

pub(crate) fn packet_pages(packet: &[u8], allowance: usize) -> Result<PacketPages<'_>, WireError> {
    if packet.len() > allowance.min(CODE_WITNESS_BYTES) {
        return Err(WireError::OverBudget);
    }
    let header = packet.get(..HEADER_BYTES).ok_or(WireError::Truncated)?;
    if &header[..4] != MAGIC {
        return Err(WireError::BadHeader);
    }
    let count = usize::from(u16::from_be_bytes([header[4], header[5]]));
    let remaining = &packet[HEADER_BYTES..];
    if count > remaining.len() / PAGE_HEADER_BYTES {
        return Err(WireError::Truncated);
    }

    Ok(PacketPages {
        count,
        remaining,
        previous: None,
    })
}

impl<'a> PacketPages<'a> {
    pub(crate) fn next_page(&mut self) -> Result<Option<WirePage<'a>>, WireError> {
        if self.count == 0 {
            return Ok(None);
        }
        let (header, rest) = self
            .remaining
            .split_at_checked(PAGE_HEADER_BYTES)
            .ok_or(WireError::Truncated)?;
        let index = u32::from_be_bytes([0, header[0], header[1], header[2]]);
        if index as usize >= MAX_PAGES || self.previous.is_some_and(|previous| index <= previous) {
            return Err(WireError::PageOrder);
        }
        let mode = Mode::from_byte(header[3] & !WRITABLE)?;
        let length = usize::from(u16::from_be_bytes([header[4], header[5]]));
        let (bytes, rest) = rest.split_at_checked(length).ok_or(WireError::Truncated)?;
        self.count -= 1;
        self.remaining = rest;
        self.previous = Some(index);
        Ok(Some(WirePage {
            index,
            writable: header[3] & WRITABLE != 0,
            mode,
            bytes,
        }))
    }
}

pub fn zero_subtrees(hash: &mut impl Keccak) -> [Digest; DEPTH as usize + 1] {
    let mut zeros = [[0; 32]; DEPTH as usize + 1];
    zeros[0] = checkpoint_tree::leaf(hash, &[0; PAGE_SIZE]);
    for level in 1..zeros.len() {
        zeros[level] = checkpoint_tree::parent(hash, zeros[level - 1], zeros[level - 1]);
    }
    zeros
}

pub(crate) struct CompactProof<'a, A> {
    pub(crate) remaining: &'a [u8],
    pub(crate) zero: &'a [Digest; DEPTH as usize + 1],
    pub(crate) archive: &'a mut A,
}

impl<A: Archive> SiblingProof for CompactProof<'_, A> {
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
            2 => {
                let (offset, rest) = self
                    .remaining
                    .split_at_checked(4)
                    .ok_or(CheckpointError::MissingSibling)?;
                self.remaining = rest;
                let mut value = [0; 32];
                self.archive
                    .read(u32::from_be_bytes(offset.try_into().unwrap()), &mut value)
                    .map_err(|_| CheckpointError::InvalidSibling)?;
                Ok(value)
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

#[derive(Clone, Copy)]
pub enum PageInput<'a> {
    Inline(&'a Page),
    Archive(u32),
}

#[derive(Clone, Copy)]
pub enum NodeInput {
    Digest(u32, Digest),
    Archive(u32),
}

/// Serialize a sorted page set and the existing traversal-ordered multiproof.
/// `siblings` contains each sibling digest and its level (zero is a leaf).
pub fn encode(
    hash: &mut impl Keccak,
    pages: &[InputPage<'_>],
    siblings: &[(u32, Digest)],
    allowance: usize,
) -> Result<Vec<u8>, WireError> {
    encode_packet(
        hash,
        pages.len(),
        pages
            .iter()
            .map(|p| (p.index, p.writable, PageInput::Inline(p.page))),
        siblings
            .iter()
            .map(|(level, value)| NodeInput::Digest(*level, *value)),
        allowance.min(TRANSACTION_BYTES - 1),
    )
}

/// Offsets address the contract's selected immutable checkpoint archive.
pub fn encode_archived<'a>(
    hash: &mut impl Keccak,
    pages: &[(u32, bool, PageInput<'a>)],
    siblings: &[NodeInput],
    allowance: usize,
) -> Result<Vec<u8>, WireError> {
    encode_packet(
        hash,
        pages.len(),
        pages.iter().copied(),
        siblings.iter().copied(),
        allowance.min(TRANSACTION_BYTES - 1),
    )
}

/// Encode a witness intended for immutable code cells. The transaction only
/// carries a manifest. The verifier still authenticates it against the root.
pub fn encode_code_witness<'a>(
    hash: &mut impl Keccak,
    pages: &[(u32, bool, PageInput<'a>)],
    siblings: &[NodeInput],
) -> Result<Vec<u8>, WireError> {
    encode_packet(
        hash,
        pages.len(),
        pages.iter().copied(),
        siblings.iter().copied(),
        CODE_WITNESS_BYTES,
    )
}

fn encode_packet<'a>(
    hash: &mut impl Keccak,
    count: usize,
    pages: impl Iterator<Item = (u32, bool, PageInput<'a>)>,
    siblings: impl Iterator<Item = NodeInput>,
    allowance: usize,
) -> Result<Vec<u8>, WireError> {
    let max = allowance;
    if max < HEADER_BYTES
        || count > (max - HEADER_BYTES) / PAGE_HEADER_BYTES
        || count > u16::MAX as usize
    {
        return Err(WireError::OverBudget);
    }
    let mut output = Vec::new();
    output
        .try_reserve_exact(max)
        .map_err(|_| WireError::Allocation)?;
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(count as u16).to_be_bytes());
    let mut scratch = [0; PAGE_SIZE];
    let mut previous = None;
    for (index, writable, source) in pages {
        if index as usize >= MAX_PAGES || previous.is_some_and(|prior| index <= prior) {
            return Err(WireError::PageOrder);
        }
        previous = Some(index);
        let (mode, len) = match source {
            PageInput::Inline(page) => encode_page(page, &mut scratch),
            PageInput::Archive(offset) => {
                scratch[..4].copy_from_slice(&offset.to_be_bytes());
                (Mode::Archive, 4)
            }
        };
        if output.len() + PAGE_HEADER_BYTES + len > max {
            return Err(WireError::OverBudget);
        }
        output.extend_from_slice(&index.to_be_bytes()[1..]);
        output.push(mode as u8 | if writable { WRITABLE } else { 0 });
        output.extend_from_slice(&(len as u16).to_be_bytes());
        output.extend_from_slice(&scratch[..len]);
    }
    let zeros = zero_subtrees(hash);
    let mut encoded = [0; 33];
    for node in siblings {
        let len = match node {
            NodeInput::Digest(level, sibling) => {
                let zero = zeros.get(level as usize).ok_or(WireError::BadHeader)?;
                if &sibling == zero {
                    encoded[0] = 0;
                    1
                } else {
                    encoded[0] = 1;
                    encoded[1..].copy_from_slice(&sibling);
                    33
                }
            }
            NodeInput::Archive(offset) => {
                encoded[0] = 2;
                encoded[1..5].copy_from_slice(&offset.to_be_bytes());
                5
            }
        };
        if output.len() + len > max {
            return Err(WireError::OverBudget);
        }
        output.extend_from_slice(&encoded[..len]);
    }
    Ok(output)
}
