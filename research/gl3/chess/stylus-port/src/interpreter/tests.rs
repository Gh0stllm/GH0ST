use super::*;

struct Code<'a> {
    bytes: &'a [u8],
    start: Function,
    call: Option<Function>,
    link: Option<(u32, ControlLink)>,
}

impl Executable for Code<'_> {
    type Error = ();

    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), Self::Error> {
        let start = offset as usize;
        output.copy_from_slice(self.bytes.get(start..start + output.len()).ok_or(())?);
        Ok(())
    }

    fn function(&mut self, index: u32) -> Result<Option<Function>, Self::Error> {
        Ok(match index {
            0 => Some(self.start),
            1 => self.call,
            _ => None,
        })
    }

    fn signature(&mut self, index: u32) -> Result<Signature, Self::Error> {
        if index == 0 {
            Ok(self.start.signature)
        } else {
            Err(())
        }
    }

    fn control(&mut self, offset: u32) -> Result<ControlLink, Self::Error> {
        self.link
            .filter(|(key, _)| *key == offset)
            .map(|(_, link)| link)
            .ok_or(())
    }

    fn indirect(&mut self, index: u32) -> Result<Option<u32>, Self::Error> {
        Ok((index == 0).then_some(1))
    }
}

#[derive(Default)]
struct Memory([u8; 32]);

impl GuestMemory for Memory {
    type Error = ();

    fn read(&mut self, address: u32, output: &mut [u8]) -> Result<(), Self::Error> {
        let start = address as usize;
        output.copy_from_slice(self.0.get(start..start + output.len()).ok_or(())?);
        Ok(())
    }

    fn write(&mut self, address: u32, input: &[u8]) -> Result<(), Self::Error> {
        let start = address as usize;
        self.0
            .get_mut(start..start + input.len())
            .ok_or(())?
            .copy_from_slice(input);
        Ok(())
    }

    fn size(&self) -> u32 {
        0
    }
    fn grow(&mut self, _: u32) -> Option<u32> {
        None
    }
    fn copy(&mut self, _: u32, _: u32, _: u32) -> Result<(), Self::Error> {
        Err(())
    }
    fn fill(&mut self, _: u32, _: u8, _: u32) -> Result<(), Self::Error> {
        Err(())
    }
}

fn func(entry: u32, end: u32, params: u16) -> Function {
    Function {
        entry,
        end,
        extra_locals: 0,
        signature: Signature {
            params,
            results: 1,
            type_id: u32::from(params),
        },
    }
}

#[test]
fn cold_instruction_resume_preserves_locals_and_call_frames() {
    // Outer: return inner(40). Inner: return its argument + 2.
    let bytes = [0x41, 40, 0x10, 1, 0x0b, 0x20, 0, 0x41, 2, 0x6a, 0x0b];
    let code = || Code {
        bytes: &bytes,
        start: func(0, 4, 0),
        call: Some(func(5, 10, 1)),
        link: None,
    };
    let mut globals = [];
    let mut first = vm(code(), &mut globals);
    first.start(0, &[]).unwrap();
    let mut fuel = 3;
    assert!(matches!(
        first.run_for(&mut fuel).unwrap(),
        InvocationProgress::Pending
    ));
    assert!(first.is_active());
    assert_eq!(fuel, 0);
    let state = first.snapshot().unwrap();

    let mut globals = [];
    let mut fresh = vm(code(), &mut globals);
    assert_eq!(
        fresh.restore(&state[..state.len() - 1]),
        Err(SnapshotError::Format)
    );
    assert!(!fresh.is_active());
    fresh.restore(&state).unwrap();
    assert_eq!(fresh.snapshot().unwrap(), state);
    let mut fuel = 20;
    match fresh.run_for(&mut fuel).unwrap() {
        InvocationProgress::Returned(result) => assert_eq!(result, &[42]),
        InvocationProgress::Pending => panic!("nested call did not finish"),
    }
    assert!(!fresh.is_active());
    assert_eq!(fuel, 16);
}

fn vm<'a>(code: Code<'a>, globals: &'a mut [Value]) -> Machine<'a, Code<'a>, Memory> {
    Machine::new(
        code,
        Memory::default(),
        globals,
        Limits {
            values: 32,
            locals: 32,
            calls: 8,
            blocks: 8,
        },
    )
}

fn numeric_result(opcode: &[u8], operands: &[Value]) -> Result<Value, Trap<(), ()>> {
    let mut bytes = alloc::vec::Vec::new();
    for index in 0..operands.len() {
        bytes.extend([0x20, index as u8]);
    }
    bytes.extend_from_slice(opcode);
    bytes.push(0x0b);
    let code = Code {
        bytes: &bytes,
        start: func(0, bytes.len() as u32 - 1, operands.len() as u16),
        call: None,
        link: None,
    };
    vm(code, &mut [])
        .invoke(0, operands, &mut 30)
        .map(|out| out[0])
}

#[test]
fn software_float_matches_wasm_numeric_results() {
    fn canonical(value: f64) -> Value {
        if value.is_nan() {
            0x7ff8_0000_0000_0000
        } else {
            Value::from(value.to_bits())
        }
    }

    let cases = [
        f64::NEG_INFINITY,
        -3.75,
        -0.5,
        -0.0,
        0.0,
        f64::from_bits(1),
        f64::MIN_POSITIVE,
        2.0,
        3.5,
        f64::MAX,
        f64::INFINITY,
        f64::from_bits(0xfff0_0000_0000_0001),
    ];
    for &left in &cases {
        let input = [Value::from(left.to_bits())];
        for (op, expected) in [
            (0x9b, left.ceil()),
            (0x9c, left.floor()),
            (0x9d, left.trunc()),
            (0x9f, left.sqrt()),
        ] {
            assert_eq!(
                numeric_result(&[op], &input),
                Ok(canonical(expected)),
                "op {op:x}, {input:x?}"
            );
        }
        for &right in &cases {
            let inputs = [input[0], Value::from(right.to_bits())];
            for (op, expected) in [
                (0xa0, canonical(left + right)),
                (0xa1, canonical(left - right)),
                (0xa2, canonical(left * right)),
                (0xa3, canonical(left / right)),
                (0x61, Value::from(left == right)),
                (0x62, Value::from(left != right)),
                (0x65, Value::from(left <= right)),
            ] {
                assert_eq!(
                    numeric_result(&[op], &inputs),
                    Ok(expected),
                    "op {op:x}, {inputs:x?}"
                );
            }
        }
    }
    assert_eq!(numeric_result(&[0xa4], &[0, 1 << 63]), Ok(1 << 63));
    assert_eq!(numeric_result(&[0xa5], &[0, 1 << 63]), Ok(0));
    assert_eq!(numeric_result(&[0x97], &[0, 1 << 31]), Ok(0));
    assert_eq!(
        numeric_result(&[0xbb], &[1]),
        Ok(canonical(f64::from(f32::from_bits(1))))
    );
    assert_eq!(
        numeric_result(&[0xbb], &[0x7f80_0001]),
        Ok(0x7ff8_0000_0000_0000)
    );
    assert_eq!(
        numeric_result(&[0xba], &[u64::MAX.into()]),
        Ok(canonical(u64::MAX as f64))
    );
    assert_eq!(
        numeric_result(&[0xb6], &[canonical(1.0 + 2f64.powi(-24))]),
        Ok(0x3f80_0000)
    );
    assert_eq!(numeric_result(&[0xab], &[canonical(-0.5)]), Ok(0));
    assert_eq!(
        numeric_result(&[0xab], &[canonical(-1.0)]),
        Err(Trap::FloatConversion)
    );
    assert_eq!(
        numeric_result(&[0xaa], &[canonical(-2_147_483_648.0)]),
        Ok(0x8000_0000)
    );
    assert_eq!(
        numeric_result(&[0xaa], &[canonical(2_147_483_648.0)]),
        Err(Trap::FloatConversion)
    );
    assert_eq!(
        numeric_result(&[0xfc, 2], &[canonical(f64::NEG_INFINITY)]),
        Ok(0x8000_0000)
    );
    assert_eq!(
        numeric_result(&[0xfc, 7], &[canonical(f64::INFINITY)]),
        Ok(u64::MAX.into())
    );
    assert_eq!(numeric_result(&[0xfc, 6], &[canonical(f64::NAN)]), Ok(0));
}

#[test]
fn software_float_simd_lanes_preserve_rounding_and_nan_comparisons() {
    let vector = |lo: u64, hi: u64| Value::from(lo) | (Value::from(hi) << 64);
    let left = vector(3.0f64.to_bits(), 0.0f64.to_bits());
    let right = vector(2.0f64.to_bits(), (-0.0f64).to_bits());
    assert_eq!(
        simd::binary(0xf2, left, right),
        Some(vector(6.0f64.to_bits(), (-0.0f64).to_bits()))
    );
    assert_eq!(
        simd::binary(0xf3, left, right),
        Some(vector(1.5f64.to_bits(), 0x7ff8_0000_0000_0000))
    );
    assert_eq!(simd::binary(0x4b, left, right), Some(vector(0, u64::MAX)));
    assert_eq!(
        simd::binary(0x4b, vector(0x7ff0_0000_0000_0001, 0), right),
        Some(vector(0, u64::MAX))
    );
}

#[test]
fn conditional_returns_the_correct_arm_on_repeat_invocations() {
    let code = Code {
        bytes: &[
            0x20, 0, 0x04, 0x7f, 0x41, 0x2a, 0x05, 0x41, 0x07, 0x0b, 0x0b,
        ],
        start: func(0, 10, 1),
        call: None,
        link: Some((
            2,
            ControlLink {
                end: 9,
                else_body: Some(7),
            },
        )),
    };
    let mut vm = vm(code, &mut []);
    let mut fuel = 30;
    assert_eq!(vm.invoke(0, &[1], &mut fuel), Ok(&[42][..]));
    assert_eq!(vm.invoke(0, &[0], &mut fuel), Ok(&[7][..]));
}

#[test]
fn branch_keeps_the_label_result_and_skips_dead_code() {
    let code = Code {
        bytes: &[0x02, 0x7f, 0x41, 42, 0x0e, 0, 0, 0x00, 0x0b, 0x0b],
        start: func(0, 9, 0),
        call: None,
        link: Some((
            0,
            ControlLink {
                end: 8,
                else_body: None,
            },
        )),
    };
    let mut vm = vm(code, &mut []);
    // The branch table consumes its selector, leaving the result below it.
    assert_eq!(vm.invoke(0, &[], &mut 30), Err(Trap::InvalidStack));
    let code = Code {
        bytes: &[0x02, 0x7f, 0x41, 42, 0x41, 0, 0x0e, 0, 0, 0x00, 0x0b, 0x0b],
        start: func(0, 11, 0),
        call: None,
        link: Some((
            0,
            ControlLink {
                end: 10,
                else_body: None,
            },
        )),
    };
    assert_eq!(
        super::tests::vm(code, &mut []).invoke(0, &[], &mut 30),
        Ok(&[42][..])
    );
}

#[test]
fn indirect_calls_validate_the_type_and_share_mutable_memory() {
    let bytes = [
        0x41, 0, 0x11, 0, 0, 0x0b, // indirect call with table index zero
        0x41, 4, 0x41, 0x7f, 0x3a, 0, 0, // store byte -1
        0x41, 4, 0x2c, 0, 0, 0x0b, // signed load of that byte
    ];
    let code = Code {
        bytes: &bytes,
        start: func(0, 5, 0),
        call: Some(func(6, 18, 0)),
        link: None,
    };
    let mut machine = vm(code, &mut []);
    assert_eq!(
        machine.invoke(0, &[], &mut 30),
        Ok(&[u128::from(u32::MAX)][..])
    );
    assert_eq!(machine.memory().0[4], 255);

    let code = Code {
        bytes: &bytes,
        start: func(0, 5, 0),
        call: Some(func(6, 18, 1)),
        link: None,
    };
    assert_eq!(
        vm(code, &mut []).invoke(0, &[], &mut 30),
        Err(Trap::IndirectTypeMismatch)
    );
}

#[test]
fn signed_immediates_and_fuel_fail_closed() {
    let bytes = [
        0x42, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f, 0x0b,
    ];
    let code = Code {
        bytes: &bytes,
        start: func(0, 11, 0),
        call: None,
        link: None,
    };
    assert_eq!(
        vm(code, &mut []).invoke(0, &[], &mut 2),
        Ok(&[u128::from(u64::MAX)][..])
    );
    let code = Code {
        bytes: &bytes,
        start: func(0, 11, 0),
        call: None,
        link: None,
    };
    assert_eq!(vm(code, &mut []).invoke(0, &[], &mut 1), Err(Trap::Fuel));
}
