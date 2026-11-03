// Decode PUSH operands before counting opcodes; an operand is data, not an executed instruction.
// This is a linear disassembly. Reachability and authorization require separate evidence.
use candid::{CandidType, Deserialize};
use revm::primitives::keccak256;
use std::collections::BTreeSet;

#[derive(CandidType, Deserialize)]
pub struct CodeProfile {
    bytes: u32,
    hash: String,
    selectors: Vec<String>,
    delegatecall: u32,
    origin: u32,
    selfdestruct: u32,
    external_call: u32,
}

#[ic_cdk::query]
pub fn inspect_runtime(code: Vec<u8>) -> Result<CodeProfile, String> {
    if code.is_empty() || code.len() > 131072 {
        return Err("Expected 1–131072 runtime bytes".into());
    }
    let mut end = code.len();
    // Common Solidity CBOR trailers end with their own big-endian length.
    if end >= 4 {
        let n = u16::from_be_bytes([code[end - 2], code[end - 1]]) as usize;
        if n > 0 && n <= end - 2 {
            let tail = &code[end - 2 - n..end - 2];
            if tail[0] >> 5 == 5 && tail.windows(4).any(|x| x == b"solc" || x == b"ipfs") {
                end -= n + 2
            }
        }
    }
    let mut result = CodeProfile {
        bytes: code.len() as u32,
        hash: format!("{:#x}", keccak256(&code)),
        selectors: vec![],
        delegatecall: 0,
        origin: 0,
        selfdestruct: 0,
        external_call: 0,
    };
    let mut selectors = BTreeSet::new();
    let mut i = 0usize;
    while i < end {
        let op = code[i];
        i += 1;
        if (0x60..=0x7f).contains(&op) {
            let n = (op - 0x5f) as usize;
            if n == 4 && i + 4 <= end {
                selectors.insert(format!(
                    "{:08x}",
                    u32::from_be_bytes(code[i..i + 4].try_into().unwrap())
                ));
            }
            i += n;
        } else {
            match op {
                0xf4 => result.delegatecall += 1,
                0x32 => result.origin += 1,
                0xff => result.selfdestruct += 1,
                0xf1 | 0xf2 | 0xfa => result.external_call += 1,
                _ => {}
            }
        }
    }
    result.selectors = selectors.into_iter().collect();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_push_data_and_handles_partial_push() {
        let r = inspect_runtime(vec![0x63, 0xf4, 0xff, 0x32, 0xfa, 0x32, 0x7f, 0xff]).unwrap();
        assert_eq!(
            (r.origin, r.selfdestruct, r.delegatecall, r.external_call),
            (1, 0, 0, 0)
        );
        assert_eq!(r.selectors, ["f4ff32fa"]);
    }
}
