use super::*;
use revm::primitives::{address, keccak256, AccountInfo};
use revm::Database;
type R<T> = Result<T, String>;

#[derive(CandidType, Deserialize)]
pub enum Rule {
    Mint { balance_of: bool },
    Authorization,
    Withdraw { takes_amount: bool },
    Replay,
    TokenReturn { credit_slot: Option<u64> },
    Underflow,
}
#[derive(CandidType, Deserialize, Debug)]
pub struct RuleResult {
    pub reproduced: bool,
    pub observed: Vec<(String, String)>,
}
fn report(reproduced: bool, values: &[(&str, String)]) -> RuleResult {
    RuleResult {
        reproduced,
        observed: values
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    }
}
fn word(n: u64) -> [u8; 32] {
    U256::from(n).to_be_bytes()
}
fn arg(a: Address) -> [u8; 32] {
    a.into_word().0
}
fn data(sig: &str, params: &[[u8; 32]]) -> Vec<u8> {
    let mut v = keccak256(sig.as_bytes())[..4].to_vec();
    for p in params {
        v.extend_from_slice(p)
    }
    v
}
struct Chain {
    db: InMemoryDB,
    owner: Address,
    user: Address,
    dest: Address,
}
impl Chain {
    fn new() -> Self {
        let mut x = Self {
            db: InMemoryDB::default(),
            owner: Address::repeat_byte(0x11),
            user: Address::repeat_byte(0x22),
            dest: Address::repeat_byte(0x33),
        };
        for a in [x.owner, x.user] {
            x.db.insert_account_info(
                a,
                AccountInfo {
                    balance: U256::from(1000000),
                    ..Default::default()
                },
            );
        }
        x
    }
    fn deploy(&mut self, mut code: Vec<u8>, args: &[[u8; 32]], value: u64) -> R<Address> {
        for a in args {
            code.extend_from_slice(a)
        }
        match execute_value(&mut self.db, self.owner, TxKind::Create, code, true, value)? {
            ExecutionResult::Success {
                output: Output::Create(code, Some(a)),
                ..
            } if !code.is_empty() => Ok(a),
            _ => Err("Untested: constructor failed or returned no code".into()),
        }
    }
    fn call(
        &mut self,
        from: Address,
        to: Address,
        sig: &str,
        args: &[[u8; 32]],
        value: u64,
    ) -> R<bool> {
        match execute_value(
            &mut self.db,
            from,
            TxKind::Call(to),
            data(sig, args),
            true,
            value,
        )? {
            ExecutionResult::Success { .. } => Ok(true),
            ExecutionResult::Revert { .. } => Ok(false),
            ExecutionResult::Halt { reason, .. } => {
                Err(format!("Untested: EVM halted ({reason:?})"))
            }
        }
    }
    fn read(&mut self, to: Address, sig: &str, who: Address) -> R<U256> {
        match execute(
            &mut self.db,
            self.user,
            TxKind::Call(to),
            data(sig, &[arg(who)]),
            false,
        )? {
            ExecutionResult::Success {
                output: Output::Call(v),
                ..
            } if v.len() == 32 => Ok(U256::from_be_slice(&v)),
            _ => Err(format!("Untested: getter {sig} did not return a uint256")),
        }
    }
    fn eth(&mut self, who: Address) -> R<U256> {
        Ok(self
            .db
            .basic(who)
            .map_err(|e| format!("{e:?}"))?
            .unwrap_or_default()
            .balance)
    }
    fn credit(&mut self, to: Address, slot: Option<u64>) -> R<U256> {
        if let Some(slot) = slot {
            let mut key = arg(self.user).to_vec();
            key.extend_from_slice(&word(slot));
            return self
                .db
                .storage(to, U256::from_be_slice(keccak256(&key).as_slice()))
                .map_err(|e| format!("{e:?}"));
        }
        self.read(to, "credit(address)", self.user)
    }
}
fn ensure(ok: bool, reason: &str) -> R<()> {
    if ok {
        Ok(())
    } else {
        Err(format!("Untested: {reason}"))
    }
}
#[ic_cdk::query]
pub fn check_contract(rule: Rule, creation_hex: String) -> Result<RuleResult, String> {
    let init = decode_hex(&creation_hex)?;
    let mut c = Chain::new();
    let (owner, user, dest) = (c.owner, c.user, c.dest);
    match rule {
        Rule::Mint { balance_of } => {
            let m = check_mint(creation_hex, balance_of)?;
            Ok(report(
                m.finding == "ordinary mint of seven reproduced",
                &[
                    ("ordinary_receipt", m.ordinary_mint),
                    ("before", m.ordinary_before),
                    ("after", m.ordinary_after),
                    ("control_before", m.control_before),
                    ("control_after", m.control_after),
                ],
            ))
        }
        Rule::Authorization => {
            let t = c.deploy(init, &[], 100)?;
            let via = c.deploy(decode_hex(include_str!("Forwarder.hex"))?, &[], 0)?;
            ensure(
                c.call(owner, t, "pay(address,uint256)", &[arg(dest), word(1)], 0)?
                    && c.eth(dest)? == U256::from(1),
                "direct owner payment failed",
            )?;
            let ok = c.call(
                owner,
                via,
                "forward(address,address)",
                &[arg(t), arg(dest)],
                0,
            )?;
            let after = c.eth(dest)?;
            Ok(report(
                ok && after == U256::from(8),
                &[
                    ("indirect_success", ok.to_string()),
                    ("recipient_before", "1".into()),
                    ("recipient_after", after.to_string()),
                ],
            ))
        }
        Rule::Underflow => {
            let t = c.deploy(init, &[], 0)?;
            ensure(
                c.read(t, "balance(address)", user)? == U256::ZERO,
                "starting balance must be zero",
            )?;
            let ok = c.call(user, t, "burn(uint256)", &[word(1)], 0)?;
            let after = c.read(t, "balance(address)", user)?;
            Ok(report(
                ok && after == U256::MAX,
                &[
                    ("burn_success", ok.to_string()),
                    ("before", "0".into()),
                    ("after", after.to_string()),
                ],
            ))
        }
        Rule::Withdraw { takes_amount } => {
            let t = c.deploy(init, &[], 0)?;
            let atk = c.deploy(decode_hex(include_str!("ReentryProbe.hex"))?, &[], 0)?;
            ensure(
                c.call(owner, t, "deposit()", &[], 20)?,
                "victim deposit failed",
            )?;
            ensure(
                c.call(
                    user,
                    atk,
                    "begin(address,bool)",
                    &[arg(t), word(takes_amount as u64)],
                    7,
                )?,
                "attack setup or first withdrawal failed",
            )?;
            let got = c.eth(atk)?;
            ensure(
                got == U256::from(7) || got == U256::from(14),
                "unexpected payout, review manually",
            )?;
            Ok(report(
                got == U256::from(14),
                &[
                    ("deposit_wei", "7".into()),
                    ("received_wei", got.to_string()),
                ],
            ))
        }
        Rule::TokenReturn { credit_slot } => {
            let token = c.deploy(
                decode_hex(include_str!("ToggleToken.hex"))?,
                &[arg(user)],
                0,
            )?;
            let t = c.deploy(init, &[arg(token)], 0)?;
            let before = c.credit(t, credit_slot)?;
            let ok = c.call(user, t, "deposit(uint256)", &[word(7)], 0)?;
            let claimed = c.credit(t, credit_slot)?;
            let moved = c.read(token, "balance(address)", t)?;
            ensure(
                c.call(owner, token, "enable()", &[], 0)?
                    && c.call(user, t, "deposit(uint256)", &[word(7)], 0)?,
                "successful transfer control failed",
            )?;
            ensure(
                c.credit(t, credit_slot)?.checked_sub(claimed) == Some(U256::from(7))
                    && c.read(token, "balance(address)", t)?.checked_sub(moved)
                        == Some(U256::from(7)),
                "control did not transfer and credit seven",
            )?;
            Ok(report(
                ok && claimed.checked_sub(before) == Some(U256::from(7)) && moved.is_zero(),
                &[
                    ("deposit_success", ok.to_string()),
                    ("credit_before", before.to_string()),
                    ("credit_after", claimed.to_string()),
                    ("tokens_moved", moved.to_string()),
                ],
            ))
        }
        Rule::Replay => {
            // Recovered address for the fixture's digest with v=27, r=s=1, owner nonce 0 and chain 31337.
            let signer = address!("0c1109be813472c935bfa61789c654451fdb37ef");
            let t = c.deploy(init, &[arg(signer)], 0)?;
            let args = [word(1), word(27), word(1), word(1)];
            let sig = "redeem(uint256,uint8,bytes32,bytes32)";
            let before = c.read(t, "points(address)", user)?;
            ensure(c.call(user, t, sig, &args, 0)?, "first signature rejected")?;
            let first = c.read(t, "points(address)", user)?;
            ensure(first > before, "first redemption did not credit points")?;
            let ok = c.call(user, t, sig, &args, 0)?;
            let second = c.read(t, "points(address)", user)?;
            Ok(report(
                ok && second > first,
                &[
                    ("first_points", first.to_string()),
                    ("same_signature_success", ok.to_string()),
                    ("final_points", second.to_string()),
                ],
            ))
        }
    }
}
