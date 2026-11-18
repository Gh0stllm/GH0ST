use core::cmp::Ordering;
use ieee_apsqrt::sqrt_accurate;
use rustc_apfloat::{
    ieee::{Double, Single},
    Float, FloatConvert, Round, Status,
};

use super::{Executable, GuestMemory, Machine, Trap, Value, VmResult};

fn f32_bits(value: Single) -> Value {
    if value.is_nan() {
        0x7fc0_0000
    } else {
        value.to_bits()
    }
}

pub(super) fn f64_bits(value: Double) -> u64 {
    if value.is_nan() {
        0x7ff8_0000_0000_0000
    } else {
        value.to_bits() as u64
    }
}

fn compare(op: u8, order: Option<Ordering>) -> Value {
    Value::from(match op {
        0 => order == Some(Ordering::Equal),
        1 => order != Some(Ordering::Equal),
        2 => order == Some(Ordering::Less),
        3 => order == Some(Ordering::Greater),
        4 => matches!(order, Some(Ordering::Less | Ordering::Equal)),
        _ => matches!(order, Some(Ordering::Greater | Ordering::Equal)),
    })
}

fn float_integer<F: Float>(value: F, wide: bool, signed: bool, saturate: bool) -> Option<Value> {
    let width = if wide { 64 } else { 32 };
    // APFloat supplies the saturated endpoint on INVALID_OP, including zero for NaN.
    let converted = if signed {
        value.to_i128(width).map(|number| number as u64)
    } else {
        value.to_u128(width).map(|number| number as u64)
    };
    if !saturate && converted.status.contains(Status::INVALID_OP) {
        return None;
    }
    let bits = if wide {
        converted.value
    } else {
        u64::from(converted.value as u32)
    };
    Some(Value::from(bits))
}

impl<C: Executable, M: GuestMemory> Machine<'_, C, M> {
    pub(super) fn saturating_conversion(&self, opcode: u32, value: Value) -> Value {
        let wide = opcode >= 4;
        let signed = opcode & 1 == 0;
        let converted = if opcode & 2 == 0 {
            float_integer(
                Single::from_bits(Value::from(value as u32)),
                wide,
                signed,
                true,
            )
        } else {
            float_integer(
                Double::from_bits(Value::from(value as u64)),
                wide,
                signed,
                true,
            )
        };
        converted.unwrap_or(0)
    }

    pub(super) fn numeric(&mut self, op: u8) -> VmResult<(), C, M> {
        let right = self.take()?;
        let r32 = right as u32;
        let r64 = right as u64;
        // Decode the software values in the individual floating-point arms.
        // Ordinary integer instructions never pay for APFloat classification.
        let f32r = || Single::from_bits(Value::from(r32));
        let f64r = || Double::from_bits(Value::from(r64));
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
            0x8d => f32_bits(f32r().round_to_integral(Round::TowardPositive).value),
            0x8e => f32_bits(f32r().round_to_integral(Round::TowardNegative).value),
            0x8f => f32_bits(f32r().round_to_integral(Round::TowardZero).value),
            0x91 => f32_bits(Single::from_bits(Value::from(
                sqrt_accurate(r32, Round::NearestTiesToEven).0.value,
            ))),
            0x99 => Value::from(r64 & 0x7fff_ffff_ffff_ffff),
            0x9a => Value::from(r64 ^ 0x8000_0000_0000_0000),
            0x9b => Value::from(f64_bits(
                f64r().round_to_integral(Round::TowardPositive).value,
            )),
            0x9c => Value::from(f64_bits(
                f64r().round_to_integral(Round::TowardNegative).value,
            )),
            0x9d => Value::from(f64_bits(f64r().round_to_integral(Round::TowardZero).value)),
            0x9f => Value::from(f64_bits(Double::from_bits(Value::from(
                sqrt_accurate(r64, Round::NearestTiesToEven).0.value,
            )))),
            0xa7 | 0xbc | 0xbe => Value::from(r32),
            0xa8..=0xab | 0xae..=0xb1 => {
                let wide = op >= 0xae;
                let base = if wide { 0xae } else { 0xa8 };
                let kind = op - base;
                let signed = kind & 1 == 0;
                let converted = if kind & 2 == 0 {
                    float_integer(f32r(), wide, signed, false)
                } else {
                    float_integer(f64r(), wide, signed, false)
                };
                converted.ok_or(Trap::FloatConversion)?
            }
            0xac => Value::from(r32 as i32 as i64 as u64),
            0xad => Value::from(r32),
            0xb2 => f32_bits(Single::from_i128(i128::from(r32 as i32)).value),
            0xb3 => f32_bits(Single::from_u128(Value::from(r32)).value),
            0xb4 => f32_bits(Single::from_i128(i128::from(r64 as i64)).value),
            0xb5 => f32_bits(Single::from_u128(Value::from(r64)).value),
            0xb6 => f32_bits(f64r().convert(&mut false).value),
            0xb7 => Value::from(f64_bits(Double::from_i128(i128::from(r32 as i32)).value)),
            0xb8 => Value::from(f64_bits(Double::from_u128(Value::from(r32)).value)),
            0xb9 => Value::from(f64_bits(Double::from_i128(i128::from(r64 as i64)).value)),
            0xba => Value::from(f64_bits(Double::from_u128(Value::from(r64)).value)),
            0xbb => Value::from(f64_bits(f32r().convert(&mut false).value)),
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
                let left = Single::from_bits(Value::from(bits));
                let right = f32r();
                match op {
                    0x5b..=0x60 => compare(op - 0x5b, left.partial_cmp(&right)),
                    0x92 => f32_bits((left + right).value),
                    0x93 => f32_bits((left - right).value),
                    0x94 => f32_bits((left * right).value),
                    0x95 => f32_bits((left / right).value),
                    0x96 | 0x97 => match left.partial_cmp(&right) {
                        None => 0x7fc0_0000,
                        Some(Ordering::Equal) if op == 0x96 => Value::from(bits | r32),
                        Some(Ordering::Equal) => Value::from(bits & r32),
                        Some(Ordering::Less) if op == 0x96 => Value::from(bits),
                        Some(Ordering::Greater) if op == 0x97 => Value::from(bits),
                        _ => Value::from(r32),
                    },
                    _ => Value::from((bits & 0x7fff_ffff) | (r32 & 0x8000_0000)),
                }
            }
            0x61..=0x66 | 0xa0..=0xa6 => {
                let bits = self.take()? as u64;
                let left = Double::from_bits(Value::from(bits));
                let right = f64r();
                match op {
                    0x61..=0x66 => compare(op - 0x61, left.partial_cmp(&right)),
                    0xa0 => Value::from(f64_bits((left + right).value)),
                    0xa1 => Value::from(f64_bits((left - right).value)),
                    0xa2 => Value::from(f64_bits((left * right).value)),
                    0xa3 => Value::from(f64_bits((left / right).value)),
                    0xa4 | 0xa5 => match left.partial_cmp(&right) {
                        None => 0x7ff8_0000_0000_0000,
                        Some(Ordering::Equal) if op == 0xa4 => Value::from(bits | r64),
                        Some(Ordering::Equal) => Value::from(bits & r64),
                        Some(Ordering::Less) if op == 0xa4 => Value::from(bits),
                        Some(Ordering::Greater) if op == 0xa5 => Value::from(bits),
                        _ => Value::from(r64),
                    },
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
