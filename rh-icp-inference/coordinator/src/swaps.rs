//! Pure verification and canonical identity for existing Uniswap v4 Swap logs.
//! Receipt facts are independently retrieved by the coordinator, not supplied by
//! an observer as trusted amounts, addresses, pool IDs or prompt text.
use crate::core::{bytes, hash, hex0, quantity};
use crate::types::{Config, Request, SwapPool, SwapSource};
use ethabi::{ethereum_types::U256, ParamType, Token};
use serde_json::Value;
use std::collections::BTreeSet;

pub const SWAP_EVENT: &str = "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)";
pub const GH0ST: &str = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";

fn address(s: &str) -> Result<Token, String> {
    Ok(Token::Address(ethabi::ethereum_types::H160::from_slice(
        &bytes(s, 20)?,
    )))
}

pub fn pool_id(pool: &SwapPool) -> Result<String, String> {
    if pool.tick_spacing <= 0 || pool.tick_spacing > 32_767 {
        return Err("invalid swap-source tick spacing".into());
    }
    if pool.fee > 1_000_000 && pool.fee != 0x80_0000 {
        return Err("invalid swap-source fee".into());
    }
    Ok(hex0(hash(ethabi::encode(&[
        address(&pool.currency0)?,
        address(&pool.currency1)?,
        Token::Uint(pool.fee.into()),
        Token::Int((pool.tick_spacing as u32).into()),
        address(&pool.hook)?,
    ]))))
}

pub fn validate_pools(pools: Option<&[SwapPool]>) -> Result<(), String> {
    let pools = pools.unwrap_or_default();
    if pools.len() > 32 {
        return Err("too many swap sources".into());
    }
    let mut seen = BTreeSet::new();
    for pool in pools {
        if bytes(&pool.manager, 20)? == vec![0; 20] {
            return Err("zero swap-source manager".into());
        }
        bytes(&pool.pool_id, 32)?;
        let currency0 = bytes(&pool.currency0, 20)?;
        let currency1 = bytes(&pool.currency1, 20)?;
        if currency0 >= currency1 {
            return Err("swap-source currencies must be distinct and sorted".into());
        }
        if pool.currency0.to_lowercase() != GH0ST && pool.currency1.to_lowercase() != GH0ST {
            return Err("swap source does not contain GH0ST".into());
        }
        if pool_id(pool)? != pool.pool_id.to_lowercase() {
            return Err("swap-source pool ID does not match its full key".into());
        }
        if !seen.insert((pool.manager.to_lowercase(), pool.pool_id.to_lowercase())) {
            return Err("duplicate swap source".into());
        }
    }
    Ok(())
}

pub fn source_id(chain_id: u64, source: &SwapSource) -> Result<String, String> {
    Ok(hex0(hash(ethabi::encode(&[
        Token::Uint(chain_id.into()),
        address(&source.manager)?,
        Token::FixedBytes(bytes(&source.pool_id, 32)?),
        Token::FixedBytes(bytes(&source.transaction_hash, 32)?),
        Token::Uint(source.log_index.into()),
    ]))))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedSwap {
    pub source: SwapSource,
    pub sender: String,
    pub amount0: String,
    pub amount1: String,
    pub sqrt_price_x96: String,
    pub liquidity: String,
    pub tick: String,
    pub fee: u32,
    pub block_number: u64,
    pub block_hash: String,
}

fn text(value: &Value) -> Result<String, String> {
    Ok(value.as_str().ok_or("missing swap string")?.to_lowercase())
}

fn uint(token: &Token, width: usize) -> Result<U256, String> {
    let value = token
        .clone()
        .into_uint()
        .ok_or("invalid unsigned swap field")?;
    if !(value >> width).is_zero() {
        return Err("unsigned swap field exceeds ABI width".into());
    }
    Ok(value)
}

fn signed(token: &Token, width: usize) -> Result<String, String> {
    let value = token
        .clone()
        .into_int()
        .ok_or("invalid signed swap field")?;
    let negative = value.bit(width - 1);
    let high = value >> width;
    if (negative && high != (U256::MAX >> width)) || (!negative && !high.is_zero()) {
        return Err("signed swap field is not canonically extended".into());
    }
    if negative {
        let magnitude = (!value).overflowing_add(U256::one()).0;
        Ok(format!("-{magnitude}"))
    } else {
        Ok(value.to_string())
    }
}

pub fn parse_swap_receipt(
    receipt: &Value,
    config: &Config,
    tx: &str,
    log_index: u64,
) -> Result<VerifiedSwap, String> {
    bytes(tx, 32)?;
    if quantity(&receipt["status"])? != 1 || text(&receipt["transactionHash"])? != tx.to_lowercase()
    {
        return Err("failed or mismatched swap transaction".into());
    }
    let block_hash = text(&receipt["blockHash"])?;
    bytes(&block_hash, 32)?;
    let block_number = quantity(&receipt["blockNumber"])?;
    let logs = receipt["logs"].as_array().ok_or("missing swap logs")?;
    let mut matching = logs
        .iter()
        .filter(|l| quantity(&l["logIndex"]).ok() == Some(log_index));
    let log = matching.next().ok_or("swap log absent")?;
    if matching.next().is_some() {
        return Err("duplicate receipt log index".into());
    }
    if log["removed"].as_bool().unwrap_or(false) {
        return Err("removed swap log".into());
    }
    if !log["transactionHash"].is_null() && text(&log["transactionHash"])? != tx.to_lowercase() {
        return Err("swap log transaction mismatch".into());
    }
    if !log["blockHash"].is_null() && text(&log["blockHash"])? != block_hash {
        return Err("swap log block mismatch".into());
    }
    if !log["blockNumber"].is_null() && quantity(&log["blockNumber"])? != block_number {
        return Err("swap log block number mismatch".into());
    }
    let manager = text(&log["address"])?;
    bytes(&manager, 20)?;
    let topics = log["topics"].as_array().ok_or("missing swap topics")?;
    if topics.len() != 3 || text(&topics[0])? != hex0(hash(SWAP_EVENT)) {
        return Err("wrong canonical v4 Swap event".into());
    }
    let id = text(&topics[1])?;
    bytes(&id, 32)?;
    let pool = config
        .swap_sources
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|p| p.manager.to_lowercase() == manager && p.pool_id.to_lowercase() == id)
        .ok_or("unregistered swap source")?;
    // Defense in depth for recovered configuration and future migrations.
    validate_pools(Some(std::slice::from_ref(pool)))?;
    let sender = bytes(topics[2].as_str().ok_or("missing swap sender")?, 32)?;
    if sender[..12] != [0u8; 12] {
        return Err("noncanonical swap sender".into());
    }
    let data = hex::decode(
        log["data"]
            .as_str()
            .ok_or("missing swap data")?
            .strip_prefix("0x")
            .ok_or("invalid swap data")?,
    )
    .map_err(|_| "invalid swap data")?;
    let fields = ethabi::decode(
        &[
            ParamType::Int(128),
            ParamType::Int(128),
            ParamType::Uint(160),
            ParamType::Uint(128),
            ParamType::Int(24),
            ParamType::Uint(24),
        ],
        &data,
    )
    .map_err(|_| "invalid swap event ABI")?;
    if ethabi::encode(&fields) != data {
        return Err("noncanonical swap ABI or trailing data".into());
    }
    Ok(VerifiedSwap {
        source: SwapSource {
            manager,
            pool_id: id,
            transaction_hash: tx.to_lowercase(),
            log_index,
        },
        // A router is often the swap sender; never label this the trader wallet.
        sender: hex0(&sender[12..]),
        amount0: signed(&fields[0], 128)?,
        amount1: signed(&fields[1], 128)?,
        sqrt_price_x96: uint(&fields[2], 160)?.to_string(),
        liquidity: uint(&fields[3], 128)?.to_string(),
        tick: signed(&fields[4], 24)?,
        fee: uint(&fields[5], 24)?.low_u32(),
        block_number,
        block_hash,
    })
}

pub fn swap_request(
    config: &Config,
    swap: &VerifiedSwap,
    timestamp: u64,
) -> Result<Request, String> {
    let prompt = format!(
        "Write one short, cryptic, irreverent GH0ST monologue inspired by a swap. Stay under 200 characters. No URLs or mentions. Pool deltas in raw units: currency0 {}; currency1 {}. Tick {}; fee {}. A swap is a stimulus for your own recurring imagery.",
        swap.amount0, swap.amount1, swap.tick, swap.fee
    );
    Ok(Request {
        id: source_id(config.chain_id, &swap.source)?,
        requester: swap.sender.clone(),
        model_id: config.model_id.clone(),
        prompt_hash: hex0(hash(prompt.as_bytes())),
        prompt,
        max_tokens: 50,
        deadline: timestamp
            .checked_add(3600)
            .ok_or("swap deadline overflow")?,
        tx_hash: swap.source.transaction_hash.clone(),
        log_index: swap.source.log_index,
        block_number: swap.block_number,
        block_hash: swap.block_hash.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        serde_json::from_value(v["config"].clone()).unwrap()
    }
    fn pool() -> SwapPool {
        let mut p = SwapPool {
            manager: "0x3333333333333333333333333333333333333333".into(),
            pool_id: String::new(),
            currency0: "0x0000000000000000000000000000000000000000".into(),
            currency1: GH0ST.into(),
            fee: 3000,
            tick_spacing: 60,
            hook: "0x4444444444444444444444444444444444444444".into(),
        };
        p.pool_id = pool_id(&p).unwrap();
        p
    }
    fn receipt(p: &SwapPool) -> Value {
        let negative = U256::MAX - U256::from(6u8); // -7, canonically sign-extended
        let data = ethabi::encode(&[
            Token::Int(negative),
            Token::Int(9.into()),
            Token::Uint(123.into()),
            Token::Uint(456.into()),
            Token::Int(negative),
            Token::Uint(3000.into()),
        ]);
        serde_json::json!({
            "status":"0x1", "transactionHash":hex0([0x55u8;32]),
            "blockNumber":"0x64", "blockHash":hex0([0x66u8;32]),
            "logs":[{"address":p.manager,"logIndex":"0x7","removed":false,
                "topics":[hex0(hash(SWAP_EVENT)),p.pool_id,hex0([0u8;32])],"data":hex0(data)}]
        })
    }
    #[test]
    fn validates_full_pool_key_and_gh0st_membership() {
        let p = pool();
        validate_pools(Some(&[p.clone()])).unwrap();
        let mut bad = p.clone();
        bad.currency1 = "0x5555555555555555555555555555555555555555".into();
        assert!(validate_pools(Some(&[bad])).is_err());
        let mut bad = p.clone();
        bad.pool_id = hex0([1; 32]);
        assert!(validate_pools(Some(&[bad])).is_err());
        let mut bad = p.clone();
        std::mem::swap(&mut bad.currency0, &mut bad.currency1);
        assert!(validate_pools(Some(&[bad])).is_err());
        assert!(validate_pools(Some(&[p.clone(), p])).is_err());
    }
    #[test]
    fn pool_key_event_topic_and_source_id_match_independent_ethers_vector() {
        // Encoded independently by the JavaScript observer tests. The pool is
        // the saved GH0ST/native ETH pool key, not a fresh onchain-state claim.
        let p = SwapPool {
            manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951".into(),
            pool_id: "0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7".into(),
            currency0: "0x0000000000000000000000000000000000000000".into(),
            currency1: GH0ST.into(),
            fee: 3000,
            tick_spacing: 60,
            hook: "0x25e6366c490225358625d941c7b147360b155040".into(),
        };
        assert_eq!(pool_id(&p).unwrap(), p.pool_id);
        assert_eq!(
            hex0(hash(SWAP_EVENT)),
            "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
        );
        let source = SwapSource {
            manager: p.manager,
            pool_id: p.pool_id,
            transaction_hash: "0x57f63f74d6fec865080ef21a1b3e256193d875abf27391631673e61b149ab1be"
                .into(),
            log_index: 7,
        };
        assert_eq!(
            source_id(4663, &source).unwrap(),
            "0x6cd1437d543ef5a7ea5b195473b195d42a4a76e292fc50a1510b527bea14b6dc"
        );
    }
    #[test]
    fn verified_swap_builds_bounded_derived_request() {
        let p = pool();
        let mut c = config();
        c.swap_sources = Some(vec![p.clone()]);
        let tx = hex0([0x55; 32]);
        let swap = parse_swap_receipt(&receipt(&p), &c, &tx, 7).unwrap();
        assert_eq!(swap.amount0, "-7");
        assert_eq!(swap.amount1, "9");
        assert_eq!(swap.tick, "-7");
        assert_eq!(swap.fee, 3000);
        let request = swap_request(&c, &swap, 1000).unwrap();
        assert_eq!(request.max_tokens, 50);
        assert_eq!(request.deadline, 4600);
        assert_eq!(request.prompt_hash, hex0(hash(request.prompt.as_bytes())));
        assert_eq!(request.id, source_id(c.chain_id, &swap.source).unwrap());
        assert!(request.prompt.len() < 4096);
        let mut next = swap.source.clone();
        next.log_index += 1;
        assert_ne!(source_id(c.chain_id, &next).unwrap(), request.id);
        assert_ne!(source_id(c.chain_id + 1, &swap.source).unwrap(), request.id);
    }
    #[test]
    fn rejects_unregistered_removed_failed_and_malformed_swap_logs() {
        let p = pool();
        let mut c = config();
        c.swap_sources = Some(vec![p.clone()]);
        let tx = hex0([0x55; 32]);
        let original = receipt(&p);
        let mut r = original.clone();
        r["status"] = Value::String("0x0".into());
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        let mut r = original.clone();
        r["logs"][0]["removed"] = Value::Bool(true);
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        let mut r = original.clone();
        r["logs"][0]["address"] = Value::String(hex0([1; 20]));
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        let mut r = original.clone();
        r["logs"][0]["topics"][1] = Value::String(hex0([1; 32]));
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        let mut r = original.clone();
        let data = r["logs"][0]["data"].as_str().unwrap().to_string();
        r["logs"][0]["data"] = Value::String(data + "00");
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        let mut r = original.clone();
        let log = r["logs"][0].clone();
        r["logs"].as_array_mut().unwrap().push(log);
        assert!(parse_swap_receipt(&r, &c, &tx, 7).is_err());
        assert!(parse_swap_receipt(&original, &c, &tx, 8).is_err());
        c.swap_sources = None;
        assert!(parse_swap_receipt(&original, &c, &tx, 7).is_err());
    }
    #[test]
    fn rejects_noncanonical_signed_width() {
        let p = pool();
        let mut c = config();
        c.swap_sources = Some(vec![p.clone()]);
        let mut r = receipt(&p);
        // 2^128 is not a valid int128, even though it fits the EVM ABI word.
        let data = ethabi::encode(&[
            Token::Int(U256::one() << 128),
            Token::Int(1.into()),
            Token::Uint(1.into()),
            Token::Uint(1.into()),
            Token::Int(1.into()),
            Token::Uint(1.into()),
        ]);
        r["logs"][0]["data"] = Value::String(hex0(data));
        assert!(parse_swap_receipt(&r, &c, &hex0([0x55; 32]), 7).is_err());
    }
}
