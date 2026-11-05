//! Read-only receipt verification against the pinned Robinhood mainnet RPC.
use candid::{CandidType, Deserialize, Principal};
use ic_cdk::call::Call;
use ic_management_canister_types::{
    HttpHeader, HttpMethod, HttpRequestArgs, HttpRequestResult, TransformArgs, TransformContext,
    TransformFunc,
};
use revm::primitives::{alloy_primitives::keccak256, hex, U256};
use serde::Serialize;
use serde_json::{json, Value};

const RPC: &str = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID: u64 = 4663;
const TOKEN: &str = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
const TRANSFORM: &str = "bounty_reward_transform";
const RESERVE: u128 = 120_000_000_000;
const MAX_CALL_CYCLES: u128 = 4_000_000_000;
const RECEIPT_LIMIT: u64 = 16 * 1024;
const FINALIZED_LIMIT: u64 = 64 * 1024;
const CANONICAL_LIMIT: u64 = 128 * 1024;
const CALL_LIMIT: u64 = 4 * 1024;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountyRewardConfig {
    pub chain_id: u64,
    pub token_address: String,
    pub escrow_address: String,
}

impl BountyRewardConfig {
    pub(super) fn new(escrow: &str) -> Result<Self, String> {
        let escrow_address = wallet(escrow)?;
        if escrow_address == TOKEN {
            return Err("The token and escrow must have different addresses.".into());
        }
        Ok(Self {
            chain_id: CHAIN_ID,
            token_address: TOKEN.into(),
            escrow_address,
        })
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if Self::new(&self.escrow_address)? != *self {
            return Err("Invalid saved reward escrow configuration.".into());
        }
        Ok(())
    }
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountyReward {
    pub creator_wallet: String,
    pub amount_wei: String,
    pub bounty_key: String,
    pub status: String,
    pub tx_hash: Option<String>,
}

impl BountyReward {
    pub(super) fn new(
        canister: Principal,
        id: u64,
        creator: &str,
        wei: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            creator_wallet: wallet(creator)?,
            amount_wei: amount(wei)?.to_string(),
            bounty_key: hex::encode_prefixed(keccak256(format!(
                "GH0ST_BOUNTIES_V1:{canister}:{id}"
            ))),
            status: "awaiting_funding".into(),
            tx_hash: None,
        })
    }

    pub(super) fn validate(&self, board_status: &str) -> Result<(), String> {
        if wallet(&self.creator_wallet)? != self.creator_wallet
            || amount(&self.amount_wei)?.to_string() != self.amount_wei
            || tx_hash(&self.bounty_key)? != self.bounty_key
            || self
                .tx_hash
                .as_ref()
                .is_some_and(|h| tx_hash(h).as_ref() != Ok(h))
            || !matches!(
                (self.status.as_str(), board_status, self.tx_hash.is_some()),
                ("awaiting_funding", "open", false)
                    | ("funded", "open", true)
                    | ("paid", "completed", true)
                    | ("paid_unmatched", "cancelled", true)
                    | ("cancelled", "cancelled", true)
            )
        {
            return Err("Invalid saved reward state.".into());
        }
        Ok(())
    }
}

fn fixed_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    let s = s.strip_prefix("0x")?;
    if s.len() != 2 * N {
        return None;
    }
    let mut bytes = [0; N];
    hex::decode_to_slice(s, &mut bytes).ok()?;
    Some(bytes)
}

pub(super) fn wallet(raw: &str) -> Result<String, String> {
    fixed_hex::<20>(raw.trim())
        .filter(|bytes| *bytes != [0; 20])
        .map(hex::encode_prefixed)
        .ok_or_else(|| "Enter a nonzero Robinhood wallet or contract address.".into())
}

pub(super) fn tx_hash(raw: &str) -> Result<String, String> {
    fixed_hex::<32>(raw.trim())
        .filter(|bytes| *bytes != [0; 32])
        .map(hex::encode_prefixed)
        .ok_or_else(|| "Enter a Robinhood transaction hash.".into())
}

fn amount(raw: &str) -> Result<U256, String> {
    if raw.is_empty() || raw.len() > 78 || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Enter the positive reward amount in whole wei.".into());
    }
    U256::from_str_radix(raw, 10)
        .ok()
        .filter(|n| !n.is_zero())
        .ok_or_else(|| "Enter a positive reward amount within the uint256 range.".into())
}

fn block_number(v: &Value) -> Option<u64> {
    let digits = v.as_str()?.strip_prefix("0x")?;
    u64::from_str_radix(digits, 16).ok()
}

#[derive(Serialize, Deserialize)]
enum Check {
    Receipt {
        tx_hash: String,
        escrow: String,
        creator: String,
        bounty_key: String,
    },
    Finalized(u64),
    Canonical {
        number: u64,
        hash: String,
    },
    Funded {
        amount: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) enum Action {
    Funded {
        amount: String,
    },
    Paid {
        amount: String,
        submission_id: u64,
        recipient: String,
    },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Receipt {
    block: u64,
    block_hash: String,
    pub(super) action: Action,
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
enum Evidence {
    Receipt(Receipt),
    Pass,
    Retry,
    Invalid,
}

fn receipt(result: &Value, hash: &str, escrow: &str, creator: &str, key: &str) -> Option<Receipt> {
    if result["status"].as_str()? != "0x1"
        || !result["transactionHash"]
            .as_str()?
            .eq_ignore_ascii_case(hash)
        || !result["to"].as_str()?.eq_ignore_ascii_case(escrow)
        || !result["from"].as_str()?.eq_ignore_ascii_case(creator)
    {
        return None;
    }
    let block = block_number(&result["blockNumber"])?;
    let block_hash = tx_hash(result["blockHash"].as_str()?).ok()?;
    let creator_topic = format!("0x{:0>64}", creator.strip_prefix("0x")?);
    let funded = keccak256(b"RewardFunded(address,bytes32,uint256)").0;
    let paid = keccak256(b"RewardPaid(address,bytes32,uint64,address,uint256)").0;
    let cancelled = keccak256(b"RewardCancelled(address,bytes32,uint256)").0;
    let mut action = None;
    for log in result["logs"].as_array()? {
        if !log["address"].as_str()?.eq_ignore_ascii_case(escrow) {
            continue;
        }
        let topics = log["topics"].as_array()?;
        let Some(signature) = topics
            .first()
            .and_then(Value::as_str)
            .and_then(fixed_hex::<32>)
        else {
            continue;
        };
        if ![funded, paid, cancelled].contains(&signature) {
            continue;
        }
        if action.is_some()
            || log["removed"].as_bool()?
            || block_number(&log["blockNumber"])? != block
            || !log["blockHash"].as_str()?.eq_ignore_ascii_case(&block_hash)
            || !log["transactionHash"].as_str()?.eq_ignore_ascii_case(hash)
            || !topics
                .get(1)?
                .as_str()?
                .eq_ignore_ascii_case(&creator_topic)
            || !topics.get(2)?.as_str()?.eq_ignore_ascii_case(key)
        {
            return None;
        }
        let data = log["data"].as_str()?;
        action = Some(match (signature, topics.len()) {
            (s, 3) if s == funded => Action::Funded {
                amount: U256::from_be_bytes(fixed_hex::<32>(data)?).to_string(),
            },
            (s, 3) if s == cancelled => {
                fixed_hex::<32>(data)?;
                Action::Cancelled
            }
            (s, 4) if s == paid => {
                let submission_id =
                    u64::try_from(U256::from_be_bytes(fixed_hex::<32>(topics[3].as_str()?)?))
                        .ok()?;
                let data = fixed_hex::<64>(data)?;
                let recipient = &data[12..32];
                if submission_id == 0 || data[..12] != [0; 12] || recipient == [0; 20] {
                    return None;
                }
                Action::Paid {
                    amount: U256::from_be_slice(&data[32..]).to_string(),
                    submission_id,
                    recipient: hex::encode_prefixed(recipient),
                }
            }
            _ => return None,
        });
    }
    Some(Receipt {
        block,
        block_hash,
        action: action?,
    })
}

fn project(check: Check, raw: &[u8]) -> Option<Evidence> {
    let envelope: Value = serde_json::from_slice(raw).ok()?;
    if envelope["jsonrpc"].as_str()? != "2.0" || envelope["id"].as_u64()? != 1 {
        return None;
    }
    let result = envelope.get("result")?;
    Some(match check {
        Check::Receipt {
            tx_hash,
            escrow,
            creator,
            bounty_key,
        } => {
            if result.is_null() {
                Evidence::Retry
            } else {
                receipt(result, &tx_hash, &escrow, &creator, &bounty_key)
                    .map(Evidence::Receipt)
                    .unwrap_or(Evidence::Invalid)
            }
        }
        Check::Finalized(number) => {
            if block_number(&result["number"])? >= number {
                Evidence::Pass
            } else {
                Evidence::Retry
            }
        }
        Check::Canonical { number, hash } => {
            if block_number(&result["number"])? == number
                && result["hash"].as_str()?.eq_ignore_ascii_case(&hash)
            {
                Evidence::Pass
            } else {
                Evidence::Invalid
            }
        }
        Check::Funded { amount: expected } => {
            let bytes = fixed_hex::<128>(result.as_str()?)?;
            if U256::from_be_slice(&bytes[..32]) == U256::from(1)
                && U256::from_be_slice(&bytes[32..64]) == amount(&expected).ok()?
                && bytes[64..] == [0; 64]
            {
                Evidence::Pass
            } else {
                Evidence::Invalid
            }
        }
    })
}

fn transform_guard() -> Result<(), String> {
    if ic_cdk::api::msg_caller() != Principal::management_canister() {
        return Err("Only the IC HTTPS adapter can transform reward responses.".into());
    }
    Ok(())
}

#[ic_cdk::query(guard = "transform_guard")]
fn bounty_reward_transform(args: TransformArgs) -> HttpRequestResult {
    let mut args = args;
    let r = &mut args.response;
    r.headers.clear();
    let evidence = (r.status == 200u16)
        .then(|| {
            serde_json::from_slice(&args.context)
                .ok()
                .and_then(|c| project(c, &r.body))
        })
        .flatten();
    if let Some(evidence) = evidence {
        r.body = serde_json::to_vec(&evidence).expect("encode reward RPC evidence");
    } else {
        r.status = 502u16.into();
        r.body.clear();
    }
    args.response
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREATOR: &str = "0x1111111111111111111111111111111111111111";
    const ESCROW: &str = "0x2222222222222222222222222222222222222222";
    const RECIPIENT: &str = "0x3333333333333333333333333333333333333333";
    const KEY: &str = "0x4444444444444444444444444444444444444444444444444444444444444444";
    const TX: &str = "0x5555555555555555555555555555555555555555555555555555555555555555";
    const BLOCK: &str = "0x6666666666666666666666666666666666666666666666666666666666666666";

    fn paid_receipt() -> Value {
        let creator_topic = format!("0x{:0>64}", &CREATOR[2..]);
        let signature = hex::encode_prefixed(keccak256(
            b"RewardPaid(address,bytes32,uint64,address,uint256)",
        ));
        let submission_id = format!("0x{:064x}", 42);
        let data = format!("0x{:0>64}{:064x}", &RECIPIENT[2..], 50);
        json!({"status":"0x1","from":CREATOR,"to":ESCROW,"blockNumber":"0x12","blockHash":BLOCK,
            "transactionHash":TX,"logs":[{"address":ESCROW,"removed":false,"blockNumber":"0x12",
            "blockHash":BLOCK,"transactionHash":TX,"topics":[signature,creator_topic,KEY,submission_id],"data":data}]})
    }

    #[test]
    fn escrow_receipts_are_bound_to_sender_contract_key_and_exact_event() {
        let valid = paid_receipt();
        let result = receipt(&valid, TX, ESCROW, CREATOR, KEY).unwrap();
        assert_eq!(result.block, 18);
        assert_eq!(
            result.action,
            Action::Paid {
                amount: "50".into(),
                submission_id: 42,
                recipient: RECIPIENT.into()
            }
        );
        assert!(receipt(&valid, BLOCK, ESCROW, CREATOR, KEY).is_none());
        assert!(receipt(&valid, TX, RECIPIENT, CREATOR, KEY).is_none());
        assert!(receipt(&valid, TX, ESCROW, RECIPIENT, KEY).is_none());
        assert!(receipt(&valid, TX, ESCROW, CREATOR, BLOCK).is_none());
        for (field, value) in [
            ("removed", json!(true)),
            ("blockNumber", json!("0x13")),
            ("blockHash", json!(KEY)),
            ("transactionHash", json!(BLOCK)),
            ("data", json!("0x1234")),
        ] {
            let mut malformed = valid.clone();
            malformed["logs"][0][field] = value;
            assert!(
                receipt(&malformed, TX, ESCROW, CREATOR, KEY).is_none(),
                "{field}"
            );
        }
        let mut ambiguous = valid.clone();
        ambiguous["logs"]
            .as_array_mut()
            .unwrap()
            .push(valid["logs"][0].clone());
        assert!(receipt(&ambiguous, TX, ESCROW, CREATOR, KEY).is_none());
    }

    #[test]
    fn finality_projection_ignores_height_drift_and_live_funding_rejects_terminal_state() {
        let body =
            |result| serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"result":result})).unwrap();
        assert_eq!(
            project(Check::Finalized(18), &body(json!({"number":"0x11"}))),
            Some(Evidence::Retry)
        );
        for number in ["0x12", "0x20"] {
            assert_eq!(
                project(Check::Finalized(18), &body(json!({"number":number}))),
                Some(Evidence::Pass)
            );
        }
        assert_eq!(
            project(
                Check::Canonical {
                    number: 18,
                    hash: BLOCK.into()
                },
                &body(json!({"number":"0x12","hash":KEY}))
            ),
            Some(Evidence::Invalid)
        );
        for (status, amount, expected) in [
            (1, 50, Evidence::Pass),
            (1, 49, Evidence::Invalid),
            (2, 50, Evidence::Invalid),
            (3, 50, Evidence::Invalid),
        ] {
            let words = format!("0x{status:064x}{amount:064x}{:0128x}", 0);
            assert_eq!(
                project(
                    Check::Funded {
                        amount: "50".into()
                    },
                    &body(json!(words))
                ),
                Some(expected)
            );
        }
    }
}

async fn rpc(method: &str, params: Value, check: Check, limit: u64) -> Result<Evidence, String> {
    let body = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
        .expect("encode bounded RPC request");
    let context = serde_json::to_vec(&check).expect("encode bounded reward check");
    let req = HttpRequestArgs {
        url: RPC.into(),
        max_response_bytes: Some(limit),
        method: HttpMethod::POST,
        headers: vec![HttpHeader {
            name: "Content-Type".into(),
            value: "application/json".into(),
        }],
        body: Some(body),
        transform: Some(TransformContext {
            function: TransformFunc::new(ic_cdk::api::canister_self(), TRANSFORM.into()),
            context,
        }),
    };
    let size = candid::encode_one(&req)
        .expect("size bounded reward outcall")
        .len() as u64;
    let cost = ic_cdk::api::cost_http_request(size, limit);
    if cost > MAX_CALL_CYCLES || ic_cdk::api::canister_liquid_cycle_balance() < RESERVE + cost {
        return Err(
            "Reward verification is preserving the canister cycle reserve. Try again later.".into(),
        );
    }
    let response: HttpRequestResult =
        Call::bounded_wait(Principal::management_canister(), "http_request")
            .change_timeout(20)
            .with_cycles(cost)
            .with_arg(&req)
            .await
            .map_err(|_| {
                "Robinhood RPC did not respond within the verification limits. Retry later."
            })?
            .candid()
            .map_err(|_| "Could not decode the Robinhood RPC response. Retry later.")?;
    if response.status != 200u16 {
        return Err("Robinhood RPC could not return verifiable data. Retry later.".into());
    }
    serde_json::from_slice(&response.body)
        .map_err(|_| "Could not decode the verified Robinhood evidence. Retry later.".into())
}

pub(super) async fn read_receipt(
    config: &BountyRewardConfig,
    reward: &BountyReward,
    hash: &str,
) -> Result<Receipt, String> {
    let check = Check::Receipt {
        tx_hash: hash.into(),
        escrow: config.escrow_address.clone(),
        creator: reward.creator_wallet.clone(),
        bounty_key: reward.bounty_key.clone(),
    };
    match rpc(
        "eth_getTransactionReceipt",
        json!([hash]),
        check,
        RECEIPT_LIMIT,
    )
    .await?
    {
        Evidence::Receipt(receipt) => Ok(receipt),
        Evidence::Retry => {
            Err("This transaction receipt is not available yet. Retry after it finalizes.".into())
        }
        _ => Err(
            "This is not a successful escrow transaction for this bounty and creator wallet."
                .into(),
        ),
    }
}

pub(super) async fn check_finalized(receipt: &Receipt) -> Result<(), String> {
    match rpc(
        "eth_getBlockByNumber",
        json!(["finalized", false]),
        Check::Finalized(receipt.block),
        FINALIZED_LIMIT,
    )
    .await?
    {
        Evidence::Pass => Ok(()),
        _ => Err("This escrow transaction has not finalized on Robinhood yet. Retry later.".into()),
    }
}

pub(super) async fn check_canonical(receipt: &Receipt) -> Result<(), String> {
    let check = Check::Canonical {
        number: receipt.block,
        hash: receipt.block_hash.clone(),
    };
    match rpc(
        "eth_getBlockByNumber",
        json!([format!("0x{:x}", receipt.block), false]),
        check,
        CANONICAL_LIMIT,
    )
    .await?
    {
        Evidence::Pass => Ok(()),
        _ => Err("This escrow receipt does not match the canonical Robinhood block.".into()),
    }
}

pub(super) async fn check_funded(
    config: &BountyRewardConfig,
    reward: &BountyReward,
) -> Result<(), String> {
    // The endpoint prunes historical state. Latest may observe a subsequent
    // payout or cancellation, either of which prevents publishing old funding.
    let selector = &keccak256(b"getReward(address,bytes32)").0[..4];
    let creator = reward
        .creator_wallet
        .strip_prefix("0x")
        .expect("saved creator wallet");
    let key = reward
        .bounty_key
        .strip_prefix("0x")
        .expect("saved reward key");
    let data = format!("{}{:0>64}{key}", hex::encode_prefixed(selector), creator);
    let params = json!([{"to":config.escrow_address,"data":data},"latest"]);
    let check = Check::Funded {
        amount: reward.amount_wei.clone(),
    };
    match rpc("eth_call", params, check, CALL_LIMIT).await? {
        Evidence::Pass => Ok(()),
        _ => Err("The escrow no longer holds the advertised reward. Sync its payout or cancellation receipt.".into()),
    }
}
