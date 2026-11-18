use super::{simd, Executable, GuestMemory, Machine, Trap, Value, VmResult};
use crate::memory::{MemoryError, PageBackend, PagedMemory};

const WASM_PAGE: u64 = 65_536;
const MAX_WASM_PAGES: u32 = (crate::checkpoint_tree::MAX_MEMORY as u64 / WASM_PAGE) as u32;

impl<B: PageBackend, const RESIDENT: usize> GuestMemory for PagedMemory<B, RESIDENT> {
    type Error = MemoryError<B::Error>;

    fn read(&mut self, address: u32, output: &mut [u8]) -> Result<(), Self::Error> {
        self.read(address, output)
    }

    fn write(&mut self, address: u32, input: &[u8]) -> Result<(), Self::Error> {
        self.write(address, input)
    }

    fn size(&self) -> u32 {
        (self.len() / WASM_PAGE) as u32
    }

    fn grow(&mut self, pages: u32) -> Option<u32> {
        let old = self.size();
        if old.checked_add(pages)? > MAX_WASM_PAGES {
            return None;
        }
        self.grow(u64::from(pages) * WASM_PAGE).ok()?;
        Some(old)
    }

    fn copy(&mut self, dst: u32, src: u32, len: u32) -> Result<(), Self::Error> {
        self.copy(u64::from(dst), u64::from(src), len as usize)
    }

    fn fill(&mut self, dst: u32, byte: u8, len: u32) -> Result<(), Self::Error> {
        self.fill(u64::from(dst), byte, len as usize)
    }
}

impl<C: Executable, M: GuestMemory> Machine<'_, C, M> {
    fn memory_offset(&mut self) -> VmResult<u32, C, M> {
        // The validated guest uses memory32 and only memory index zero.
        if self.u32()? > 4 {
            return Err(Trap::InvalidImmediate);
        }
        self.u32()
    }

    fn address(&mut self, offset: u32) -> VmResult<u32, C, M> {
        (self.take()? as u32)
            .checked_add(offset)
            .ok_or(Trap::InvalidIndex)
    }

    fn read_bits(&mut self, offset: u32, bytes: usize) -> VmResult<Value, C, M> {
        let address = self.address(offset)?;
        let mut output = [0; 16];
        self.memory
            .read(address, &mut output[..bytes])
            .map_err(Trap::Memory)?;
        Ok(Value::from_le_bytes(output))
    }

    pub(super) fn memory_opcode(&mut self, opcode: u8) -> VmResult<(), C, M> {
        if opcode >= 0x3f {
            if self.u32()? != 0 {
                return Err(Trap::InvalidImmediate);
            }
            let pages = if opcode == 0x3f {
                self.memory.size()
            } else {
                let delta = self.take()? as u32;
                self.memory.grow(delta).unwrap_or(u32::MAX)
            };
            return self.push(pages.into());
        }
        let offset = self.memory_offset()?;
        let bytes = match opcode {
            0x28 | 0x2a | 0x34..=0x36 | 0x38 | 0x3e => 4,
            0x29 | 0x2b | 0x37 | 0x39 => 8,
            0x2c | 0x2d | 0x30 | 0x31 | 0x3a | 0x3c => 1,
            0x2e | 0x2f | 0x32 | 0x33 | 0x3b | 0x3d => 2,
            _ => return Err(Trap::UnsupportedOpcode(opcode.into())),
        };
        if opcode >= 0x36 {
            let value = self.take()?.to_le_bytes();
            let address = self.address(offset)?;
            return self
                .memory
                .write(address, &value[..bytes])
                .map_err(Trap::Memory);
        }
        let raw = self.read_bits(offset, bytes)?;
        let value = match opcode {
            0x2c => Value::from(raw as i8 as i32 as u32),
            0x2e => Value::from(raw as i16 as i32 as u32),
            0x30 => Value::from(raw as i8 as i64 as u64),
            0x32 => Value::from(raw as i16 as i64 as u64),
            0x34 => Value::from(raw as i32 as i64 as u64),
            _ => raw,
        };
        self.push(value)
    }

    pub(super) fn bulk_opcode(&mut self) -> VmResult<(), C, M> {
        let opcode = self.u32()?;
        match opcode {
            0..=7 => {
                let value = self.take()?;
                let result = self.saturating_conversion(opcode, value);
                self.push(result)
            }
            10 | 11 => {
                if self.u32()? != 0 || (opcode == 10 && self.u32()? != 0) {
                    return Err(Trap::InvalidImmediate);
                }
                let len = self.take()? as u32;
                let source = self.take()? as u32;
                let destination = self.take()? as u32;
                if opcode == 10 {
                    self.memory.copy(destination, source, len)
                } else {
                    self.memory.fill(destination, source as u8, len)
                }
                .map_err(Trap::Memory)
            }
            _ => Err(Trap::UnsupportedOpcode(0x30000 | opcode)),
        }
    }

    pub(super) fn vector_opcode(&mut self) -> VmResult<(), C, M> {
        let opcode = self.u32()?;
        let unsupported = Trap::UnsupportedOpcode(0x40000 | opcode);
        let value = match opcode {
            0x00 | 0x01 | 0x08 | 0x09 | 0x5c | 0x5d => {
                let offset = self.memory_offset()?;
                let bytes = match opcode {
                    0x00 => 16,
                    0x01 | 0x5d => 8,
                    0x08 => 2,
                    _ => 4,
                };
                let raw = self.read_bits(offset, bytes)?;
                match opcode {
                    0x01 => {
                        let mut lanes = 0u128;
                        for (lane, byte) in (raw as u64).to_le_bytes().into_iter().enumerate() {
                            let value = byte as i8 as i16 as u16;
                            lanes |= u128::from(value) << (lane * 16);
                        }
                        lanes
                    }
                    0x08 => raw * 0x00010001000100010001000100010001,
                    0x09 => raw * 0x00000001000000010000000100000001,
                    _ => raw,
                }
            }
            0x0b => {
                let offset = self.memory_offset()?;
                let value = self.take()?.to_le_bytes();
                let address = self.address(offset)?;
                return self.memory.write(address, &value).map_err(Trap::Memory);
            }
            0x0c => Value::from_le_bytes(self.raw()?),
            0x0d => {
                let indices = self.raw()?;
                let right = self.take()?;
                let left = self.take()?;
                simd::shuffle(left, right, indices).ok_or(Trap::InvalidImmediate)?
            }
            0x1b | 0x1d | 0x21 => {
                let lane = self.byte()?;
                let value = self.take()?;
                Value::from(simd::extract_lane(opcode, value, lane).ok_or(Trap::InvalidImmediate)?)
            }
            0x1c | 0x1e | 0x22 => {
                let lane = self.byte()?;
                let scalar = self.take()? as u64;
                let value = self.take()?;
                simd::replace_lane(opcode, value, lane, scalar).ok_or(Trap::InvalidImmediate)?
            }
            0x55 | 0x56 => {
                let offset = self.memory_offset()?;
                let lane = usize::from(self.byte()?);
                let value = self.take()?;
                let bytes = if opcode == 0x55 { 2 } else { 4 };
                let width = 8 * bytes;
                if lane >= 16 / bytes {
                    return Err(Trap::InvalidImmediate);
                }
                let shift = lane * width;
                let mask = ((1u128 << width) - 1) << shift;
                (value & !mask) | (self.read_bits(offset, bytes)? << shift)
            }
            _ => {
                let right = self.take()?;
                if let Some(result) = simd::unary(opcode, right) {
                    result
                } else {
                    let left = self.take()?;
                    simd::binary(opcode, left, right).ok_or(unsupported)?
                }
            }
        };
        self.push(value)
    }
}
