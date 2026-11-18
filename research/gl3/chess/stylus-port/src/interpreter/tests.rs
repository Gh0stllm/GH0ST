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
