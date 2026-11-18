//! Scalar execution of the SIMD instructions in the pinned Stockfish guest.
//!
//! The opcode is the unsigned LEB after 0xfd. A vector's low eight bits
//! are byte zero. Only the outer interpreter reads guest memory.

fn mask(width: usize) -> u128 {
    (1u128 << width) - 1
}

fn lane(vector: u128, index: usize, width: usize) -> u64 {
    ((vector >> (index * width)) & mask(width)) as u64
}

fn lanes(width: usize, mut value: impl FnMut(usize) -> u64) -> u128 {
    let mut output = 0;
    let bit_mask = mask(width);
    for index in 0..128 / width {
        output |= (u128::from(value(index)) & bit_mask) << (index * width);
    }
    output
}

fn unary16(input: u128, mut operation: impl FnMut(u16) -> u16) -> u128 {
    lanes(16, |index| {
        u64::from(operation(lane(input, index, 16) as u16))
    })
}

fn binary16(a: u128, b: u128, mut operation: impl FnMut(u16, u16) -> u16) -> u128 {
    lanes(16, |index| {
        u64::from(operation(
            lane(a, index, 16) as u16,
            lane(b, index, 16) as u16,
        ))
    })
}

fn binary32(a: u128, b: u128, mut operation: impl FnMut(u32, u32) -> u32) -> u128 {
    lanes(32, |index| {
        u64::from(operation(
            lane(a, index, 32) as u32,
            lane(b, index, 32) as u32,
        ))
    })
}

fn narrow(a: u128, b: u128, width: usize, mut value: impl FnMut(u64) -> u64) -> u128 {
    let input_lanes = 64 / width;
    lanes(width, |index| {
        let source = if index < input_lanes { a } else { b };
        value(lane(source, index % input_lanes, width * 2))
    })
}

fn extmul_unsigned8(a: u128, b: u128, start: usize) -> u128 {
    lanes(16, |index| {
        lane(a, start + index, 8) * lane(b, start + index, 8)
    })
}

fn signed_product16(a: u128, b: u128, index: usize) -> i32 {
    i32::from(lane(a, index, 16) as i16) * i32::from(lane(b, index, 16) as i16)
}

fn f64_bits(value: f64) -> u64 {
    if value.is_nan() {
        0x7ff8_0000_0000_0000
    } else {
        value.to_bits()
    }
}

fn binary64f(a: u128, b: u128, mut operation: impl FnMut(f64, f64) -> u64) -> u128 {
    lanes(64, |index| {
        operation(
            f64::from_bits(lane(a, index, 64)),
            f64::from_bits(lane(b, index, 64)),
        )
    })
}

/// `0x64` returns an i32 bitmask represented in the low bits. The splat
/// opcodes use the low scalar bits of `input` and return vectors.
pub fn unary(op: u32, input: u128) -> Option<u128> {
    let result = match op {
        0x0f => lanes(8, |_| input as u64),
        0x10 => lanes(16, |_| input as u64),
        0x11 => lanes(32, |_| input as u64),
        0x14 => lanes(64, |_| input as u64),
        0x4d => !input,
        0x64 => {
            let mut result = 0;
            for index in 0..16 {
                result |= u128::from(lane(input, index, 8) >> 7) << index;
            }
            result
        }
        0xa7 => lanes(32, |index| {
            lane(input, index, 16) as i16 as i32 as u32 as u64
        }),
        _ => return None,
    };
    Some(result)
}

/// For shift opcodes `b` holds the i32 shift count in its low bits.
pub fn binary(op: u32, a: u128, b: u128) -> Option<u128> {
    let result = match op {
        0x23 => lanes(8, |index| {
            if lane(a, index, 8) == lane(b, index, 8) {
                0xff
            } else {
                0
            }
        }),
        0x2d => binary16(a, b, |x, y| if x == y { u16::MAX } else { 0 }),
        0x4b => binary64f(a, b, |x, y| if x <= y { u64::MAX } else { 0 }),
        0x4e => a & b,
        0x51 => a ^ b,
        0x65 => narrow(a, b, 8, |value| {
            (value as i16).clamp(-128, 127) as u8 as u64
        }),
        0x66 => narrow(a, b, 8, |value| (value as i16).clamp(0, 255) as u64),
        0x6d => lanes(8, |index| {
            (lane(a, index, 8) as u8).wrapping_shr(b as u32) as u64
        }),
        0x85 => narrow(a, b, 16, |value| {
            (value as i32).clamp(-32768, 32767) as u16 as u64
        }),
        0x86 => narrow(a, b, 16, |value| (value as i32).clamp(0, 65535) as u64),
        0x8b => unary16(a, |value| value.wrapping_shl(b as u32)),
        0x8c => unary16(a, |value| (value as i16).wrapping_shr(b as u32) as u16),
        0x8d => unary16(a, |value| value.wrapping_shr(b as u32)),
        0x8e => binary16(a, b, u16::wrapping_add),
        0x8f => binary16(a, b, |x, y| (x as i16).saturating_add(y as i16) as u16),
        0x91 => binary16(a, b, u16::wrapping_sub),
        0x95 => binary16(a, b, u16::wrapping_mul),
        0x9e => extmul_unsigned8(a, b, 0),
        0x9f => extmul_unsigned8(a, b, 8),
        0xae => binary32(a, b, u32::wrapping_add),
        0xb1 => binary32(a, b, u32::wrapping_sub),
        0xb5 => binary32(a, b, u32::wrapping_mul),
        0xb9 => binary32(a, b, u32::max),
        0xba => lanes(32, |index| {
            signed_product16(a, b, index * 2).wrapping_add(signed_product16(a, b, index * 2 + 1))
                as u32 as u64
        }),
        0xbc => lanes(32, |index| signed_product16(a, b, index) as u32 as u64),
        0xbd => lanes(32, |index| signed_product16(a, b, index + 4) as u32 as u64),
        0xf2 => binary64f(a, b, |x, y| f64_bits(x * y)),
        0xf3 => binary64f(a, b, |x, y| f64_bits(x / y)),
        _ => return None,
    };
    Some(result)
}

pub fn extract_lane(op: u32, vector: u128, index: u8) -> Option<u64> {
    let width = match op {
        0x1b => 32,
        0x1d | 0x21 => 64,
        _ => return None,
    };
    let index = usize::from(index);
    (index < 128 / width).then(|| lane(vector, index, width))
}

pub fn replace_lane(op: u32, vector: u128, index: u8, scalar_bits: u64) -> Option<u128> {
    let width = match op {
        0x1c => 32,
        0x1e | 0x22 => 64,
        _ => return None,
    };
    let shift = usize::from(index) * width;
    if shift >= 128 {
        return None;
    }
    let bit_mask = mask(width);
    Some((vector & !(bit_mask << shift)) | ((u128::from(scalar_bits) & bit_mask) << shift))
}

pub fn shuffle(a: u128, b: u128, indices: [u8; 16]) -> Option<u128> {
    let a = a.to_le_bytes();
    let b = b.to_le_bytes();
    let mut result = [0; 16];
    for (dst, index) in result.iter_mut().zip(indices) {
        *dst = match index {
            0..=15 => a[usize::from(index)],
            16..=31 => b[usize::from(index - 16)],
            _ => return None,
        };
    }
    Some(u128::from_le_bytes(result))
}
