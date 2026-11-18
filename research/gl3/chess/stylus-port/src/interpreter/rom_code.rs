//! Adapt exact instruction cells and generated lookup tables to the VM.

use crate::resume::Globals;
use crate::rom::{BytecodeRom, CodeHost, RomError, DEFINED_FUNCTIONS, FIRST_DEFINED_FUNCTION};

use super::{ControlLink, Executable, Function, Signature, Value};

const CONTROL_INDEX_ROWS: u32 = 24_778;
const CONTROL_ROW_BYTES: u32 = 12;
const HEADER_BYTES: u32 = 16;
const GLOBALS: usize = 100;
const TABLE: u32 = 473;
const CODE_BYTES: u32 = 870_051;
const MUTABLE_GLOBALS: [usize; 3] = [0, 98, 99];

#[derive(Debug, Eq, PartialEq)]
pub enum ProgramError<E> {
    Rom(RomError<E>),
    InvalidMetadata,
    OutOfBounds,
}

impl<E> From<RomError<E>> for ProgramError<E> {
    fn from(err: RomError<E>) -> Self {
        Self::Rom(err)
    }
}

#[derive(Clone, Copy)]
struct CachedLink {
    offset: u32,
    link: ControlLink,
}

/// ROM inputs are selected by the code and checkpoint identity committed by
/// the contract. The caller cannot replace the active manifest.
pub struct RomCode<'a, H: CodeHost, const RESIDENT: usize, const LINK_CACHE: usize> {
    code: BytecodeRom<'a, H, RESIDENT>,
    functions: BytecodeRom<'a, H, RESIDENT>,
    controls: BytecodeRom<'a, H, RESIDENT>,
    runtime: BytecodeRom<'a, H, RESIDENT>,
    signatures: u32,
    cached_links: [Option<CachedLink>; LINK_CACHE],
}

impl<'a, H: CodeHost, const RESIDENT: usize, const LINK_CACHE: usize>
    RomCode<'a, H, RESIDENT, LINK_CACHE>
{
    pub fn new(
        code: BytecodeRom<'a, H, RESIDENT>,
        functions: BytecodeRom<'a, H, RESIDENT>,
        controls: BytecodeRom<'a, H, RESIDENT>,
        mut runtime: BytecodeRom<'a, H, RESIDENT>,
    ) -> Result<Self, ProgramError<H::Error>> {
        let mut header = [0; HEADER_BYTES as usize];
        runtime.read(0, &mut header)?;
        let signatures = u32::from(u16::from_be_bytes([header[8], header[9]]));
        let table = u32::from(u16::from_be_bytes([header[10], header[11]]));
        let globals = usize::from(u16::from_be_bytes([header[12], header[13]]));
        if &header[..8] != b"GL3IR001"
            || signatures == 0
            || table != TABLE
            || globals != GLOBALS
            || header[14..] != [0, 0]
            || code.len() != CODE_BYTES
            || controls.len() != CONTROL_INDEX_ROWS * CONTROL_ROW_BYTES
            || runtime.len() != HEADER_BYTES + 6 * signatures + 2 * TABLE + 4 * GLOBALS as u32
        {
            return Err(ProgramError::InvalidMetadata);
        }
        Ok(Self {
            code,
            functions,
            controls,
            runtime,
            signatures,
            cached_links: [None; LINK_CACHE],
        })
    }

    pub fn globals(
        &mut self,
        restored: Option<Globals>,
    ) -> Result<[Value; GLOBALS], ProgramError<H::Error>> {
        let mut raw = [0u8; GLOBALS * 4];
        self.runtime
            .read(HEADER_BYTES + 6 * self.signatures + 2 * TABLE, &mut raw)?;
        let mut globals = [0; GLOBALS];
        for (out, word) in globals.iter_mut().zip(raw.chunks_exact(4)) {
            *out = Value::from(u32::from_le_bytes(word.try_into().unwrap()));
        }
        if let Some(restored) = restored {
            for (index, value) in MUTABLE_GLOBALS.into_iter().zip(restored) {
                globals[index] =
                    Value::from(u32::try_from(value).map_err(|_| ProgramError::InvalidMetadata)?);
            }
        }
        Ok(globals)
    }

    pub fn retained_globals(values: &[Value; GLOBALS]) -> Result<Globals, ProgramError<H::Error>> {
        let mut result = [0; 3];
        for (dst, index) in result.iter_mut().zip(MUTABLE_GLOBALS) {
            *dst =
                u64::from(u32::try_from(values[index]).map_err(|_| ProgramError::InvalidMetadata)?);
        }
        Ok(result)
    }

    fn byte_until(&mut self, pc: &mut u32, end: u32) -> Result<u8, ProgramError<H::Error>> {
        if *pc >= end {
            return Err(ProgramError::InvalidMetadata);
        }
        let mut byte = [0];
        self.code.read(*pc, &mut byte)?;
        *pc += 1;
        Ok(byte[0])
    }

    fn local_leb(&mut self, pc: &mut u32, end: u32) -> Result<u32, ProgramError<H::Error>> {
        let mut result = 0;
        for shift in (0..32).step_by(7) {
            let byte = self.byte_until(pc, end)?;
            if shift == 28 && byte > 0x0f {
                return Err(ProgramError::InvalidMetadata);
            }
            result |= u32::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
        }
        Err(ProgramError::InvalidMetadata)
    }

    fn control_link(&mut self, offset: u32) -> Result<ControlLink, ProgramError<H::Error>> {
        let mut low = 0;
        let mut high = CONTROL_INDEX_ROWS;
        while low < high {
            let row = low + (high - low) / 2;
            let mut raw = [0; CONTROL_ROW_BYTES as usize];
            self.controls.read(row * CONTROL_ROW_BYTES, &mut raw)?;
            let key = u32::from_be_bytes(raw[..4].try_into().unwrap());
            if key == offset {
                let end = u32::from_be_bytes(raw[4..8].try_into().unwrap());
                let next = u32::from_be_bytes(raw[8..].try_into().unwrap());
                return Ok(ControlLink {
                    end,
                    else_body: (next != u32::MAX).then_some(next),
                });
            }
            if key < offset {
                low = row + 1;
            } else {
                high = row;
            }
        }
        Err(ProgramError::OutOfBounds)
    }
}

impl<H: CodeHost, const RESIDENT: usize, const LINK_CACHE: usize> Executable
    for RomCode<'_, H, RESIDENT, LINK_CACHE>
{
    type Error = ProgramError<H::Error>;

    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), Self::Error> {
        Ok(self.code.read(offset, output)?)
    }

    fn function(&mut self, index: u32) -> Result<Option<Function>, Self::Error> {
        if index < FIRST_DEFINED_FUNCTION {
            return Ok(None);
        }
        let entry = self.functions.function(index, CODE_BYTES)?;
        let mut start = entry.offset;
        let end = start + u32::from(entry.len) - 1;
        let mut extra_locals = 0u32;
        for _ in 0..self.local_leb(&mut start, end)? {
            extra_locals = extra_locals
                .checked_add(self.local_leb(&mut start, end)?)
                .ok_or(ProgramError::InvalidMetadata)?;
            if !(0x7b..=0x7f).contains(&self.byte_until(&mut start, end)?) {
                return Err(ProgramError::InvalidMetadata);
            }
        }
        let signature = self.signature(u32::from(entry.type_index))?;
        Ok(Some(Function {
            entry: start,
            end,
            extra_locals,
            signature,
        }))
    }

    fn signature(&mut self, index: u32) -> Result<Signature, Self::Error> {
        if index >= self.signatures {
            return Err(ProgramError::OutOfBounds);
        }
        let mut raw = [0; 6];
        self.runtime.read(HEADER_BYTES + 6 * index, &mut raw)?;
        let signature = Signature {
            params: u16::from_be_bytes([raw[0], raw[1]]),
            results: u16::from_be_bytes([raw[2], raw[3]]),
            type_id: u32::from(u16::from_be_bytes([raw[4], raw[5]])),
        };
        if signature.type_id > index {
            return Err(ProgramError::InvalidMetadata);
        }
        Ok(signature)
    }

    fn control(&mut self, offset: u32) -> Result<ControlLink, Self::Error> {
        let cache = (LINK_CACHE != 0).then(|| offset as usize % LINK_CACHE);
        if let Some(hit) = cache
            .and_then(|slot| self.cached_links[slot])
            .filter(|hit| hit.offset == offset)
        {
            return Ok(hit.link);
        }
        let link = self.control_link(offset)?;
        if let Some(slot) = cache {
            self.cached_links[slot] = Some(CachedLink { offset, link });
        }
        Ok(link)
    }

    fn indirect(&mut self, index: u32) -> Result<Option<u32>, Self::Error> {
        if index >= TABLE {
            return Err(ProgramError::OutOfBounds);
        }
        let mut raw = [0; 2];
        self.runtime
            .read(HEADER_BYTES + self.signatures * 6 + index * 2, &mut raw)?;
        let function = u16::from_be_bytes(raw);
        if function == u16::MAX {
            return Ok(None);
        }
        if usize::from(function) >= DEFINED_FUNCTIONS + FIRST_DEFINED_FUNCTION as usize {
            return Err(ProgramError::InvalidMetadata);
        }
        Ok(Some(u32::from(function)))
    }
}
