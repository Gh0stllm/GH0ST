//! Bounded execution core for the validated, pinned Wasm guest. Code and
//! jump metadata come from authenticated ROM and guest memory is separate.

use alloc::vec::Vec;

pub mod guest;
mod memory_ops;
mod numeric;
pub mod rom_code;
mod simd;
#[cfg(test)]
mod tests;

pub type Value = u128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Signature {
    pub params: u16,
    pub results: u16,
    /// Canonical identifier for the complete parameter and result types.
    pub type_id: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Function {
    /// First opcode after local declarations.
    pub entry: u32,
    /// Offset of this function's final `end` opcode.
    pub end: u32,
    pub extra_locals: u32,
    pub signature: Signature,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ControlLink {
    pub end: u32,
    pub else_body: Option<u32>,
}

pub trait Executable {
    type Error;
    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), Self::Error>;
    /// Imported functions have no executable body and must return `None`.
    fn function(&mut self, index: u32) -> Result<Option<Function>, Self::Error>;
    fn signature(&mut self, index: u32) -> Result<Signature, Self::Error>;
    fn control(&mut self, opcode_offset: u32) -> Result<ControlLink, Self::Error>;
    /// Resolve an immutable funcref table index. A null entry returns `None`.
    fn indirect(&mut self, table_index: u32) -> Result<Option<u32>, Self::Error>;
}

pub trait GuestMemory {
    type Error;
    fn read(&mut self, address: u32, output: &mut [u8]) -> Result<(), Self::Error>;
    fn write(&mut self, address: u32, input: &[u8]) -> Result<(), Self::Error>;
    fn size(&self) -> u32;
    fn grow(&mut self, pages: u32) -> Option<u32>;
    fn copy(&mut self, dst: u32, src: u32, len: u32) -> Result<(), Self::Error>;
    fn fill(&mut self, dst: u32, byte: u8, len: u32) -> Result<(), Self::Error>;
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub values: usize,
    pub locals: usize,
    pub calls: usize,
    pub blocks: usize,
}

#[derive(Debug, Eq, PartialEq)]
pub enum Trap<C, M> {
    Code(C),
    Memory(M),
    MissingFunction,
    InvalidImmediate,
    InvalidProgramCounter,
    InvalidIndex,
    InvalidStack,
    IndirectTypeMismatch,
    ResourceLimit,
    Fuel,
    Unreachable,
    IntegerArithmetic,
    FloatConversion,
    UnsupportedOpcode(u32),
}

type VmTrap<C, M> = Trap<<C as Executable>::Error, <M as GuestMemory>::Error>;
type VmResult<T, C, M> = Result<T, VmTrap<C, M>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    Function,
    Block,
    Loop,
    If,
}

#[derive(Clone, Copy)]
struct Frame {
    resume: u32,
    end: u32,
    locals_base: usize,
    control_base: usize,
}

#[derive(Clone, Copy)]
struct Label {
    kind: Kind,
    start: u32,
    end: u32,
    bottom: usize,
    params: usize,
    results: usize,
}

pub struct Machine<'a, C: Executable, M: GuestMemory> {
    code: C,
    memory: M,
    globals: &'a mut [Value],
    limits: Limits,
    pc: u32,
    values: Vec<Value>,
    locals: Vec<Value>,
    calls: Vec<Frame>,
    controls: Vec<Label>,
}

impl<'a, C: Executable, M: GuestMemory> Machine<'a, C, M> {
    pub fn new(code: C, memory: M, globals: &'a mut [Value], limits: Limits) -> Self {
        Self {
            code,
            memory,
            globals,
            limits,
            pc: 0,
            values: Vec::new(),
            locals: Vec::new(),
            calls: Vec::new(),
            controls: Vec::new(),
        }
    }

    pub fn memory(&mut self) -> &mut M {
        &mut self.memory
    }

    /// Invoke a guest export. `fuel` is an instruction screen shared across
    /// invocations. Nitro separately meters the actual interpreter. If this
    /// traps, the caller must discard all state writes in this transaction.
    pub fn invoke(
        &mut self,
        function: u32,
        args: &[Value],
        fuel: &mut u64,
    ) -> VmResult<&[Value], C, M> {
        if !self.calls.is_empty() || args.len() > self.limits.values {
            return Err(Trap::ResourceLimit);
        }
        let function = self.lookup(function)?;
        if args.len() != usize::from(function.signature.params) {
            return Err(Trap::InvalidStack);
        }
        self.values.clear();
        self.values.extend_from_slice(args);
        self.enter(function)?;
        while !self.calls.is_empty() {
            *fuel = fuel.checked_sub(1).ok_or(Trap::Fuel)?;
            self.step()?;
        }
        Ok(&self.values)
    }

    fn lookup(&mut self, index: u32) -> VmResult<Function, C, M> {
        self.code
            .function(index)
            .map_err(Trap::Code)?
            .ok_or(Trap::MissingFunction)
    }

    fn raw<const N: usize>(&mut self) -> VmResult<[u8; N], C, M> {
        let offset = self.pc;
        let next = offset
            .checked_add(N as u32)
            .ok_or(Trap::InvalidProgramCounter)?;
        if next
            > self
                .calls
                .last()
                .ok_or(Trap::InvalidStack)?
                .end
                .saturating_add(1)
        {
            return Err(Trap::InvalidProgramCounter);
        }
        let mut result = [0; N];
        self.code.read(offset, &mut result).map_err(Trap::Code)?;
        self.pc = next;
        Ok(result)
    }

    fn byte(&mut self) -> VmResult<u8, C, M> {
        Ok(self.raw::<1>()?[0])
    }

    fn leb(&mut self, bits: u32, signed: bool) -> VmResult<u64, C, M> {
        let mut result = 0;
        for shift in (0..bits).step_by(7) {
            let byte = self.byte()?;
            let raw = u64::from(byte & 0x7f);
            let used = (bits - shift).min(7);
            let sign = signed && raw & (1 << (used - 1)) != 0;
            let high = raw >> used;
            if high != if sign { (1 << (7 - used)) - 1 } else { 0 } {
                return Err(Trap::InvalidImmediate);
            }
            result |= (raw & ((1 << used) - 1)) << shift;
            if byte & 0x80 == 0 {
                if sign && shift + used < 64 {
                    result |= u64::MAX << (shift + used);
                }
                return Ok(result);
            }
        }
        Err(Trap::InvalidImmediate)
    }

    fn u32(&mut self) -> VmResult<u32, C, M> {
        Ok(self.leb(32, false)? as u32)
    }

    fn take(&mut self) -> VmResult<Value, C, M> {
        if self.values.len() <= self.controls.last().ok_or(Trap::InvalidStack)?.bottom {
            return Err(Trap::InvalidStack);
        }
        self.values.pop().ok_or(Trap::InvalidStack)
    }

    fn push(&mut self, value: Value) -> VmResult<(), C, M> {
        if self.values.len() >= self.limits.values {
            return Err(Trap::ResourceLimit);
        }
        self.values.push(value);
        Ok(())
    }

    fn stack_bottom(&self, count: usize) -> VmResult<usize, C, M> {
        let bottom = self
            .values
            .len()
            .checked_sub(count)
            .ok_or(Trap::InvalidStack)?;
        if self
            .controls
            .last()
            .is_some_and(|label| bottom < label.bottom)
        {
            return Err(Trap::InvalidStack);
        }
        Ok(bottom)
    }

    fn enter(&mut self, function: Function) -> VmResult<(), C, M> {
        if function.entry > function.end {
            return Err(Trap::InvalidProgramCounter);
        }
        let params = usize::from(function.signature.params);
        let bottom = self.stack_bottom(params)?;
        let locals_base = self.locals.len();
        let locals_end = locals_base
            .checked_add(params + function.extra_locals as usize)
            .filter(|end| *end <= self.limits.locals)
            .ok_or(Trap::ResourceLimit)?;
        if self.calls.len() >= self.limits.calls || self.controls.len() >= self.limits.blocks {
            return Err(Trap::ResourceLimit);
        }
        self.locals.extend_from_slice(&self.values[bottom..]);
        self.locals.resize(locals_end, 0);
        self.values.truncate(bottom);
        self.calls.push(Frame {
            resume: self.pc,
            end: function.end,
            locals_base,
            control_base: self.controls.len(),
        });
        self.controls.push(Label {
            kind: Kind::Function,
            start: function.entry,
            end: function.end,
            bottom,
            params: 0,
            results: usize::from(function.signature.results),
        });
        self.pc = function.entry;
        Ok(())
    }

    fn keep(&mut self, bottom: usize, keep: usize) -> VmResult<(), C, M> {
        let start = self.stack_bottom(keep)?;
        if start < bottom {
            return Err(Trap::InvalidStack);
        }
        self.values.copy_within(start.., bottom);
        self.values.truncate(bottom + keep);
        Ok(())
    }

    fn leave_function(&mut self) -> VmResult<(), C, M> {
        let frame = *self.calls.last().ok_or(Trap::InvalidStack)?;
        let label = self.controls[frame.control_base];
        self.keep(label.bottom, label.results)?;
        self.locals.truncate(frame.locals_base);
        self.controls.truncate(frame.control_base);
        self.calls.pop();
        self.pc = frame.resume;
        Ok(())
    }

    fn open(&mut self, opcode: u8, offset: u32) -> VmResult<(), C, M> {
        let kind = match opcode {
            2 => Kind::Block,
            3 => Kind::Loop,
            _ => Kind::If,
        };
        let condition = kind != Kind::If || self.take()? as u32 != 0;
        let block_type = self.leb(33, true)? as i64;
        let (params, results) = match block_type {
            -64 => (0, 0),
            -5..=-1 => (0, 1),
            0.. => {
                let sig = self.code.signature(block_type as u32).map_err(Trap::Code)?;
                (usize::from(sig.params), usize::from(sig.results))
            }
            _ => return Err(Trap::InvalidImmediate),
        };
        let bottom = self.stack_bottom(params)?;
        let link = self.code.control(offset).map_err(Trap::Code)?;
        let outer_end = self.controls.last().ok_or(Trap::InvalidStack)?.end;
        if link.end < self.pc
            || link.end >= outer_end
            || link
                .else_body
                .is_some_and(|p| kind != Kind::If || p <= self.pc || p > link.end)
        {
            return Err(Trap::InvalidProgramCounter);
        }
        if self.controls.len() >= self.limits.blocks {
            return Err(Trap::ResourceLimit);
        }
        self.controls.push(Label {
            kind,
            start: self.pc,
            end: link.end,
            bottom,
            params,
            results,
        });
        if !condition {
            self.pc = link.else_body.unwrap_or(link.end);
        }
        Ok(())
    }

    fn jump(&mut self, depth: u32) -> VmResult<(), C, M> {
        let frame = self.calls.last().ok_or(Trap::InvalidStack)?;
        let index = self
            .controls
            .len()
            .checked_sub(depth as usize + 1)
            .filter(|index| *index >= frame.control_base)
            .ok_or(Trap::InvalidIndex)?;
        let label = self.controls[index];
        match label.kind {
            Kind::Function => self.leave_function(),
            Kind::Loop => {
                self.keep(label.bottom, label.params)?;
                self.controls.truncate(index + 1);
                self.pc = label.start;
                Ok(())
            }
            _ => {
                self.keep(label.bottom, label.results)?;
                self.controls.truncate(index);
                self.pc = label.end + 1;
                Ok(())
            }
        }
    }

    fn close(&mut self, offset: u32) -> VmResult<(), C, M> {
        let label = *self.controls.last().ok_or(Trap::InvalidStack)?;
        if label.end != offset {
            return Err(Trap::InvalidProgramCounter);
        }
        if label.kind == Kind::Function {
            return self.leave_function();
        }
        self.keep(label.bottom, label.results)?;
        self.controls.pop();
        Ok(())
    }

    fn local_index(&mut self) -> VmResult<usize, C, M> {
        let index = self.u32()? as usize;
        self.calls
            .last()
            .ok_or(Trap::InvalidStack)?
            .locals_base
            .checked_add(index)
            .filter(|index| *index < self.locals.len())
            .ok_or(Trap::InvalidIndex)
    }

    fn step(&mut self) -> VmResult<(), C, M> {
        let offset = self.pc;
        let opcode = self.byte()?;
        match opcode {
            0x00 => return Err(Trap::Unreachable),
            0x01 => (),
            0x02..=0x04 => self.open(opcode, offset)?,
            0x05 => {
                let block = self.controls.last().ok_or(Trap::InvalidStack)?;
                if block.kind != Kind::If || block.end < self.pc {
                    return Err(Trap::InvalidProgramCounter);
                }
                self.pc = block.end;
            }
            0x0b => self.close(offset)?,
            0x0c => {
                let depth = self.u32()?;
                self.jump(depth)?;
            }
            0x0d => {
                let depth = self.u32()?;
                if self.take()? as u32 != 0 {
                    self.jump(depth)?;
                }
            }
            0x0e => {
                let n = self.u32()?;
                let index = self.take()? as u32;
                // Control targets are variable-width immediates. Once the
                // selected label is decoded, the old PC will be discarded.
                for _ in 0..index.min(n) {
                    self.u32()?;
                }
                let depth = self.u32()?;
                self.jump(depth)?;
            }
            0x0f => self.leave_function()?,
            0x10 => {
                let index = self.u32()?;
                let function = self.lookup(index)?;
                self.enter(function)?;
            }
            0x11 => {
                let signature = self.u32()?;
                if self.u32()? != 0 {
                    return Err(Trap::InvalidImmediate);
                }
                let table_index = self.take()? as u32;
                let index = self
                    .code
                    .indirect(table_index)
                    .map_err(Trap::Code)?
                    .ok_or(Trap::MissingFunction)?;
                let function = self.lookup(index)?;
                let requested = self.code.signature(signature).map_err(Trap::Code)?;
                if requested != function.signature {
                    return Err(Trap::IndirectTypeMismatch);
                }
                self.enter(function)?;
            }
            0x1a => {
                self.take()?;
            }
            0x1b => {
                let condition = self.take()? as u32;
                let right = self.take()?;
                let left = self.take()?;
                self.push(if condition == 0 { right } else { left })?;
            }
            0x20 => {
                let index = self.local_index()?;
                self.push(self.locals[index])?;
            }
            0x21 | 0x22 => {
                let index = self.local_index()?;
                let value = self.take()?;
                self.locals[index] = value;
                if opcode == 0x22 {
                    self.push(value)?;
                }
            }
            0x23 => {
                let index = self.u32()? as usize;
                self.push(*self.globals.get(index).ok_or(Trap::InvalidIndex)?)?;
            }
            0x24 => {
                let index = self.u32()? as usize;
                let value = self.take()?;
                *self.globals.get_mut(index).ok_or(Trap::InvalidIndex)? = value;
            }
            0x28..=0x40 => self.memory_opcode(opcode)?,
            0x41 => {
                let value = self.leb(32, true)? as u32;
                self.push(value.into())?;
            }
            0x42 => {
                let value = self.leb(64, true)?;
                self.push(value.into())?;
            }
            0x43 => {
                let value = u32::from_le_bytes(self.raw()?);
                self.push(value.into())?;
            }
            0x44 => {
                let value = u64::from_le_bytes(self.raw()?);
                self.push(value.into())?;
            }
            0x45..=0xc4 => self.numeric(opcode)?,
            0xfc => self.bulk_opcode()?,
            0xfd => self.vector_opcode()?,
            _ => return Err(Trap::UnsupportedOpcode(opcode.into())),
        }
        Ok(())
    }
}
