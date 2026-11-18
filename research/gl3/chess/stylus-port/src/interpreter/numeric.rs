use super::{Executable, GuestMemory, Machine, Trap, Value, VmResult};

fn f32_bits(value: f32) -> Value {
    if value.is_nan() {
        0x7fc0_0000
    } else {
        value.to_bits().into()
    }
}

fn f64_bits(value: f64) -> Value {
    if value.is_nan() {
        0x7ff8_0000_0000_0000
    } else {
        value.to_bits().into()
    }
}

fn compare(op: u8, eq: bool, lt: bool, gt: bool, le: bool, ge: bool) -> Value {
    Value::from(match op {
        0 => eq,
        1 => !eq,
        2 => lt,
        3 => gt,
        4 => le,
        _ => ge,
    })
}

fn float_integer(value: f64, wide: bool, signed: bool, saturate: bool) -> Option<Value> {
    if value.is_nan() {
        return saturate.then_some(0);
    }
    let truncated = libm::trunc(value);
    let (low, high) = match (wide, signed) {
        (false, false) => (0.0, 4_294_967_296.0),
        (false, true) => (-2_147_483_648.0, 2_147_483_648.0),
        (true, false) => (0.0, 18_446_744_073_709_551_616.0),
        (true, true) => (-9_223_372_036_854_775_808.0, 9_223_372_036_854_775_808.0),
    };
    if !saturate && (truncated < low || truncated >= high) {
        return None;
    }
    Some(match (wide, signed) {
        (false, false) => Value::from(truncated as u32),
        (false, true) => Value::from(truncated as i32 as u32),
        (true, false) => Value::from(truncated as u64),
        (true, true) => Value::from(truncated as i64 as u64),
    })
}

impl<C: Executable, M: GuestMemory> Machine<'_, C, M> {
    pub(super) fn saturating_conversion(&self, opcode: u32, value: Value) -> Value {
        let wide = opcode >= 4;
        let signed = opcode & 1 == 0;
        let input = if opcode & 2 == 0 {
            f64::from(f32::from_bits(value as u32))
        } else {
            f64::from_bits(value as u64)
        };
        float_integer(input, wide, signed, true).unwrap_or(0)
    }

    pub(super) fn numeric(&mut self, op: u8) -> VmResult<(), C, M> {
        let right = self.take()?;
        let r32 = right as u32;
        let r64 = right as u64;
        let f32r = f32::from_bits(r32);
        let f64r = f64::from_bits(r64);
        let result = match op {
            0x45 => Value::from(r32 == 0),
            0x50 => Value::from(r64 == 0),
            0x67 => Value::from(r32.leading_zeros()),
            0x68 => Value::from(r32.trailing_zeros()),
            0x69 => Value::from(r32.count_ones()),
            0x79 => Value::from(r64.leading_zeros()),
            0x7a => Value::from(r64.trailing_zeros()),
            0x7b => Value::from(r64.count_ones()),
            0x8b => Value::from(r32 & 0x7fff_ffff),
            0x8c => Value::from(r32 ^ 0x8000_0000),
            0x8d => f32_bits(libm::ceilf(f32r)),
            0x8e => f32_bits(libm::floorf(f32r)),
            0x8f => f32_bits(libm::truncf(f32r)),
            0x91 => f32_bits(libm::sqrtf(f32r)),
            0x99 => Value::from(r64 & 0x7fff_ffff_ffff_ffff),
            0x9a => Value::from(r64 ^ 0x8000_0000_0000_0000),
            0x9b => f64_bits(libm::ceil(f64r)),
            0x9c => f64_bits(libm::floor(f64r)),
            0x9d => f64_bits(libm::trunc(f64r)),
            0x9f => f64_bits(libm::sqrt(f64r)),
            0xa7 | 0xbc | 0xbe => Value::from(r32),
            0xa8..=0xab | 0xae..=0xb1 => {
                let wide = op >= 0xae;
                let base = if wide { 0xae } else { 0xa8 };
                let kind = op - base;
                let value = if kind & 2 == 0 { f64::from(f32r) } else { f64r };
                float_integer(value, wide, kind & 1 == 0, false).ok_or(Trap::FloatConversion)?
            }
            0xac => Value::from(r32 as i32 as i64 as u64),
            0xad => Value::from(r32),
            0xb2 => f32_bits(r32 as i32 as f32),
            0xb3 => f32_bits(r32 as f32),
            0xb4 => f32_bits(r64 as i64 as f32),
            0xb5 => f32_bits(r64 as f32),
            0xb6 => f32_bits(f64r as f32),
            0xb7 => f64_bits(r32 as i32 as f64),
            0xb8 => f64_bits(r32 as f64),
            0xb9 => f64_bits(r64 as i64 as f64),
            0xba => f64_bits(r64 as f64),
            0xbb => f64_bits(f64::from(f32r)),
            0xbd | 0xbf => Value::from(r64),
            0xc0 => Value::from(r32 as i8 as i32 as u32),
            0xc1 => Value::from(r32 as i16 as i32 as u32),
            0xc2 => Value::from(r64 as i8 as i64 as u64),
            0xc3 => Value::from(r64 as i16 as i64 as u64),
            0xc4 => Value::from(r64 as i32 as i64 as u64),
            0x46..=0x4f | 0x6a..=0x78 => {
                let left = self.take()? as u32;
                Value::from(Self::integer32(op, left, r32)?)
            }
            0x51..=0x5a | 0x7c..=0x8a => {
                let left = self.take()? as u64;
                Value::from(Self::integer64(op, left, r64)?)
            }
            0x5b..=0x60 | 0x92..=0x98 => {
                let bits = self.take()? as u32;
                let left = f32::from_bits(bits);
                match op {
                    0x5b..=0x60 => compare(
                        op - 0x5b,
                        left == f32r,
                        left < f32r,
                        left > f32r,
                        left <= f32r,
                        left >= f32r,
                    ),
                    0x92 => f32_bits(left + f32r),
                    0x93 => f32_bits(left - f32r),
                    0x94 => f32_bits(left * f32r),
                    0x95 => f32_bits(left / f32r),
                    0x96 => f32_bits(if left.is_nan() || f32r.is_nan() {
                        f32::NAN
                    } else if left == f32r {
                        f32::from_bits(bits | r32)
                    } else {
                        left.min(f32r)
                    }),
                    0x97 => f32_bits(if left.is_nan() || f32r.is_nan() {
                        f32::NAN
                    } else if left == f32r {
                        f32::from_bits(bits & r32)
                    } else {
                        left.max(f32r)
                    }),
                    _ => Value::from((bits & 0x7fff_ffff) | (r32 & 0x8000_0000)),
                }
            }
            0x61..=0x66 | 0xa0..=0xa6 => {
                let bits = self.take()? as u64;
                let left = f64::from_bits(bits);
                match op {
                    0x61..=0x66 => compare(
                        op - 0x61,
                        left == f64r,
                        left < f64r,
                        left > f64r,
                        left <= f64r,
                        left >= f64r,
                    ),
                    0xa0 => f64_bits(left + f64r),
                    0xa1 => f64_bits(left - f64r),
                    0xa2 => f64_bits(left * f64r),
                    0xa3 => f64_bits(left / f64r),
                    0xa4 => f64_bits(if left.is_nan() || f64r.is_nan() {
                        f64::NAN
                    } else if left == f64r {
                        f64::from_bits(bits | r64)
                    } else {
                        left.min(f64r)
                    }),
                    0xa5 => f64_bits(if left.is_nan() || f64r.is_nan() {
                        f64::NAN
                    } else if left == f64r {
                        f64::from_bits(bits & r64)
                    } else {
                        left.max(f64r)
                    }),
                    _ => {
                        Value::from((bits & 0x7fff_ffff_ffff_ffff) | (r64 & 0x8000_0000_0000_0000))
                    }
                }
            }
            _ => return Err(Trap::UnsupportedOpcode(op.into())),
        };
        self.push(result)
    }

    fn integer32(op: u8, a: u32, b: u32) -> VmResult<u32, C, M> {
        let (x, y) = (a as i32, b as i32);
        Ok(match op {
            0x46 => u32::from(a == b),
            0x47 => u32::from(a != b),
            0x48 => u32::from(x < y),
            0x49 => u32::from(a < b),
            0x4a => u32::from(x > y),
            0x4b => u32::from(a > b),
            0x4c => u32::from(x <= y),
            0x4d => u32::from(a <= b),
            0x4e => u32::from(x >= y),
            0x4f => u32::from(a >= b),
            0x6a => a.wrapping_add(b),
            0x6b => a.wrapping_sub(b),
            0x6c => a.wrapping_mul(b),
            0x6d => x.checked_div(y).ok_or(Trap::IntegerArithmetic)? as u32,
            0x6e => a.checked_div(b).ok_or(Trap::IntegerArithmetic)?,
            0x6f => {
                if y == 0 {
                    return Err(Trap::IntegerArithmetic);
                } else {
                    x.wrapping_rem(y) as u32
                }
            }
            0x70 => a.checked_rem(b).ok_or(Trap::IntegerArithmetic)?,
            0x71 => a & b,
            0x72 => a | b,
            0x73 => a ^ b,
            0x74 => a.wrapping_shl(b),
            0x75 => x.wrapping_shr(b) as u32,
            0x76 => a.wrapping_shr(b),
            0x77 => a.rotate_left(b),
            0x78 => a.rotate_right(b),
            _ => return Err(Trap::UnsupportedOpcode(op.into())),
        })
    }

    fn integer64(op: u8, a: u64, b: u64) -> VmResult<u64, C, M> {
        let (x, y) = (a as i64, b as i64);
        Ok(match op {
            0x51 => u64::from(a == b),
            0x52 => u64::from(a != b),
            0x53 => u64::from(x < y),
            0x54 => u64::from(a < b),
            0x55 => u64::from(x > y),
            0x56 => u64::from(a > b),
            0x57 => u64::from(x <= y),
            0x58 => u64::from(a <= b),
            0x59 => u64::from(x >= y),
            0x5a => u64::from(a >= b),
            0x7c => a.wrapping_add(b),
            0x7d => a.wrapping_sub(b),
            0x7e => a.wrapping_mul(b),
            0x7f => x.checked_div(y).ok_or(Trap::IntegerArithmetic)? as u64,
            0x80 => a.checked_div(b).ok_or(Trap::IntegerArithmetic)?,
            0x81 => {
                if y == 0 {
                    return Err(Trap::IntegerArithmetic);
                } else {
                    x.wrapping_rem(y) as u64
                }
            }
            0x82 => a.checked_rem(b).ok_or(Trap::IntegerArithmetic)?,
            0x83 => a & b,
            0x84 => a | b,
            0x85 => a ^ b,
            0x86 => a.wrapping_shl(b as u32),
            0x87 => x.wrapping_shr(b as u32) as u64,
            0x88 => a.wrapping_shr(b as u32),
            0x89 => a.rotate_left(b as u32),
            0x8a => a.rotate_right(b as u32),
            _ => return Err(Trap::UnsupportedOpcode(op.into())),
        })
    }
}
