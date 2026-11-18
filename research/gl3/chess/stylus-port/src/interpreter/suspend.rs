//! Canonical instruction-boundary state. A caller must verify its commitment
//! with the same guest ROM, memory root, globals, and invocation driver phase.

use alloc::vec::Vec;

use super::{Executable, Frame, GuestMemory, Kind, Label, Machine, Value};

const VERSION: &[u8; 4] = b"GVM1";
const HEADER_BYTES: usize = 24;
const VALUE_BYTES: usize = 16;
const FRAME_BYTES: usize = 16;
const LABEL_BYTES: usize = 21;

#[derive(Debug, Eq, PartialEq)]
pub enum SnapshotError {
    Format,
    Limits,
    Stack,
}

impl<C: Executable, M: GuestMemory> Machine<'_, C, M> {
    /// Export the private execution stack and program counter. Guest memory and
    /// globals are already part of the enclosing transaction checkpoint.
    pub fn snapshot(&self) -> Result<Vec<u8>, SnapshotError> {
        let mut output = Vec::new();
        output.extend_from_slice(VERSION);
        output.extend_from_slice(&self.pc.to_be_bytes());
        for count in [
            self.values.len(),
            self.locals.len(),
            self.calls.len(),
            self.controls.len(),
        ] {
            word(&mut output, count)?;
        }
        for value in self.values.iter().chain(&self.locals) {
            output.extend_from_slice(&value.to_be_bytes());
        }
        for frame in &self.calls {
            output.extend_from_slice(&frame.resume.to_be_bytes());
            output.extend_from_slice(&frame.end.to_be_bytes());
            word(&mut output, frame.locals_base)?;
            word(&mut output, frame.control_base)?;
        }
        for label in &self.controls {
            output.push(match label.kind {
                Kind::Function => 0,
                Kind::Block => 1,
                Kind::Loop => 2,
                Kind::If => 3,
            });
            output.extend_from_slice(&label.start.to_be_bytes());
            output.extend_from_slice(&label.end.to_be_bytes());
            for count in [label.bottom, label.params, label.results] {
                word(&mut output, count)?;
            }
        }
        Ok(output)
    }

    /// Restore a snapshot authenticated by the enclosing checkpoint. Decode and
    /// check the entire byte string before changing the machine.
    pub fn restore(&mut self, encoded: &[u8]) -> Result<(), SnapshotError> {
        let mut reader = Reader(encoded);
        if &reader.take::<4>()? != VERSION {
            return Err(SnapshotError::Format);
        }
        let pc = reader.word()?;
        let values_len = reader.length(self.limits.values)?;
        let locals_len = reader.length(self.limits.locals)?;
        let calls_len = reader.length(self.limits.calls)?;
        let labels_len = reader.length(self.limits.blocks)?;
        let bounds = [
            (values_len, VALUE_BYTES),
            (locals_len, VALUE_BYTES),
            (calls_len, FRAME_BYTES),
            (labels_len, LABEL_BYTES),
        ];
        let size = bounds
            .into_iter()
            .try_fold(HEADER_BYTES, |total, (count, width)| {
                total.checked_add(count.checked_mul(width)?)
            });
        if size != Some(encoded.len()) {
            return Err(SnapshotError::Format);
        }

        let mut stack = |count| -> Result<Vec<Value>, SnapshotError> {
            (0..count)
                .map(|_| Ok(Value::from_be_bytes(reader.take()?)))
                .collect()
        };
        let values = stack(values_len)?;
        let locals = stack(locals_len)?;
        let mut calls: Vec<Frame> = Vec::with_capacity(calls_len);
        for _ in 0..calls_len {
            let frame = Frame {
                resume: reader.word()?,
                end: reader.word()?,
                locals_base: reader.length(locals_len)?,
                control_base: reader.length(labels_len.saturating_sub(1))?,
            };
            match calls.last() {
                None if frame.locals_base != 0 || frame.control_base != 0 => {
                    return Err(SnapshotError::Stack)
                }
                Some(parent)
                    if frame.locals_base < parent.locals_base
                        || frame.control_base <= parent.control_base
                        || frame.resume > parent.end =>
                {
                    return Err(SnapshotError::Stack);
                }
                _ => {}
            }
            calls.push(frame);
        }
        let mut controls = Vec::with_capacity(labels_len);
        let mut next_function = 0;
        for index in 0..labels_len {
            let kind = match reader.take::<1>()?[0] {
                0 => Kind::Function,
                1 => Kind::Block,
                2 => Kind::Loop,
                3 => Kind::If,
                _ => return Err(SnapshotError::Format),
            };
            let start = reader.word()?;
            let end = reader.word()?;
            let bottom = reader.length(values_len)?;
            let params = reader.length(self.limits.values)?;
            let results = reader.length(self.limits.values)?;
            if start > end {
                return Err(SnapshotError::Stack);
            }
            if kind == Kind::Function {
                let frame = calls.get(next_function).ok_or(SnapshotError::Stack)?;
                if frame.control_base != index || frame.end != end || params != 0 {
                    return Err(SnapshotError::Stack);
                }
                next_function += 1;
            } else if next_function == 0 {
                return Err(SnapshotError::Stack);
            }
            controls.push(Label {
                kind,
                start,
                end,
                bottom,
                params,
                results,
            });
        }
        if next_function != calls.len() || (calls.is_empty() && locals_len != 0) {
            return Err(SnapshotError::Stack);
        }
        if let Some(label) = controls.last() {
            if pc < label.start || pc > label.end {
                return Err(SnapshotError::Stack);
            }
        }
        self.pc = pc;
        self.values = values;
        self.locals = locals;
        self.calls = calls;
        self.controls = controls;
        Ok(())
    }
}

fn word(output: &mut Vec<u8>, number: usize) -> Result<(), SnapshotError> {
    output.extend_from_slice(
        &u32::try_from(number)
            .map_err(|_| SnapshotError::Limits)?
            .to_be_bytes(),
    );
    Ok(())
}

struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], SnapshotError> {
        let bytes = self.0.get(..N).ok_or(SnapshotError::Format)?;
        self.0 = &self.0[N..];
        Ok(bytes.try_into().unwrap())
    }

    fn word(&mut self) -> Result<u32, SnapshotError> {
        Ok(u32::from_be_bytes(self.take()?))
    }

    fn length(&mut self, limit: usize) -> Result<usize, SnapshotError> {
        let size = self.word()? as usize;
        if size > limit {
            return Err(SnapshotError::Limits);
        }
        Ok(size)
    }
}
