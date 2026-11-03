mod interpretation;
mod scanner;
mod suite;
mod web;
use candid::Principal;
use candid::{CandidType, Deserialize};
use ic_http_certification::{HttpRequest, HttpResponse};
use interpretation::Interpretation;
use revm::primitives::{Address, Bytes, ExecutionResult, Output, SpecId, TxKind, U256};
use revm::{Evm, InMemoryDB};
use scanner::CodeProfile;

const GAS_LIMIT: u64 = 800_000;
const MAX_BYTES: usize = 12_288;
type Check = Result<Evidence, String>;

#[derive(CandidType, Deserialize, Debug)]
struct Evidence {
    finding: String,
    simulated_address: String,
    ordinary_mint: String,
    ordinary_before: String,
    ordinary_after: String,
    control_before: String,
    control_after: String,
}
#[derive(CandidType, Deserialize)]
struct Demo {
    open_mint: Check,
    protected_mint: Check,
}

fn execute(
    db: &mut InMemoryDB,
    sender: Address,
    target: TxKind,
    data: Vec<u8>,
    commit: bool,
) -> Result<ExecutionResult, String> {
    execute_value(db, sender, target, data, commit, 0)
}
fn execute_value(
    db: &mut InMemoryDB,
    sender: Address,
    target: TxKind,
    data: Vec<u8>,
    commit: bool,
    value: u64,
) -> Result<ExecutionResult, String> {
    let mut evm = Evm::builder()
        .with_db(db)
        .with_spec_id(SpecId::SHANGHAI)
        .modify_cfg_env(|cfg| cfg.chain_id = 31337)
        .modify_tx_env(|tx| {
            tx.caller = sender;
            tx.value = U256::from(value);
            tx.transact_to = target;
            tx.data = Bytes::from(data);
            tx.gas_limit = GAS_LIMIT;
        })
        .build();
    let result = if commit {
        evm.transact_commit()
    } else {
        evm.transact().map(|r| r.result)
    };
    result.map_err(|e| format!("Simulation could not run: {e:?}"))
}

fn calldata(selector: [u8; 4], recipient: Address, amount: Option<u8>) -> Vec<u8> {
    let mut data = selector.to_vec();
    data.extend_from_slice(&recipient.into_word().0);
    if let Some(value) = amount {
        data.extend_from_slice(&U256::from(value).to_be_bytes::<32>());
    }
    data
}

fn balance(
    db: &mut InMemoryDB,
    contract: Address,
    user: Address,
    selector: [u8; 4],
) -> Result<U256, String> {
    match execute(
        db,
        user,
        TxKind::Call(contract),
        calldata(selector, user, None),
        false,
    )? {
        ExecutionResult::Success {
            output: Output::Call(bytes),
            ..
        } if bytes.len() == 32 => Ok(U256::from_be_slice(&bytes)),
        _ => Err("Untested: balance getter did not return a 32-byte value".into()),
    }
}

fn decode_hex(creation_hex: &str) -> Result<Vec<u8>, String> {
    let hex = creation_hex
        .trim()
        .strip_prefix("0x")
        .unwrap_or(creation_hex.trim());
    if hex.is_empty()
        || hex.len() > MAX_BYTES * 2
        || hex.len() % 2 != 0
        || !hex.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(format!(
            "Expected hex EVM creation bytecode, 1 to {MAX_BYTES} bytes"
        ));
    }
    Ok(hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect())
}
#[ic_cdk::query]
fn check_mint(creation_hex: String, use_balance_of: bool) -> Check {
    let init = decode_hex(&creation_hex)?;
    let mut db = InMemoryDB::default();
    let owner = Address::repeat_byte(0x11);
    let user = Address::repeat_byte(0x22);
    let recipient = Address::repeat_byte(0x33);
    let contract = match execute(&mut db, owner, TxKind::Create, init, true)? {
        ExecutionResult::Success {
            output: Output::Create(code, Some(address)),
            ..
        } if !code.is_empty() => address,
        _ => return Err("Untested: deployment failed or returned empty runtime code".into()),
    };
    let getter = if use_balance_of {
        [0x70, 0xa0, 0x82, 0x31]
    } else {
        [0xe3, 0xd6, 0x70, 0xd7]
    };
    let mint = [0x40, 0xc1, 0x0f, 0x19];
    let before = balance(&mut db, contract, user, getter)?;
    let ordinary = execute(
        &mut db,
        user,
        TxKind::Call(contract),
        calldata(mint, user, Some(7)),
        true,
    )?;
    let receipt = match ordinary {
        ExecutionResult::Success { .. } => "succeeded",
        ExecutionResult::Revert { .. } => "reverted",
        ExecutionResult::Halt { .. } => return Err("Untested: ordinary mint halted".into()),
    };
    let after = balance(&mut db, contract, user, getter)?;
    let control_before = balance(&mut db, contract, recipient, getter)?;
    let control = execute(
        &mut db,
        owner,
        TxKind::Call(contract),
        calldata(mint, recipient, Some(7)),
        true,
    )?;
    let control_after = balance(&mut db, contract, recipient, getter)?;
    if !control.is_success() || control_after.checked_sub(control_before) != Some(U256::from(7)) {
        return Err(
            "Untested: deployer control failed to increase the recipient balance by seven".into(),
        );
    }
    let reproduced = receipt == "succeeded" && after.checked_sub(before) == Some(U256::from(7));
    Ok(Evidence {
        finding: if reproduced {
            "ordinary mint of seven reproduced"
        } else {
            "ordinary mint of seven not reproduced in this execution"
        }
        .into(),
        simulated_address: contract.to_string(),
        ordinary_mint: receipt.into(),
        ordinary_before: before.to_string(),
        ordinary_after: after.to_string(),
        control_before: control_before.to_string(),
        control_after: control_after.to_string(),
    })
}

#[ic_cdk::query]
fn demo() -> Demo {
    Demo {
        open_mint: check_mint(include_str!("open.hex").into(), false),
        protected_mint: check_mint(include_str!("protected.hex").into(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runnable_pair_and_failure_paths() {
        let result = demo();
        let open = result.open_mint.unwrap();
        let protected = result.protected_mint.unwrap();
        assert_eq!(
            (open.ordinary_after.as_str(), open.ordinary_mint.as_str()),
            ("7", "succeeded")
        );
        assert_eq!(
            (
                protected.ordinary_after.as_str(),
                protected.ordinary_mint.as_str()
            ),
            ("0", "reverted")
        );
        assert!(check_mint(include_str!("open.hex").into(), true).is_err());
        assert!(check_mint("00".into(), false).is_err());
    }
}
use suite::{Rule, RuleResult};
ic_cdk::export_candid!();
